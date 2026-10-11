import type { CallContext, PluginContext, Tool, ToolResult } from "@/brain/core/tools";
import { errorResult, jsonResult, textResult } from "@/brain/core/tools";
import {
  errorText,
  getInt,
  getString,
  isRecord,
  needArg,
  requireString,
  strField,
} from "@/brain/plugins/google/args";
import { toolDef } from "@/brain/plugins/google/catalog";
import { driveGet, driveList, fileRow, filesByName, readNameQuery } from "@/brain/plugins/google/drive";
import { GoogleApiError } from "@/brain/plugins/google/http";
import {
  extractGoogleResourceID,
  googleIDError,
  isIdFailure,
  looksLikeGoogleURL,
  takeGoogleID,
} from "@/brain/plugins/google/ids";
import { isResult, openUser } from "@/brain/plugins/google/session";

const DOCS = "https://docs.googleapis.com/v1/documents";
const DOC_MIME = "application/vnd.google-apps.document";
const DOC_FIELDS = "files(id, name, createdTime, modifiedTime, webViewLink)";

type Handler = (args: Record<string, unknown>, call: CallContext) => Promise<ToolResult>;

export function docsTools(ctx: PluginContext): Tool[] {
  const bind = (name: string, fn: Handler): Tool => ({ ...toolDef(name), call: fn });
  return [
    bind("docs_search", (args, call) => searchDocs(ctx, args, call)),
    bind("docs_get_content", (args, call) => getContent(ctx, args, call)),
    bind("docs_create", (args, call) => createDoc(ctx, args, call)),
    bind("docs_update_text", (args, call) => updateText(ctx, args, call)),
  ];
}

async function searchDocs(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, errorResult("user_google_email is required"));
  if (isResult(opened)) {
    return opened;
  }
  const named = readNameQuery(args);
  if (named) {
    try {
      const files = await filesByName(opened.api, named, DOC_MIME);
      return jsonResult(files.map(fileRow));
    } catch (e) {
      return errorResult(`Drive API error: ${errorText(e)}`);
    }
  }
  const query = requireString(args, "query");
  if (query === undefined) {
    return errorResult("query is required");
  }
  const pageSize = getInt(args, "page_size", 10);
  try {
    let files: unknown[];
    if (looksLikeGoogleURL(query)) {
      const fileID = extractGoogleResourceID(query);
      if (fileID === "") {
        return errorResult("query looks like a URL but no Google document id was found");
      }
      files = [await driveGet(opened.api, fileID, "id, name, createdTime, modifiedTime, webViewLink")];
    } else {
      const escaped = query.replaceAll("'", "\\'");
      const q = `name contains '${escaped}' and mimeType='${DOC_MIME}' and trashed=false`;
      const listed = await driveList(opened.api, q, pageSize, DOC_FIELDS);
      files = isRecord(listed) && Array.isArray(listed.files) ? listed.files : [];
    }
    if (files.length === 0) {
      return textResult(`No Google Docs found matching '${query}'.`);
    }
    let text = `Found ${files.length} Google Docs matching '${query}':`;
    for (const file of files) {
      const modified = strField(file, "modifiedTime") || "N/A";
      const link = strField(file, "webViewLink") || "#";
      text += `\n- ${strField(file, "name")} (ID: ${strField(file, "id")}) Modified: ${modified} Link: ${link}`;
    }
    return textResult(text);
  } catch (e) {
    return errorResult(`Drive API error: ${errorText(e)}`);
  }
}

