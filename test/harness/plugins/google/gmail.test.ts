import { describe, expect, it } from "vitest";
import { callTool, jsonResponse, liveToken, recordingFetch, testCtx, textOf } from "@/test/harness/plugins/google/harness";

function b64url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_");
}

const messagePayload = {
  id: "msg001",
  threadId: "thread001",
  payload: {
    headers: [
      { name: "Subject", value: "Test Email" },
      { name: "From", value: "alice@example.com" },
      { name: "To", value: "bob@example.com" },
      { name: "Date", value: "Mon, 1 Jan 2026 12:00:00 +0000" },
      { name: "Message-ID", value: "<msg001@example.com>" },
    ],
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "text/plain", body: { data: b64url("Hello, this is the message body.") } },
      { filename: "report.pdf", mimeType: "application/pdf", body: { attachmentId: "att001", size: 2048 } },
    ],
  },
};

describe("gmail tools", () => {
  it("requires a query and names USER_GOOGLE_EMAIL when no account is known", async () => {
    const missingQuery = await callTool(testCtx({ token: liveToken() }), "gmail_search_messages", {});
    expect(missingQuery.isError).toBe(true);
    expect(textOf(missingQuery).toLowerCase()).toContain("query");

    const ctx = testCtx({ env: { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "csecret" } });
    const missingEmail = await callTool(ctx, "gmail_search_messages", { query: "from:me" });
    expect(missingEmail.isError).toBe(true);
    expect(textOf(missingEmail)).toContain("USER_GOOGLE_EMAIL");
  });

  it("formats a search page, including the next page token", async () => {
    const { fetch } = recordingFetch((hit) => {
      expect(hit.url.searchParams.get("q")).toBe("in:inbox");
      expect(hit.url.searchParams.get("maxResults")).toBe("1");
      return jsonResponse({
        messages: [{ id: "msg001", threadId: "thread001" }],
        nextPageToken: "token123",
      });
    });
    const text = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "gmail_search_messages", {
      query: "in:inbox",
      page_size: 1,
    }));
    expect(text).toContain("Found 1 messages for query: 'in:inbox'");
    expect(text).toContain("Message ID: msg001");
    expect(text).toContain("Thread ID: thread001");
    expect(text).toContain("https://mail.google.com/mail/u/0/#inbox/msg001");
    expect(text).toContain("page_token: 'token123'");
  });

  it("says when a search matches nothing", async () => {
    const { fetch } = recordingFetch(() => jsonResponse({ resultSizeEstimate: 0 }));
    const text = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "gmail_search_messages", { query: "from:nobody@example.com" }));
    expect(text).toBe("No messages found for query: 'from:nobody@example.com'");
  });

  it("reads subject, headers, body, and attachment ids", async () => {
    const { fetch, hits } = recordingFetch((hit) => {
      expect(hit.url.pathname).toBe("/gmail/v1/users/me/messages/msg001");
      return jsonResponse(messagePayload);
    });
    const text = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "gmail_get_message", { message_id: "msg001" }));
    expect(hits.map((h) => h.url.searchParams.get("format"))).toEqual(["metadata", "full"]);
    expect(text).toContain("Subject: Test Email");
    expect(text).toContain("From:    alice@example.com");
    expect(text).toContain("To:      bob@example.com");
    expect(text).toContain("Message-ID: <msg001@example.com>");
    expect(text).toContain("Hello, this is the message body.");
    expect(text).toContain("1. report.pdf (application/pdf, 2.0 KB)");
    expect(text).toContain("Attachment ID: att001");
  });

  it("requires message_id", async () => {
    const result = await callTool(testCtx({ token: liveToken() }), "gmail_get_message", {});
    expect(result.isError).toBe(true);
    expect(textOf(result).toLowerCase()).toContain("message_id");
  });

  it("downloads an attachment preview", async () => {
    const data = `${"a".repeat(80)}TAIL`;
    const { fetch } = recordingFetch(() => jsonResponse({ size: 2048, data }));
    const text = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "gmail_get_attachment", {
      message_id: "msg001",
      attachment_id: "att001",
    }));
    expect(text).toContain("Attachment downloaded successfully!");
    expect(text).toContain("Size: 2.0 KB (2048 bytes)");
    expect(text).toContain(`${"a".repeat(80)}TAIL...`);
  });

  it("lists system and user labels", async () => {
    const { fetch } = recordingFetch(() => jsonResponse({
      labels: [
        { id: "INBOX", name: "INBOX", type: "system" },
        { id: "Label_1", name: "Receipts", type: "user" },
      ],
    }));
    const text = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "gmail_list_labels"));
    expect(text).toContain("Found 2 labels:");
    expect(text).toContain("SYSTEM LABELS:\n  - INBOX (ID: INBOX)");
    expect(text).toContain("USER LABELS:\n  - Receipts (ID: Label_1)");
  });

  it("sends a plain message and returns the id", async () => {
    const { fetch } = recordingFetch(async (hit) => {
      expect(hit.url.pathname).toBe("/gmail/v1/users/me/messages/send");
      const body = JSON.parse(hit.body) as { raw: string };
      const raw = atob(body.raw.replace(/-/g, "+").replace(/_/g, "/"));
      expect(raw).toContain("From: test@example.com\r\n");
      expect(raw).toContain("To: bob@example.com\r\n");
      expect(raw).toContain("Subject: Hello\r\n");
      expect(raw).toContain("\r\n\r\nSee you");
      return jsonResponse({ id: "sent1" });
    });
    const text = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "gmail_create_message", {
      to: "bob@example.com",
      subject: "Hello",
      body: "See you",
    }));
    expect(text).toBe("Email sent successfully!\nMessage ID: sent1");
  });

  it("requires to, subject, and body before sending", async () => {
    const ctx = testCtx({ token: liveToken() });
    expect(textOf(await callTool(ctx, "gmail_create_message", {})).toLowerCase()).toContain("to");
    expect(textOf(await callTool(ctx, "gmail_create_message", { to: "a@b.c" })).toLowerCase()).toContain("subject");
    expect(textOf(await callTool(ctx, "gmail_create_message", { to: "a@b.c", subject: "s" })).toLowerCase()).toContain("body");
  });

  it("creates a draft", async () => {
    const { fetch } = recordingFetch(() => jsonResponse({ id: "draft1" }));
    const text = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "gmail_create_draft", {
      subject: "Later",
      body: "Hold",
      to: "a@b.c",
    }));
    expect(text).toBe("Draft created successfully!\nDraft ID: draft1");
  });

  it("modifies labels on one message and on a batch", async () => {
    const { fetch, hits } = recordingFetch(() => jsonResponse({}));
    const one = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "gmail_update_message_labels", {
      message_id: "msg001",
      remove_label_ids: ["INBOX"],
      add_label_ids: ["Label_1"],
    }));
    expect(one).toBe("Labels modified for message msg001\nAdded: Label_1\nRemoved: INBOX\n");
    expect(hits[0]?.url.pathname).toBe("/gmail/v1/users/me/messages/msg001/modify");
    const batch = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "gmail_batch_update_message_labels", {
      message_ids: ["m1", "m2"],
      add_label_ids: ["TRASH"],
    }));
    expect(batch).toContain("Labels modified for 2 messages");
    expect(batch).toContain("Added: TRASH");
  });

  it("rejects label changes with no ids", async () => {
    const result = await callTool(testCtx({ token: liveToken() }), "gmail_update_message_labels", { message_id: "m" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("add_label_ids");
  });

  it("fails auth when no google token is stored", async () => {
    const result = await callTool(testCtx(), "gmail_list_labels", {});
    expect(result.isError).toBe(true);
    const lower = textOf(result).toLowerCase();
    expect(lower.includes("credentials") || lower.includes("authenticating") || lower.includes("token")).toBe(true);
  });
});

