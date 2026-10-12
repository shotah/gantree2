import type { CallContext, PluginContext, Tool, ToolResult } from "@/harness/core/tools";
import { errorResult, textResult } from "@/harness/core/tools";
import { arrField, errorText, getString, isRecord, needArg, requireString, strField } from "@/harness/plugins/google/args";
import { toolDef } from "@/harness/plugins/google/catalog";
import { commentTools } from "@/harness/plugins/google/comments";
import { googleIDError, isIdFailure, takeGoogleID } from "@/harness/plugins/google/ids";
import { EMAIL_REQUIRED_MESSAGE } from "@/harness/plugins/google/oauth";
import { isResult, openUser } from "@/harness/plugins/google/session";

const SLIDES = "https://slides.googleapis.com/v1/presentations";

type Handler = (args: Record<string, unknown>, call: CallContext) => Promise<ToolResult>;

export function slidesTools(ctx: PluginContext): Tool[] {
  const bind = (name: string, fn: Handler): Tool => ({ ...toolDef(name), call: fn });
  return [
    bind("slides_create_presentation", (args, call) => createPresentation(ctx, args, call)),
    bind("slides_get_presentation", (args, call) => getPresentation(ctx, args, call)),
    bind("slides_batch_update", (args, call) => batchUpdate(ctx, args, call)),
    bind("slides_get_page", (args, call) => getPage(ctx, args, call)),
    bind("slides_get_page_thumbnail", (args, call) => getThumbnail(ctx, args, call)),
    ...commentTools(ctx, "slides", "presentation", "presentation_id"),
  ];
}

async function createPresentation(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "slides_create_presentation(title=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const title = getString(args, "title", "Untitled Presentation");
  let created: unknown;
  try {
    created = await opened.api.post(SLIDES, { title });
  } catch (e) {
    return errorResult(`creating presentation: ${errorText(e)}`);
  }
  const presID = strField(created, "presentationId");
  const url = `https://docs.google.com/presentation/d/${presID}/edit`;
  const slideCount = arrField(created, "slides").length;
  return textResult(`Presentation Created Successfully for ${opened.email}:
- Title: ${title}
- Presentation ID: ${presID}
- URL: ${url}
- Slides: ${slideCount} slide(s) created`);
}

async function getPresentation(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "slides_get_presentation(presentation_id=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const presID = takeGoogleID(args, "presentation_id");
  if (isIdFailure(presID)) {
    return googleIDError(presID, "presentation_id", "slides_create_presentation(title=…) then slides_get_presentation(presentation_id)");
  }
  let pres: unknown;
  try {
    pres = await opened.api.get(`${SLIDES}/${encodeURIComponent(presID)}`);
  } catch (e) {
    return errorResult(`getting presentation: ${errorText(e)}`);
  }
  const title = strField(pres, "title") || "Untitled";
  const slides = arrField(pres, "slides");
  const lines = slides.map((slide, i) => {
    const slideID = strField(slide, "objectId") || "Unknown";
    const elements = arrField(slide, "pageElements");
    const slideText = extractSlideText(slide);
    if (slideText !== "") {
      return `  Slide ${i + 1}: ID ${slideID}, ${elements.length} element(s), text: ${slideText}`;
    }
    return `  Slide ${i + 1}: ID ${slideID}, ${elements.length} element(s), text: empty`;
  });
  const breakdown = lines.length > 0 ? lines.join("\n") : "  No slides found";
  const url = `https://docs.google.com/presentation/d/${presID}/edit`;
  return textResult(`Presentation Details for ${opened.email}:
- Title: ${title}
- Presentation ID: ${presID}
- URL: ${url}
- Total Slides: ${slides.length}
- Page Size: ${pageSizeText(pres)}

Slides Breakdown:
${breakdown}`);
}

function pageSizeText(pres: unknown): string {
  if (!isRecord(pres) || !isRecord(pres.pageSize)) {
    return "Unknown";
  }
  const width = pres.pageSize.width;
  const height = pres.pageSize.height;
  if (!isRecord(width) || !isRecord(height)) {
    return "Unknown";
  }
  const w = width.magnitude;
  const h = height.magnitude;
  const unit = typeof width.unit === "string" ? width.unit : "";
  return `${formatMagnitude(w)} x ${formatMagnitude(h)} ${unit}`;
}

function formatMagnitude(v: unknown): string {
  return typeof v === "number" ? String(v) : "";
}

export function extractSlideText(slide: unknown): string {
  const texts: string[] = [];
  for (const elem of arrField(slide, "pageElements")) {
    if (!isRecord(elem) || !isRecord(elem.shape) || !isRecord(elem.shape.text)) {
      continue;
    }
    const runs: { index: number; content: string }[] = [];
    for (const te of arrField(elem.shape.text, "textElements")) {
      if (!isRecord(te) || !isRecord(te.textRun)) {
        continue;
      }
      const content = strField(te.textRun, "content");
      if (content === "") {
        continue;
      }
      const index = typeof te.startIndex === "number" ? te.startIndex : 0;
      runs.push({ index, content });
    }
    if (runs.length > 0) {
      runs.sort((a, b) => a.index - b.index);
      texts.push(runs.map((run) => run.content).join(""));
    }
  }
  if (texts.length === 0) {
    return "";
  }
  const lines = texts.join("\n").split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    return "";
  }
  return `\n${lines.map((line) => `    > ${line}`).join("\n")}`;
}

