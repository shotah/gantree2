import type { CallContext, JsonSchema, Plugin, PluginContext, Tool, ToolResult } from "@/harness/core/tools";
import { errorResult } from "@/harness/core/tools";
import { loadImageConfig, type ImageConfig } from "./config";
import { decodeBase64, encodeBase64, extForMime, mimeFromPath, readInsideRoots, writeOutputFile, type PathMessages } from "./files";
import { generateImage, mimePNG, promptRequired, validateAspectSize, type ImageRequest, type ImageResult } from "./gemini";

const generateDescription = "Generate images from text prompts. Returns PNG bytes to MCP clients plus a JSON list of summaries (mime, bytes, model, optional path). Use for “draw”, “make an image”, “render a picture”. Prefer this over describing an image in prose. When IMAGE_OUTPUT_DIR is set, summary.path is the file for pendant__avatar_update (ask for 1:1) or pendant__backdrop_update (ask for 9:16); the chat also receives the picture. Not for Drive/Docs files — use google__drive_* or docs_insert_image. Not for editing an existing photo — use photo_edit. prompts accepts up to 4; prompt still works for one. One failure is an error row.";
const editDescription = "Edit existing images with a text prompt. Pass source_path from photo_generate or pendant__avatar_get (must sit inside IMAGE_OUTPUT_DIR). Use for “make this watercolor”, “add a hat”. Not for creating from scratch — use photo_generate. images accepts up to 4 edits; prompt plus source_path still works for one. One failure is an error row.";

const maxImages = 4;

const nextEdit = "Next: photo_edit(prompt=\"add a hat\", source_path=\"<IMAGE_OUTPUT_DIR/file.jpg>\")";

const pathMessages: PathMessages = {
  needDir: `IMAGE_OUTPUT_DIR is required for source_path (the pendant__avatar_get / photo_generate handoff). ${nextEdit}`,
  required: `source_path is required. ${nextEdit}`,
  refuse: `source_path must resolve inside IMAGE_OUTPUT_DIR (or PENDANT_IMAGE_DIR). ${nextEdit}`,
  unreadable: `source_path could not be read. ${nextEdit}`,
  empty: `source_path is empty. ${nextEdit}`,
};

function schema(edit: boolean): JsonSchema {
  const properties: Record<string, JsonSchema> = {
    prompt: { type: "string", description: edit ? "How to change the image. Shared across images when an item omits prompt." : "What to draw. Be specific about subject, style, and composition." },
  };
  if (edit) {
    properties.images = {
      type: "array",
      description: "Up to 4 edits. Each object has source_path or source_image, optional source_mime, and optional prompt. prompt plus source_path still edits one image.",
      items: { type: "object" },
    };
    properties.source_path = { type: "string", description: "File on disk from photo_generate or pendant__avatar_get. Must resolve inside IMAGE_OUTPUT_DIR (or PENDANT_IMAGE_DIR). This is the v1 handoff." };
    properties.source_image = { type: "string", description: "Optional base64 when the host keeps image bytes. Prefer source_path." };
    properties.source_mime = { type: "string", description: "Optional MIME of the source (default from the file ext, else image/png)." };
  } else {
    properties.prompts = {
      type: "array",
      description: "What to draw, up to 4 prompts. prompt still works for one. aspect_ratio and size apply to each.",
      items: { type: "string" },
    };
  }
  properties.aspect_ratio = { type: "string", description: "Optional. One of 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9." };
  properties.size = { type: "string", description: "Optional. 1K (default), 2K, or 4K." };
  return { type: "object", properties, required: ["prompt"] };
}

function trimmedStrings(value: unknown): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    return text === "" ? [] : [text];
  }
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (text !== "") out.push(text);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type EditJob = { prompt: string; sourcePath: string; sourceImage: string; sourceMime: string };

function editJobs(args: Record<string, unknown>): EditJob[] | string {
  const sharedPrompt = str(args.prompt);
  const images = args.images;
  if (Array.isArray(images) && images.length > 0) {
    if (images.length > maxImages) return "images accepts at most 4";
    const jobs: EditJob[] = [];
    for (const item of images) {
      if (!isRecord(item)) {
        jobs.push({ prompt: sharedPrompt, sourcePath: "", sourceImage: "", sourceMime: "" });
        continue;
      }
      const prompt = str(item.prompt) || sharedPrompt;
      const sourcePath = str(item.source_path) || str(args.source_path);
      const sourceImage = str(item.source_image) || (str(item.source_path) ? "" : str(args.source_image));
      const sourceMime = str(item.source_mime) || str(args.source_mime);
      jobs.push({ prompt, sourcePath, sourceImage, sourceMime });
    }
    return jobs;
  }
  return [{
    prompt: sharedPrompt,
    sourcePath: str(args.source_path),
    sourceImage: str(args.source_image),
    sourceMime: str(args.source_mime),
  }];
}

