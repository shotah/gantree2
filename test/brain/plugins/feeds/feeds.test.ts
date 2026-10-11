import { describe, expect, it } from "vitest";
import {
  fetchFeed,
  feedsPlugin,
  githubCandidate,
  htmlFeedLinks,
  joinPath,
  kindFromContentType,
  isFeedType,
  looksLikeURL,
  nwsCandidate,
  resolveFeed,
  resolveHref,
  youtubeChannelCandidate,
  youtubeFromHTML,
} from "@/brain/plugins/feeds/index";
import { httpGet, userAgentFrom, validateURL, type Got } from "@/brain/plugins/feeds/http";
import { firstNonEmpty, looksLikeHTML, parseFeedDocument, parseFeedTitle, stripTags, truncateRunes } from "@/brain/plugins/feeds/parse";
import { callTool, pluginCtx, textOf, textResponse } from "../helpers";

const rssFeed = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example RSS</title>
    <link>https://example.com</link>
    <item>
      <guid>guid-1</guid>
      <title>First</title>
      <link>https://example.com/1</link>
      <description>Hello <b>world</b></description>
      <pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate>
    </item>
    <item>
      <title>No guid</title>
      <link>https://example.com/2</link>
    </item>
    <item>
      <title>Dropped — no id</title>
    </item>
  </channel>
</rss>`;

const atomFeed = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom</title>
  <link href="https://example.com/atom"/>
  <entry>
    <id>atom-1</id>
    <title>Entry</title>
    <link href="https://example.com/a"/>
    <updated>2026-01-02T00:00:00Z</updated>
    <summary>Sum</summary>
  </entry>
</feed>`;

const jsonFeed = `{
  "version": "https://jsonfeed.org/version/1",
  "title": "Example JSON",
  "feed_url": "https://example.com/feed.json",
  "items": [
    {"id": "jf-1", "title": "JF", "url": "https://example.com/j", "content_text": "Body"}
  ]
}`;

function got(body: string, contentType: string, finalURL = "https://example.com/feed"): Got {
  return { body: new TextEncoder().encode(body), contentType, finalURL };
}

function staticGet(body: string, contentType: string): (url: string) => Promise<Got> {
  return () => Promise.resolve(got(body, contentType));
}

