import { describe, expect, it } from "vitest";
import { callTool, jsonResponse, liveToken, recordingFetch, testCtx, textOf } from "@/test/brain/plugins/google/harness";

const authed = (fetch: typeof globalThis.fetch) => testCtx({ token: liveToken(), fetch });

const person = {
  resourceName: "people/c1",
  names: [{ displayName: "Ada Lovelace" }],
  emailAddresses: [{ value: "ada@example.com" }],
  phoneNumbers: [{ value: "555" }],
  organizations: [{ title: "Engineer", name: "Analytical" }],
};

describe("contacts", () => {
  it("requires an email and a query", async () => {
    const missing = await callTool(testCtx({ env: { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "csecret" } }), "contacts_search", {});
    expect(textOf(missing)).toContain("user_google_email");
    const query = await callTool(testCtx({ token: liveToken() }), "contacts_search", {});
    expect(textOf(query)).toContain("query");
  });

  it("lists, gets, searches, and creates a contact", async () => {
    const { fetch, hits } = recordingFetch((hit) => {
      if (hit.url.pathname.endsWith(":searchContacts") && hit.url.searchParams.get("query") === null) {
        return jsonResponse({});
      }
      if (hit.url.pathname.endsWith(":searchContacts")) {
        return jsonResponse({ results: [{ person }] });
      }
      if (hit.url.pathname.endsWith(":createContact")) {
        return jsonResponse(person);
      }
      if (hit.url.pathname.endsWith("/connections")) {
        return jsonResponse({ connections: [person], totalPeople: 1 });
      }
      return jsonResponse(person);
    });
    const ctx = authed(fetch);
    const listed = textOf(await callTool(ctx, "contacts_list"));
    expect(listed).toContain("Contacts for test@example.com (1 of 1):");
    expect(listed).toContain("Name: Ada Lovelace");
    expect(listed).toContain("Organization: Engineer at Analytical");
    const got = textOf(await callTool(ctx, "contacts_get", { contact_id: "c1" }));
    expect(got).toContain("Contact Details for test@example.com:");
    expect(got).toContain("Contact ID: c1");
    const found = textOf(await callTool(ctx, "contacts_search", { query: "Ada" }));
    expect(found).toContain("Search Results for 'Ada' (1 found):");
    expect(hits.some((hit) => hit.url.searchParams.get("query") === "Ada")).toBe(true);
    const created = textOf(await callTool(ctx, "contacts_create", { given_name: "Ada", email: "ada@example.com" }));
    expect(created).toContain("Contact Created for test@example.com:");
  });
});

