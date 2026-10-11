import type { CallContext, JsonSchema, Plugin, PluginContext, Tool, ToolResult } from "@/brain/core/tools";
import { errorResult, textResult } from "@/brain/core/tools";
import {
  blobURL,
  errNeedImageDir,
  imageRoots,
  loadChatConfig,
  nextAvatarUpdate,
  nextBackdropUpdate,
  type ServerConfig,
} from "./config";
import { decodeBase64, encodeBase64, readInsideRoots, writeOutputFile, type PathMessages } from "@/brain/plugins/image/files";
import { parseWriteJSON, pendantRequest, workerError } from "./http";
import { avatarEdge, avatarMaxBytes, backdropEdge, backdropMaxBytes, prepareJpeg } from "./jpeg";
import { cachedThemeIDs, forgetThemeCatalog, parseThemeIDs, rememberThemeCatalog } from "./theme";

const avatarUpdateDescription = "Change your own profile picture / face on the phone app. Pass source_path from image__photo_generate (ask for a 1:1 portrait). Not a chat photo — do not use this to send a picture.";
const avatarGetDescription = "Read your current phone-app face. Returns JPEG bytes to MCP clients plus { rev, bytes }. Writes a file when IMAGE_OUTPUT_DIR is set so photo_edit can start from it.";
const backdropUpdateDescription = "Set the wallpaper behind the chat on the phone app. Pass source_path from image__photo_generate (ask for 9:16). Use backdrop_delete to go back to plain.";
const backdropDeleteDescription = "Clear the chat wallpaper on the phone app. The thread goes back to the plain theme canvas. Does not change the face or the mood.";
const themeListDescription = "List the color moods you can put on the phone app. Each card has feel (happy, excited, sad, frustrated, angry, anxious, or neutral) and scheme (dark / light), a mood line, and two hexes. Filter by how you feel, then by light or dark. Pick one id, then call theme_update. Not for drawing a picture — that is image__photo_generate.";
const themeUpdateDescription = "Set the phone app's color mood. Pass a theme id from theme_list. Pick a card whose feel matches, scheme: light by day; neutral to go plain. Do not invent hex. Humans can unfollow and keep their own theme.";
const themeDeleteDescription = "Clear the room mood on the phone app. Phones that follow you fall back to the theme they picked. Does not change the face or the wallpaper.";

const pathMessages: PathMessages = {
  needDir: errNeedImageDir(),
  required: `source_path is required. ${nextAvatarUpdate}`,
  refuse: `source_path must resolve inside IMAGE_OUTPUT_DIR (or PENDANT_IMAGE_DIR). ${nextAvatarUpdate}`,
  unreadable: `source_path could not be read. ${nextAvatarUpdate}`,
  empty: `source_path is empty. ${nextAvatarUpdate}`,
};

const themeRequired = "theme must be a catalog id. Next: theme_list()";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function goJSON(value: Record<string, string | number>): string {
  return JSON.stringify(value);
}

function textBody(raw: Uint8Array): string {
  return new TextDecoder().decode(raw).trim();
}

function blobJSON(rev: number, bytes: number, edge: number, filePath = ""): string {
  const out: Record<string, string | number> = { rev, bytes, edge, mime: "image/jpeg" };
  if (filePath) out.path = filePath;
  return goJSON(out);
}

function imageResult(text: string, data: Uint8Array): ToolResult {
  return {
    content: [
      { type: "text", text },
      { type: "image", data: encodeBase64(data), mimeType: "image/jpeg" },
    ],
  };
}

export function readSource(ctx: PluginContext, sourcePath: string, sourceImage: string): Uint8Array {
  const filePath = sourcePath.trim();
  const img = sourceImage.trim();
  const roots = imageRoots(ctx.env);
  if (filePath && img) throw new Error(`pass exactly one of source_path or source_image. ${nextAvatarUpdate}`);
  if (!filePath && !img) {
    if (roots.length === 0) throw new Error(errNeedImageDir());
    throw new Error(pathMessages.required);
  }
  if (img) return decodeChatImage(img);
  return readInsideRoots(ctx.sql, filePath, roots, pathMessages);
}

