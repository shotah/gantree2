import type { CallContext, PluginContext, Tool, ToolResult } from "@/brain/core/tools";
import { errorResult, jsonResult, textResult } from "@/brain/core/tools";
import {
  errorText,
  getBoolOnly,
  getInt,
  getString,
  getStringSlice,
  isRecord,
  needArg,
  requireString,
  strField,
  toolHint,
} from "@/brain/plugins/google/args";
import { toolDef } from "@/brain/plugins/google/catalog";
import { GoogleApiError, RawBody, type GoogleClient } from "@/brain/plugins/google/http";
import {
  extractGoogleResourceID,
  googleIDError,
  isIdFailure,
  looksLikeGoogleURL,
  optionalFolderID,
  takeGoogleID,
} from "@/brain/plugins/google/ids";
import { isResult, openUser } from "@/brain/plugins/google/session";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FILE_FIELDS = "nextPageToken, files(id, name, mimeType, webViewLink, iconLink, modifiedTime, size)";
const SHORTCUT = "application/vnd.google-apps.shortcut";
const FOLDER = "application/vnd.google-apps.folder";
const DOC = "application/vnd.google-apps.document";
const SHEET = "application/vnd.google-apps.spreadsheet";
const SLIDES = "application/vnd.google-apps.presentation";
const BOUNDARY = "gantree_drive_upload";

const STRUCTURED = [
  /\b\w+\s*(=|!=|>|<)\s*['"].*?['"]/i,
  /\b\w+\s*(=|!=|>|<)\s*\d+/i,
  /\bcontains\b/i,
  /\bin\s+parents\b/i,
  /\bhas\s*\{/i,
  /\btrashed\s*=\s*(true|false)\b/i,
  /\bstarred\s*=\s*(true|false)\b/i,
  /['"][^'"]+['"]\s+in\s+parents/i,
  /\bfullText\s+contains\b/i,
  /\bname\s*(=|contains)\b/i,
  /\bmimeType\s*(=|!=)\b/i,
];

const IMPORT_MIME: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".text": "text/plain",
  ".html": "text/html",
  ".htm": "text/html",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".rtf": "application/rtf",
  ".odt": "application/vnd.oasis.opendocument.text",
};

type Handler = (args: Record<string, unknown>, call: CallContext) => Promise<ToolResult>;

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  modifiedTime: string;
  size: number;
  createdTime: string;
};

export function driveTools(ctx: PluginContext): Tool[] {
  const bind = (name: string, fn: Handler): Tool => ({ ...toolDef(name), call: fn });
  return [
    bind("drive_search_files", (args, call) => searchFiles(ctx, args, call)),
    bind("drive_get_file_content", (args, call) => fileContent(ctx, args, call)),
    bind("drive_get_file_download_url", (args, call) => downloadUrl(ctx, args, call)),
    bind("drive_create_file", (args, call) => createFile(ctx, args, call)),
    bind("drive_convert_to_doc", (args, call) => convertToDoc(ctx, args, call)),
    bind("drive_create_permission", (args, call) => shareFile(ctx, args, call)),
    bind("drive_get_shareable_link", (args, call) => shareableLink(ctx, args, call)),
  ];
}

export async function driveGet(api: GoogleClient, fileID: string, fields: string): Promise<unknown> {
  return api.get(`${DRIVE}/files/${encodeURIComponent(fileID)}`, { fields, supportsAllDrives: true });
}

export async function driveList(
  api: GoogleClient,
  q: string,
  pageSize: number,
  fields: string,
  extra: { orderBy?: string; driveId?: string; corpora?: string; includeAll?: boolean } = {},
): Promise<unknown> {
  const query: Record<string, string | number | boolean> = {
    q,
    pageSize,
    fields,
    supportsAllDrives: true,
    includeItemsFromAllDrives: extra.includeAll ?? true,
  };
  if (extra.orderBy) {
    query.orderBy = extra.orderBy;
  }
  if (extra.driveId) {
    query.driveId = extra.driveId;
    query.corpora = extra.corpora || "drive";
  } else if (extra.corpora) {
    query.corpora = extra.corpora;
  }
  return api.get(`${DRIVE}/files`, query);
}