describe("drive", () => {
  it("searches by name, then fullText, and resolves a share URL", async () => {
    const { fetch, hits } = recordingFetch((hit) => {
      if (hit.url.pathname.endsWith("/files") && hit.url.searchParams.get("q")?.startsWith("name contains")) {
        return jsonResponse({ files: [] });
      }
      if (hit.url.searchParams.get("q")?.startsWith("fullText contains")) {
        return jsonResponse({
          files: [{
            id: "f1",
            name: "Budget",
            mimeType: "text/plain",
            webViewLink: "https://drive/f1",
            modifiedTime: "t",
            size: "12",
          }],
        });
      }
      return jsonResponse({
        id: "abc",
        name: "From URL",
        mimeType: "text/plain",
        webViewLink: "https://drive/abc",
        modifiedTime: "",
      });
    });
    const ctx = authed(fetch);
    const found = textOf(await callTool(ctx, "drive_search_files", { query: "Budget" }));
    expect(found).toBe(
      "Found 1 files for test@example.com matching 'Budget':\n- Name: \"Budget\" (ID: f1, Type: text/plain, Size: 12, Modified: t) Link: https://drive/f1",
    );
    expect(hits.some((hit) => hit.url.searchParams.get("q") === "name contains 'Budget' and trashed=false")).toBe(true);
    const resolved = textOf(await callTool(ctx, "drive_search_files", {
      query: "https://drive.google.com/file/d/abc/view",
    }));
    expect(resolved).toContain("Resolved 1 file for test@example.com from URL:");
    expect(resolved).toContain("Modified: N/A");
    const empty = textOf(await callTool(testCtx({ token: liveToken() }), "drive_search_files", {}));
    expect(empty).toContain("query");
  });

  it("reads, downloads, shares, creates, and converts", async () => {
    const { fetch, hits } = recordingFetch((hit) => {
      if (hit.url.pathname.includes("/export") || hit.url.searchParams.get("alt") === "media") {
        return new Response("hello", { status: 200 });
      }
      if (hit.method === "POST" && hit.url.pathname.includes("/permissions")) {
        return jsonResponse({ id: "p1", type: "user", role: "reader", emailAddress: "a@b.co" });
      }
      if (hit.method === "POST" && hit.url.hostname === "www.googleapis.com" && hit.url.pathname.includes("/upload/")) {
        return jsonResponse({ id: "new1", name: hit.body.includes("notes.md") ? "notes" : "notes.txt", webViewLink: "https://drive/new1" });
      }
      if (hit.url.searchParams.get("fields")?.includes("permissions")) {
        return jsonResponse({
          id: "f1",
          name: "Budget",
          mimeType: "text/plain",
          webViewLink: "https://drive/f1",
          shared: true,
          permissions: [{ id: "p0", type: "anyone", role: "reader" }],
        });
      }
      return jsonResponse({
        id: "f1",
        name: "Budget",
        mimeType: "application/vnd.google-apps.document",
        webViewLink: "https://drive/f1",
      });
    });
    const ctx = authed(fetch);
    const content = textOf(await callTool(ctx, "drive_get_file_content", { file_id: "f1" }));
    const contentRows = JSON.parse(content) as { text: string }[];
    expect(contentRows).toHaveLength(1);
    expect(contentRows[0]?.text).toContain("File: \"Budget\" (ID: f1, Type: application/vnd.google-apps.document)");
    expect(contentRows[0]?.text).toContain("--- CONTENT ---\nhello");
    const downloaded = textOf(await callTool(ctx, "drive_get_file_download_url", { file_id: "f1" }));
    expect(downloaded).toContain("File downloaded successfully!");
    expect(downloaded).toContain("Size: 0.0 KB (5 bytes)");
    expect(downloaded).toContain("Note: Google native file exported to application/pdf format.");
    const link = textOf(await callTool(ctx, "drive_get_shareable_link", { file_id: "f1" }));
    expect(link).toContain("Shared: true");
    expect(link).toContain("Anyone with the link (reader) [id: p0]");
    const shared = textOf(await callTool(ctx, "drive_create_permission", { file_id: "f1", share_with: "a@b.co" }));
    expect(shared).toContain("Successfully shared 'Budget'");
    expect(shared).toContain("User: a@b.co (reader) [id: p1]");
    const created = textOf(await callTool(ctx, "drive_create_file", { file_name: "notes.txt", content: "hi" }));
    expect(created).toBe("Successfully created file 'notes.txt' (ID: new1) in folder 'root' for test@example.com. Link: https://drive/new1");
    expect(hits.some((hit) => hit.body.includes("hi") && hit.body.includes("gantree_drive_upload"))).toBe(true);
    const converted = textOf(await callTool(ctx, "drive_convert_to_doc", { file_name: "notes.md", content: "# Hi" }));
    expect(converted).toBe(
      "Successfully imported 'notes' as Google Doc\n   Document ID: new1\n   Source format: text/markdown\n   Folder: root\n   Link: https://drive/new1",
    );
    const hint = textOf(await callTool(ctx, "drive_create_file", { file_name: "x" }));
    expect(hint).toContain("content is required");
  });
});