export function decodeChatImage(raw: string): Uint8Array {
  if (!raw.trim()) throw new Error(`source_image is empty. ${nextAvatarUpdate}`);
  const data = decodeBase64(raw);
  if (!data) throw new Error(`source_image must be base64. ${nextAvatarUpdate}`);
  if (data.byteLength === 0) throw new Error(`source_image is empty. ${nextAvatarUpdate}`);
  return data;
}

async function blobUpdate(ctx: PluginContext, call: CallContext, args: Record<string, unknown>, kind: string, edge: number, maxBytes: number, next: string): Promise<ToolResult> {
  let cfg: ServerConfig;
  try {
    cfg = loadChatConfig(ctx.env, ctx.log);
    const raw = readSource(ctx, str(args.source_path), str(args.source_image));
    const jpeg = prepareJpeg(raw, edge, maxBytes);
    const got = await pendantRequest(cfg, ctx.fetch, "POST", blobURL(cfg, kind), jpeg.data, "image/jpeg", call.signal);
    if (got.status >= 400) return errorResult(workerError(got.body, got.status));
    const rev = parseWriteJSON(got.body);
    return textResult(blobJSON(rev, jpeg.data.byteLength, jpeg.edge));
  } catch (err) {
    const message = err instanceof Error ? err.message : "pendant request failed";
    if (message === "could not read that image" || message === "image too large" || message === "could not encode jpeg") {
      return errorResult(`${message}. ${next}`);
    }
    return errorResult(message);
  }
}

async function themeIDs(ctx: PluginContext, call: CallContext, cfg: ServerConfig): Promise<Set<string>> {
  const cached = cachedThemeIDs(ctx.sql, ctx.clock, cfg);
  if (cached) return cached;
  const got = await pendantRequest(cfg, ctx.fetch, "GET", blobURL(cfg, "theme"), undefined, "", call.signal);
  if (got.status >= 400) throw new Error(workerError(got.body, got.status));
  const ids = parseThemeIDs(textBody(got.body));
  rememberThemeCatalog(ctx.sql, ctx.clock, cfg, ids);
  return ids;
}

function emptySchema(): JsonSchema {
  return { type: "object", properties: {}, required: [] };
}

function sourceSchema(pathDescription: string): JsonSchema {
  return {
    type: "object",
    properties: {
      source_path: { type: "string", description: pathDescription },
      source_image: { type: "string", description: "Optional base64 when the host keeps image bytes. Prefer source_path." },
    },
    required: [],
  };
}