async function getContent(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "docs_get_content(document_id=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const taken = takeGoogleID(args, "document_id");
  if (isIdFailure(taken)) {
    return googleIDError(taken, "document_id", "docs_create(title=…) or docs_get_content(document_id=…)");
  }
  try {
    const meta = await driveGet(opened.api, taken, "id, name, mimeType, webViewLink");
    const mime = strField(meta, "mimeType");
    const name = strField(meta, "name") || "Unknown File";
    const link = strField(meta, "webViewLink") || "#";
    let body: string;
    if (mime === DOC_MIME) {
      let doc: unknown;
      try {
        doc = await opened.api.get(`${DOCS}/${encodeURIComponent(taken)}`, { includeTabsContent: true });
      } catch (e) {
        return errorResult(`Docs API error: ${errorText(e)}`);
      }
      body = extractDocText(doc);
    } else {
      const raw = await opened.api.text("GET", `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(taken)}`, undefined, {
        alt: "media",
        supportsAllDrives: true,
      });
      if (raw.status < 200 || raw.status >= 300) {
        return errorResult(`Drive API download error: ${new GoogleApiError(raw.status, raw.text.trim() || String(raw.status)).message}`);
      }
      body = raw.text.includes("\uFFFD")
        ? `[Binary or unsupported text encoding for mimeType '${mime}' - ${new TextEncoder().encode(raw.text).length} bytes]`
        : raw.text;
    }
    return textResult(`File: "${name}" (ID: ${taken}, Type: ${mime})\nLink: ${link}\n\n--- CONTENT ---\n${body}`);
  } catch (e) {
    const msg = errorText(e);
    return errorResult(msg.startsWith("Docs API") || msg.startsWith("Drive API") ? msg : `Drive API error: ${msg}`);
  }
}

async function createDoc(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "docs_create(title=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const title = requireString(args, "title");
  if (title === undefined) {
    return needArg("title", "docs_create(title=…)");
  }
  const content = getString(args, "content", "");
  try {
    const doc = await opened.api.post(DOCS, { title });
    const docID = strField(doc, "documentId");
    if (content !== "") {
      try {
        await opened.api.post(`${DOCS}/${encodeURIComponent(docID)}:batchUpdate`, {
          requests: [{ insertText: { location: { index: 1 }, text: content } }],
        });
      } catch (e) {
        return errorResult(`Docs API error inserting content: ${errorText(e)}`);
      }
    }
    return textResult(`Created Google Doc '${title}' (ID: ${docID}) for ${opened.email}. Link: https://docs.google.com/document/d/${docID}/edit`);
  } catch (e) {
    return errorResult(`Docs API error: ${errorText(e)}`);
  }
}

