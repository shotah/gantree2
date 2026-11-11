import { describe, expect, it, vi } from "vitest";
import { mailboxUrl, parseIncoming, probeMailbox } from "@/app/lib/socket";

describe("socket helpers", () => {
  it("spike /crane tab may put secret or bearer on the query (oidc upgrade rejects query bearer in handshake tests)", () => {
    expect(mailboxUrl({
      host: "gantree.example.workers.dev",
      protocol: "https:",
      slug: "kit",
      role: "phone",
      secret: "s",
    })).toBe("wss://gantree.example.workers.dev/ws/kit?role=phone&secret=s");
    expect(mailboxUrl({
      host: "localhost:5173",
      protocol: "http:",
      slug: "kit",
      role: "crane",
      bearer: "tok",
    })).toContain("ws://localhost:5173/ws/kit?role=crane&bearer=tok");
  });

  it("omits secret and bearer when they are not provided", () => {
    expect(mailboxUrl({
      host: "gantree.example.workers.dev",
      protocol: "https:",
      slug: "kit",
      role: "phone",
    })).toBe("wss://gantree.example.workers.dev/ws/kit?role=phone");
  });

  it("probes the mailbox route over HTTP", async () => {
    const init = { credentials: "same-origin", cache: "no-store" };
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 403 }));
    await expect(probeMailbox("wss://gantree.example.workers.dev/ws/kit?role=phone", fetchFn)).resolves.toBe(403);
    expect(fetchFn).toHaveBeenCalledWith("https://gantree.example.workers.dev/ws/kit?role=phone", init);
    const httpFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 426 }));
    await expect(probeMailbox("ws://localhost:5173/ws/kit?role=phone&secret=s", httpFn)).resolves.toBe(426);
    expect(httpFn).toHaveBeenCalledWith("http://localhost:5173/ws/kit?role=phone&secret=s", init);
  });

  it("resolves null when the probe fetch fails", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    await expect(probeMailbox("wss://host/ws/kit?role=phone", fetchFn)).resolves.toBeNull();
  });

  it("parses incoming frames and rejects junk", () => {
    expect(parseIncoming('{"text":"hi"}')).toEqual({ text: "hi" });
    expect(parseIncoming("nope")).toBeNull();
    expect(parseIncoming("1")).toBeNull();
  });
});
