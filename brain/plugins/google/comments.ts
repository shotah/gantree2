import type { CallContext, PluginContext, Tool, ToolResult } from "@/brain/core/tools";
import { errorResult, textResult } from "@/brain/core/tools";
import { arrField, boolField, errorText, isRecord, needArg, requireString, strField } from "@/brain/plugins/google/args";
import { toolDef } from "@/brain/plugins/google/catalog";
import { googleIDError, isIdFailure, takeGoogleID } from "@/brain/plugins/google/ids";
import { isResult, openUser } from "@/brain/plugins/google/session";

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const COMMENT_FIELDS = "comments(id,content,author,createdTime,modifiedTime,resolved,replies(content,author,id,createdTime,modifiedTime))";
const WRITE_FIELDS = "id,content,author,createdTime,modifiedTime";

type Handler = (args: Record<string, unknown>, call: CallContext) => Promise<ToolResult>;

/** Comment tools registered with a Workspace app (docs, sheets, or slides). */
export function commentTools(ctx: PluginContext, service: string, appName: string, fileIDParam: string): Tool[] {
  const bind = (name: string, fn: Handler): Tool => ({ ...toolDef(name), call: fn });
  return [
    bind(`${service}_list_comments`, (args, call) => listComments(ctx, args, call, service, appName, fileIDParam)),
    bind(`${service}_create_comment`, (args, call) => createComment(ctx, args, call, service, fileIDParam)),
    bind(`${service}_create_reply`, (args, call) => createReply(ctx, args, call, service, fileIDParam)),
    bind(`${service}_resolve_comment`, (args, call) => resolveComment(ctx, args, call, service, fileIDParam)),
  ];
}

async function listComments(
  ctx: PluginContext,
  args: Record<string, unknown>,
  call: CallContext,
  service: string,
  appName: string,
  fileIDParam: string,
): Promise<ToolResult> {
  const toolName = `${service}_list_comments`;
  const opened = await openUser(ctx, args, call, needArg("user_google_email", `${toolName}(${fileIDParam}=…)`));
  if (isResult(opened)) {
    return opened;
  }
  const fileID = takeGoogleID(args, fileIDParam);
  if (isIdFailure(fileID)) {
    return googleIDError(fileID, fileIDParam, `${toolName}(${fileIDParam}=…)`);
  }
  let resp: unknown;
  try {
    resp = await opened.api.get(`${DRIVE}/${encodeURIComponent(fileID)}/comments`, { fields: COMMENT_FIELDS });
  } catch (e) {
    return errorResult(`listing comments: ${errorText(e)}`);
  }
  const comments = arrField(resp, "comments");
  if (comments.length === 0) {
    return textResult(`No comments found in ${appName} ${fileID}`);
  }
  let text = `Found ${comments.length} comments in ${appName} ${fileID}:\n`;
  for (const c of comments) {
    const author = strField(isRecord(c) ? c.author : undefined, "displayName") || "Unknown";
    const status = boolField(c, "resolved") ? " [RESOLVED]" : "";
    text += `\nComment ID: ${strField(c, "id")}\n`;
    text += `Author: ${author}\n`;
    text += `Created: ${strField(c, "createdTime")}${status}\n`;
    text += `Content: ${strField(c, "content")}\n`;
    const replies = arrField(c, "replies");
    if (replies.length > 0) {
      text += `  Replies (${replies.length}):\n`;
      for (const r of replies) {
        const replyAuthor = strField(isRecord(r) ? r.author : undefined, "displayName") || "Unknown";
        text += `    Reply ID: ${strField(r, "id")}\n`;
        text += `    Author: ${replyAuthor}\n`;
        text += `    Created: ${strField(r, "createdTime")}\n`;
        text += `    Content: ${strField(r, "content")}\n`;
      }
    }
  }
  return textResult(text);
}

