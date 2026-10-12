import type { CallContext, PluginContext, Tool, ToolResult } from "@/harness/core/tools";
import { errorResult, textResult } from "@/harness/core/tools";
import { arrField, boolField, errorText, getBoolOnly, getInt, getString, isRecord, needArg, requireString, strField } from "@/harness/plugins/google/args";
import { toolDef } from "@/harness/plugins/google/catalog";
import { googleIDError, isIdFailure, takeGoogleID } from "@/harness/plugins/google/ids";
import { EMAIL_REQUIRED_MESSAGE } from "@/harness/plugins/google/oauth";
import { isResult, openUser } from "@/harness/plugins/google/session";

const FORMS = "https://forms.googleapis.com/v1/forms";

type Handler = (args: Record<string, unknown>, call: CallContext) => Promise<ToolResult>;

export function formsTools(ctx: PluginContext): Tool[] {
  const bind = (name: string, fn: Handler): Tool => ({ ...toolDef(name), call: fn });
  return [
    bind("forms_create", (args, call) => createForm(ctx, args, call)),
    bind("forms_get", (args, call) => getForm(ctx, args, call)),
    bind("forms_update_publish_settings", (args, call) => publishSettings(ctx, args, call)),
    bind("forms_get_response", (args, call) => getResponse(ctx, args, call)),
    bind("forms_list_responses", (args, call) => listResponses(ctx, args, call)),
    bind("forms_batch_update", (args, call) => batchUpdate(ctx, args, call)),
  ];
}

async function createForm(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "forms_create(title=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const title = requireString(args, "title");
  if (title === undefined) {
    return needArg("title", "forms_create(title=…)");
  }
  const description = getString(args, "description", "");
  const documentTitle = getString(args, "document_title", "");
  const info: Record<string, string> = {};
  if (description !== "") {
    info.description = description;
  }
  if (documentTitle !== "") {
    info.documentTitle = documentTitle;
  }
  info.title = title;
  let created: unknown;
  try {
    created = await opened.api.post(FORMS, { info });
  } catch (e) {
    return errorResult(`creating form: ${errorText(e)}`);
  }
  const formID = strField(created, "formId");
  const editURL = `https://docs.google.com/forms/d/${formID}/edit`;
  const responder = strField(created, "responderUri") || `https://docs.google.com/forms/d/${formID}/viewform`;
  const infoRec = isRecord(created) ? created.info : undefined;
  const createdTitle = strField(infoRec, "title") || title;
  return textResult(`Successfully created form '${createdTitle}' for ${opened.email}. Form ID: ${formID}. Edit URL: ${editURL}. Responder URL: ${responder}`);
}

async function getForm(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "forms_get(form_id=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const formID = takeGoogleID(args, "form_id");
  if (isIdFailure(formID)) {
    return googleIDError(formID, "form_id", "forms_create(title=…) then forms_get(form_id)");
  }
  let form: unknown;
  try {
    form = await opened.api.get(`${FORMS}/${encodeURIComponent(formID)}`);
  } catch (e) {
    return errorResult(`getting form: ${errorText(e)}`);
  }
  const info = isRecord(form) ? form.info : undefined;
  let title = "No Title";
  let description = "No Description";
  let documentTitle = title;
  if (isRecord(info)) {
    if (strField(info, "title") !== "") {
      title = strField(info, "title");
    }
    if (strField(info, "description") !== "") {
      description = strField(info, "description");
    }
    documentTitle = strField(info, "documentTitle") || title;
  }
  const editURL = `https://docs.google.com/forms/d/${formID}/edit`;
  const responder = strField(form, "responderUri") || `https://docs.google.com/forms/d/${formID}/viewform`;
  const items = arrField(form, "items");
  const lines: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemTitle = strField(item, "title") || `Question ${i + 1}`;
    const question = isRecord(item) && isRecord(item.questionItem) ? item.questionItem.question : undefined;
    const required = boolField(question, "required") ? " (Required)" : "";
    lines.push(`  ${i + 1}. ${itemTitle}${required}`);
  }
  const questionsText = lines.length > 0 ? lines.join("\n") : "  No questions found";
  return textResult(`Form Details for ${opened.email}:
- Title: "${title}"
- Description: "${description}"
- Document Title: "${documentTitle}"
- Form ID: ${formID}
- Edit URL: ${editURL}
- Responder URL: ${responder}
- Questions (${items.length} total):
${questionsText}`);
}

