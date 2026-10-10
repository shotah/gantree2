"use client";

import { useEffect, useId, useRef, useState } from "react";
import { copyImageElement, downloadImage, uploadAvatarFile } from "@/app/lib/avatar";
import { blobCacheKey, useBlobUrl } from "@/app/lib/blobUrl";
import { avatarRequestPath } from "@/lib/avatar/http";
import { displaySlug } from "@/lib/avatar/store";

const FALLBACK = "/icon.svg";
const COPIED_MS = 1600;

const DIM = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-16 w-16",
  xl: "h-[82px] w-[82px]",
} as const;

const ACTION = "rounded-xl border border-accent-line bg-accent-soft px-3 py-2 text-sm text-mark disabled:opacity-40";

function sheetError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.startsWith("could not") ? err.message : fallback;
}

export function KitAvatar({
  slug,
  rev,
  secret,
  bearer,
  size = "md",
  editable,
  className,
  onRev,
  onError,
}: {
  slug: string;
  rev: number;
  secret?: string;
  bearer?: string;
  size?: keyof typeof DIM;
  editable?: boolean;
  className?: string;
  onRev?: (rev: number) => void;
  onError?: (msg: string) => void;
}) {
  const src = useBlobUrl(
    slug ? avatarRequestPath({ slug, rev, secret, bearer }) : null,
    FALLBACK,
    slug ? blobCacheKey("avatar", slug) : undefined,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const faceRef = useRef<HTMLImageElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const copiedTimer = useRef<number | null>(null);
  const dialogId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"copy" | "download" | "upload" | null>(null);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState("");
  const dim = DIM[size];
  const name = displaySlug(slug);

  useEffect(() => () => {
    if (copiedTimer.current !== null) {
      window.clearTimeout(copiedTimer.current);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    panel.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const img = (
    <img src={src} alt="" className={`${dim} shrink-0 rounded-full object-cover bg-track${className ? ` ${className}` : ""}`} />
  );

  if (!editable) {
    return img;
  }

  function flashCopied() {
    setCopied(true);
    if (copiedTimer.current !== null) {
      window.clearTimeout(copiedTimer.current);
    }
    copiedTimer.current = window.setTimeout(() => {
      copiedTimer.current = null;
      setCopied(false);
    }, COPIED_MS);
  }

  function showSheet() {
    setNote("");
    setCopied(false);
    setOpen(true);
  }

  async function onCopy() {
    const face = faceRef.current;
    if (!face) {
      setNote("could not copy that image");
      return;
    }
    setBusy("copy");
    setNote("");
    setCopied(false);
    try {
      await copyImageElement(face);
      flashCopied();
    } catch (err) {
      setNote(sheetError(err, "could not copy that image"));
    } finally {
      setBusy(null);
    }
  }

  async function onDownload() {
    // A blob: URL is the paint. The file itself is the avatar route (or the
    // pendant glyph, when that is what is on screen).
    const fileSrc = src.startsWith("blob:")
      ? avatarRequestPath({ slug, rev, secret, bearer })
      : src;
    setBusy("download");
    setNote("");
    try {
      await downloadImage(fileSrc, slug);
    } catch (err) {
      setNote(sheetError(err, "could not download that image"));
    } finally {
      setBusy(null);
    }
  }

  async function onFile(file: File) {
    setBusy("upload");
    setNote("");
    const got = await uploadAvatarFile({ slug, file, secret, bearer });
    setBusy(null);
    if (got.ok) {
      onRev?.(got.rev);
      onError?.("");
      return;
    }
    setNote(got.error);
    onError?.(got.error);
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) {
            return;
          }
          void onFile(f);
        }}
      />
      <button
        type="button"
        className="shrink-0 rounded-full"
        aria-label={`${name}'s photo`}
        title={`${name}'s photo`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={showSheet}
      >
        {img}
      </button>
      {open
        ? (
            <>
              <div
                data-testid="avatar-scrim"
                aria-hidden
                className="fixed inset-0 z-40 bg-black/40"
                onClick={() => setOpen(false)}
              />
              <div
                id={dialogId}
                ref={panel}
                role="dialog"
                aria-modal="true"
                aria-label={`${name}'s photo`}
                tabIndex={-1}
                className="fixed left-1/2 top-1/2 z-40 w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-panel p-4 shadow-2xl outline-none"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-fg">{`${name}'s photo`}</p>
                  <button
                    type="button"
                    aria-label="Close photo"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-track hover:text-fg"
                    onClick={() => setOpen(false)}
                  >
                    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
                      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M5 5l10 10M15 5L5 15" />
                    </svg>
                  </button>
                </div>
                <img ref={faceRef} src={src} alt="" className="mx-auto mt-3 h-32 w-32 rounded-full border-2 border-line object-cover bg-track" />
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" className={ACTION} disabled={busy !== null} onClick={() => void onCopy()}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button type="button" className={ACTION} disabled={busy !== null} onClick={() => void onDownload()}>
                    Download
                  </button>
                </div>
                <button
                  type="button"
                  className={`${ACTION} mt-2 w-full`}
                  disabled={busy !== null}
                  onClick={() => fileRef.current?.click()}
                >
                  {busy === "upload" ? "Saving…" : "Upload photo"}
                </button>
                {note
                  ? <p role="alert" className="mt-2 text-xs text-danger">{note}</p>
                  : null}
              </div>
            </>
          )
        : null}
    </>
  );
}
