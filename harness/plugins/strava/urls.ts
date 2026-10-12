import { errorMessage } from "./helpers.ts";

const maxRedirects = 8;
const maxHtmlBytes = 512 << 10;

export const resolveUserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const htmlResourceUrlRe = /https?:\/\/(?:www\.|app\.|m\.)?strava\.com\/(?:activities|routes|segments|athletes|clubs)\/[0-9]+/;

const resourceHosts = new Set(["strava.com", "www.strava.com", "app.strava.com", "m.strava.com"]);
const redirectHosts = new Set(["strava.app.link", "www.strava.app.link", "app.link", "bnc.lt"]);

const pathTypes: Record<string, ResourceType> = {
  activities: "activity",
  athletes: "athlete",
  clubs: "club",
  routes: "route",
  segments: "segment",
};

export type ResourceType = "activity" | "route" | "segment" | "athlete" | "club";

export type ResolvedUrl = {
  inputUrl: string;
  canonicalUrl: string;
  type: ResourceType;
  id: number;
};

export type ResolveOptions = {
  fetch: typeof fetch;
  signal?: AbortSignal;
  allowHttp?: boolean;
  extraHosts?: readonly string[];
};

const notResource = "not a Strava resource URL";

export function parseStravaUrl(raw: string): ResolvedUrl {
  const trimmed = raw.trim();
  if (trimmed === "") throw new Error(notResource);
  const url = parseGoUrl(trimmed);
  if (url.host === "" || url.pathname === "") throw new Error(notResource);
  if (!resourceHosts.has(url.hostname.toLowerCase())) throw new Error(notResource);
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  const segment = parts[0] ?? "";
  const idPart = parts[1] ?? "";
  if (parts.length < 2 || segment === "" || idPart === "") throw new Error(notResource);
  const type = pathTypes[segment.toLowerCase()];
  if (!type) throw new Error(notResource);
  const id = parsePositiveId(idPart);
  if (id === null) throw new Error(notResource);
  return {
    canonicalUrl: `https://www.strava.com/${segment}/${id}`,
    id,
    inputUrl: raw,
    type,
  };
}

export function apiPath(resolved: { type: string; id: number } | null): string {
  if (!resolved || resolved.id <= 0) throw new Error("unresolved url");
  switch (resolved.type) {
    case "activity":
      return `/activities/${resolved.id}`;
    case "route":
      return `/routes/${resolved.id}`;
    case "segment":
      return `/segments/${resolved.id}`;
    case "athlete":
      return `/athletes/${resolved.id}`;
    case "club":
      return `/clubs/${resolved.id}`;
    default:
      throw new Error(`unsupported resource type ${JSON.stringify(resolved.type)}`);
  }
}

export async function resolveStravaUrl(raw: string, opts: ResolveOptions): Promise<ResolvedUrl> {
  const policy = { allowHttp: opts.allowHttp === true, allowed: allowedHosts(opts.extraHosts) };
  const currentUrl = normalize(raw, policy);
  try {
    const parsed = parseStravaUrl(currentUrl.href);
    parsed.inputUrl = raw;
    return parsed;
  } catch (err) {
    if (!isNotResource(err)) throw err;
  }

  let current = currentUrl.href;
  for (let hop = 0; hop < maxRedirects; hop += 1) {
    let response: Response;
    try {
      response = await opts.fetch(current, {
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "User-Agent": resolveUserAgent,
        },
        method: "GET",
        redirect: "manual",
        signal: opts.signal,
      });
    } catch (err) {
      throw new Error(`resolve request: ${errorMessage(err)}`, { cause: err });
    }
    const location = response.headers.get("location");
    if (location) {
      let next: URL;
      try {
        next = new URL(location, current);
      } catch (err) {
        await response.body?.cancel();
        throw new Error(`parse redirect location: ${errorMessage(err)}`, { cause: err });
      }
      try {
        validate(next, policy);
      } catch (err) {
        await response.body?.cancel();
        throw err;
      }
      try {
        const parsed = parseStravaUrl(next.href);
        await response.body?.cancel();
        parsed.inputUrl = raw;
        return parsed;
      } catch (err) {
        await response.body?.cancel();
        if (!isNotResource(err)) throw err;
      }
      current = next.href;
      continue;
    }
    let html: string;
    try {
      html = await response.text();
    } catch (err) {
      throw new Error(`read resolve body: ${errorMessage(err)}`, { cause: err });
    }
    try {
      const parsed = parseStravaUrlFromHtml(html.slice(0, maxHtmlBytes));
      parsed.inputUrl = raw;
      return parsed;
    } catch (err) {
      if (!isNotResource(err)) throw err;
    }
    throw new Error(`could not resolve ${JSON.stringify(raw)} to a Strava activity, route, or segment`);
  }
  throw new Error(`too many redirects resolving ${JSON.stringify(raw)}`);
}

function parseStravaUrlFromHtml(html: string): ResolvedUrl {
  const match = htmlResourceUrlRe.exec(html);
  if (!match) throw new Error(notResource);
  return parseStravaUrl(match[0]);
}

function normalize(raw: string, policy: { allowHttp: boolean; allowed: Set<string> }): URL {
  const trimmed = raw.trim();
  if (trimmed === "") throw new Error("url is required");
  const withScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = parseGoUrl(withScheme);
  validate(url, policy);
  return url;
}

function validate(url: URL, policy: { allowHttp: boolean; allowed: Set<string> }): void {
  const scheme = url.protocol.replace(/:$/, "");
  if (scheme === "https") {
    // allowed
  } else if (scheme === "http") {
    if (!policy.allowHttp) throw new Error("refusing non-https url");
  } else {
    throw new Error(`unsupported url scheme ${JSON.stringify(scheme)}`);
  }
  if (url.host === "") throw new Error("invalid url");
  const host = url.hostname.toLowerCase();
  if (!policy.allowed.has(host)) {
    throw new Error(`refusing non-Strava host ${JSON.stringify(host)}`);
  }
}

function allowedHosts(extra: readonly string[] | undefined): Set<string> {
  const hosts = new Set<string>([...resourceHosts, ...redirectHosts]);
  for (const host of extra ?? []) hosts.add(host.toLowerCase());
  return hosts;
}

function parseGoUrl(raw: string): URL {
  const bad = /%(?![0-9A-Fa-f]{2})/.exec(raw);
  if (bad) {
    throw new Error(`parse url: parse ${JSON.stringify(raw)}: invalid URL escape ${JSON.stringify(bad[0])}`);
  }
  try {
    return new URL(raw);
  } catch (err) {
    throw new Error(`parse url: ${errorMessage(err)}`, { cause: err });
  }
}

function parsePositiveId(raw: string): number | null {
  if (!/^[0-9]+$/.test(raw)) return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return id;
}

function isNotResource(err: unknown): boolean {
  return err instanceof Error && err.message === notResource;
}