describe("feeds fetch", () => {
  it("parses RSS, strips tags, and falls back to the link", async () => {
    const doc = await fetchFeed(staticGet(rssFeed, "application/rss+xml"), "https://example.com/rss.xml", 25);
    expect(doc.title).toBe("Example RSS");
    expect(doc.items).toHaveLength(2);
    expect(doc.items[0]).toMatchObject({ id: "guid-1", title: "First", url: "https://example.com/1" });
    expect(doc.items[0]?.summary).toContain("Hello world");
    expect(doc.items[1]?.id).toBe("https://example.com/2");
  });

  it("parses Atom published timestamps and JSON Feed", async () => {
    const atom = await fetchFeed(staticGet(atomFeed, "application/atom+xml"), "https://example.com/atom.xml", 10);
    expect(atom.title).toBe("Example Atom");
    expect(atom.items[0]?.id).toBe("atom-1");
    expect(atom.items[0]?.published).toBe("2026-01-02T00:00:00Z");
    const json = await fetchFeed(staticGet(jsonFeed, "application/feed+json"), "https://example.com/feed.json", 10);
    expect(json.title).toBe("Example JSON");
    expect(json.items[0]?.id).toBe("jf-1");
    const versionOnly = `{"version":"https://jsonfeed.org/version/1.1","title":"Only version","items":[]}`;
    expect(parseFeedDocument(versionOnly, "application/feed+json").title).toBe("Only version");
    const spoof = `{"version":"https://evil.example/?x=jsonfeed.org","title":"Spoof"}`;
    expect(() => parseFeedDocument(spoof, "application/feed+json")).toThrow(/invalid json feed/);
  });

  it("refuses HTML, plain text, and a bad scheme", async () => {
    await expect(fetchFeed(staticGet("<!DOCTYPE html><html><body>blog</body></html>", "text/html"), "https://example.com/", 10))
      .rejects.toThrow("source_resolve");
    await expect(fetchFeed(staticGet("<html><head><title>x</title></head></html>", "application/octet-stream"), "https://example.com/", 10))
      .rejects.toThrow("web page");
    await expect(fetchFeed(staticGet("plain text, not a feed", "text/plain"), "https://example.com/", 10))
      .rejects.toThrow("not a feed");
    await expect(fetchFeed(staticGet("x", "text/plain"), "ftp://x", 10)).rejects.toThrow();
  });

  it("defaults, caps, and keeps the watch fields", async () => {
    const items = Array.from({ length: 60 }, (_, i) => `<item><guid>id-${i}</guid><title>T</title><link>https://example.com/${i}</link></item>`).join("");
    const body = `<?xml version="1.0"?><rss version="2.0"><channel><title>Many</title>${items}</channel></rss>`;
    const get = staticGet(body, "application/rss+xml");
    expect((await fetchFeed(get, "https://example.com/rss.xml", 3)).items).toHaveLength(3);
    expect((await fetchFeed(get, "https://example.com/rss.xml", 0)).items).toHaveLength(25);
    expect((await fetchFeed(get, "https://example.com/rss.xml", 999)).items).toHaveLength(50);
    const watched = await fetchFeed(staticGet(rssFeed, "application/rss+xml"), "https://example.com/rss.xml", 10);
    const parsed = JSON.parse(JSON.stringify(watched)) as { items: { id: string }[] };
    expect(parsed.items[0]?.id).toBe("guid-1");
  });

  it("keeps an unparseable published string and surfaces a GET error", async () => {
    const raw = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><item><guid>g</guid><link>https://example.com/x</link><title>T</title><pubDate>yesterday</pubDate></item></channel></rss>`;
    const doc = parseFeedDocument(raw, "application/rss+xml");
    expect(doc.items[0]).toMatchObject({ id: "g", published: "yesterday" });
    await expect(fetchFeed(async () => {
      throw new Error("GET https://example.com: HTTP 502");
    }, "https://example.com/rss.xml", 10)).rejects.toThrow("HTTP 502");
  });

  it("classifies HTML and truncates summaries", () => {
    expect(looksLikeHTML("", "text/html")).toBe(true);
    expect(looksLikeHTML("", "application/xhtml+xml")).toBe(false);
    expect(looksLikeHTML("<!DOCTYPE HTML>", "")).toBe(true);
    expect(looksLikeHTML("<rss/>", "application/xml")).toBe(false);
    expect(stripTags("  a <em>b</em>  c ")).toBe("a b c");
    expect(truncateRunes("hi", 5)).toBe("hi");
    expect(truncateRunes("abcdef", 3)).toBe("abc…");
    expect(firstNonEmpty("", "  ", "x")).toBe("x");
    expect(parseFeedTitle(atomFeed)).toBe("Example Atom");
    expect(parseFeedTitle("not a feed")).toBeUndefined();
  });
});