function asFile(value: unknown): DriveFile {
  const sizeRaw = isRecord(value) ? value.size : undefined;
  let size = 0;
  if (typeof sizeRaw === "number") {
    size = sizeRaw;
  } else if (typeof sizeRaw === "string" && /^\d+$/.test(sizeRaw)) {
    size = Number(sizeRaw);
  }
  return {
    id: strField(value, "id"),
    name: strField(value, "name"),
    mimeType: strField(value, "mimeType"),
    webViewLink: strField(value, "webViewLink"),
    modifiedTime: strField(value, "modifiedTime"),
    createdTime: strField(value, "createdTime"),
    size,
  };
}

function filesOf(value: unknown): DriveFile[] {
  if (!isRecord(value) || !Array.isArray(value.files)) {
    return [];
  }
  return value.files.map(asFile);
}

function formatList(files: DriveFile[], header: string): string {
  let text = header;
  for (const file of files) {
    const size = file.size > 0 ? `, Size: ${file.size}` : "";
    const modified = file.modifiedTime || "N/A";
    const link = file.webViewLink || "#";
    text += `\n- Name: "${file.name}" (ID: ${file.id}, Type: ${file.mimeType}${size}, Modified: ${modified}) Link: ${link}`;
  }
  return text;
}

export type NameQuery = { prefixes: string[]; contains: string; limit: number };

const SEARCH_LIMIT_DEFAULT = 50;
const SEARCH_LIMIT_MAX = 200;

/** name_prefix / name_contains / name_prefixes. Undefined when none are set. */
export function readNameQuery(args: Record<string, unknown>): NameQuery | undefined {
  const prefixes: string[] = [];
  const one = getString(args, "name_prefix", "").trim();
  if (one) {
    prefixes.push(one);
  }
  for (const prefix of getStringSlice(args, "name_prefixes") ?? []) {
    const trimmed = prefix.trim();
    if (trimmed && !prefixes.includes(trimmed)) {
      prefixes.push(trimmed);
    }
  }
  const contains = getString(args, "name_contains", "").trim();
  if (prefixes.length === 0 && contains === "") {
    return undefined;
  }
  let limit = getInt(args, "limit", SEARCH_LIMIT_DEFAULT);
  if (limit <= 0) {
    limit = SEARCH_LIMIT_DEFAULT;
  }
  return { prefixes: prefixes.slice(0, 20), contains, limit: Math.min(limit, SEARCH_LIMIT_MAX) };
}

export async function filesByName(api: GoogleClient, spec: NameQuery, mime?: string): Promise<DriveFile[]> {
  const ors = [
    ...spec.prefixes.map((prefix) => `name contains '${escapeQuery(prefix)}'`),
    ...(spec.contains ? [`name contains '${escapeQuery(spec.contains)}'`] : []),
  ];
  const parts = ["trashed=false"];
  if (mime) {
    parts.push(`mimeType='${mime}'`);
  }
  if (ors.length === 1) {
    const clause = ors[0];
    if (clause) {
      parts.push(clause);
    }
  } else if (ors.length > 1) {
    parts.push(`(${ors.join(" or ")})`);
  }
  const q = parts.join(" and ");
  const out: DriveFile[] = [];
  const seen = new Set<string>();
  const seenTokens = new Set<string>();
  let pageToken = "";
  let pages = 0;
  while (out.length < spec.limit && pages < 20) {
    const query: Record<string, string | number | boolean> = {
      q,
      pageSize: 100,
      fields: FILE_FIELDS,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    };
    if (pageToken) {
      query.pageToken = pageToken;
    }
    const data = await api.get(`${DRIVE}/files`, query);
    const batch = filesOf(data);
    for (const file of batch) {
      if (seen.has(file.id) || !nameMatches(file.name, spec)) {
        continue;
      }
      seen.add(file.id);
      out.push(file);
      if (out.length >= spec.limit) {
        break;
      }
    }
    pageToken = strField(data, "nextPageToken");
    pages += 1;
    if (!pageToken || seenTokens.has(pageToken) || batch.length === 0) {
      break;
    }
    seenTokens.add(pageToken);
  }
  return out;
}

