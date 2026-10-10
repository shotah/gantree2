import { acceptJpeg } from "@/lib/avatar/jpeg";
import { avatarRequestPath } from "@/lib/avatar/http";
import { jpegFromFile } from "./jpegFromFile";

const DOWNLOAD_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

/** `kit-avatar.jpg` — the slug is already a safe token; an empty one is Kit. */
export function avatarDownloadName(slug: string, type: string): string {
  const base = slug.trim().toLowerCase() || "kit";
  const mime = type.split(";")[0]?.trim().toLowerCase() ?? "";
  return `${base}-avatar.${DOWNLOAD_EXT[mime] ?? "jpg"}`;
}

export async function fetchImageBlob(src: string): Promise<Blob> {
  const res = await fetch(src, { credentials: "include" });
  if (!res.ok) {
    throw new Error("could not read that image");
  }
  const raw = await res.blob();
  const type = raw.type || res.headers.get("Content-Type")?.split(";")[0]?.trim() || "image/jpeg";
  if (raw.type === type) {
    return raw;
  }
  return new Blob([await raw.arrayBuffer()], { type });
}

/** Clipboard writes want a PNG of the picture already painted, not a second fetch. */
export function pngFromImage(img: HTMLImageElement): Promise<Blob> {
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!width || !height) {
    return Promise.reject(new Error("could not copy that image"));
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return Promise.reject(new Error("could not copy that image"));
  }
  ctx.drawImage(img, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((next) => {
      if (!next) {
        reject(new Error("could not copy that image"));
        return;
      }
      resolve(next);
    }, "image/png");
  });
}

/**
 * Copy the picture that is on screen. The blob promise is handed to
 * `ClipboardItem` so the write still counts as the tap.
 */
export async function copyImageElement(img: HTMLImageElement): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("could not copy that image");
  }
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": pngFromImage(img) }),
  ]);
}

/** Save the picture that is on screen. The browser names the file. */
export async function downloadImage(src: string, slug: string): Promise<void> {
  const blob = await fetchImageBlob(src);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = avatarDownloadName(slug, blob.type);
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function uploadAvatarFile(opts: {
  slug: string;
  file: File;
  secret?: string;
  bearer?: string;
}): Promise<{ ok: true; rev: number } | { ok: false; error: string }> {
  let jpeg: Blob;
  try {
    jpeg = await jpegFromFile(opts.file);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "could not read that image" };
  }
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  const check = acceptJpeg(bytes);
  if (!check.ok) {
    return { ok: false, error: check.detail };
  }
  const body = new FormData();
  body.append("file", jpeg, "avatar.jpg");
  try {
    const res = await fetch(avatarRequestPath({
      slug: opts.slug,
      secret: opts.secret,
      bearer: opts.bearer,
    }), { method: "POST", body, credentials: "include" });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; rev?: number; error?: string; detail?: string };
    if (!res.ok || !data.ok || typeof data.rev !== "number") {
      return { ok: false, error: data.detail || data.error || res.statusText || "upload failed" };
    }
    return { ok: true, rev: data.rev };
  } catch {
    return { ok: false, error: "upload failed" };
  }
}