async function batchUpdate(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return plainEmail(opened);
  }
  const presID = takeGoogleID(args, "presentation_id");
  if (isIdFailure(presID)) {
    return googleIDError(presID, "presentation_id", "presentation_id=…");
  }
  if (!Object.prototype.hasOwnProperty.call(args, "requests")) {
    return errorResult("requests is required");
  }
  const requests = args.requests;
  if (!Array.isArray(requests)) {
    return errorResult("requests must be an array");
  }
  for (const raw of requests) {
    if (!isRecord(raw)) {
      return errorResult("each request must be an object");
    }
  }
  let resp: unknown;
  try {
    resp = await opened.api.post(`${SLIDES}/${encodeURIComponent(presID)}:batchUpdate`, { requests });
  } catch (e) {
    return errorResult(`batch updating presentation: ${errorText(e)}`);
  }
  const replies = arrField(resp, "replies");
  const url = `https://docs.google.com/presentation/d/${presID}/edit`;
  let text = `Batch Update Completed for ${opened.email}:\n`;
  text += `- Presentation ID: ${presID}\n`;
  text += `- URL: ${url}\n`;
  text += `- Requests Applied: ${requests.length}\n`;
  text += `- Replies Received: ${replies.length}`;
  if (replies.length > 0) {
    text += formatSlideReplies(replies);
  }
  return textResult(text);
}

function formatSlideReplies(replies: unknown[]): string {
  let text = "\n\nUpdate Results:";
  for (let i = 0; i < replies.length; i++) {
    const reply = replies[i];
    if (isRecord(reply) && isRecord(reply.createSlide)) {
      text += `\n  Request ${i + 1}: Created slide with ID ${strField(reply.createSlide, "objectId") || "Unknown"}`;
    } else if (isRecord(reply) && isRecord(reply.createShape)) {
      text += `\n  Request ${i + 1}: Created shape with ID ${strField(reply.createShape, "objectId") || "Unknown"}`;
    } else {
      text += `\n  Request ${i + 1}: Operation completed`;
    }
  }
  return text;
}

async function getPage(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return plainEmail(opened);
  }
  const presID = takeGoogleID(args, "presentation_id");
  if (isIdFailure(presID)) {
    return googleIDError(presID, "presentation_id", "presentation_id=…");
  }
  const pageID = requireString(args, "page_object_id");
  if (pageID === undefined) {
    return errorResult("page_object_id is required");
  }
  let page: unknown;
  try {
    page = await opened.api.get(`${SLIDES}/${encodeURIComponent(presID)}/pages/${encodeURIComponent(pageID)}`);
  } catch (e) {
    return errorResult(`getting page: ${errorText(e)}`);
  }
  const pageType = strField(page, "pageType") || "Unknown";
  const elements = arrField(page, "pageElements");
  const breakdown = elements.length > 0 ? elements.map((elem) => formatPageElement(elem)).join("\n") : "  No elements found";
  return textResult(`Page Details for ${opened.email}:
- Presentation ID: ${presID}
- Page ID: ${pageID}
- Page Type: ${pageType}
- Total Elements: ${elements.length}

Page Elements:
${breakdown}`);
}

function formatPageElement(elem: unknown): string {
  const elemID = strField(elem, "objectId") || "Unknown";
  if (isRecord(elem) && isRecord(elem.shape)) {
    return `  Shape: ID ${elemID}, Type: ${strField(elem.shape, "shapeType") || "Unknown"}`;
  }
  if (isRecord(elem) && isRecord(elem.table)) {
    const rows = typeof elem.table.rows === "number" ? elem.table.rows : 0;
    const columns = typeof elem.table.columns === "number" ? elem.table.columns : 0;
    return `  Table: ID ${elemID}, Size: ${rows}x${columns}`;
  }
  if (isRecord(elem) && isRecord(elem.line)) {
    return `  Line: ID ${elemID}, Type: ${strField(elem.line, "lineType") || "Unknown"}`;
  }
  return `  Element: ID ${elemID}, Type: Unknown`;
}

async function getThumbnail(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return plainEmail(opened);
  }
  const presID = takeGoogleID(args, "presentation_id");
  if (isIdFailure(presID)) {
    return googleIDError(presID, "presentation_id", "presentation_id=…");
  }
  const pageID = requireString(args, "page_object_id");
  if (pageID === undefined) {
    return errorResult("page_object_id is required");
  }
  const thumbnailSize = getString(args, "thumbnail_size", "MEDIUM");
  let thumbnail: unknown;
  try {
    thumbnail = await opened.api.get(
      `${SLIDES}/${encodeURIComponent(presID)}/pages/${encodeURIComponent(pageID)}/thumbnail`,
      {
        "thumbnailProperties.mimeType": "PNG",
        "thumbnailProperties.thumbnailSize": thumbnailSize,
      },
    );
  } catch (e) {
    return errorResult(`getting page thumbnail: ${errorText(e)}`);
  }
  return textResult(`Thumbnail Generated for ${opened.email}:
- Presentation ID: ${presID}
- Page ID: ${pageID}
- Thumbnail Size: ${thumbnailSize}
- Thumbnail URL: ${strField(thumbnail, "contentUrl")}

You can view or download the thumbnail using the provided URL.`);
}

function plainEmail(result: ToolResult): ToolResult {
  const first = result.content[0];
  const text = first?.type === "text" ? first.text : "";
  if (result.isError && text === EMAIL_REQUIRED_MESSAGE) {
    return errorResult(EMAIL_REQUIRED_MESSAGE);
  }
  return result;
}