export function fileRow(file: DriveFile): { id: string; name: string; mimeType: string; modifiedTime: string; link: string } {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    link: file.webViewLink,
  };
}

function escapeQuery(value: string): string {
  return value.replaceAll("'", "\\'");
}

function nameMatches(name: string, spec: NameQuery): boolean {
  const lower = name.toLowerCase();
  if (spec.prefixes.length > 0 && !spec.prefixes.some((prefix) => lower.startsWith(prefix.toLowerCase()))) {
    return false;
  }
  if (spec.contains !== "" && !lower.includes(spec.contains.toLowerCase())) {
    return false;
  }
  return true;
}

function isStructured(query: string): boolean {
  return STRUCTURED.some((pattern) => pattern.test(query));
}

async function searchFiles(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "drive_search_files(query=\"…\")"));
  if (isResult(opened)) {
    return opened;
  }
  const named = readNameQuery(args);
  if (named) {
    try {
      const files = await filesByName(opened.api, named);
      return jsonResult(files.map(fileRow));
    } catch (e) {
      return errorResult(`Drive API error: ${errorText(e)}`);
    }
  }
  const query = requireString(args, "query");
  if (query === undefined) {
    return needArg("query", "drive_search_files(query=\"Budget\") or drive_search_files(name_prefix=\"…\")");
  }
  const pageSize = getInt(args, "page_size", 10);
  const driveID = getString(args, "drive_id", "");
  const includeAll = getBoolOnly(args, "include_items_from_all_drives", true);
  const corpora = getString(args, "corpora", "");
  try {
    if (looksLikeGoogleURL(query)) {
      const fileID = extractGoogleResourceID(query);
      if (fileID === "") {
        return errorResult("query looks like a URL but no Google file id was found");
      }
      const meta = asFile(await driveGet(opened.api, fileID, "id, name, mimeType, webViewLink, iconLink, modifiedTime, size"));
      return textResult(formatList([meta], `Resolved 1 file for ${opened.email} from URL:`));
    }
    const files = await listForQuery(opened.api, query, pageSize, driveID, includeAll, corpora);
    if (files.length === 0) {
      return textResult(`No files found for '${query}'.`);
    }
    return textResult(formatList(files, `Found ${files.length} files for ${opened.email} matching '${query}':`));
  } catch (e) {
    return errorResult(`Drive API error: ${errorText(e)}`);
  }
}

async function listForQuery(
  api: GoogleClient,
  query: string,
  pageSize: number,
  driveID: string,
  includeAll: boolean,
  corpora: string,
): Promise<DriveFile[]> {
  const extra = { driveId: driveID, corpora, includeAll };
  if (isStructured(query)) {
    return filesOf(await driveList(api, query, pageSize, FILE_FIELDS, extra));
  }
  const escaped = query.replaceAll("'", "\\'");
  const named = filesOf(await driveList(api, `name contains '${escaped}' and trashed=false`, pageSize, FILE_FIELDS, extra));
  if (named.length > 0) {
    return named;
  }
  return filesOf(await driveList(api, `fullText contains '${escaped}' and trashed=false`, pageSize, FILE_FIELDS, extra));
}

