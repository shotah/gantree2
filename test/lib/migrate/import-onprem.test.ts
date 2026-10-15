import { describe, expect, it } from "vitest";
import {
  applyOnPremBundle,
  emptyBundle,
  type AgentDoFetch,
  type OnPremBundle,
} from "@/lib/migrate/onprem";
import { parseImportArgs } from "@/scripts/import-onprem";

describe("parseImportArgs", () => {
  it("parses slug, input, and remote", () => {
    expect(parseImportArgs(["--slug", "kit", "--in", "b.json", "--remote"])).toEqual({
      help: false,
      slug: "kit",
      input: "b.json",
      remote: true,
    });
  });
});

describe("applyOnPremBundle", () => {
  it("sends memory_import, aims_import, persona_put, and self_put when present", async () => {
    const ops: string[] = [];
    const fetchAgent: AgentDoFetch = async (_input, init) => {
      const headers = init?.headers;
      let op = "";
      if (headers instanceof Headers) {
        op = headers.get("X-Chat-Op") ?? "";
      } else if (headers && typeof headers === "object") {
        const record = headers as Record<string, string>;
        op = record["X-Chat-Op"] ?? record["x-chat-op"] ?? "";
      }
      ops.push(op);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const bundle: OnPremBundle = {
      ...emptyBundle(),
      memory: {
        rows: [{
          id: 1,
          kind: "fact",
          subject: "x",
          content: "y",
          source: "human",
          confidence: 1,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          expires_at: null,
          superseded_by: null,
          consolidated: 0,
          consolidate_attempts: 0,
        }],
      },
      persona_file: {
        rows: [{ name: "PERSONA.md", text: "operator", updated_at: 1 }],
      },
      selfnote: {
        rows: [{ id: "self", body: "self text", updated_at: 1 }],
      },
    };

    await applyOnPremBundle(bundle, fetchAgent);
    expect(ops).toEqual(["memory_import", "aims_import", "persona_put", "self_put"]);
  });

  it("skips persona and self when empty", async () => {
    const ops: string[] = [];
    const fetchAgent: AgentDoFetch = async (_input, init) => {
      const headers = init?.headers;
      let op = "";
      if (headers instanceof Headers) {
        op = headers.get("X-Chat-Op") ?? "";
      } else if (headers && typeof headers === "object") {
        const record = headers as Record<string, string>;
        op = record["X-Chat-Op"] ?? "";
      }
      ops.push(op);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await applyOnPremBundle(emptyBundle(), fetchAgent);
    expect(ops).toEqual(["memory_import", "aims_import"]);
  });

  it("throws when a DO response is not ok", async () => {
    const fetchAgent: AgentDoFetch = async () =>
      new Response(JSON.stringify({ error: "bad" }), { status: 503 });

    await expect(applyOnPremBundle(emptyBundle(), fetchAgent)).rejects.toThrow(
      /memory_import → 503 bad/,
    );
  });
});
