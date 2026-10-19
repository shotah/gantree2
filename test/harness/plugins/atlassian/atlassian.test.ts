import { describe, expect, it } from "vitest";
import { fixedClock, makeLogger, memorySink } from "@/harness/core";
import type { CallContext, PluginContext } from "@/harness/core/tools";
import { adfToPlainText, normalizeSite } from "@/harness/plugins/atlassian/client";
import { atlassian } from "@/harness/plugins/atlassian";

const call: CallContext = { userId: "u", sessionId: "s" };

const env = {
  ATLASSIAN_SITE: "acme.atlassian.net",
  ATLASSIAN_EMAIL: "a@b.co",
  ATLASSIAN_API_TOKEN: "secret",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function routeFetch(handler: (url: URL, init?: RequestInit) => Response): typeof fetch {
  return (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(handler(new URL(href), init));
  };
}

function pluginCtx(fetchFn: typeof fetch, extraEnv: Record<string, string> = {}): PluginContext {
  return {
    env: { ...env, ...extraEnv },
    sql: { exec: () => [], one: () => null, changes: () => 0 },
    clock: fixedClock(Date.UTC(2026, 9, 11), "UTC"),
    log: makeLogger(memorySink(), () => 0),
    fetch: fetchFn,
    tokens: {
      get: () => Promise.resolve(null),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      list: async () => [],
    },
  };
}

function textOf(result: { content: { type: string; text?: string }[]; isError?: boolean }): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text ?? "" : "";
}

const TOOL_NAMES = [
  "jira_list_boards",
  "jira_list_sprints",
  "jira_list_issues",
  "jira_search_issues",
  "jira_get_issues",
  "confluence_list_spaces",
  "confluence_list_pages",
  "confluence_search_pages",
  "confluence_get_pages",
] as const;

