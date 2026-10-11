import { describe, expect, it } from "vitest";
import { extractSlideText } from "@/brain/plugins/google/slides";
import { callTool, jsonResponse, liveToken, recordingFetch, testCtx, textOf } from "@/test/brain/plugins/google/harness";

const authed = (fetch: typeof globalThis.fetch) => testCtx({ token: liveToken(), fetch });

describe("slide text", () => {
  it("sorts runs and prefixes non-empty lines", () => {
    const text = extractSlideText({
      pageElements: [{
        shape: {
          text: {
            textElements: [
              { startIndex: 5, textRun: { content: "there\n" } },
              { startIndex: 0, textRun: { content: "hello " } },
              { textRun: { content: "" } },
            ],
          },
        },
      }],
    });
    expect(text).toBe("\n    > hello there");
  });
});

describe("slides tools", () => {
  it("creates a deck and describes its slides", async () => {
    const { fetch } = recordingFetch((hit) => {
      if (hit.method === "POST") {
        return jsonResponse({ presentationId: "PRES", slides: [{ objectId: "p" }] });
      }
      return jsonResponse({
        title: "",
        presentationId: "PRES",
        pageSize: { width: { magnitude: 9144000, unit: "EMU" }, height: { magnitude: 5143500, unit: "EMU" } },
        slides: [{ objectId: "slide1", pageElements: [{ objectId: "e1" }] }],
      });
    });
    const created = textOf(await callTool(authed(fetch), "slides_create_presentation", {}));
    expect(created).toContain("- Title: Untitled Presentation");
    expect(created).toContain("- Slides: 1 slide(s) created");
    const details = textOf(await callTool(authed(fetch), "slides_get_presentation", { presentation_id: "PRES" }));
    expect(details).toContain("- Title: Untitled");
    expect(details).toContain("- Page Size: 9144000 x 5143500 EMU");
    expect(details).toContain("Slide 1: ID slide1, 1 element(s), text: empty");
  });

  it("requires an object request and reports created slides", async () => {
    const bad = await callTool(testCtx({ token: liveToken() }), "slides_batch_update", {
      presentation_id: "PRES",
      requests: ["nope"],
    });
    expect(textOf(bad)).toBe("each request must be an object");
    const { fetch } = recordingFetch(() => jsonResponse({
      replies: [{ createSlide: { objectId: "s2" } }, {}],
    }));
    const text = textOf(await callTool(authed(fetch), "slides_batch_update", {
      presentation_id: "PRES",
      requests: [{ createSlide: {} }],
    }));
    expect(text).toContain("Batch Update Completed for test@example.com:");
    expect(text).toContain("Request 1: Created slide with ID s2");
    expect(text).toContain("Request 2: Operation completed");
  });

  it("describes page elements and a thumbnail", async () => {
    const { fetch, hits } = recordingFetch((hit) => {
      if (hit.url.pathname.endsWith("/thumbnail")) {
        return jsonResponse({ contentUrl: "https://lh3.example/thumb.png" });
      }
      return jsonResponse({
        pageType: "SLIDE",
        pageElements: [
          { objectId: "sh", shape: { shapeType: "TEXT_BOX" } },
          { objectId: "tb", table: { rows: 2, columns: 3 } },
          { objectId: "ln", line: { lineType: "STRAIGHT" } },
          { objectId: "other" },
        ],
      });
    });
    const page = textOf(await callTool(authed(fetch), "slides_get_page", {
      presentation_id: "PRES",
      page_object_id: "slide1",
    }));
    expect(page).toContain("Shape: ID sh, Type: TEXT_BOX");
    expect(page).toContain("Table: ID tb, Size: 2x3");
    expect(page).toContain("Line: ID ln, Type: STRAIGHT");
    expect(page).toContain("Element: ID other, Type: Unknown");
    const thumb = textOf(await callTool(authed(fetch), "slides_get_page_thumbnail", {
      presentation_id: "PRES",
      page_object_id: "slide1",
    }));
    expect(thumb).toContain("Thumbnail URL: https://lh3.example/thumb.png");
    const thumbHit = hits.find((hit) => hit.url.pathname.endsWith("/thumbnail"));
    expect(thumbHit?.url.searchParams.get("thumbnailProperties.mimeType")).toBe("PNG");
    expect(thumbHit?.url.searchParams.get("thumbnailProperties.thumbnailSize")).toBe("MEDIUM");
  });

  it("lists, creates, replies to, and resolves comments", async () => {
    const { fetch, hits } = recordingFetch((hit) => {
      if (hit.method === "GET") {
        return jsonResponse({
          comments: [{
            id: "c1",
            content: "Look",
            createdTime: "t0",
            resolved: true,
            author: { displayName: "Ada" },
            replies: [{ id: "r0", content: "ok", createdTime: "t1", author: { displayName: "Bea" } }],
          }],
        });
      }
      const body = JSON.parse(hit.body) as { content?: string; action?: string };
      return jsonResponse({ id: body.action === "resolve" ? "r-resolve" : "r1", createdTime: "t2", author: { displayName: "Ada" } });
    });
    const ctx = authed(fetch);
    const list = textOf(await callTool(ctx, "slides_list_comments", { presentation_id: "PRES" }));
    expect(list).toContain("Found 1 comments in presentation PRES:");
    expect(list).toContain("Created: t0 [RESOLVED]");
    expect(list).toContain("Reply ID: r0");
    const created = textOf(await callTool(ctx, "slides_create_comment", { presentation_id: "PRES", comment_content: "Hi" }));
    expect(created).toContain("Comment created successfully!");
    expect(created).toContain("Content: Hi");
    const reply = textOf(await callTool(ctx, "slides_create_reply", {
      presentation_id: "PRES",
      comment_id: "c1",
      reply_content: "Noted",
    }));
    expect(reply).toContain("Reply posted successfully!");
    const resolved = textOf(await callTool(ctx, "slides_resolve_comment", { presentation_id: "PRES", comment_id: "c1" }));
    expect(resolved).toContain("Comment c1 has been resolved successfully.");
    expect(resolved).toContain("Resolve reply ID: r-resolve");
    const resolveHit = hits.find((hit) => hit.body.includes("resolve"));
    expect(JSON.parse(resolveHit?.body ?? "{}")).toEqual({ content: "This comment has been resolved.", action: "resolve" });
  });
});