async function updateText(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "docs_update_text(document_id, start_index, text=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const taken = takeGoogleID(args, "document_id");
  if (isIdFailure(taken)) {
    return googleIDError(taken, "document_id", "docs_create(title=…) then docs_update_text(document_id, start_index, text=…)");
  }
  const startIndex = getInt(args, "start_index", 0);
  const endIndex = getInt(args, "end_index", -1);
  const text = getString(args, "text", "");
  const hasBold = Object.prototype.hasOwnProperty.call(args, "bold");
  const hasItalic = Object.prototype.hasOwnProperty.call(args, "italic");
  const hasUnderline = Object.prototype.hasOwnProperty.call(args, "underline");
  const fontSize = getInt(args, "font_size", 0);
  const fontFamily = getString(args, "font_family", "");
  const textColor = getString(args, "text_color", "");
  const bgColor = getString(args, "background_color", "");
  const hasFormatting = hasBold || hasItalic || hasUnderline || fontSize > 0 || fontFamily !== "" || textColor !== "" || bgColor !== "";
  if (text === "" && !hasFormatting) {
    return needArg("text", "docs_update_text(document_id, start_index, text=…). For bold/colors use docs_batch_update");
  }
  if (hasFormatting && endIndex < 0) {
    return needArg("end_index", "docs_update_text(…, end_index=…) for formatting, or prefer docs_batch_update");
  }
  const textBytes = new TextEncoder().encode(text).length;
  const requests: Record<string, unknown>[] = [];
  const operations: string[] = [];
  if (text !== "") {
    if (endIndex > startIndex) {
      if (startIndex === 0) {
        requests.push({ insertText: { location: { index: 1 }, text } });
        requests.push({
          deleteContentRange: { range: { startIndex: 1 + textBytes, endIndex: endIndex + textBytes } },
        });
      } else {
        requests.push({ deleteContentRange: { range: { startIndex, endIndex } } });
        requests.push({ insertText: { location: { index: startIndex }, text } });
      }
      operations.push(`Replaced text from index ${startIndex} to ${endIndex}`);
    } else {
      const actual = startIndex === 0 ? 1 : startIndex;
      requests.push({ insertText: { location: { index: actual }, text } });
      operations.push(`Inserted text at index ${startIndex}`);
    }
  }
  if (hasFormatting) {
    let formatStart = startIndex;
    let formatEnd = endIndex;
    if (text !== "") {
      if (endIndex > startIndex) {
        formatEnd = startIndex + textBytes;
      } else {
        formatStart = startIndex === 0 ? 1 : startIndex;
        formatEnd = formatStart + textBytes;
      }
    }
    if (formatStart === 0) {
      formatStart = 1;
    }
    if (formatEnd <= formatStart) {
      formatEnd = formatStart + 1;
    }
    const built = textStyle(args, hasBold, hasItalic, hasUnderline, fontSize, fontFamily, textColor, bgColor);
    if (built.fields.length > 0) {
      requests.push({
        updateTextStyle: {
          range: { startIndex: formatStart, endIndex: formatEnd },
          textStyle: built.style,
          fields: built.fields.join(","),
        },
      });
      const details: string[] = [];
      if (hasBold) {
        details.push(`bold=${scalar(args.bold)}`);
      }
      if (hasItalic) {
        details.push(`italic=${scalar(args.italic)}`);
      }
      if (hasUnderline) {
        details.push(`underline=${scalar(args.underline)}`);
      }
      if (fontSize > 0) {
        details.push(`font_size=${fontSize}`);
      }
      if (fontFamily !== "") {
        details.push(`font_family=${fontFamily}`);
      }
      if (textColor !== "") {
        details.push(`text_color=${textColor}`);
      }
      if (bgColor !== "") {
        details.push(`background_color=${bgColor}`);
      }
      operations.push(`Applied formatting (${details.join(", ")}) to range ${formatStart}-${formatEnd}`);
    }
  }
  try {
    await opened.api.post(`${DOCS}/${encodeURIComponent(taken)}:batchUpdate`, { requests });
  } catch (e) {
    return errorResult(`Docs API error: ${errorText(e)}`);
  }
  const link = `https://docs.google.com/document/d/${taken}/edit`;
  const textInfo = text !== "" ? ` Text length: ${textBytes} characters.` : "";
  return textResult(`${operations.join("; ")} in document ${taken}.${textInfo} Link: ${link}`);
}

function textStyle(
  args: Record<string, unknown>,
  hasBold: boolean,
  hasItalic: boolean,
  hasUnderline: boolean,
  fontSize: number,
  fontFamily: string,
  textColor: string,
  bgColor: string,
): { style: Record<string, unknown>; fields: string[] } {
  const style: Record<string, unknown> = {};
  const fields: string[] = [];
  if (hasBold) {
    style.bold = args.bold === true;
    fields.push("bold");
  }
  if (hasItalic) {
    style.italic = args.italic === true;
    fields.push("italic");
  }
  if (hasUnderline) {
    style.underline = args.underline === true;
    fields.push("underline");
  }
  if (fontSize > 0) {
    style.fontSize = { magnitude: fontSize, unit: "PT" };
    fields.push("fontSize");
  }
  if (fontFamily !== "") {
    style.weightedFontFamily = { fontFamily };
    fields.push("weightedFontFamily");
  }
  const fg = colorOf(textColor);
  if (fg) {
    style.foregroundColor = { color: { rgbColor: fg } };
    fields.push("foregroundColor");
  }
  const bg = colorOf(bgColor);
  if (bg) {
    style.backgroundColor = { color: { rgbColor: bg } };
    fields.push("backgroundColor");
  }
  return { style, fields };
}

