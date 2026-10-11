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
} from "@/brain/plugins/google/args";
import { toolDef } from "@/brain/plugins/google/catalog";
import { driveGet, driveList, fileRow, filesByName, readNameQuery } from "@/brain/plugins/google/drive";
import {
  extractGoogleResourceID,
  googleIDError,
  isIdFailure,
  looksLikeGoogleURL,
  takeGoogleID,
} from "@/brain/plugins/google/ids";
import { isResult, openUser } from "@/brain/plugins/google/session";

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const ROW_CAP = 1000;

type Handler = (args: Record<string, unknown>, call: CallContext) => Promise<ToolResult>;
type Grid = unknown[][];
type Update = { range: string; values: Grid };

export function sheetsTools(ctx: PluginContext): Tool[] {
  const bind = (name: string, fn: Handler): Tool => ({ ...toolDef(name), call: fn });
  return [
    bind("sheets_list_spreadsheets", (args, call) => listSheets(ctx, args, call)),
    bind("sheets_get_values", (args, call) => getValues(ctx, args, call)),
    bind("sheets_update_values", (args, call) => updateValues(ctx, args, call)),
    bind("sheets_create_spreadsheet", (args, call) => createSheet(ctx, args, call)),
  ];
}

async function listSheets(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return opened;
  }
  const named = readNameQuery(args);
  if (named) {
    try {
      const files = await filesByName(opened.api, named, SHEET_MIME);
      return jsonResult(files.map(fileRow));
    } catch (e) {
      return errorResult(`listing spreadsheets: ${errorText(e)}`);
    }
  }
  const query = getString(args, "query", "").trim();
  const maxResults = getInt(args, "max_results", 25);
  try {
    if (looksLikeGoogleURL(query)) {
      const fileID = extractGoogleResourceID(query);
      if (fileID === "") {
        return errorResult("query looks like a URL but no Google spreadsheet id was found");
      }
      const meta = await driveGet(opened.api, fileID, "id,name,modifiedTime,webViewLink,mimeType");
      return textResult(formatSpreadsheetList([meta], opened.email, query));
    }
    let q = `mimeType='${SHEET_MIME}' and trashed=false`;
    if (query !== "") {
      q = `name contains '${query.replaceAll("'", "\\'")}' and ${q}`;
    }
    const listed = await driveList(opened.api, q, maxResults, "files(id,name,modifiedTime,webViewLink)", {
      orderBy: "modifiedTime desc",
    });
    const files = isRecord(listed) && Array.isArray(listed.files) ? listed.files : [];
    if (files.length === 0) {
      return textResult(query !== ""
        ? `No spreadsheets found for ${opened.email} matching '${query}'.`
        : `No spreadsheets found for ${opened.email}.`);
    }
    return textResult(formatSpreadsheetList(files, opened.email, query));
  } catch (e) {
    return errorResult(looksLikeGoogleURL(query) ? `getting spreadsheet: ${errorText(e)}` : `listing spreadsheets: ${errorText(e)}`);
  }
}

function formatSpreadsheetList(files: unknown[], email: string, query: string): string {
  let text = query !== ""
    ? `Found ${files.length} spreadsheets for ${email} matching '${query}':`
    : `Successfully listed ${files.length} spreadsheets for ${email}:`;
  for (const file of files) {
    const modified = strField(file, "modifiedTime") || "Unknown";
    const link = strField(file, "webViewLink") || "No link";
    text += `\n- "${strField(file, "name")}" (ID: ${strField(file, "id")}) | Modified: ${modified} | Link: ${link}`;
  }
  return text;
}