async function publishSettings(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return plainEmail(opened);
  }
  const formID = takeGoogleID(args, "form_id");
  if (isIdFailure(formID)) {
    return googleIDError(formID, "form_id", "form_id=…");
  }
  const publishAsTemplate = getBoolOnly(args, "publish_as_template", false);
  const requireAuthentication = getBoolOnly(args, "require_authentication", false);
  let raw: { status: number; text: string };
  try {
    raw = await opened.api.text("POST", `${FORMS}/${encodeURIComponent(formID)}:setPublishSettings`, {
      publishAsTemplate,
      requireAuthentication,
    });
  } catch (e) {
    return errorResult(`setting publish settings: ${errorText(e)}`);
  }
  if (raw.status !== 200) {
    return errorResult(`setting publish settings (HTTP ${raw.status}): ${raw.text}`);
  }
  return textResult(`Successfully updated publish settings for form ${formID} for ${opened.email}. Publish as template: ${publishAsTemplate}, Require authentication: ${requireAuthentication}`);
}

async function getResponse(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return plainEmail(opened);
  }
  const formID = takeGoogleID(args, "form_id");
  if (isIdFailure(formID)) {
    return googleIDError(formID, "form_id", "form_id=…");
  }
  const responseID = requireString(args, "response_id");
  if (responseID === undefined) {
    return errorResult("response_id is required");
  }
  let formResp: unknown;
  try {
    formResp = await opened.api.get(`${FORMS}/${encodeURIComponent(formID)}/responses/${encodeURIComponent(responseID)}`);
  } catch (e) {
    return errorResult(`getting form response: ${errorText(e)}`);
  }
  const respID = strField(formResp, "responseId") || "Unknown";
  const createTime = strField(formResp, "createTime") || "Unknown";
  const lastSubmitted = strField(formResp, "lastSubmittedTime") || "Unknown";
  const answers = isRecord(formResp) && isRecord(formResp.answers) ? formResp.answers : {};
  const lines: string[] = [];
  for (const questionID of Object.keys(answers).sort()) {
    const answer = answers[questionID];
    const values = textAnswerValues(answer);
    lines.push(values ? `  Question ID ${questionID}: ${values.join(", ")}` : `  Question ID ${questionID}: No answer provided`);
  }
  const answersText = lines.length > 0 ? lines.join("\n") : "  No answers found";
  return textResult(`Form Response Details for ${opened.email}:
- Form ID: ${formID}
- Response ID: ${respID}
- Created: ${createTime}
- Last Submitted: ${lastSubmitted}
- Answers:
${answersText}`);
}

