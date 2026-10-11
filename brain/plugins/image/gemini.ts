import type { ImageConfig } from "./config";
import { decodeBase64Bytes, encodeBase64 } from "./files";

export const mimePNG = "image/png";

const nextGenerate = "Next: photo_generate(prompt=\"a red bicycle leaning on a brick wall\")";
const nextEdit = "Next: photo_edit(prompt=\"add a hat\", source_path=\"<IMAGE_OUTPUT_DIR/file.jpg>\")";

export const allowedAspect = new Set(["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"]);
export const allowedSize = new Set(["1K", "2K", "4K"]);

export type ImageRequest = {
  prompt: string;
  aspectRatio: string;
  size: string;
  sourceMIME: string;
  sourceData: Uint8Array;
};

export type ImageResult = {
  mime: string;
  data: Uint8Array;
  model: string;
  note: string;
};

export function promptRequired(edit: boolean): string {
  return edit ? `prompt is required. ${nextEdit}` : `prompt is required. ${nextGenerate}`;
}

export function validateAspectSize(aspectRatio: string, size: string): void {
  if (aspectRatio && !allowedAspect.has(aspectRatio)) {
    throw new Error(`aspect_ratio must be one of 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9. ${nextGenerate}`);
  }
  if (size && !allowedSize.has(size)) {
    throw new Error(`size must be 1K, 2K, or 4K. ${nextGenerate}`);
  }
}

export function buildBody(req: ImageRequest): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [];
  if (req.sourceData.byteLength > 0) {
    parts.push({
      inlineData: {
        mimeType: req.sourceMIME || mimePNG,
        data: encodeBase64(req.sourceData),
      },
    });
  }
  parts.push({ text: req.prompt });
  const generationConfig: Record<string, unknown> = {
    responseModalities: ["TEXT", "IMAGE"],
  };
  const imageConfig: Record<string, string> = {};
  if (req.aspectRatio) imageConfig.aspectRatio = req.aspectRatio;
  if (req.size) imageConfig.imageSize = req.size;
  if (Object.keys(imageConfig).length > 0) generationConfig.imageConfig = imageConfig;
  return { contents: [{ role: "user", parts }], generationConfig };
}

export function geminiURL(cfg: ImageConfig): string {
  const model = encodeURIComponent(cfg.model);
  if (cfg.useVertex) {
    const project = encodeURIComponent(cfg.project);
    const location = encodeURIComponent(cfg.location);
    const host = cfg.location === "global"
      ? "https://aiplatform.googleapis.com"
      : `https://${cfg.location}-aiplatform.googleapis.com`;
    return `${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

export async function generateImage(cfg: ImageConfig, fetchImpl: typeof fetch, req: ImageRequest, signal?: AbortSignal): Promise<ImageResult> {
  if (!cfg.apiKey && !cfg.useVertex) throw new Error("image provider is not configured");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers["x-goog-api-key"] = cfg.apiKey;
  let res: Response;
  try {
    res = await fetchImpl(geminiURL(cfg), {
      method: "POST",
      headers,
      body: JSON.stringify(buildBody(req)),
      signal,
    });
  } catch (err) {
    throw new Error(`image generate failed: ${err instanceof Error ? err.message : "request failed"}`, { cause: err });
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`image generate failed: HTTP ${res.status} ${text.trim()}`.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    throw new Error(`image generate failed: ${err instanceof Error ? err.message : "bad json"}`, { cause: err });
  }
  return parseGeminiResponse(cfg.model, parsed);
}

export function parseGeminiResponse(model: string, resp: unknown): ImageResult {
  const root = isRecord(resp) ? resp : undefined;
  const candidates = root && Array.isArray(root.candidates) ? root.candidates : [];
  const first = isRecord(candidates[0]) ? candidates[0] : undefined;
  const content = first && isRecord(first.content) ? first.content : undefined;
  const parts = content && Array.isArray(content.parts) ? content.parts : undefined;
  if (!parts) throw new Error("image generate returned no candidates");
  const out: ImageResult = { model, mime: mimePNG, data: new Uint8Array(), note: "" };
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (typeof part.text === "string" && part.text) {
      out.note = out.note ? `${out.note}\n${part.text}` : part.text;
    }
    const inline = isRecord(part.inlineData) ? part.inlineData : undefined;
    const data = inline && typeof inline.data === "string" ? inline.data : "";
    if (data) {
      out.data = decodeBase64Bytes(data);
      if (typeof inline?.mimeType === "string" && inline.mimeType) out.mime = inline.mimeType;
    }
  }
  if (out.data.byteLength === 0) {
    const note = out.note.trim();
    if (note) throw new Error(`image generate returned no image: ${note}`);
    throw new Error("image generate returned no image");
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
