import { describe, expect, it } from "vitest";
import { apiPath, parseStravaUrl, resolveStravaUrl, resolveUserAgent } from "@/harness/plugins/strava/urls";

function urlOf(input: RequestInfo | URL): URL {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

describe("parseStravaUrl", () => {
  const cases: { name: string; raw: string; type?: string; id?: number; canonical?: string; ok: boolean }[] = [
    { name: "activity", raw: "https://www.strava.com/activities/123456", type: "activity", id: 123456, canonical: "https://www.strava.com/activities/123456", ok: true },
    { name: "overview", raw: "https://www.strava.com/activities/99/overview?utm_source=share", type: "activity", id: 99, canonical: "https://www.strava.com/activities/99", ok: true },
    { name: "route", raw: "https://strava.com/routes/3141592653589793", type: "route", id: 3141592653589793, canonical: "https://www.strava.com/routes/3141592653589793", ok: true },
    { name: "segment", raw: "https://app.strava.com/segments/42", type: "segment", id: 42, canonical: "https://www.strava.com/segments/42", ok: true },
    { name: "athlete", raw: "https://m.strava.com/athletes/7", type: "athlete", id: 7, canonical: "https://www.strava.com/athletes/7", ok: true },
    { name: "club", raw: "https://www.strava.com/clubs/55/activities", type: "club", id: 55, canonical: "https://www.strava.com/clubs/55", ok: true },
    { name: "short", raw: "https://strava.app.link/abc123", ok: false },
    { name: "missing id", raw: "https://www.strava.com/routes/", ok: false },
    { name: "non-numeric", raw: "https://www.strava.com/routes/abc", ok: false },
    { name: "unknown", raw: "https://www.strava.com/dashboard", ok: false },
    { name: "other host", raw: "https://example.com/routes/1", ok: false },
    { name: "empty", raw: "", ok: false },
    { name: "bad escape", raw: "https://www.strava.com/%zz", ok: false },
  ];

  for (const tc of cases) {
    it(tc.name, () => {
      if (!tc.ok) {
        expect(() => parseStravaUrl(tc.raw)).toThrow();
        return;
      }
      const got = parseStravaUrl(tc.raw);
      expect(got.type).toBe(tc.type);
      expect(got.id).toBe(tc.id);
      expect(got.canonicalUrl).toBe(tc.canonical);
    });
  }
});

describe("apiPath", () => {
  it("maps each resource and rejects the rest", () => {
    expect(apiPath({ type: "activity", id: 1 })).toBe("/activities/1");
    expect(apiPath({ type: "route", id: 2 })).toBe("/routes/2");
    expect(apiPath({ type: "segment", id: 3 })).toBe("/segments/3");
    expect(apiPath({ type: "athlete", id: 4 })).toBe("/athletes/4");
    expect(apiPath({ type: "club", id: 5 })).toBe("/clubs/5");
    expect(() => apiPath({ type: "other", id: 6 })).toThrow(/unsupported resource type/);
    expect(() => apiPath({ type: "route", id: 0 })).toThrow(/unresolved url/);
    expect(() => apiPath(null)).toThrow(/unresolved url/);
  });
});

describe("resolveStravaUrl", () => {
  it("parses a canonical url without fetching", async () => {
    const got = await resolveStravaUrl("https://www.strava.com/routes/88", {
      fetch: () => Promise.reject(new Error("fetched")),
    });
    expect(got).toMatchObject({ type: "route", id: 88, inputUrl: "https://www.strava.com/routes/88" });
  });

  it("adds https and trims", async () => {
    const got = await resolveStravaUrl("  www.strava.com/activities/12  ", {
      fetch: () => Promise.reject(new Error("fetched")),
    });
    expect(got).toMatchObject({ type: "activity", id: 12 });
  });

  it("follows a short link redirect", async () => {
    let ua = "";
    const got = await resolveStravaUrl("https://strava.app.link/abc123", {
      fetch: (input, init) => {
        const url = urlOf(input);
        expect(url.pathname).toBe("/abc123");
        ua = new Headers(init?.headers).get("user-agent") ?? "";
        return Promise.resolve(new Response(null, { status: 302, headers: { location: "https://www.strava.com/routes/777" } }));
      },
    });
    expect(ua).toBe(resolveUserAgent);
    expect(got).toMatchObject({ type: "route", id: 777, canonicalUrl: "https://www.strava.com/routes/777" });
  });

  it("follows a relative redirect then scrapes html", async () => {
    const got = await resolveStravaUrl("http://127.0.0.1/short", {
      allowHttp: true,
      extraHosts: ["127.0.0.1"],
      fetch: (input) => {
        const url = urlOf(input);
        if (url.pathname === "/short") {
          return Promise.resolve(new Response(null, { status: 301, headers: { location: "/interstitial" } }));
        }
        return Promise.resolve(new Response(`<html><head><meta property="og:url" content="https://www.strava.com/activities/4242"></head></html>`));
      },
    });
    expect(got).toMatchObject({ type: "activity", id: 4242 });
  });

  it("rejects non-https, foreign hosts, empty urls, and odd schemes", async () => {
    const fetch = () => Promise.reject(new Error("fetched"));
    await expect(resolveStravaUrl("http://www.strava.com/routes/1", { fetch })).rejects.toThrow(/non-https/);
    await expect(resolveStravaUrl("https://evil.example/routes/1", { fetch })).rejects.toThrow(/non-Strava host/);
    await expect(resolveStravaUrl("   ", { fetch })).rejects.toThrow(/url is required/);
    await expect(resolveStravaUrl("javascript:alert(1)", { fetch })).rejects.toThrow(/unsupported url scheme/);
    await expect(resolveStravaUrl("https://www.strava.com/%zz", { fetch })).rejects.toThrow(/parse url/);
  });

  it("rejects a redirect onto a foreign host", async () => {
    await expect(resolveStravaUrl("https://strava.app.link/short", {
      fetch: () => Promise.resolve(new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } })),
    })).rejects.toThrow(/non-Strava host/);
  });

  it("errors when the html has no strava resource", async () => {
    await expect(resolveStravaUrl("https://strava.app.link/short", {
      fetch: () => Promise.resolve(new Response("<html><body>no strava links here</body></html>")),
    })).rejects.toThrow(/could not resolve/);
  });

  it("stops after 8 redirects", async () => {
    let hops = 0;
    await expect(resolveStravaUrl("https://strava.app.link/loop", {
      fetch: () => {
        hops += 1;
        return Promise.resolve(new Response(null, { status: 302, headers: { location: "/loop" } }));
      },
    })).rejects.toThrow(/too many redirects/);
    expect(hops).toBe(8);
  });

  it("errors on a broken location header and a failed request", async () => {
    await expect(resolveStravaUrl("https://strava.app.link/short", {
      fetch: () => Promise.resolve(new Response(null, { status: 302, headers: { location: "://not-a-url" } })),
    })).rejects.toThrow();
    await expect(resolveStravaUrl("https://strava.app.link/short", {
      fetch: () => Promise.reject(new Error("down")),
    })).rejects.toThrow(/resolve request/);
  });
});
