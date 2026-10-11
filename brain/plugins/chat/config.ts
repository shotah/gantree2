import type { Logger } from "@/brain/core/log";

export const envChatMailboxURL = "CHAT_MAILBOX_URL";
export const envChatBearer = "CHAT_BEARER";
export const envChatAPIPrefix = "CHAT_API_PREFIX";
export const envPendantMailboxURL = "PENDANT_MAILBOX_URL";
export const envPendantBearer = "PENDANT_BEARER";
export const envImageOutputDir = "IMAGE_OUTPUT_DIR";
export const envPendantImageDir = "PENDANT_IMAGE_DIR";

export const defaultChatAPIPrefix = "/api/chat";

export const nextAvatarUpdate = "Next: avatar_update(source_path=\"<IMAGE_OUTPUT_DIR/file.png>\")";
export const nextAvatarGet = "Next: avatar_get()";
export const nextBackdropUpdate = "Next: backdrop_update(source_path=\"<IMAGE_OUTPUT_DIR/file.png>\")";
export const nextBackdropDelete = "Next: backdrop_delete()";
export const nextThemeList = "Next: theme_list()";
export const nextThemeDelete = "Next: theme_delete()";

const slugRE = /^[a-z][a-z0-9-]{0,31}$/;

export type ServerConfig = {
  mailboxURL: string;
  apiPrefix: string;
  bearer: string;
  slug: string;
  imageRoots: string[];
};

export type Warner = { warn(alias: string, canonical: string): void };

export function createWarner(log: Logger): Warner {
  const seen = new Set<string>();
  return {
    warn(alias, canonical) {
      if (seen.has(alias)) return;
      seen.add(alias);
      log.warn(`deprecated, use ${canonical}`, { env: alias });
    },
  };
}

const processWarnerState = { warner: undefined as Warner | undefined };

export function processWarner(log: Logger): Warner {
  processWarnerState.warner ??= createWarner(log);
  return processWarnerState.warner;
}

export function resetProcessWarner(): void {
  processWarnerState.warner = undefined;
}

export function loadChatConfig(env: Readonly<Record<string, string>>, log: Logger): ServerConfig {
  return resolveServerConfig(env, processWarner(log));
}

export function resolveServerConfig(env: Readonly<Record<string, string>>, warn: Warner | null): ServerConfig {
  const mailbox = lookupAlias(env, envChatMailboxURL, envPendantMailboxURL, warn);
  if (!mailbox) throw new Error(errNeedMailbox());
  const { base, slug } = mailboxToAPI(mailbox);
  const bearer = lookupAlias(env, envChatBearer, envPendantBearer, warn);
  if (!bearer) throw new Error(errNeedBearer());
  return {
    mailboxURL: base,
    apiPrefix: normalizeAPIPrefix(env[envChatAPIPrefix] ?? ""),
    bearer,
    slug,
    imageRoots: imageRoots(env),
  };
}

export function lookupAlias(env: Readonly<Record<string, string>>, canonical: string, alias: string, warn: Warner | null): string {
  const primary = (env[canonical] ?? "").trim();
  if (primary) return primary;
  const fallback = (env[alias] ?? "").trim();
  if (fallback) {
    warn?.warn(alias, canonical);
    return fallback;
  }
  return "";
}

export function normalizeAPIPrefix(raw: string): string {
  let p = raw.trim();
  if (!p) return defaultChatAPIPrefix;
  if (!p.startsWith("/")) p = `/${p}`;
  return p.replace(/\/+$/, "");
}

export function imageRoots(env: Readonly<Record<string, string>>): string[] {
  const roots: string[] = [];
  for (const key of [envImageOutputDir, envPendantImageDir]) {
    const dir = (env[key] ?? "").trim();
    if (dir) roots.push(dir);
  }
  return roots;
}

export function mailboxToAPI(raw: string): { base: string; slug: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error(errBadMailbox());
  }
  if (!u.host) throw new Error(errBadMailbox());
  if (u.protocol === "wss:") u.protocol = "https:";
  else if (u.protocol === "ws:") u.protocol = "http:";
  else if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(errBadMailbox());
  const parts = u.pathname.split("/").filter((part) => part.length > 0);
  if (parts.length < 2 || parts[0] !== "ws") throw new Error(errBadMailbox());
  const slug = (parts[1] ?? "").trim().toLowerCase();
  if (!slugRE.test(slug)) throw new Error(errBadMailbox());
  u.pathname = "";
  u.search = "";
  u.hash = "";
  const base = u.toString().replace(/\/$/, "");
  return { base, slug };
}

export function blobURL(cfg: ServerConfig, kind: string): string {
  const prefix = cfg.apiPrefix || defaultChatAPIPrefix;
  const u = new URL(`${cfg.mailboxURL}${prefix}/${kind}`);
  u.searchParams.set("slug", cfg.slug);
  return u.toString();
}

export function themeCatalogKey(cfg: ServerConfig): string {
  return `${cfg.mailboxURL}\u0000${cfg.slug}`;
}

export function errNeedMailbox(): string {
  return `${envChatMailboxURL} is required (wss://…/ws/<slug>). ${nextThemeList}`;
}

export function errNeedBearer(): string {
  return `${envChatBearer} is required (Authorization: Bearer). ${nextThemeList}`;
}

export function errBadMailbox(): string {
  return `${envChatMailboxURL} must be ws(s) or http(s) with /ws/<slug>. ${nextThemeList}`;
}

export function errNeedImageDir(): string {
  return `${envImageOutputDir} is required for source_path (the image__photo_generate handoff). Set it on the crane, then ${nextAvatarUpdate}`;
}