describe("feeds http", () => {
  it("accepts http(s) and rejects the rest", () => {
    expect(validateURL("https://example.com/rss.xml")).toBeNull();
    expect(validateURL("http://localhost/feed")).toBeNull();
    expect(validateURL("ftp://example.com/feed")).not.toBeNull();
    expect(validateURL("https://")).not.toBeNull();
    expect(validateURL("://bad")).not.toBeNull();
    expect(validateURL("not a url")).not.toBeNull();
  });

  it("sends the UA and Accept header and strips charset", async () => {
    let ua = "";
    let accept = "";
    const gotBody = await httpGet({
      url: "https://example.com/rss.xml",
      userAgent: "feeds-mcp-test/1",
      maxBytes: 1024,
      fetch: async (_input, init) => {
        const headers = new Headers(init?.headers);
        ua = headers.get("user-agent") ?? "";
        accept = headers.get("accept") ?? "";
        return textResponse("<rss/>", 200, { "content-type": "application/rss+xml; charset=utf-8" });
      },
    });
    expect(new TextDecoder().decode(gotBody.body)).toBe("<rss/>");
    expect(gotBody.contentType).toBe("application/rss+xml");
    expect(gotBody.finalURL).toBe("https://example.com/rss.xml");
    expect(ua).toBe("feeds-mcp-test/1");
    expect(accept).toContain("application/rss+xml");
  });

  it("defaults the user agent, reports HTTP status, and caps the body", async () => {
    const ok = await httpGet({
      url: "https://example.com/rss.xml",
      fetch: async () => textResponse("ok"),
    });
    expect(new TextDecoder().decode(ok.body)).toBe("ok");
    await expect(httpGet({
      url: "https://example.com/missing",
      fetch: async () => textResponse("nope", 404),
    })).rejects.toThrow("HTTP 404");
    await expect(httpGet({
      url: "https://example.com/big",
      maxBytes: 8,
      fetch: async () => textResponse("x".repeat(64)),
    })).rejects.toThrow("larger than");
    await expect(httpGet({ url: "ftp://example.com/x", fetch })).rejects.toThrow();
  });

  it("stops after five redirects and refuses a bad scheme hop", async () => {
    let n = 0;
    await expect(httpGet({
      url: "https://example.com/start",
      fetch: async () => {
        n += 1;
        return new Response(null, { status: 302, headers: { location: "https://example.com/hop" } });
      },
    })).rejects.toThrow("stopped after 5 redirects");
    expect(n).toBeGreaterThanOrEqual(2);
    await expect(httpGet({
      url: "https://example.com/start",
      fetch: async () => new Response(null, { status: 302, headers: { location: "ftp://example.com/x" } }),
    })).rejects.toThrow();
  });

  it("reads FEEDS_USER_AGENT and falls back, and honors a canceled call", async () => {
    expect(userAgentFrom({ FEEDS_USER_AGENT: "nws-contact/1 (me@example.com)" })).toBe("nws-contact/1 (me@example.com)");
    expect(userAgentFrom({ FEEDS_USER_AGENT: "  " })).toContain("feeds-mcp");
    const signal = AbortSignal.abort();
    await expect(httpGet({
      url: "https://example.com/rss.xml",
      signal,
      fetch: async (_input, init) => {
        if (init?.signal?.aborted) throw new Error("aborted");
        return textResponse("ok");
      },
    })).rejects.toThrow();
  });
});