async function getValues(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "sheets_get_values(spreadsheet_id, range_name=\"Sheet1!A1:D10\")"));
  if (isResult(opened)) {
    return opened;
  }
  const taken = takeGoogleID(args, "spreadsheet_id");
  if (isIdFailure(taken)) {
    return googleIDError(taken, "spreadsheet_id", "sheets_create_spreadsheet(title=…) then sheets_get_values(spreadsheet_id, range_name)");
  }
  let rangeName = getString(args, "range_name", "A1:Z1000");
  const ranges = getStringSlice(args, "ranges") ?? [];
  try {
    if (ranges.length > 1 || (ranges.length === 1 && ranges[0] !== rangeName)) {
      const resp = await opened.api.get(`${SHEETS}/${encodeURIComponent(taken)}/values:batchGet`, { ranges });
      const valueRanges = isRecord(resp) && Array.isArray(resp.valueRanges) ? resp.valueRanges : [];
      if (valueRanges.length === 0) {
        return textResult(`No data found in ranges ${goFmt(ranges)} for ${opened.email}.`);
      }
      let text = `Successfully read ${valueRanges.length} ranges in spreadsheet ${taken} for ${opened.email}:`;
      for (const item of valueRanges) {
        text += `\n${formatValues(strField(item, "range"), gridOf(isRecord(item) ? item.values : undefined), taken, opened.email)}`;
      }
      return textResult(text);
    }
    if (ranges.length === 1 && ranges[0]) {
      rangeName = ranges[0];
    }
    const resp = await opened.api.get(`${SHEETS}/${encodeURIComponent(taken)}/values/${encodeURIComponent(rangeName)}`);
    return textResult(formatValues(rangeName, gridOf(isRecord(resp) ? resp.values : undefined), taken, opened.email));
  } catch (e) {
    return errorResult(`reading sheet values: ${errorText(e)}`);
  }
}

function formatValues(rangeName: string, values: Grid, spreadsheetID: string, email: string): string {
  if (values.length === 0) {
    return `No data found in range '${rangeName}' for ${email}.`;
  }
  const maxRows = Math.min(values.length, ROW_CAP);
  const width = values[0]?.length ?? 0;
  let text = `Successfully read ${values.length} rows from range '${rangeName}' in spreadsheet ${spreadsheetID} for ${email}:`;
  for (let i = 0; i < maxRows; i++) {
    const row = values[i] ?? [];
    const padded = Array.from({ length: width }, (_, col) => (col < row.length ? row[col] : null));
    const label = String(i + 1).padStart(2, " ");
    text += `\nRow ${label}: ${goFmt(padded)}`;
  }
  if (values.length > ROW_CAP) {
    text += `\n... and ${values.length - ROW_CAP} more rows (narrow range_name)`;
  }
  return text;
}

async function updateValues(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "sheets_update_values(spreadsheet_id, range_name, values=[[…]])"));
  if (isResult(opened)) {
    return opened;
  }
  const taken = takeGoogleID(args, "spreadsheet_id");
  if (isIdFailure(taken)) {
    return googleIDError(taken, "spreadsheet_id", "sheets_create_spreadsheet(title=…) then sheets_update_values(spreadsheet_id, range_name, values)");
  }
  const rangeName = getString(args, "range_name", "");
  const valueInputOption = getString(args, "value_input_option", "USER_ENTERED");
  const clearValues = getBoolOnly(args, "clear_values", false);
  const hasUpdates = Object.prototype.hasOwnProperty.call(args, "updates") && args.updates != null;
  if (hasUpdates) {
    const parsed = parseUpdates(args.updates);
    if (typeof parsed === "string") {
      return errorResult(parsed);
    }
  } else if (rangeName === "") {
    return needArg("range_name", "sheets_update_values(spreadsheet_id, range_name=\"Sheet1!A1\", values=[[…], […]]) or updates=[{range_name, values}]");
  }
  try {
    if (hasUpdates) {
      const updates = parseUpdates(args.updates);
      if (typeof updates === "string") {
        return errorResult(updates);
      }
      const resp = await opened.api.post(`${SHEETS}/${encodeURIComponent(taken)}/values:batchUpdate`, {
        valueInputOption,
        data: updates.map((item) => ({ range: item.range, values: item.values })),
      });
      return textResult(
        `Successfully updated ${updates.length} ranges in spreadsheet ${taken} for ${opened.email}. Updated: ${num(resp, "totalUpdatedCells")} cells, ${num(resp, "totalUpdatedRows")} rows, ${num(resp, "totalUpdatedColumns")} columns.`,
      );
    }
    if (clearValues) {
      const resp = await opened.api.post(`${SHEETS}/${encodeURIComponent(taken)}/values/${encodeURIComponent(rangeName)}:clear`, {});
      const cleared = strField(resp, "clearedRange") || rangeName;
      return textResult(`Successfully cleared range '${cleared}' in spreadsheet ${taken} for ${opened.email}.`);
    }
    if (!Object.prototype.hasOwnProperty.call(args, "values") || args.values == null) {
      return needArg("values", "sheets_update_values(spreadsheet_id, range_name, values=[[\"col1\",\"col2\"],[\"1\",\"2\"]]) or updates=[{range_name, values}] or clear_values=true");
    }
    const values = parseValues(args.values);
    if (typeof values === "string") {
      return errorResult(values);
    }
    if (values.length === 0) {
      return errorResult("either 'values' must be provided or 'clear_values' must be true");
    }
    const resp = await opened.api.put(
      `${SHEETS}/${encodeURIComponent(taken)}/values/${encodeURIComponent(rangeName)}`,
      { values },
      {
        valueInputOption,
        includeValuesInResponse: true,
        responseValueRenderOption: "FORMATTED_VALUE",
      },
    );
    return textResult(
      `Successfully updated range '${rangeName}' in spreadsheet ${taken} for ${opened.email}. Updated: ${num(resp, "updatedCells")} cells, ${num(resp, "updatedRows")} rows, ${num(resp, "updatedColumns")} columns.`,
    );
  } catch (e) {
    return errorResult(clearValues && !hasUpdates ? `clearing range: ${errorText(e)}` : `updating sheet values: ${errorText(e)}`);
  }
}