describe("docs", () => {
  it("searches, reads, creates, and inserts text", async () => {
    const { fetch } = recordingFetch((hit) => {
      if (hit.url.pathname.includes("/documents") && hit.method === "POST" && !hit.url.pathname.includes(":batchUpdate")) {
        return jsonResponse({ documentId: "d1" });
      }
      if (hit.url.pathname.includes(":batchUpdate")) {
        return jsonResponse({});
      }
      if (hit.url.pathname.includes("/documents/")) {
        return jsonResponse({
          body: { content: [{ paragraph: { elements: [{ textRun: { content: "Hello\n" } }] } }] },
          tabs: [{
            tabProperties: { title: "Notes", tabId: "t1" },
            documentTab: { body: { content: [{ paragraph: { elements: [{ textRun: { content: "Tab body\n" } }] } }] } },
          }],
        });
      }
      if (hit.url.pathname.endsWith("/files") || hit.url.searchParams.has("q")) {
        return jsonResponse({
          files: [{ id: "d1", name: "Plan", modifiedTime: "m", webViewLink: "https://docs/d1" }],
        });
      }
      return jsonResponse({
        id: "d1",
        name: "Plan",
        mimeType: "application/vnd.google-apps.document",
        webViewLink: "https://docs/d1",
        modifiedTime: "m",
      });
    });
    const ctx = authed(fetch);
    const found = textOf(await callTool(ctx, "docs_search", { query: "Plan" }));
    expect(found).toBe("Found 1 Google Docs matching 'Plan':\n- Plan (ID: d1) Modified: m Link: https://docs/d1");
    const body = textOf(await callTool(ctx, "docs_get_content", { document_id: "d1" }));
    const bodyRows = JSON.parse(body) as { text: string }[];
    expect(bodyRows[0]?.text).toContain("File: \"Plan\" (ID: d1, Type: application/vnd.google-apps.document)");
    expect(bodyRows[0]?.text).toContain("Hello\n");
    expect(bodyRows[0]?.text).toContain("\n--- TAB: Notes ---\nTab body\n");
    const created = textOf(await callTool(ctx, "docs_create", { title: "Plan", content: "Hi" }));
    expect(created).toBe("Created Google Doc 'Plan' (ID: d1) for test@example.com. Link: https://docs.google.com/document/d/d1/edit");
    const updated = textOf(await callTool(ctx, "docs_update_text", { document_id: "d1", start_index: 1, text: "Hi" }));
    expect(updated).toBe("Inserted text at index 1 in document d1. Text length: 2 characters. Link: https://docs.google.com/document/d/d1/edit");
    const missing = textOf(await callTool(testCtx({ env: { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "csecret" } }), "docs_search", { query: "x" }));
    expect(missing).toBe("user_google_email is required");
  });
});

describe("sheets", () => {
  it("lists, reads, writes, and creates", async () => {
    const { fetch, hits } = recordingFetch((hit) => {
      if (hit.url.pathname.includes("/values/") && hit.method === "PUT") {
        return jsonResponse({ updatedCells: 2, updatedRows: 1, updatedColumns: 2 });
      }
      if (hit.url.pathname.includes("/values/")) {
        return jsonResponse({ values: [["Ada", 1], ["Grace"]] });
      }
      if (hit.method === "POST" && hit.url.pathname.endsWith("/spreadsheets")) {
        return jsonResponse({
          spreadsheetId: "s1",
          spreadsheetUrl: "https://sheets/s1",
          properties: { title: "Budget", locale: "" },
        });
      }
      return jsonResponse({
        files: [{ id: "s1", name: "Budget", modifiedTime: "", webViewLink: "" }],
      });
    });
    const ctx = authed(fetch);
    const listed = textOf(await callTool(ctx, "sheets_list_spreadsheets", { query: "Budget" }));
    expect(listed).toBe("Found 1 spreadsheets for test@example.com matching 'Budget':\n- \"Budget\" (ID: s1) | Modified: Unknown | Link: No link");
    const values = textOf(await callTool(ctx, "sheets_get_values", { spreadsheet_id: "s1", range_name: "A1:B2" }));
    expect(values).toContain("Successfully read 2 rows from range 'A1:B2' in spreadsheet s1 for test@example.com:");
    expect(values).toContain("Row  1: [Ada 1]");
    expect(values).toContain("Row  2: [Grace <nil>]");
    const written = textOf(await callTool(ctx, "sheets_update_values", {
      spreadsheet_id: "s1",
      range_name: "A1",
      values: [["Ada", "1"]],
    }));
    expect(written).toBe("Successfully updated range 'A1' in spreadsheet s1 for test@example.com. Updated: 2 cells, 1 rows, 2 columns.");
    const created = textOf(await callTool(ctx, "sheets_create_spreadsheet", { title: "Budget" }));
    expect(created).toBe("Successfully created spreadsheet 'Budget' for test@example.com. ID: s1 | URL: https://sheets/s1 | Locale: Unknown");
    expect(hits.some((hit) => hit.url.searchParams.get("valueInputOption") === "USER_ENTERED")).toBe(true);
    const none = textOf(await callTool(testCtx({ env: { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "csecret" } }), "sheets_list_spreadsheets"));
    expect(none).toBe(
      "Ask which Google account to use — work, personal, or another mailbox — then call again with user_google_email set to that address. Do not guess.",
    );
  });
});