async function createComment(
  ctx: PluginContext,
  args: Record<string, unknown>,
  call: CallContext,
  service: string,
  fileIDParam: string,
): Promise<ToolResult> {
  const toolName = `${service}_create_comment`;
  const next = `${toolName}(${fileIDParam}, comment_content=…)`;
  const opened = await openUser(ctx, args, call, needArg("user_google_email", next));
  if (isResult(opened)) {
    return opened;
  }
  const fileID = takeGoogleID(args, fileIDParam);
  if (isIdFailure(fileID)) {
    return googleIDError(fileID, fileIDParam, next);
  }
  const content = requireString(args, "comment_content");
  if (content === undefined) {
    return needArg("comment_content", next);
  }
  let comment: unknown;
  try {
    comment = await opened.api.post(
      `${DRIVE}/${encodeURIComponent(fileID)}/comments`,
      { content },
      { fields: WRITE_FIELDS },
    );
  } catch (e) {
    return errorResult(`creating comment: ${errorText(e)}`);
  }
  const author = strField(isRecord(comment) ? comment.author : undefined, "displayName") || "Unknown";
  return textResult(`Comment created successfully!\nComment ID: ${strField(comment, "id")}\nAuthor: ${author}\nCreated: ${strField(comment, "createdTime")}\nContent: ${content}`);
}

async function createReply(
  ctx: PluginContext,
  args: Record<string, unknown>,
  call: CallContext,
  service: string,
  fileIDParam: string,
): Promise<ToolResult> {
  const toolName = `${service}_create_reply`;
  const opened = await openUser(
    ctx,
    args,
    call,
    needArg("user_google_email", `${toolName}(${fileIDParam}, comment_id, reply_content=…)`),
  );
  if (isResult(opened)) {
    return opened;
  }
  const fileID = takeGoogleID(args, fileIDParam);
  if (isIdFailure(fileID)) {
    return googleIDError(fileID, fileIDParam, `${toolName}(${fileIDParam}, comment_id, reply_content=…)`);
  }
  const commentID = requireString(args, "comment_id");
  if (commentID === undefined) {
    return needArg("comment_id", `${service}_list_comments(${fileIDParam}) then ${toolName}(${fileIDParam}, comment_id, reply_content)`);
  }
  const replyContent = requireString(args, "reply_content");
  if (replyContent === undefined) {
    return needArg("reply_content", `${toolName}(${fileIDParam}, comment_id, reply_content=…)`);
  }
  let reply: unknown;
  try {
    reply = await opened.api.post(
      `${DRIVE}/${encodeURIComponent(fileID)}/comments/${encodeURIComponent(commentID)}/replies`,
      { content: replyContent },
      { fields: WRITE_FIELDS },
    );
  } catch (e) {
    return errorResult(`replying to comment: ${errorText(e)}`);
  }
  const author = strField(isRecord(reply) ? reply.author : undefined, "displayName") || "Unknown";
  return textResult(`Reply posted successfully!\nReply ID: ${strField(reply, "id")}\nAuthor: ${author}\nCreated: ${strField(reply, "createdTime")}\nContent: ${replyContent}`);
}

async function resolveComment(
  ctx: PluginContext,
  args: Record<string, unknown>,
  call: CallContext,
  service: string,
  fileIDParam: string,
): Promise<ToolResult> {
  const toolName = `${service}_resolve_comment`;
  const opened = await openUser(ctx, args, call, needArg("user_google_email", `${toolName}(${fileIDParam}, comment_id=…)`));
  if (isResult(opened)) {
    return opened;
  }
  const fileID = takeGoogleID(args, fileIDParam);
  if (isIdFailure(fileID)) {
    return googleIDError(fileID, fileIDParam, `${toolName}(${fileIDParam}, comment_id=…)`);
  }
  const commentID = requireString(args, "comment_id");
  if (commentID === undefined) {
    return needArg("comment_id", `${service}_list_comments(${fileIDParam}) then ${toolName}(${fileIDParam}, comment_id)`);
  }
  let reply: unknown;
  try {
    reply = await opened.api.post(
      `${DRIVE}/${encodeURIComponent(fileID)}/comments/${encodeURIComponent(commentID)}/replies`,
      { content: "This comment has been resolved.", action: "resolve" },
      { fields: WRITE_FIELDS },
    );
  } catch (e) {
    return errorResult(`resolving comment: ${errorText(e)}`);
  }
  const author = strField(isRecord(reply) ? reply.author : undefined, "displayName") || "Unknown";
  return textResult(`Comment ${commentID} has been resolved successfully.\nResolve reply ID: ${strField(reply, "id")}\nAuthor: ${author}\nCreated: ${strField(reply, "createdTime")}`);
}