describe("auth tools", () => {
  it("lists no accounts until a token carries an email", async () => {
    const empty = textOf(await callTool(testCtx({ token: { accessToken: "ya29.secret", refreshToken: "1//also-secret" } }), "auth_list_accounts"));
    expect(empty).toContain("No Google accounts");
    expect(empty).not.toContain("ya29.secret");
    const listed = textOf(await callTool(testCtx({ token: liveToken({ email: "ada@gmail.com" }) }), "auth_list_accounts"));
    expect(listed).toContain("Signed-in Google accounts (1):");
    expect(listed).toContain("- ada@gmail.com");
    expect(listed).not.toContain("ya29");
    expect(listed).not.toContain("refresh");
  });

  it("requires service_name and returns an authorization URL", async () => {
    const missing = await callTool(testCtx({ token: liveToken() }), "auth_generate_url", {});
    expect(missing.isError).toBe(true);
    expect(textOf(missing).toLowerCase()).toContain("service_name");
    const text = textOf(await callTool(testCtx({ token: liveToken() }), "auth_generate_url", { service_name: "Gmail" }));
    expect(text).toContain("**ACTION REQUIRED: Google Authentication Needed for Gmail for 'test@example.com'**");
    expect(text).toContain("access_type=offline");
    expect(text).toContain("prompt=consent");
    expect(text).toContain("select_account");
    expect(text).toContain("https://accounts.google.com/o/oauth2/auth?");
  });
});
