import { describe, expect, it } from "vitest";
import { fromStub } from "@/lib/chat/slugRoute";

describe("fromStub", () => {
  it("copies status, headers, and body off the Durable Object response", async () => {
    const res = await fromStub(new Response("jpeg", { status: 200, headers: { "X-Chat-Rev": "9", "Content-Type": "image/jpeg" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Chat-Rev")).toBe("9");
    expect(await res.text()).toBe("jpeg");
    const empty = await fromStub(new Response(null, { status: 404 }));
    expect(empty.status).toBe(404);
    expect(empty.body).toBeNull();
  });
});