async function fileContent(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "drive_get_file_content(file_id=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const taken = takeGoogleID(args, "file_id");
  if (isIdFailure(taken)) {
    return googleIDError(taken, "file_id", "drive_search_files(query=\"…\") then drive_get_file_content(file_id)");
  }
  try {
    const resolved = await resolveItem(opened.api, taken);
    const exportMIME = nativeExport(resolved.file.mimeType);
    const body = await download(opened.api, resolved.id, exportMIME);
    const name = resolved.file.name || "Unknown File";
    const link = resolved.file.webViewLink || "#";
    const header = `File: "${name}" (ID: ${resolved.id}, Type: ${resolved.file.mimeType})\nLink: ${link}\n\n--- CONTENT ---\n`;
    return textResult(header + decodeText(body, resolved.file.mimeType));
  } catch (e) {
    return errorResult(errorText(e).startsWith("Drive API ") ? errorText(e) : `Drive API error: ${errorText(e)}`);
  }
}

async function downloadUrl(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "drive_get_file_download_url(file_id=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const taken = takeGoogleID(args, "file_id");
  if (isIdFailure(taken)) {
    return googleIDError(taken, "file_id", "drive_search_files(query=\"…\") then drive_get_file_download_url(file_id)");
  }
  const exportFormat = getString(args, "export_format", "");
  try {
    const resolved = await resolveItem(opened.api, taken);
    const formats = exportFormatOf(resolved.file.mimeType, exportFormat);
    const body = await download(opened.api, resolved.id, formats.exportMIME);
    const output = formats.exportMIME === "" ? resolved.file.mimeType : formats.outputMIME;
    const bytes = new TextEncoder().encode(body).length;
    const kb = (bytes / 1024).toFixed(1);
    const name = resolved.file.name || "Unknown File";
    let text = `File downloaded successfully!\nFile: ${name}\nFile ID: ${resolved.id}\nSize: ${kb} KB (${bytes} bytes)\nMIME Type: ${output}`;
    if (formats.exportMIME !== "") {
      text += `\n\nNote: Google native file exported to ${output} format.`;
    }
    return textResult(text);
  } catch (e) {
    return errorResult(errorText(e).startsWith("Drive API ") ? errorText(e) : `Drive API error: ${errorText(e)}`);
  }
}

async function shareableLink(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "drive_get_shareable_link(file_id=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const taken = takeGoogleID(args, "file_id");
  if (isIdFailure(taken)) {
    return googleIDError(taken, "file_id", "drive_search_files(query=\"…\") then drive_get_shareable_link(file_id)");
  }
  try {
    const resolved = await resolveItem(opened.api, taken);
    const meta = await driveGet(
      opened.api,
      resolved.id,
      "id, name, mimeType, webViewLink, webContentLink, shared, permissions(id, type, role, emailAddress, domain, expirationTime)",
    );
    const file = asFile(meta);
    const shared = isRecord(meta) && meta.shared === true;
    const view = file.webViewLink || "N/A";
    let text = `File: ${file.name}\nID: ${resolved.id}\nType: ${file.mimeType}\nShared: ${shared}\n\nLinks:\n  View: ${view}\n`;
    const downloadLink = strField(meta, "webContentLink");
    if (downloadLink !== "") {
      text += `  Download: ${downloadLink}\n`;
    }
    const perms = permissionsOf(meta);
    if (perms.length > 0) {
      text += "\nCurrent permissions:\n";
      for (const perm of perms) {
        text += `  - ${formatPermission(perm)}\n`;
      }
    }
    return textResult(text);
  } catch (e) {
    return errorResult(`Drive API error: ${errorText(e)}`);
  }
}

async function createFile(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "drive_create_file(file_name, content=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const fileName = requireString(args, "file_name");
  if (fileName === undefined) {
    return needArg("file_name", "drive_create_file(file_name, content=…)");
  }
  const content = getString(args, "content", "");
  const fileURL = getString(args, "fileUrl", "");
  if (content === "" && fileURL === "") {
    return toolHint("content is required", "drive_create_file(file_name, content=…)");
  }
  if (content === "") {
    return errorResult("fileUrl support is not yet implemented in the Go server. Please use 'content' parameter instead.");
  }
  const folderID = optionalFolderID(args, "root");
  const mimeType = getString(args, "mime_type", "text/plain");
  try {
    const parent = await resolveFolder(opened.api, folderID);
    const created = asFile(await upload(opened.api, {
      name: fileName,
      parents: [parent],
      mimeType,
    }, content, mimeType, "id, name, webViewLink"));
    const link = created.webViewLink || "No link available";
    return textResult(`Successfully created file '${created.name}' (ID: ${created.id}) in folder '${folderID}' for ${opened.email}. Link: ${link}`);
  } catch (e) {
    return errorResult(`Drive API error: ${errorText(e)}`);
  }
}

