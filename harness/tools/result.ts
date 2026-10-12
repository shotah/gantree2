/**
 * Flatten a plugin `ToolResult` into the string the model sees.
 * Image bytes stay out of that string (the cap would cut them mid-blob).
 * Chat photo tools (`photo_generate`, `photo_edit`) append a delivery note
 * and return data URLs beside the text so the room can show the picture.
 */
import { type ToolResult } from "@/harness/core/tools";

export type ModelView = {
  text: string;
  /** Data URLs for chat photo tools. Empty for every other tool. */
  images: string[];
};

export function modelView(result: ToolResult, originalName: string): ModelView {
  const delivered = isChatPhotoTool(originalName);
  const parts: string[] = [];
  const images: string[] = [];
  let imageCount = 0;
  for (const part of result.content) {
    if (part.type === "text") {
      if (part.text.trim() !== "") {
        parts.push(part.text);
      }
      continue;
    }
    if (part.type === "image") {
      const url = dataUrl(part.data, part.mimeType);
      if (!url) {
        continue;
      }
      imageCount += 1;
      if (delivered) {
        images.push(url);
      }
      continue;
    }
    parts.push(JSON.stringify(part));
  }
  if (delivered && imageCount > 0) {
    parts.push(`[image] ${imageCount} picture(s) delivered to chat`);
  } else if (parts.length === 0 && imageCount > 0) {
    return { text: `[image] ${imageCount} picture(s)`, images: [] };
  }
  return { text: parts.join("\n"), images: delivered ? images : [] };
}

function isChatPhotoTool(name: string): boolean {
  return name === "photo_generate" || name === "photo_edit";
}

function dataUrl(data: string, mimeType: string | undefined): string | null {
  if (!data) {
    return null;
  }
  if (data.startsWith("data:")) {
    return data;
  }
  const mime = mimeType?.trim() || "image/png";
  return `data:${mime};base64,${data}`;
}
