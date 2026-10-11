import { describe, expect, it } from "vitest";
import { normalizeChatSpaceID } from "@/brain/plugins/google/chat";
import { callTool, jsonResponse, liveToken, recordingFetch, testCtx, textOf } from "@/test/brain/plugins/google/harness";

const noEmail = () => testCtx({
  env: { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "csecret", GOOGLE_TOOL_PRESET: "all" },
  token: null,
});

describe("chat space ids", () => {
  it("prefixes a bare id and leaves resource names alone", () => {
    expect(normalizeChatSpaceID("AAAA")).toBe("spaces/AAAA");
    expect(normalizeChatSpaceID(" spaces/AAAA ")).toBe("spaces/AAAA");
    expect(normalizeChatSpaceID("spaces/AAAA/messages/m")).toBe("spaces/AAAA/messages/m");
    expect(normalizeChatSpaceID("foo/bar")).toBe("foo/bar");
  });
});

describe("chat tools", () => {
  it("requires space_id before auth", async () => {
    const result = await callTool(testCtx({ token: liveToken() }), "chat_list_messages", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("space_id is required");
    expect(textOf(result)).toContain("chat_list_spaces");
  });

  it("reports auth failure", async () => {
    const result = await callTool(noEmail(), "chat_list_spaces", { user_google_email: "ada@example.com" });
    const text = textOf(result).toLowerCase();
    expect(result.isError).toBe(true);
    expect(text.includes("credentials") || text.includes("authenticating")).toBe(true);
  });

  it("lists spaces", async () => {
    const { fetch } = recordingFetch(() => jsonResponse({
      spaces: [
        { name: "spaces/AAAA", displayName: "General", spaceType: "SPACE" },
        { name: "spaces/BBBB", displayName: "", spaceType: "" },
      ],
    }));
    const text = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "chat_list_spaces"));
    expect(text).toContain("Found 2 Chat spaces (type: all):");
    expect(text).toContain("- General (ID: spaces/AAAA, Type: SPACE)");
    expect(text).toContain("- Unnamed Space (ID: spaces/BBBB, Type: UNKNOWN)");
  });

  it("says when there are no spaces", async () => {
    const { fetch } = recordingFetch(() => jsonResponse({ spaces: [] }));
    const text = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "chat_list_spaces"));
    expect(text).toBe("No Chat spaces found for type 'all'.");
  });

  it("reads messages after loading the space", async () => {
    const { fetch, hits } = recordingFetch((hit) => {
      if (hit.url.pathname.endsWith("/messages")) {
        return jsonResponse({
          messages: [{
            name: "spaces/AAAA/messages/msg001",
            text: "First message",
            createTime: "2026-02-18T10:00:00Z",
            sender: { displayName: "Alice" },
          }],
        });
      }
      return jsonResponse({ name: "spaces/AAAA", displayName: "General", spaceType: "SPACE" });
    });
    const text = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "chat_list_messages", { space_id: "AAAA" }));
    expect(hits[0]?.url.pathname).toBe("/v1/spaces/AAAA");
    expect(hits[1]?.url.searchParams.get("orderBy")).toBe("createTime desc");
    expect(text).toContain("Messages from 'General' (ID: spaces/AAAA):");
    expect(text).toContain("[2026-02-18T10:00:00Z] Alice:");
    expect(text).toContain("First message");
    expect(text).toContain("(Message ID: spaces/AAAA/messages/msg001)");
  });

  it("sends a message", async () => {
    const { fetch, hits } = recordingFetch((hit) => {
      expect(hit.method).toBe("POST");
      expect(JSON.parse(hit.body)).toEqual({ text: "Hello team!" });
      return jsonResponse({ name: "spaces/AAAA/messages/msg001", createTime: "2026-02-18T10:00:00Z" });
    });
    const text = textOf(await callTool(testCtx({ token: liveToken(), fetch }), "chat_create_message", {
      space_id: "spaces/AAAA",
      message_text: "Hello team!",
    }));
    expect(hits[0]?.url.pathname).toBe("/v1/spaces/AAAA/messages");
    expect(text).toBe("Message sent to space 'spaces/AAAA' by test@example.com. Message ID: spaces/AAAA/messages/msg001, Time: 2026-02-18T10:00:00Z");
  });

  it("searches one space and every space", async () => {
    const scoped = recordingFetch(() => jsonResponse({
      messages: [{
        name: "spaces/AAAA/messages/msg001",
        text: "Project kickoff tomorrow",
        createTime: "2026-02-18T10:00:00Z",
        sender: { displayName: "Alice" },
      }],
    }));
    const scopedText = textOf(await callTool(testCtx({ token: liveToken(), fetch: scoped.fetch }), "chat_search_messages", {
      query: "kickoff",
      space_id: "spaces/AAAA",
    }));
    expect(scopedText).toContain("Found 1 messages matching 'kickoff' in space 'spaces/AAAA'");
    expect(scoped.hits[0]?.url.searchParams.get("filter")).toBe("text:\"kickoff\"");

    const all = recordingFetch((hit) => {
      if (hit.url.pathname === "/v1/spaces") {
        return jsonResponse({
          spaces: [
            { name: "spaces/AAAA", displayName: "General" },
            { name: "spaces/BBBB", displayName: "Engineering" },
          ],
        });
      }
      if (hit.url.pathname.includes("BBBB")) {
        return jsonResponse({
          messages: [{ name: "m2", text: "Kickoff notes", createTime: "2026-02-18T10:01:00Z", sender: { displayName: "Bob" } }],
        });
      }
      return jsonResponse({
        messages: [{ name: "m1", text: "Project kickoff tomorrow", createTime: "2026-02-18T10:00:00Z", sender: { displayName: "Alice" } }],
      });
    });
    const allText = textOf(await callTool(testCtx({ token: liveToken(), fetch: all.fetch }), "chat_search_messages", { query: "kickoff" }));
    expect(allText).toContain("Found 2 messages matching 'kickoff' in all accessible spaces");
    expect(allText).toContain("General");
    expect(allText).toContain("Engineering");
  });
});
