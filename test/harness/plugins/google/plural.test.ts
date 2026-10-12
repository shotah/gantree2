import { describe, expect, it } from "vitest";
import { isRecord } from "@/harness/plugins/google/args";
import { google } from "@/harness/plugins/google/index";
import { callTool, jsonResponse, liveToken, recordingFetch, testCtx, textOf } from "@/test/harness/plugins/google/harness";

const baseEnv = {
  GOOGLE_OAUTH_CLIENT_ID: "cid",
  GOOGLE_OAUTH_CLIENT_SECRET: "csecret",
  USER_GOOGLE_EMAIL: "test@example.com",
};

const authed = (fetch: typeof globalThis.fetch) => testCtx({ token: liveToken(), fetch });

function rowsOf(text: string): { id: string; text?: string; error?: string; name?: string }[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(isRecord).map((row) => ({
    id: typeof row.id === "string" ? row.id : "",
    text: typeof row.text === "string" ? row.text : undefined,
    error: typeof row.error === "string" ? row.error : undefined,
    name: typeof row.name === "string" ? row.name : undefined,
  }));
}

function hasListInput(tool: { inputSchema: { properties?: unknown }; single?: string }): boolean {
  if (typeof tool.single === "string" && tool.single.trim() !== "") {
    return true;
  }
  const props = tool.inputSchema.properties;
  if (!isRecord(props)) {
    return false;
  }
  const keys = Object.keys(props);
  for (const key of keys) {
    const prop = props[key];
    if (isRecord(prop) && prop.type === "array") {
      return true;
    }
  }
  return (keys.includes("time_min") && keys.includes("time_max"))
    || (keys.includes("start") && keys.includes("end"));
}

