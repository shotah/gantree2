import { describe, expect, it } from "vitest";
import { stampAgentHeaders, stripUpgradeOp, upgradeOriginOk } from "@/lib/chat/upgrade";

describe("upgradeOriginOk", () => {
  it("allows a missing Origin (Go harness)", () => {
    expect(upgradeOriginOk(null, "https://gantree.example.workers.dev")).toBe(true);
  });

  it("allows Origin equal to the request URL origin", () => {
    expect(upgradeOriginOk("https://gantree.example.workers.dev", "https://gantree.example.workers.dev")).toBe(true);
    expect(upgradeOriginOk("http://127.0.0.1:5173", "http://127.0.0.1:5173")).toBe(true);
  });

  it("rejects a mismatched Origin (scheme, host, or port)", () => {
    expect(upgradeOriginOk("https://evil.example", "https://gantree.example.workers.dev")).toBe(false);
    expect(upgradeOriginOk("http://gantree.example.workers.dev", "https://gantree.example.workers.dev")).toBe(false);
    expect(upgradeOriginOk("https://x.test:443", "https://x.test")).toBe(false);
    expect(upgradeOriginOk("", "https://x.test")).toBe(false);
  });
});

describe("stripUpgradeOp", () => {
  it("deletes every X-Chat-* and leftover X-Pendant-* header", () => {
    const headers = new Headers({
      "X-Chat-Op": "avatar",
      "X-Chat-Role": "phone",
      "X-Pendant-Sub": "attacker",
      "X-Chat-Email": "ada@example.com",
      Cookie: "gantree_session=x",
    });
    stripUpgradeOp(headers);
    expect(headers.get("X-Chat-Op")).toBeNull();
    expect(headers.get("X-Chat-Role")).toBeNull();
    expect(headers.get("X-Pendant-Sub")).toBeNull();
    expect(headers.get("X-Chat-Email")).toBeNull();
    expect(headers.get("Cookie")).toBe("gantree_session=x");
  });
});

describe("stampAgentHeaders", () => {
  it("does not keep a client-supplied Sub on a harness upgrade", () => {
    const request = new Request("https://x.test/ws/kit?role=crane", {
      headers: {
        "X-Pendant-Sub": "attacker-picked",
        "X-Chat-Email": "ada@example.com",
        "X-Chat-EmailVerified": "1",
        "X-Chat-Exp": "1",
        "X-Chat-Op": "avatar",
        Authorization: "Bearer crane-tok",
      },
    });
    const headers = stampAgentHeaders(request, {
      role: "crane",
      rateId: "bearer:kit",
      slug: "kit",
    });
    expect(headers.get("X-Chat-Op")).toBeNull();
    expect(headers.get("X-Chat-Sub")).toBeNull();
    expect(headers.get("X-Chat-Email")).toBeNull();
    expect(headers.get("X-Chat-EmailVerified")).toBeNull();
    expect(headers.get("X-Chat-Exp")).toBeNull();
    expect(headers.get("X-Chat-Role")).toBe("crane");
    expect(headers.get("X-Chat-Rate")).toBe("bearer:kit");
    expect(headers.get("X-Chat-Slug")).toBe("kit");
    expect(headers.get("Authorization")).toBeNull();
  });

  it("stamps phone Sub after stripping the client copy", () => {
    const request = new Request("https://x.test/ws/kit?role=phone", {
      headers: { "X-Chat-Sub": "attacker-picked" },
    });
    const headers = stampAgentHeaders(request, {
      role: "phone",
      rateId: "sub:1182",
      slug: "kit",
      userId: "1182",
      email: "ada@x.com",
      emailVerified: true,
      exp: 9,
    });
    expect(headers.get("X-Chat-Sub")).toBe("1182");
    expect(headers.get("X-Chat-Email")).toBe("ada@x.com");
    expect(headers.get("X-Chat-EmailVerified")).toBe("1");
    expect(headers.get("X-Chat-Exp")).toBe("9");
  });
});