function colorOf(hex: string): { red: number; green: number; blue: number } | undefined {
  if (hex.length !== 7 || hex[0] !== "#") {
    return undefined;
  }
  const r = hexByte(hex.slice(1, 3));
  const g = hexByte(hex.slice(3, 5));
  const b = hexByte(hex.slice(5, 7));
  if (r < 0 || g < 0 || b < 0) {
    return undefined;
  }
  return { red: r / 255, green: g / 255, blue: b / 255 };
}

function scalar(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "false";
}

function hexByte(s: string): number {
  const n = Number.parseInt(s, 16);
  return /^[0-9a-fA-F]{2}$/.test(s) ? n : -1;
}

function extractDocText(doc: unknown): string {
  if (!isRecord(doc)) {
    return "";
  }
  const parts: string[] = [];
  const body = isRecord(doc.body) ? doc.body : undefined;
  const main = extractElements(isRecord(body) && Array.isArray(body.content) ? body.content : [], "", 0);
  if (main.trim() !== "") {
    parts.push(main);
  }
  const tabs = Array.isArray(doc.tabs) ? doc.tabs : [];
  for (const tab of tabs) {
    const tabText = processTab(tab, 0);
    if (tabText.trim() !== "") {
      parts.push(tabText);
    }
  }
  return parts.join("");
}

function processTab(tab: unknown, level: number): string {
  if (!isRecord(tab)) {
    return "";
  }
  let text = "";
  if (tab.documentTab) {
    text += documentTab(tab, level);
  }
  const children = Array.isArray(tab.childTabs) ? tab.childTabs : [];
  for (const child of children) {
    text += processTab(child, level + 1);
  }
  return text;
}

function documentTab(tab: Record<string, unknown>, level: number): string {
  const props = isRecord(tab.tabProperties) ? tab.tabProperties : undefined;
  let title = strField(props, "title") || "Untitled Tab";
  const tabID = strField(props, "tabId") || "Unknown ID";
  if (level > 0) {
    title = `${"    ".repeat(level)}${title} ( ID: ${tabID})`;
  }
  const documentTab = isRecord(tab.documentTab) ? tab.documentTab : undefined;
  const body = documentTab && isRecord(documentTab.body) ? documentTab.body : undefined;
  if (!body) {
    return "";
  }
  const content = Array.isArray(body.content) ? body.content : [];
  return extractElements(content, title, 0);
}

function extractElements(elements: unknown[], tabName: string, depth: number): string {
  if (depth > 5) {
    return "";
  }
  const lines: string[] = [];
  if (tabName !== "") {
    lines.push(`\n--- TAB: ${tabName} ---\n`);
  }
  for (const elem of elements) {
    if (!isRecord(elem)) {
      continue;
    }
    if (isRecord(elem.paragraph)) {
      const runs = Array.isArray(elem.paragraph.elements) ? elem.paragraph.elements : [];
      let line = "";
      for (const run of runs) {
        const content = strField(isRecord(run) ? run.textRun : undefined, "content");
        if (content !== "") {
          line += content;
        }
      }
      if (line.trim() !== "") {
        lines.push(line);
      }
    } else if (isRecord(elem.table) && Array.isArray(elem.table.tableRows)) {
      for (const row of elem.table.tableRows) {
        const cells = isRecord(row) && Array.isArray(row.tableCells) ? row.tableCells : [];
        for (const cell of cells) {
          const content = isRecord(cell) && Array.isArray(cell.content) ? cell.content : [];
          const cellText = extractElements(content, "", depth + 1);
          if (cellText.trim() !== "") {
            lines.push(cellText);
          }
        }
      }
    }
  }
  return lines.join("");
}