async function convertToDoc(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "drive_convert_to_doc(file_name, content=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const fileName = requireString(args, "file_name");
  if (fileName === undefined) {
    return needArg("file_name", "drive_convert_to_doc(file_name, content=…)");
  }
  const content = getString(args, "content", "");
  const filePath = getString(args, "file_path", "");
  const fileURL = getString(args, "file_url", "");
  const sources = [content, filePath, fileURL].filter((part) => part !== "").length;
  if (sources === 0) {
    return toolHint("content is required", "drive_convert_to_doc(file_name, content=…)");
  }
  if (sources > 1) {
    return toolHint("provide only one source", "drive_convert_to_doc(file_name, content=…)");
  }
  const sourceFormat = getString(args, "source_format", "");
  let sourceMIME: string;
  if (sourceFormat !== "") {
    const key = `.${sourceFormat.replace(/^\./, "").toLowerCase()}`;
    const mapped = IMPORT_MIME[key];
    if (!mapped) {
      return errorResult(`Unsupported source_format: '${sourceFormat}'`);
    }
    sourceMIME = mapped;
  } else {
    sourceMIME = detectSource(fileName, content);
  }
  if (content === "") {
    return errorResult("file_path and file_url support are not yet implemented in the Go server. Please use 'content' parameter instead.");
  }
  const folderID = optionalFolderID(args, "root");
  const dot = fileName.lastIndexOf(".");
  const docName = dot > 0 ? fileName.slice(0, dot) : fileName;
  try {
    const parent = await resolveFolder(opened.api, folderID);
    const created = asFile(await upload(opened.api, {
      name: docName,
      parents: [parent],
      mimeType: DOC,
    }, content, sourceMIME, "id, name, webViewLink, mimeType"));
    const link = created.webViewLink || "No link available";
    return textResult(
      `Successfully imported '${docName}' as Google Doc\n   Document ID: ${created.id}\n   Source format: ${sourceMIME}\n   Folder: ${folderID}\n   Link: ${link}`,
    );
  } catch (e) {
    return errorResult(`Drive API error: ${errorText(e)}`);
  }
}