describe("atlassian plugin", () => {
  it("ready() is no_key when any key is missing or whitespace, null when all set", async () => {
    const bare = pluginCtx(routeFetch(() => jsonResponse({})));
    expect(await atlassian.ready({ ...bare, env: {} })).toBe("no_key");
    expect(await atlassian.ready({
      ...bare,
      env: { ATLASSIAN_SITE: " ", ATLASSIAN_EMAIL: "a@b.co", ATLASSIAN_API_TOKEN: "secret" },
    })).toBe("no_key");
    expect(await atlassian.ready({
      ...bare,
      env: { ATLASSIAN_SITE: "acme.atlassian.net", ATLASSIAN_EMAIL: "", ATLASSIAN_API_TOKEN: "secret" },
    })).toBe("no_key");
    expect(await atlassian.ready({
      ...bare,
      env: { ATLASSIAN_SITE: "acme.atlassian.net", ATLASSIAN_EMAIL: "a@b.co", ATLASSIAN_API_TOKEN: "  " },
    })).toBe("no_key");
    expect(await atlassian.ready(bare)).toBeNull();
  });

  it("publishes nine tools without an atlassian prefix", () => {
    const ctx = pluginCtx(routeFetch(() => jsonResponse({})));
    const tools = atlassian.tools(ctx);
    expect(tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
    for (const name of tools.map((tool) => tool.name)) {
      expect(name.startsWith("atlassian")).toBe(false);
    }
  });

  it("list boards hits the agile board endpoint with Basic auth and maps rows", async () => {
    let auth = "";
    const fetchFn = routeFetch((url, init) => {
      expect(url.origin).toBe("https://acme.atlassian.net");
      expect(url.pathname).toBe("/rest/agile/1.0/board");
      expect(url.searchParams.get("startAt")).toBe("0");
      expect(url.searchParams.get("maxResults")).toBe("25");
      auth = (init?.headers as Record<string, string>).Authorization ?? "";
      return jsonResponse({
        values: [{
          id: 7,
          name: "Platform",
          type: "scrum",
          location: { projectKey: "ACME" },
        }],
      });
    });
    const ctx = pluginCtx(fetchFn);
    const tool = atlassian.tools(ctx).find((row) => row.name === "jira_list_boards");
    const result = await tool?.call({}, call);
    expect(result?.isError).toBeUndefined();
    const rows = JSON.parse(textOf(result ?? { content: [] })) as Record<string, unknown>[];
    expect(rows).toEqual([{
      id: 7,
      name: "Platform",
      type: "scrum",
      project_key: "ACME",
      url: "https://acme.atlassian.net/jira/software/c/projects/ACME/boards/7",
    }]);
    expect(auth.startsWith("Basic ")).toBe(true);
    const decoded = atob(auth.slice(6));
    expect(decoded).toBe("a@b.co:secret");
  });

  it("list boards with two project_keys makes two requests", async () => {
    const paths: string[] = [];
    const fetchFn = routeFetch((url) => {
      paths.push(url.searchParams.get("projectKeyOrId") ?? "");
      return jsonResponse({ values: [] });
    });
    const ctx = pluginCtx(fetchFn);
    const tool = atlassian.tools(ctx).find((row) => row.name === "jira_list_boards");
    await tool?.call({ project_keys: ["A", "B"] }, call);
    expect(paths).toEqual(["A", "B"]);
  });

  it("list sprints defaults state=active and tags board_id", async () => {
    const fetchFn = routeFetch((url) => {
      expect(url.pathname).toBe("/rest/agile/1.0/board/42/sprint");
      expect(url.searchParams.get("state")).toBe("active");
      return jsonResponse({
        values: [{ id: 9, name: "Sprint 1", state: "active", startDate: "2026-01-01", endDate: "2026-01-14" }],
      });
    });
    const ctx = pluginCtx(fetchFn);
    const tool = atlassian.tools(ctx).find((row) => row.name === "jira_list_sprints");
    const result = await tool?.call({ board_id: 42 }, call);
    const rows = JSON.parse(textOf(result ?? { content: [] })) as Record<string, unknown>[];
    expect(rows[0]?.board_id).toBe(42);
    expect(rows[0]?.name).toBe("Sprint 1");
  });

  it("list issues on a board returns a flat issue row", async () => {
    const fetchFn = routeFetch((url) => {
      expect(url.pathname).toBe("/rest/agile/1.0/board/1/issue");
      return jsonResponse({
        issues: [{
          key: "ACME-1",
          fields: {
            summary: "Fix bug",
            status: { name: "In Progress" },
            assignee: { displayName: "Alex" },
            issuetype: { name: "Task" },
            priority: { name: "High" },
            updated: "2026-01-02T00:00:00.000+0000",
          },
        }],
      });
    });
    const ctx = pluginCtx(fetchFn);
    const tool = atlassian.tools(ctx).find((row) => row.name === "jira_list_issues");
    const result = await tool?.call({ board_id: 1 }, call);
    const rows = JSON.parse(textOf(result ?? { content: [] })) as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({
      board_id: 1,
      key: "ACME-1",
      summary: "Fix bug",
      status: "In Progress",
      assignee: "Alex",
      url: "https://acme.atlassian.net/browse/ACME-1",
    });
  });

  it("search posts to /rest/api/3/search/jql and not /rest/api/3/search", async () => {
    const paths: string[] = [];
    const fetchFn = routeFetch((url, init) => {
      paths.push(url.pathname);
      expect(init?.method).toBe("POST");
      expect(typeof init?.body).toBe("string");
      const body = JSON.parse(init?.body as string) as { jql: string };
      expect(body.jql).toBe("project = ACME");
      return jsonResponse({ issues: [] });
    });
    const ctx = pluginCtx(fetchFn);
    const tool = atlassian.tools(ctx).find((row) => row.name === "jira_search_issues");
    await tool?.call({ jql: "project = ACME" }, call);
    expect(paths).toContain("/rest/api/3/search/jql");
    expect(paths.some((path) => path === "/rest/api/3/search")).toBe(false);
  });

  it("get issues extracts ADF description text", async () => {
    const fetchFn = routeFetch((url) => {
      expect(url.pathname).toBe("/rest/api/3/issue/ACME-2");
      return jsonResponse({
        key: "ACME-2",
        fields: {
          summary: "Doc",
          description: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }, { type: "text", text: "world" }] }],
          },
        },
      });
    });
    const ctx = pluginCtx(fetchFn);
    const tool = atlassian.tools(ctx).find((row) => row.name === "jira_get_issues");
    const result = await tool?.call({ key: "ACME-2" }, call);
    const rows = JSON.parse(textOf(result ?? { content: [] })) as Record<string, unknown>[];
    expect(rows[0]?.description).toBe("Hello world");
    expect(adfToPlainText({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
    })).toBe("a");
  });

  it("HTTP 404 on get becomes a row error without isError", async () => {
    const fetchFn = routeFetch(() => jsonResponse({ errorMessages: ["Issue does not exist"] }, 404));
    const ctx = pluginCtx(fetchFn);
    const tool = atlassian.tools(ctx).find((row) => row.name === "jira_get_issues");
    const result = await tool?.call({ key: "MISSING-1" }, call);
    expect(result?.isError).toBeUndefined();
    const rows = JSON.parse(textOf(result ?? { content: [] })) as Record<string, unknown>[];
    expect(rows[0]?.key).toBe("MISSING-1");
    expect(typeof rows[0]?.error).toBe("string");
  });

  it("list sprints with no board id sets isError", async () => {
    const ctx = pluginCtx(routeFetch(() => jsonResponse({})));
    const tool = atlassian.tools(ctx).find((row) => row.name === "jira_list_sprints");
    const result = await tool?.call({}, call);
    expect(result?.isError).toBe(true);
  });

  it("normalizeSite accepts hostname and strips trailing slashes", () => {
    expect(normalizeSite("acme.atlassian.net")).toBe("https://acme.atlassian.net");
    expect(normalizeSite("https://acme.atlassian.net/")).toBe("https://acme.atlassian.net");
  });

  it("list spaces maps webui under /spaces to a wiki url", async () => {
    const fetchFn = routeFetch((url) => {
      expect(url.pathname).toBe("/wiki/api/v2/spaces");
      return jsonResponse({
        results: [{
          id: "1",
          key: "TEAM",
          name: "Team",
          type: "global",
          status: "current",
          homepageId: "99",
          _links: { webui: "/spaces/TEAM/overview" },
        }],
      });
    });
    const ctx = pluginCtx(fetchFn);
    const tool = atlassian.tools(ctx).find((row) => row.name === "confluence_list_spaces");
    const result = await tool?.call({}, call);
    const rows = JSON.parse(textOf(result ?? { content: [] })) as Record<string, unknown>[];
    expect(rows[0]?.url).toBe("https://acme.atlassian.net/wiki/spaces/TEAM/overview");
  });

  it("search pages wraps plain text and strips excerpt html", async () => {
    const fetchFn = routeFetch((url) => {
      expect(url.pathname).toBe("/wiki/rest/api/search");
      expect(url.searchParams.get("cql")).toBe("type = page AND text ~ \"standup notes\"");
      expect(url.searchParams.get("excerpt")).toBe("indexed");
      return jsonResponse({
        results: [{
          title: "Standup",
          excerpt: "<b>Hi</b> there",
          content: { id: "10", type: "page", _links: { webui: "/wiki/spaces/TEAM/pages/10" } },
          lastModified: "2026-01-01",
        }],
      });
    });
    const ctx = pluginCtx(fetchFn);
    const tool = atlassian.tools(ctx).find((row) => row.name === "confluence_search_pages");
    const result = await tool?.call({ query: "standup notes" }, call);
    const rows = JSON.parse(textOf(result ?? { content: [] })) as Record<string, unknown>[];
    expect(rows[0]?.excerpt).toBe("Hi there");
  });

  it("get page parses atlas_doc_format body json into plain text", async () => {
    const adf = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
    });
    const fetchFn = routeFetch((url) => {
      expect(url.pathname).toBe("/wiki/api/v2/pages/55");
      expect(url.searchParams.get("body-format")).toBe("atlas_doc_format");
      return jsonResponse({
        id: "55",
        title: "Hi",
        spaceId: "1",
        status: "current",
        body: { atlas_doc_format: { value: adf } },
      });
    });
    const ctx = pluginCtx(fetchFn);
    const tool = atlassian.tools(ctx).find((row) => row.name === "confluence_get_pages");
    const result = await tool?.call({ id: "55" }, call);
    const rows = JSON.parse(textOf(result ?? { content: [] })) as Record<string, unknown>[];
    expect(rows[0]?.body).toBe("Hello");
  });

  it("list pages resolves space_key then lists pages in the space", async () => {
    const paths: string[] = [];
    const fetchFn = routeFetch((url) => {
      paths.push(url.pathname);
      if (url.pathname === "/wiki/api/v2/spaces") {
        expect(url.searchParams.get("keys")).toBe("TEAM");
        return jsonResponse({ results: [{ id: "sp1", key: "TEAM" }] });
      }
      if (url.pathname === "/wiki/api/v2/spaces/sp1/pages") {
        return jsonResponse({
          results: [{
            id: "p1",
            title: "Home",
            status: "current",
            spaceId: "sp1",
            _links: { webui: "/wiki/spaces/TEAM/pages/p1" },
          }],
        });
      }
      return jsonResponse({});
    });
    const ctx = pluginCtx(fetchFn);
    const tool = atlassian.tools(ctx).find((row) => row.name === "confluence_list_pages");
    await tool?.call({ space_key: "TEAM" }, call);
    expect(paths).toEqual(["/wiki/api/v2/spaces", "/wiki/api/v2/spaces/sp1/pages"]);
  });

  it("HTTP 404 on confluence get page is a row error without isError", async () => {
    const fetchFn = routeFetch(() => jsonResponse({ errors: [{ title: "Not found", detail: "" }] }, 404));
    const ctx = pluginCtx(fetchFn);
    const tool = atlassian.tools(ctx).find((row) => row.name === "confluence_get_pages");
    const result = await tool?.call({ id: "missing" }, call);
    expect(result?.isError).toBeUndefined();
    const rows = JSON.parse(textOf(result ?? { content: [] })) as Record<string, unknown>[];
    expect(rows[0]?.id).toBe("missing");
    expect(typeof rows[0]?.error).toBe("string");
  });
});