describe("plural google tools", () => {
  it("marks every published tool as a list, a range, or single", () => {
    const tools = google.tools(testCtx());
    const bare = tools.filter((tool) => !hasListInput(tool)).map((tool) => tool.name);
    expect(bare).toEqual([]);
    expect(google.tools(testCtx({ env: baseEnv })).map((tool) => tool.name)).toHaveLength(38);
  });

  it("keeps gmail search as one list and fans out queries", async () => {
    const { fetch } = recordingFetch((hit) => jsonResponse({
      messages: [{ id: hit.url.searchParams.get("q"), threadId: "t" }],
    }));
    const ctx = authed(fetch);
    const one = textOf(await callTool(ctx, "gmail_search_messages", { query: "in:inbox" }));
    expect(one).toContain("Found 1 messages for query: 'in:inbox'");
    const many = rowsOf(textOf(await callTool(ctx, "gmail_search_messages", { queries: ["from:a", "from:b"] })));
    expect(many.map((row) => row.id)).toEqual(["from:a", "from:b"]);
    expect(many[0]?.text).toContain("Message ID: from:a");
  });

  it("reads several messages and keeps a single message id", async () => {
    const { fetch } = recordingFetch((hit) => {
      const id = hit.url.pathname.split("/").pop() ?? "";
      if (id === "missing") {
        return jsonResponse({ error: { message: "not found" } }, 404);
      }
      return jsonResponse({
        id,
        payload: { headers: [{ name: "Subject", value: id }], mimeType: "text/plain", body: { data: "" } },
      });
    });
    const ctx = authed(fetch);
    const one = rowsOf(textOf(await callTool(ctx, "gmail_get_message", { message_id: "msg001" })));
    expect(one).toHaveLength(1);
    expect(one[0]?.text).toContain("Subject: msg001");
    const many = rowsOf(textOf(await callTool(ctx, "gmail_get_message", { message_ids: ["msg001", "missing"] })));
    expect(many[0]?.text).toContain("Subject: msg001");
    expect(many[1]?.error).toContain("googleapi");
    expect(many).toHaveLength(2);
    const threads = rowsOf(textOf(await callTool(ctx, "gmail_get_thread", { thread_ids: ["th1"] })));
    expect(threads[0]?.text).toContain("Thread ID: th1");
  });

  it("downloads several attachments", async () => {
    const { fetch } = recordingFetch(() => jsonResponse({ size: 4, data: "abcd" }));
    const text = textOf(await callTool(authed(fetch), "gmail_get_attachment", {
      attachments: [
        { message_id: "m1", attachment_id: "a1" },
        { message_id: "m2", attachment_id: "a2" },
      ],
    }));
    const rows = rowsOf(text);
    expect(rows.map((row) => row.id)).toEqual(["m1/a1", "m2/a2"]);
    expect(rows[0]?.text).toContain("Attachment downloaded successfully!");
  });

  it("reads several events and reports a bad id as a row", async () => {
    const { fetch } = recordingFetch(() => jsonResponse({
      id: "evt001",
      summary: "Standup",
      start: { dateTime: "2026-07-28T09:00:00Z" },
      end: { dateTime: "2026-07-28T09:30:00Z" },
    }));
    const rows = rowsOf(textOf(await callTool(authed(fetch), "calendar_get_event", {
      event_ids: ["evt001", "primary"],
    })));
    expect(rows[0]?.text).toContain("Standup");
    expect(rows[1]?.error).toContain("calendar_list_events");
  });

  it("defaults calendar_list_events to 7 days and keeps an explicit time_min window", async () => {
    const { fetch, hits } = recordingFetch(() => jsonResponse({ items: [] }));
    const ctx = authed(fetch);
    await callTool(ctx, "calendar_list_events", {});
    expect(hits[0]?.url.searchParams.get("timeMin")).toBe("2026-07-28T15:00:00Z");
    expect(hits[0]?.url.searchParams.get("timeMax")).toBe("2026-08-04T15:00:00Z");
    await callTool(ctx, "calendar_list_events", { days: 2 });
    expect(hits[1]?.url.searchParams.get("timeMax")).toBe("2026-07-30T15:00:00Z");
    await callTool(ctx, "calendar_list_events", { time_min: "2026-07-28T00:00:00-07:00" });
    expect(hits[2]?.url.searchParams.get("timeMax")).toBe("2026-07-29T00:00:00-07:00");
  });

  it("matches drive and docs names by prefix and contains", async () => {
    const files = [
      { id: "1", name: "tesla notes", mimeType: "text/plain", modifiedTime: "t" },
      { id: "2", name: "test plan", mimeType: "application/vnd.google-apps.document", modifiedTime: "t" },
      { id: "3", name: "notes", mimeType: "application/vnd.google-apps.document", modifiedTime: "t" },
    ];
    const { fetch, hits } = recordingFetch((hit) => {
      if (hit.url.searchParams.get("pageToken") === "p2") {
        return jsonResponse({ files: [files[2]] });
      }
      return jsonResponse({ files: files.slice(0, 2), nextPageToken: "p2" });
    });
    const ctx = authed(fetch);
    const prefixed = rowsOf(textOf(await callTool(ctx, "drive_search_files", { name_prefix: "tes" })));
    expect(prefixed.map((row) => row.name)).toEqual(["tesla notes", "test plan"]);
    expect(hits[0]?.url.searchParams.get("q")).toContain("name contains 'tes'");
    const contained = rowsOf(textOf(await callTool(ctx, "drive_search_files", { name_contains: "plan", limit: 1 })));
    expect(contained.map((row) => row.name)).toEqual(["test plan"]);
    const docs = rowsOf(textOf(await callTool(ctx, "docs_search", { name_prefixes: ["test", "note"] })));
    expect(docs.map((row) => row.name)).toEqual(["test plan", "notes"]);
    const sheets = rowsOf(textOf(await callTool(ctx, "sheets_list_spreadsheets", { name_prefix: "tes" })));
    expect(sheets.map((row) => row.name)).toEqual(["tesla notes", "test plan"]);
    expect(hits.some((hit) => hit.url.searchParams.get("q")?.includes("mimeType='application/vnd.google-apps.document'"))).toBe(true);
    expect(hits.some((hit) => hit.url.searchParams.get("q")?.includes("mimeType='application/vnd.google-apps.spreadsheet'"))).toBe(true);
    const legacy = textOf(await callTool(ctx, "drive_search_files", { query: "Budget" }));
    expect(legacy).toContain("Found");
  });

  it("reads several files, docs, sheets, contacts, forms, slides, and tasks", async () => {
    const { fetch } = recordingFetch((hit) => {
      const path = hit.url.pathname;
      if (path.endsWith("/files/d1")) {
        return jsonResponse({
          id: "d1",
          name: "Plan",
          mimeType: "application/vnd.google-apps.document",
          webViewLink: "https://docs/d1",
        });
      }
      if (path.includes("/documents/")) {
        return jsonResponse({ body: { content: [{ paragraph: { elements: [{ textRun: { content: "Doc body\n" } }] } }] } });
      }
      if (path.includes("values:batchGet")) {
        return jsonResponse({ valueRanges: [{ range: "A1:B2", values: [["a"]] }] });
      }
      if (path.includes("/values/")) {
        return jsonResponse({ values: [["a"]] });
      }
      if (path.includes("/forms/") && !path.includes("/responses")) {
        return jsonResponse({ info: { title: "Survey" }, items: [] });
      }
      if (path.includes("/pages/")) {
        return jsonResponse({ pageType: "SLIDE", pageElements: [] });
      }
      if (path.includes("/people/")) {
        return jsonResponse({ resourceName: "people/c1", names: [{ displayName: "Ada" }] });
      }
      if (/\/lists\/[^/]+\/tasks\//u.test(path)) {
        return jsonResponse({ id: path.split("/").pop(), title: "Task" });
      }
      if (path.includes("/lists/")) {
        return jsonResponse({ id: "L1", title: "Personal" });
      }
      if (hit.url.searchParams.get("alt") === "media" || path.includes("/export")) {
        return new Response("hello", { status: 200 });
      }
      return jsonResponse({
        id: "f1",
        name: "Budget",
        mimeType: "text/plain",
        webViewLink: "https://drive/f1",
      });
    });
    const ctx = authed(fetch);
    const files = rowsOf(textOf(await callTool(ctx, "drive_get_file_content", { file_ids: ["f1", "f2"] })));
    expect(files).toHaveLength(2);
    expect(files[0]?.text).toContain("--- CONTENT ---\nhello");
    const downloads = rowsOf(textOf(await callTool(ctx, "drive_get_file_download_url", { file_ids: ["f1"] })));
    expect(downloads[0]?.text).toContain("File downloaded successfully!");
    const links = rowsOf(textOf(await callTool(ctx, "drive_get_shareable_link", { file_id: "f1" })));
    expect(links[0]?.text).toContain("Shared: false");
    const docs = rowsOf(textOf(await callTool(ctx, "docs_get_content", { document_ids: ["d1"] })));
    expect(docs[0]?.text).toContain("Doc body");
    const sheets = rowsOf(textOf(await callTool(ctx, "sheets_get_values", {
      spreadsheet_ids: ["s1"],
      ranges: ["A1:B2", "C1:D2"],
    })));
    expect(sheets[0]?.text).toContain("Successfully read");
    const contacts = rowsOf(textOf(await callTool(ctx, "contacts_get", { contact_ids: ["c1"] })));
    expect(contacts[0]?.text).toContain("Name: Ada");
    const forms = rowsOf(textOf(await callTool(ctx, "forms_get", { form_ids: ["FORM1"] })));
    expect(forms[0]?.text).toContain("Survey");
    const pages = rowsOf(textOf(await callTool(ctx, "slides_get_page", {
      presentation_id: "PRES",
      page_object_ids: ["slide1"],
    })));
    expect(pages[0]?.id).toBe("slide1");
    const lists = rowsOf(textOf(await callTool(ctx, "tasks_get_tasklist", { task_list_ids: ["L1"] })));
    expect(lists[0]?.text).toContain("Personal");
    const tasks = rowsOf(textOf(await callTool(ctx, "tasks_get_task", {
      task_list_id: "L1",
      task_ids: ["t1", "t2"],
    })));
    expect(tasks.map((row) => row.id)).toEqual(["t1", "t2"]);
  });
});