function goJSON(value: unknown): string {
  return JSON.stringify(value).replace(/[&<>\u2028\u2029]/g, (ch) => {
    switch (ch) {
      case "&": return "\\u0026";
      case "<": return "\\u003c";
      case ">": return "\\u003e";
      case "\u2028": return "\\u2028";
      default: return "\\u2029";
    }
  });
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function decodeSourceImage(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`source_image is required. ${nextEdit}`);
  const data = decodeBase64(trimmed);
  if (!data) throw new Error(`source_image must be base64. ${nextEdit}`);
  if (data.byteLength === 0) throw new Error(`source_image is empty. ${nextEdit}`);
  return data;
}

export function readEditSource(sql: PluginContext["sql"], env: Readonly<Record<string, string>>, sourcePath: string, sourceImage: string, sourceMIME: string): { data: Uint8Array; mime: string } {
  const path = sourcePath.trim();
  const img = sourceImage.trim();
  if (path && img) throw new Error(`pass exactly one of source_path or source_image. ${nextEdit}`);
  const { imageRoots } = loadRoots(env);
  if (!path && !img) {
    if (imageRoots.length === 0) throw new Error(pathMessages.needDir);
    throw new Error(pathMessages.required);
  }
  if (img) {
    const mime = sourceMIME.trim() || mimePNG;
    return { data: decodeSourceImage(img), mime };
  }
  const data = readInsideRoots(sql, path, imageRoots, pathMessages);
  const mime = sourceMIME.trim() || mimeFromPath(path);
  return { data, mime };
}

function loadRoots(env: Readonly<Record<string, string>>): { imageRoots: string[] } {
  const roots: string[] = [];
  for (const key of ["IMAGE_OUTPUT_DIR", "PENDANT_IMAGE_DIR"]) {
    const dir = (env[key] ?? "").trim();
    if (dir) roots.push(dir);
  }
  return { imageRoots: roots };
}

function summaryRecord(prompt: string, got: ImageResult, filePath: string): Record<string, unknown> {
  const out: Record<string, unknown> = { prompt };
  if (got.model) out.model = got.model;
  if (got.mime) out.mime = got.mime;
  out.bytes = got.data.byteLength;
  if (filePath) out.path = filePath;
  const note = got.note.trim();
  if (note) out.note = note;
  return out;
}

async function run(ctx: PluginContext, call: CallContext, args: Record<string, unknown>, edit: boolean): Promise<ToolResult> {
  const aspectRatio = str(args.aspect_ratio);
  const size = str(args.size);
  let jobs: { prompt: string; sourcePath: string; sourceImage: string; sourceMime: string }[];
  if (edit) {
    const parsed = editJobs(args);
    if (typeof parsed === "string") return errorResult(parsed);
    jobs = parsed;
  } else {
    const prompts = [...trimmedStrings(args.prompt), ...trimmedStrings(args.prompts)];
    if (prompts.length > maxImages) return errorResult("prompts accepts at most 4");
    jobs = prompts.map((prompt) => ({ prompt, sourcePath: "", sourceImage: "", sourceMime: "" }));
  }
  if (jobs.length === 0 || jobs.every((job) => job.prompt === "")) return errorResult(promptRequired(edit));
  let cfg: ImageConfig;
  try {
    validateAspectSize(aspectRatio, size);
    cfg = loadImageConfig(ctx.env);
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : "image generate failed");
  }
  const rows: Record<string, unknown>[] = [];
  const images: { data: Uint8Array; mime: string }[] = [];
  for (const job of jobs) {
    if (job.prompt === "") {
      rows.push({ error: promptRequired(edit) });
      continue;
    }
    const req: ImageRequest = {
      prompt: job.prompt,
      aspectRatio,
      size,
      sourceMIME: "",
      sourceData: new Uint8Array(),
    };
    try {
      if (edit) {
        const src = readEditSource(ctx.sql, ctx.env, job.sourcePath, job.sourceImage, job.sourceMime);
        req.sourceData = src.data;
        req.sourceMIME = src.mime;
      }
      const got = await generateImage(cfg, ctx.fetch, req, call.signal);
      const filePath = writeOutputFile(ctx.sql, ctx.clock, cfg.outputDir, got.data, extForMime(got.mime));
      rows.push(summaryRecord(job.prompt, got, filePath));
      images.push({ data: got.data, mime: got.mime });
    } catch (err) {
      rows.push({ prompt: job.prompt, error: err instanceof Error ? err.message : "image generate failed" });
    }
  }
  return {
    content: [
      { type: "text", text: goJSON(rows) },
      ...images.map((img) => ({ type: "image" as const, data: encodeBase64(img.data), mimeType: img.mime })),
    ],
  };
}

export const imagePlugin: Plugin = {
  name: "image",
  ready: () => Promise.resolve(null),
  tools(ctx): Tool[] {
    return [
      {
        name: "photo_generate",
        description: generateDescription,
        inputSchema: schema(false),
        call: (args, call) => run(ctx, call, args, false),
      },
      {
        name: "photo_edit",
        description: editDescription,
        inputSchema: schema(true),
        call: (args, call) => run(ctx, call, args, true),
      },
    ];
  },
};

export { keys } from "./keys";
export { buildBody, parseGeminiResponse } from "./gemini";
export { isEnabled, loadImageConfig } from "./config";
export { extForMime, mimeFromPath, putOutputFile, writeOutputFile } from "./files";