export const chatPlugin: Plugin = {
  name: "chat",
  ready: () => Promise.resolve(null),
  tools(ctx): Tool[] {
    return [
      {
        name: "avatar_update",
        description: avatarUpdateDescription,
        inputSchema: sourceSchema("File image__photo_generate wrote. Must sit inside IMAGE_OUTPUT_DIR (or PENDANT_IMAGE_DIR). This is the v1 handoff."),
        single: "one profile face for this room",
        call: (args, call) => blobUpdate(ctx, call, args, "avatar", avatarEdge, avatarMaxBytes, nextAvatarUpdate),
      },
      {
        name: "avatar_get",
        description: avatarGetDescription,
        inputSchema: emptySchema(),
        single: "the room has one current face",
        call: async (_args, call) => {
          try {
            const cfg = loadChatConfig(ctx.env, ctx.log);
            const got = await pendantRequest(cfg, ctx.fetch, "GET", blobURL(cfg, "avatar"), undefined, "", call.signal);
            if (got.status === 404) return errorResult(`no face yet. ${nextAvatarUpdate}`);
            if (got.status >= 400) return errorResult(workerError(got.body, got.status));
            const revRaw = Number.parseInt(got.header("x-pendant-rev").trim(), 10);
            const rev = Number.isNaN(revRaw) ? 0 : revRaw;
            const filePath = writeOutputFile(ctx.sql, ctx.clock, (ctx.env.IMAGE_OUTPUT_DIR ?? "").trim(), got.body, ".jpg");
            return imageResult(blobJSON(rev, got.body.byteLength, avatarEdge, filePath), got.body);
          } catch (err) {
            return errorResult(err instanceof Error ? err.message : "pendant request failed");
          }
        },
      },
      {
        name: "backdrop_update",
        description: backdropUpdateDescription,
        inputSchema: sourceSchema("File image__photo_generate wrote. Must sit inside IMAGE_OUTPUT_DIR (or PENDANT_IMAGE_DIR)."),
        single: "one wallpaper for this room",
        call: (args, call) => blobUpdate(ctx, call, args, "backdrop", backdropEdge, backdropMaxBytes, nextBackdropUpdate),
      },
      {
        name: "backdrop_delete",
        description: backdropDeleteDescription,
        inputSchema: emptySchema(),
        single: "clears the one room wallpaper",
        call: async (_args, call) => {
          try {
            const cfg = loadChatConfig(ctx.env, ctx.log);
            const got = await pendantRequest(cfg, ctx.fetch, "DELETE", blobURL(cfg, "backdrop"), undefined, "", call.signal);
            if (got.status >= 400) return errorResult(workerError(got.body, got.status));
            const rev = parseWriteJSON(got.body);
            return textResult(blobJSON(rev, 0, 0));
          } catch (err) {
            return errorResult(err instanceof Error ? err.message : "pendant request failed");
          }
        },
      },
      {
        name: "theme_list",
        description: themeListDescription,
        inputSchema: emptySchema(),
        call: async (_args, call) => {
          try {
            const cfg = loadChatConfig(ctx.env, ctx.log);
            const got = await pendantRequest(cfg, ctx.fetch, "GET", blobURL(cfg, "theme"), undefined, "", call.signal);
            if (got.status >= 400) return errorResult(workerError(got.body, got.status));
            const text = textBody(got.body);
            try {
              rememberThemeCatalog(ctx.sql, ctx.clock, cfg, parseThemeIDs(text));
            } catch {
              // list still returns the worker body
            }
            return textResult(text);
          } catch (err) {
            return errorResult(err instanceof Error ? err.message : "pendant request failed");
          }
        },
      },
      {
        name: "theme_update",
        description: themeUpdateDescription,
        single: "one color mood for this room",
        inputSchema: {
          type: "object",
          properties: { theme: { type: "string", description: "Catalog id from theme_list (not raw hex)." } },
          required: ["theme"],
        },
        call: async (args, call) => {
          const theme = str(args.theme).trim().toLowerCase();
          if (!theme) return errorResult(themeRequired);
          try {
            const cfg = loadChatConfig(ctx.env, ctx.log);
            const ids = await themeIDs(ctx, call, cfg);
            if (!ids.has(theme)) return errorResult(themeRequired);
            const body = new TextEncoder().encode(JSON.stringify({ theme }));
            const got = await pendantRequest(cfg, ctx.fetch, "POST", blobURL(cfg, "theme"), body, "application/json", call.signal);
            if (got.status >= 400) {
              forgetThemeCatalog(ctx.sql, cfg);
              return errorResult(workerError(got.body, got.status));
            }
            return textResult(textBody(got.body));
          } catch (err) {
            return errorResult(err instanceof Error ? err.message : "pendant request failed");
          }
        },
      },
      {
        name: "theme_delete",
        description: themeDeleteDescription,
        inputSchema: emptySchema(),
        single: "clears the one room mood",
        call: async (_args, call) => {
          try {
            const cfg = loadChatConfig(ctx.env, ctx.log);
            const got = await pendantRequest(cfg, ctx.fetch, "DELETE", blobURL(cfg, "theme"), undefined, "", call.signal);
            if (got.status >= 400) return errorResult(workerError(got.body, got.status));
            return textResult(textBody(got.body));
          } catch (err) {
            return errorResult(err instanceof Error ? err.message : "pendant request failed");
          }
        },
      },
    ];
  },
};