async function shareFile(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "drive_create_permission(file_id, share_with, role)"));
  if (isResult(opened)) {
    return opened;
  }
  const taken = takeGoogleID(args, "file_id");
  if (isIdFailure(taken)) {
    return googleIDError(taken, "file_id", "drive_search_files(query=\"…\") then drive_create_permission(file_id, share_with, role)");
  }
  const shareWith = getString(args, "share_with", "");
  const role = getString(args, "role", "reader");
  const shareType = getString(args, "share_type", "user");
  if (role !== "reader" && role !== "commenter" && role !== "writer") {
    return toolHint(`invalid role '${role}'`, "drive_create_permission(file_id, share_with, role=\"reader\"|\"commenter\"|\"writer\")");
  }
  if (shareType !== "user" && shareType !== "group" && shareType !== "domain" && shareType !== "anyone") {
    return toolHint(`invalid share_type '${shareType}'`, "drive_create_permission(file_id, share_with, share_type=\"user\"|\"anyone\")");
  }
  if ((shareType === "user" || shareType === "group") && shareWith === "") {
    return needArg("share_with", "drive_create_permission(file_id, share_with=\"user@example.com\", role=\"reader\")");
  }
  if (shareType === "domain" && shareWith === "") {
    return needArg("share_with", "drive_create_permission(file_id, share_with=\"example.com\", share_type=\"domain\")");
  }
  const sendNotification = getBoolOnly(args, "send_notification", true);
  const emailMessage = getString(args, "email_message", "");
  const expiration = getString(args, "expiration_time", "");
  try {
    const resolved = await resolveItem(opened.api, taken);
    const perm: Record<string, unknown> = { type: shareType, role };
    if (shareType === "user" || shareType === "group") {
      perm.emailAddress = shareWith;
    } else if (shareType === "domain") {
      perm.domain = shareWith;
    }
    if (expiration !== "") {
      perm.expirationTime = expiration;
    }
    if ((shareType === "domain" || shareType === "anyone") && typeof args.allow_file_discovery === "boolean") {
      perm.allowFileDiscovery = args.allow_file_discovery;
    }
    const query: Record<string, string | boolean> = {
      supportsAllDrives: true,
      fields: "id, type, role, emailAddress, domain, expirationTime",
    };
    if (shareType === "user" || shareType === "group") {
      query.sendNotificationEmail = sendNotification;
      if (emailMessage !== "") {
        query.emailMessage = emailMessage;
      }
    }
    const created = await opened.api.post(`${DRIVE}/files/${encodeURIComponent(resolved.id)}/permissions`, perm, query);
    const name = resolved.file.name || "Unknown";
    const link = resolved.file.webViewLink || "N/A";
    return textResult(`Successfully shared '${name}'\n\nPermission created:\n  - ${formatPermission(created)}\n\nView link: ${link}`);
  } catch (e) {
    return errorResult(`Drive API error: ${errorText(e)}`);
  }
}

async function resolveItem(api: GoogleClient, fileID: string): Promise<{ id: string; file: DriveFile }> {
  const start = extractGoogleResourceID(fileID);
  if (start === "") {
    throw new Error("invalid file id or share URL");
  }
  let current = start;
  for (let depth = 0; ; depth++) {
    const meta = await driveGet(api, current, "id, mimeType, name, webViewLink, parents, shortcutDetails(targetId, targetMimeType)");
    const file = asFile(meta);
    if (file.mimeType !== SHORTCUT) {
      return { id: current, file };
    }
    const target = strField(isRecord(meta) ? meta.shortcutDetails : undefined, "targetId");
    if (target === "") {
      throw new Error(`shortcut '${current}' is missing target details`);
    }
    if (depth >= 5) {
      throw new Error(`shortcut resolution exceeded 5 hops starting from '${fileID}'`);
    }
    current = target;
  }
}

async function resolveFolder(api: GoogleClient, folderID: string): Promise<string> {
  const id = extractGoogleResourceID(folderID);
  if (id === "") {
    throw new Error("invalid folder id or share URL");
  }
  if (id === "root") {
    return "root";
  }
  const resolved = await resolveItem(api, id);
  if (resolved.file.mimeType !== FOLDER) {
    throw new Error(`resolved ID '${resolved.id}' (from '${folderID}') is not a folder; mimeType=${resolved.file.mimeType}`);
  }
  return resolved.id;
}

async function download(api: GoogleClient, fileID: string, exportMIME: string): Promise<string> {
  if (exportMIME !== "") {
    const raw = await api.text("GET", `${DRIVE}/files/${encodeURIComponent(fileID)}/export`, undefined, { mimeType: exportMIME });
    if (raw.status < 200 || raw.status >= 300) {
      throw new Error(`Drive API export error: ${new GoogleApiError(raw.status, raw.text.trim() || String(raw.status)).message}`);
    }
    return raw.text;
  }
  const raw = await api.text("GET", `${DRIVE}/files/${encodeURIComponent(fileID)}`, undefined, {
    alt: "media",
    supportsAllDrives: true,
  });
  if (raw.status < 200 || raw.status >= 300) {
    throw new Error(`Drive API download error: ${new GoogleApiError(raw.status, raw.text.trim() || String(raw.status)).message}`);
  }
  return raw.text;
}