async function listResponses(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return plainEmail(opened);
  }
  const formID = takeGoogleID(args, "form_id");
  if (isIdFailure(formID)) {
    return googleIDError(formID, "form_id", "form_id=…");
  }
  const query: Record<string, string | number> = { pageSize: getInt(args, "page_size", 10) };
  const pageToken = getString(args, "page_token", "");
  if (pageToken !== "") {
    query.pageToken = pageToken;
  }
  let resp: unknown;
  try {
    resp = await opened.api.get(`${FORMS}/${encodeURIComponent(formID)}/responses`, query);
  } catch (e) {
    return errorResult(`listing form responses: ${errorText(e)}`);
  }
  const responses = arrField(resp, "responses");
  if (responses.length === 0) {
    return textResult(`No responses found for form ${formID} for ${opened.email}.`);
  }
  const lines = responses.map((r, i) => {
    const id = strField(r, "responseId") || "Unknown";
    const created = strField(r, "createTime") || "Unknown";
    const submitted = strField(r, "lastSubmittedTime") || "Unknown";
    const count = isRecord(r) && isRecord(r.answers) ? Object.keys(r.answers).length : 0;
    return `  ${i + 1}. Response ID: ${id} | Created: ${created} | Last Submitted: ${submitted} | Answers: ${count}`;
  });
  const token = strField(resp, "nextPageToken");
  const page = token !== "" ? `\nNext page token: ${token}` : "\nNo more pages.";
  return textResult(`Form Responses for ${opened.email}:
- Form ID: ${formID}
- Total responses returned: ${responses.length}
- Responses:
${lines.join("\n")}${page}`);
}

async function batchUpdate(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return plainEmail(opened);
  }
  const formID = takeGoogleID(args, "form_id");
  if (isIdFailure(formID)) {
    return googleIDError(formID, "form_id", "form_id=…");
  }
  if (!Object.prototype.hasOwnProperty.call(args, "requests")) {
    return errorResult("requests is required");
  }
  const requests = args.requests;
  if (!Array.isArray(requests)) {
    return errorResult("requests must be an array");
  }
  let raw: { status: number; text: string };
  try {
    raw = await opened.api.text("POST", `${FORMS}/${encodeURIComponent(formID)}:batchUpdate`, { requests });
  } catch (e) {
    return errorResult(`batch updating form: ${errorText(e)}`);
  }
  if (raw.status !== 200) {
    return errorResult(`batch updating form (HTTP ${raw.status}): ${raw.text}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.text) as unknown;
  } catch (e) {
    return errorResult(`parsing response: ${errorText(e)}`);
  }
  const replies = arrField(parsed, "replies");
  const editURL = `https://docs.google.com/forms/d/${formID}/edit`;
  let text = "Batch Update Completed:\n";
  text += `- Form ID: ${formID}\n`;
  text += `- URL: ${editURL}\n`;
  text += `- Requests Applied: ${requests.length}\n`;
  text += `- Replies Received: ${replies.length}`;
  if (replies.length > 0) {
    text += formatFormReplies(replies);
  }
  return textResult(text);
}

function formatFormReplies(replies: unknown[]): string {
  let text = "\n\nUpdate Results:";
  for (let i = 0; i < replies.length; i++) {
    const reply = replies[i];
    if (!isRecord(reply) || !Object.prototype.hasOwnProperty.call(reply, "createItem")) {
      text += `\n  Request ${i + 1}: Operation completed`;
      continue;
    }
    const created = isRecord(reply.createItem) ? reply.createItem : {};
    const itemID = scalar(created.itemId);
    text += `\n  Request ${i + 1}: Created item ${itemID}${formatQuestionIDs(created.questionId)}`;
  }
  return text;
}

function formatQuestionIDs(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return "";
  }
  return ` (Question IDs: ${raw.map((q) => scalar(q)).join(", ")})`;
}

function scalar(v: unknown): string {
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return String(v);
  }
  return "Unknown";
}

function textAnswerValues(answer: unknown): string[] | undefined {
  if (!isRecord(answer) || !isRecord(answer.textAnswers)) {
    return undefined;
  }
  const answers = answer.textAnswers.answers;
  if (!Array.isArray(answers) || answers.length === 0) {
    return undefined;
  }
  return answers.map((row) => strField(row, "value"));
}

function plainEmail(result: ToolResult): ToolResult {
  const first = result.content[0];
  const text = first?.type === "text" ? first.text : "";
  if (result.isError && text === EMAIL_REQUIRED_MESSAGE) {
    return errorResult(EMAIL_REQUIRED_MESSAGE);
  }
  return result;
}