describe("feeds resolve", () => {
  it("resolves an NWS zone without fetching", async () => {
    const got = await resolveFeed(async () => {
      throw new Error("no fetch");
    }, "CAZ513");
    expect(got.candidates).toHaveLength(1);
    expect(got.candidates[0]).toMatchObject({ source: "nws", kind: "atom" });
    expect(got.candidates[0]?.url).toContain("zone=CAZ513");
    const embedded = await resolveFeed(async () => {
      throw new Error("no fetch");
    }, "alerts for caz513 please");
    expect(embedded.candidates[0]?.url).toContain("CAZ513");
  });

  it("builds GitHub and YouTube candidates even when GET fails", async () => {
    const gh = await resolveFeed(async () => {
      throw new Error("eof");
    }, "https://github.com/shotah/feeds-mcp");
    expect(gh.candidates[0]).toMatchObject({
      url: "https://github.com/shotah/feeds-mcp/releases.atom",
      source: "github",
    });
    expect(githubCandidate("https://github.com/orgs/foo")).toBeUndefined();
    expect(githubCandidate("https://github.com/settings/profile")).toBeUndefined();
    expect(githubCandidate("https://github.com/shotah/feeds-mcp.git")?.url).toMatch(/\/feeds-mcp\/releases\.atom$/);
    const id = "UCuAXFkgsw1L7xaCfnd5JJOw";
    const yt = await resolveFeed(async () => {
      throw new Error("eof");
    }, `https://www.youtube.com/channel/${id}`);
    expect(yt.candidates[0]?.url).toContain(`channel_id=${id}`);
  });

  it("reads alternate links, well-known paths, and a feed URL itself", async () => {
    const page = `<!DOCTYPE html><html><head>
<link rel="alternate" type="application/rss+xml" title="Blog" href="/rss.xml">
<link rel="alternate" type="application/atom+xml" title="Atom" href="https://cdn.example.com/atom.xml">
<link rel="stylesheet" href="/style.css">
</head><body>hi</body></html>`;
    const links = await resolveFeed(
      async () => got(page, "text/html", "https://example.com/blog"),
      "https://example.com/blog",
    );
    expect(links.candidates).toHaveLength(2);
    expect(links.candidates[0]?.source).toBe("link");
    expect(links.candidates[0]?.url.endsWith("/rss.xml")).toBe(true);
    expect(links.candidates[1]).toMatchObject({ url: "https://cdn.example.com/atom.xml", kind: "atom" });

    const routes: Record<string, { body: string; ct: string }> = {
      "/": { body: "<!DOCTYPE html><html><body>no links</body></html>", ct: "text/html" },
      "/rss.xml": { body: rssFeed, ct: "application/rss+xml" },
    };
    const known = await resolveFeed(async (url) => {
      const path = new URL(url).pathname;
      const route = routes[path];
      if (!route) throw new Error(`GET ${url}: HTTP 404`);
      return got(route.body, route.ct, url);
    }, "https://example.com/");
    expect(known.candidates[0]).toMatchObject({ source: "well-known", title: "Example RSS" });
    expect(known.candidates[0]?.url.endsWith("/rss.xml")).toBe(true);

    const self = await resolveFeed(async (url) => got(atomFeed, "application/atom+xml", url), "https://example.com/atom.xml");
    expect(self.candidates[0]).toMatchObject({ source: "self", kind: "atom" });
  });

  it("finds a YouTube channel id in HTML and skips an HTML well-known probe", async () => {
    const id = "UC1234567890abcdefghijkl";
    const page = `<!DOCTYPE html><html><body><script>var x={"channelId":"${id}"}</script></body></html>`;
    const found = await resolveFeed(async (url) => got(page, "text/html", url), "https://example.com/");
    expect(found.candidates.some((c) => c.source === "youtube" && c.url.includes(id))).toBe(true);

    const routes: Record<string, { body: string; ct: string }> = {
      "/": { body: "<!DOCTYPE html><html><body>x</body></html>", ct: "text/html" },
      "/feed": { body: "<!DOCTYPE html><html><body>not</body></html>", ct: "text/html" },
      "/atom.xml": { body: atomFeed, ct: "application/atom+xml" },
    };
    const skipped = await resolveFeed(async (url) => {
      const path = new URL(url).pathname;
      const route = routes[path];
      if (!route) throw new Error(`GET ${url}: HTTP 404`);
      return got(route.body, route.ct, url);
    }, "https://example.com/");
    expect(skipped.candidates.some((c) => c.url.endsWith("/atom.xml") && c.source === "well-known")).toBe(true);
  });

  it("covers empty queries, bad URLs, kinds, and href helpers", async () => {
    await expect(resolveFeed(async () => got("", "text/plain"), "   ")).rejects.toThrow();
    const words = await resolveFeed(async () => got("", "text/plain"), "just some words");
    expect(words.candidates).toEqual([]);
    await expect(resolveFeed(async () => {
      throw new Error("gone");
    }, "https://example.com/missing")).rejects.toThrow("gone");
    await expect(resolveFeed(async () => got("", "text/plain"), "http://")).rejects.toThrow();
    expect(kindFromContentType("application/atom+xml")).toBe("atom");
    expect(kindFromContentType("application/rss+xml")).toBe("rss");
    expect(kindFromContentType("application/feed+json")).toBe("json");
    expect(kindFromContentType("application/xml")).toBe("feed");
    expect(isFeedType("application/rss+xml")).toBe(true);
    expect(isFeedType("text/css")).toBe(false);
    expect(joinPath("://bad", "/rss.xml")).toBe("");
    expect(joinPath("https://example.com/blog/post", "/rss.xml")).toBe("https://example.com/rss.xml");
    expect(resolveHref("https://example.com/blog/", "")).toBe("");
    expect(resolveHref("https://example.com/blog/", "mailto:x")).toBe("");
    expect(resolveHref("https://example.com/blog/", "feed.xml")).toBe("https://example.com/blog/feed.xml");
    expect(looksLikeURL("https://x")).toBe(true);
    expect(looksLikeURL("x.com")).toBe(false);
    expect(htmlFeedLinks(`<html><head>
<link rel="alternate" type="text/html" href="/amp">
<link rel="alternate" type="application/rss+xml" href="javascript:alert(1)">
</head></html>`, "https://example.com")).toEqual([]);
    expect(htmlFeedLinks(`<link rel='alternate' type='application/rss+xml' href='https://example.com/feed.xml' title='News'>`, "https://example.com")).toEqual([
      { url: "https://example.com/feed.xml", title: "News", kind: "rss", source: "link" },
    ]);
    expect(htmlFeedLinks(`<link rel=alternate type=application/rss+xml href=https://example.com/rss.xml>`, "https://example.com")).toEqual([
      { url: "https://example.com/rss.xml", title: "", kind: "rss", source: "link" },
    ]);
    expect(nwsCandidate("hello")).toBeUndefined();
    expect(youtubeChannelCandidate("https://example.com")).toBeUndefined();
    expect(youtubeFromHTML("nope")).toBeUndefined();
    expect(githubCandidate("https://example.com/foo/bar")).toBeUndefined();
  });
});