function nativeExport(mime: string): string {
  if (mime === DOC || mime === SLIDES) {
    return "text/plain";
  }
  if (mime === SHEET) {
    return "text/csv";
  }
  return "";
}

function exportFormatOf(mime: string, format: string): { exportMIME: string; outputMIME: string } {
  if (mime === DOC) {
    if (format === "docx") {
      const word = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      return { exportMIME: word, outputMIME: word };
    }
    return { exportMIME: "application/pdf", outputMIME: "application/pdf" };
  }
  if (mime === SHEET) {
    if (format === "csv") {
      return { exportMIME: "text/csv", outputMIME: "text/csv" };
    }
    if (format === "pdf") {
      return { exportMIME: "application/pdf", outputMIME: "application/pdf" };
    }
    const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return { exportMIME: xlsx, outputMIME: xlsx };
  }
  if (mime === SLIDES) {
    if (format === "pptx") {
      const pptx = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      return { exportMIME: pptx, outputMIME: pptx };
    }
    return { exportMIME: "application/pdf", outputMIME: "application/pdf" };
  }
  return { exportMIME: "", outputMIME: mime };
}

function decodeText(data: string, mime: string): string {
  if (data.includes("\uFFFD") && data.length > 0) {
    return `[Binary or unsupported text encoding for mimeType '${mime}' - ${new TextEncoder().encode(data).length} bytes]`;
  }
  return data;
}

async function upload(
  api: GoogleClient,
  meta: Record<string, unknown>,
  media: string,
  mediaType: string,
  fields: string,
): Promise<unknown> {
  const payload = [
    `--${BOUNDARY}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(meta),
    `--${BOUNDARY}`,
    `Content-Type: ${mediaType}`,
    "",
    media,
    `--${BOUNDARY}--`,
    "",
  ].join("\r\n");
  return api.post(UPLOAD, new RawBody(`multipart/related; boundary=${BOUNDARY}`, payload), {
    uploadType: "multipart",
    supportsAllDrives: true,
    fields,
  });
}

function detectSource(fileName: string, content: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx >= 0) {
    const mapped = IMPORT_MIME[fileName.slice(idx).toLowerCase()];
    if (mapped) {
      return mapped;
    }
  }
  if (content !== "" && (content.startsWith("#") || content.includes("```") || content.includes("**"))) {
    return "text/markdown";
  }
  return "text/plain";
}

function permissionsOf(value: unknown): unknown[] {
  return isRecord(value) && Array.isArray(value.permissions) ? value.permissions : [];
}

function formatPermission(value: unknown): string {
  const type = strField(value, "type");
  const role = strField(value, "role");
  const id = strField(value, "id");
  let base: string;
  if (type === "anyone") {
    base = `Anyone with the link (${role}) [id: ${id}]`;
  } else if (type === "user") {
    base = `User: ${strField(value, "emailAddress") || "unknown"} (${role}) [id: ${id}]`;
  } else if (type === "group") {
    base = `Group: ${strField(value, "emailAddress") || "unknown"} (${role}) [id: ${id}]`;
  } else if (type === "domain") {
    base = `Domain: ${strField(value, "domain") || "unknown"} (${role}) [id: ${id}]`;
  } else {
    base = `${type} (${role}) [id: ${id}]`;
  }
  const extras: string[] = [];
  const expires = strField(value, "expirationTime");
  if (expires !== "") {
    extras.push(`expires: ${expires}`);
  }
  const details = isRecord(value) && Array.isArray(value.permissionDetails) ? value.permissionDetails : [];
  for (const detail of details) {
    if (isRecord(detail) && detail.inherited === true && strField(detail, "inheritedFrom") !== "") {
      extras.push(`inherited from: ${strField(detail, "inheritedFrom")}`);
      break;
    }
  }
  return extras.length > 0 ? `${base} | ${extras.join(", ")}` : base;
}
