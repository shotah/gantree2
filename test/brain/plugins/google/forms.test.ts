import { describe, expect, it } from "vitest";
import { callTool, jsonResponse, liveToken, recordingFetch, testCtx, textOf } from "@/test/brain/plugins/google/harness";

const authed = (fetch: typeof globalThis.fetch) => testCtx({ token: liveToken(), fetch });

describe("forms tools", () => {
  it("requires a title and creates a form", async () => {
    const missing = await callTool(testCtx({ token: liveToken() }), "forms_create", {});
    expect(textOf(missing)).toContain("title is required");
    const { fetch, hits } = recordingFetch((hit) => {
      expect(JSON.parse(hit.body)).toEqual({ info: { title: "Survey", description: "Hi" } });
      return jsonResponse({ formId: "FORM1", responderUri: "https://docs.google.com/forms/d/FORM1/viewform", info: { title: "Survey" } });
    });
    const text = textOf(await callTool(authed(fetch), "forms_create", { title: "Survey", description: "Hi" }));
    expect(hits[0]?.url.pathname).toBe("/v1/forms");
    expect(text).toBe("Successfully created form 'Survey' for test@example.com. Form ID: FORM1. Edit URL: https://docs.google.com/forms/d/FORM1/edit. Responder URL: https://docs.google.com/forms/d/FORM1/viewform");
  });

  it("prints form questions, including required ones", async () => {
    const { fetch } = recordingFetch(() => jsonResponse({
      info: { title: "Survey", description: "", documentTitle: "Doc" },
      responderUri: "",
      items: [
        { title: "Name", questionItem: { question: { required: true } } },
        { title: "" },
      ],
    }));
    const text = textOf(await callTool(authed(fetch), "forms_get", {
      form_id: "https://docs.google.com/forms/d/FORM1/edit",
    }));
    const body = (JSON.parse(text) as { text: string }[])[0]?.text ?? "";
    expect(body).toContain("- Title: \"Survey\"");
    expect(body).toContain("- Description: \"No Description\"");
    expect(body).toContain("- Document Title: \"Doc\"");
    expect(body).toContain("- Form ID: FORM1");
    expect(body).toContain("1. Name (Required)");
    expect(body).toContain("2. Question 2");
    expect(body).toContain("- Questions (2 total):");
  });

  it("posts publish settings and reports the booleans it sent", async () => {
    const missing = await callTool(testCtx({
      env: { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "csecret", GOOGLE_TOOL_PRESET: "all" },
      token: null,
    }), "forms_update_publish_settings", { form_id: "FORM1" });
    expect(textOf(missing)).toBe(
      "Ask which Google account to use — work, personal, or another mailbox — then call again with user_google_email set to that address. Do not guess.",
    );
    const { fetch, hits } = recordingFetch(() => jsonResponse({}));
    const text = textOf(await callTool(authed(fetch), "forms_update_publish_settings", {
      form_id: "FORM1",
      publish_as_template: true,
    }));
    expect(JSON.parse(hits[0]?.body ?? "{}")).toEqual({ publishAsTemplate: true, requireAuthentication: false });
    expect(text).toContain("Publish as template: true, Require authentication: false");
  });

  it("lists responses and reads one submission", async () => {
    const { fetch } = recordingFetch((hit) => {
      if (hit.url.pathname.endsWith("/responses/R1")) {
        return jsonResponse({
          responseId: "R1",
          createTime: "t1",
          answers: {
            q2: { textAnswers: { answers: [{ value: "no" }] } },
            q1: { textAnswers: { answers: [{ value: "yes" }, { value: "maybe" }] } },
          },
        });
      }
      return jsonResponse({
        responses: [{ responseId: "R1", createTime: "t1", lastSubmittedTime: "t2", answers: { q1: {} } }],
        nextPageToken: "NEXT",
      });
    });
    const list = textOf(await callTool(authed(fetch), "forms_list_responses", { form_id: "FORM1", page_size: 5 }));
    expect(list).toContain("Total responses returned: 1");
    expect(list).toContain("Response ID: R1 | Created: t1 | Last Submitted: t2 | Answers: 1");
    expect(list).toContain("Next page token: NEXT");
    const one = textOf(await callTool(authed(fetch), "forms_get_response", { form_id: "FORM1", response_id: "R1" }));
    expect(one).toContain("Question ID q1: yes, maybe");
    expect(one.indexOf("Question ID q1")).toBeLessThan(one.indexOf("Question ID q2"));
  });

  it("rejects a non-array batch and summarizes createItem replies", async () => {
    const bad = await callTool(testCtx({ token: liveToken() }), "forms_batch_update", { form_id: "FORM1", requests: "nope" });
    expect(textOf(bad)).toBe("requests must be an array");
    const { fetch } = recordingFetch(() => jsonResponse({
      replies: [{ createItem: { itemId: "i1", questionId: ["q1"] } }, { updateItem: {} }],
    }));
    const text = textOf(await callTool(authed(fetch), "forms_batch_update", {
      form_id: "FORM1",
      requests: [{ createItem: { title: "Name" } }],
    }));
    expect(text).toContain("Requests Applied: 1");
    expect(text).toContain("Replies Received: 2");
    expect(text).toContain("Request 1: Created item i1 (Question IDs: q1)");
    expect(text).toContain("Request 2: Operation completed");
  });
});