describe("feeds plugin", () => {
  const env = { FEEDS_USER_AGENT: "feeds-test/1" };

  it("requires the user agent and publishes both tools", async () => {
    expect(feedsPlugin.name).toBe("feeds");
    expect(await feedsPlugin.ready(pluginCtx())).toBe("no_key");
    expect(await feedsPlugin.ready(pluginCtx({ env: { FEEDS_USER_AGENT: "  " } }))).toBe("no_key");
    expect(await feedsPlugin.ready(pluginCtx({ env }))).toBeNull();
    const tools = feedsPlugin.tools(pluginCtx({ env }));
    expect(tools.map((t) => t.name)).toEqual(["items_list", "source_resolve"]);
    expect(tools[0]?.description).toContain("Not X/Twitter");
    expect(tools[1]?.description).toContain("NWS zone");
    expect(tools[0]?.inputSchema).toMatchObject({ required: ["url"] });
    expect(tools[1]?.inputSchema).toMatchObject({ required: ["query"] });
  });

  it("teaches in on a missing url or query", async () => {
    const ctx = pluginCtx({ env });
    const url = await callTool(feedsPlugin, ctx, "items_list", {});
    expect(textOf(url)).toContain("url is required");
    expect(textOf(url)).toContain("Next: items_list");
    const query = await callTool(feedsPlugin, ctx, "source_resolve", {});
    expect(textOf(query)).toContain("query is required");
    expect(textOf(query)).toContain("Next: source_resolve");
  });

  it("lists items, refuses HTML, and resolves NWS plus page links", async () => {
    const rss = pluginCtx({
      env,
      fetch: async () => textResponse(rssFeed, 200, { "content-type": "application/rss+xml" }),
    });
    const listed = await callTool(feedsPlugin, rss, "items_list", { url: "https://example.com/rss.xml", limit: 2 });
    expect(listed.isError).toBeUndefined();
    const parsed = JSON.parse(textOf(listed)) as { items: { id: string }[] }[];
    expect(parsed[0]?.items[0]?.id).not.toBe("");

    const html = pluginCtx({
      env,
      fetch: async () => textResponse("<!DOCTYPE html><html><body>nope</body></html>", 200, { "content-type": "text/html" }),
    });
    const page = await callTool(feedsPlugin, html, "items_list", { url: "https://example.com/" });
    expect(page.isError).toBeUndefined();
    const pageRows = JSON.parse(textOf(page)) as { error?: string }[];
    expect(pageRows[0]?.error).toContain("source_resolve");

    const nws = await callTool(feedsPlugin, pluginCtx({ env }), "source_resolve", { query: "CAZ513" });
    expect(nws.isError).toBeUndefined();
    expect(textOf(nws)).toContain("api.weather.gov");

    const bad = await callTool(feedsPlugin, pluginCtx({ env }), "source_resolve", { query: "http://" });
    expect(bad.isError).toBeUndefined();
    const badRows = JSON.parse(textOf(bad)) as { error?: string }[];
    expect(badRows[0]?.error).not.toBe("");

    const none = await callTool(feedsPlugin, pluginCtx({ env }), "source_resolve", { query: "not-a-url-or-zone" });
    expect(textOf(none)).toContain("no feed found");

    const linked = pluginCtx({
      env,
      fetch: async () => textResponse(`<!DOCTYPE html><html><head>
<link rel="alternate" type="application/rss+xml" title="Blog" href="/rss.xml">
</head><body></body></html>`, 200, { "content-type": "text/html" }),
    });
    const resolved = await callTool(feedsPlugin, linked, "source_resolve", { query: "https://example.com/" });
    const candidates = JSON.parse(textOf(resolved)) as { candidates: { source: string }[] }[];
    expect(candidates[0]?.candidates[0]?.source).toBe("link");

    const atom = pluginCtx({
      env,
      fetch: async () => textResponse(atomFeed, 200, { "content-type": "application/atom+xml" }),
    });
    const items = await callTool(feedsPlugin, atom, "items_list", { url: "https://example.com/atom.xml" });
    expect(textOf(items)).toContain(`"items"`);
    expect(textOf(items)).toContain("atom-1");
  });

  it("sends validators and treats 304 as an empty feed", async () => {
    let match = "";
    let since = "";
    const ctx = pluginCtx({
      env,
      fetch: async (_input, init) => {
        const headers = new Headers(init?.headers);
        match = headers.get("if-none-match") ?? "";
        since = headers.get("if-modified-since") ?? "";
        return new Response(null, {
          status: 304,
          headers: { etag: "\"abc\"", "last-modified": "Thu, 01 Jan 2026 00:00:00 GMT" },
        });
      },
    });
    const listed = await callTool(feedsPlugin, ctx, "items_list", {
      url: "https://example.com/rss.xml",
      if_none_match: "\"abc\"",
      if_modified_since: "Thu, 01 Jan 2026 00:00:00 GMT",
    });
    expect(match).toBe("\"abc\"");
    expect(since).toBe("Thu, 01 Jan 2026 00:00:00 GMT");
    expect(listed.isError).toBeUndefined();
    const rows = JSON.parse(textOf(listed)) as { not_modified?: boolean; items?: unknown[]; etag?: string }[];
    expect(rows[0]?.not_modified).toBe(true);
    expect(rows[0]?.items).toEqual([]);
    expect(rows[0]?.etag).toBe("\"abc\"");
  });

  it("reads each url and resolves each page, with a bad source as a row", async () => {
    const mixed = pluginCtx({
      env,
      fetch: async (input) => {
        const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (href.includes("bad.example")) {
          return textResponse("<html></html>", 200, { "content-type": "text/html" });
        }
        if (href.includes("page.example")) {
          return textResponse(`<!DOCTYPE html><html><head>
<link rel="alternate" type="application/rss+xml" title="Blog" href="/rss.xml">
</head></html>`, 200, { "content-type": "text/html" });
        }
        return textResponse(rssFeed, 200, { "content-type": "application/rss+xml" });
      },
    });
    const listed = JSON.parse(textOf(await callTool(feedsPlugin, mixed, "items_list", {
      urls: ["https://example.com/rss.xml", "https://bad.example/"],
    }))) as { items?: { id: string }[]; error?: string }[];
    expect(listed[0]?.items?.[0]?.id).not.toBe("");
    expect(listed[1]?.error).toContain("source_resolve");
    const resolved = JSON.parse(textOf(await callTool(feedsPlugin, mixed, "source_resolve", {
      urls: ["https://page.example/", "CAZ513"],
    }))) as { candidates?: { url: string }[] }[];
    expect(resolved[0]?.candidates?.[0]?.url).toContain("rss.xml");
    expect(resolved[1]?.candidates?.[0]?.url).toContain("CAZ513");
  });
});
