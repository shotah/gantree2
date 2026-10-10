import { describe, expect, it } from "vitest";
import { mailboxUrl, parseIncoming } from "@/app/lib/socket";

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

  it("parses incoming frames and rejects junk", () => {
    expect(parseIncoming('{"text":"hi"}')).toEqual({ text: "hi" });
    expect(parseIncoming("nope")).toBeNull();
    expect(parseIncoming("1")).toBeNull();
  });
});