async function createSheet(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "sheets_create_spreadsheet(title=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const title = requireString(args, "title");
  if (title === undefined) {
    return needArg("title", "sheets_create_spreadsheet(title=…)");
  }
  const body: Record<string, unknown> = { properties: { title } };
  const names = getStringSlice(args, "sheet_names") ?? [];
  if (names.length > 0) {
    body.sheets = names.filter((name) => name !== "").map((name) => ({ properties: { title: name } }));
  }
  try {
    const created = await opened.api.post(SHEETS, body, {
      fields: "spreadsheetId,spreadsheetUrl,properties(title,locale)",
    });
    const props = isRecord(created) ? created.properties : undefined;
    const locale = strField(props, "locale") || "Unknown";
    return textResult(
      `Successfully created spreadsheet '${title}' for ${opened.email}. ID: ${strField(created, "spreadsheetId")} | URL: ${strField(created, "spreadsheetUrl")} | Locale: ${locale}`,
    );
  } catch (e) {
    return errorResult(`creating spreadsheet: ${errorText(e)}`);
  }
}

function parseValues(raw: unknown): Grid | string {
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parseValues(parsed);
    } catch (e) {
      return `invalid JSON format for values: ${errorText(e)}`;
    }
  }
  if (!Array.isArray(raw)) {
    return "values must be a 2D array or JSON string";
  }
  const values: Grid = [];
  let i = 0;
  for (const row of raw) {
    const cells = rowCells(row);
    if (!cells) {
      return `row ${i} must be a list`;
    }
    values.push(cells);
    i += 1;
  }
  return values;
}

function parseUpdates(raw: unknown): Update[] | string {
  let items: unknown;
  if (typeof raw === "string") {
    try {
      items = JSON.parse(raw) as unknown;
    } catch (e) {
      return `invalid JSON format for updates: ${errorText(e)}`;
    }
  } else {
    items = raw;
  }
  if (!Array.isArray(items)) {
    return "updates must be an array of {range_name, values}";
  }
  if (items.length === 0) {
    return "updates must contain at least one range";
  }
  const out: Update[] = [];
  let i = 0;
  for (const item of items) {
    if (!isRecord(item)) {
      return `updates[${i}] must be an object`;
    }
    const range = typeof item.range_name === "string" ? item.range_name.trim() : "";
    if (range === "") {
      return `updates[${i}].range_name is required`;
    }
    const values = parseValues(item.values);
    if (typeof values === "string") {
      return `updates[${i}]: ${values}`;
    }
    if (values.length === 0) {
      return `updates[${i}].values must contain at least one row`;
    }
    out.push({ range, values });
    i += 1;
  }
  return out;
}

function rowCells(row: unknown): unknown[] | undefined {
  if (!Array.isArray(row)) {
    return undefined;
  }
  const cells: unknown[] = [];
  for (const cell of row) {
    cells.push(cell);
  }
  return cells;
}

function gridOf(value: unknown): Grid {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: Grid = [];
  for (const row of value) {
    rows.push(rowCells(row) ?? []);
  }
  return rows;
}

function num(value: unknown, key: string): number {
  if (!isRecord(value) || typeof value[key] !== "number") {
    return 0;
  }
  return value[key];
}

/** Go fmt `%v` for slices: `[a b]`, with `<nil>` for null. */
function goFmt(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === null || item === undefined ? "<nil>" : goFmt(item))).join(" ")}]`;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "<nil>";
  }
  return JSON.stringify(value);
}
