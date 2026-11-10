import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, scriptNonce, secured, withSecurityHeaders } from "@/lib/door/headers";

const html = { "content-type": "text/html; charset=utf-8" };

function serve(dev = false) {
  const seen: Request[] = [];
  const fetch = withSecurityHeaders<object>((request) => {
    seen.push(request);
    const json = new URL(request.url).pathname.startsWith("/api/");
    return json ? Response.json({ ok: true }) : new Response("<!doctype html>", { headers: html });
  }, dev);
  return { seen, get: (url: string, init?: RequestInit) => fetch(new Request(url, init) as Request<unknown, IncomingRequestCfProperties>, {}, {} as ExecutionContext) };
}

describe("contentSecurityPolicy", () => {
  it("names every required directive", () => {
    const csp = contentSecurityPolicy("abc", new URL("https://gantree.example.com/login"));
    for (const directive of ["default-src", "script-src", "style-src", "img-src", "font-src", "connect-src", "media-src", "worker-src", "manifest-src", "form-action"]) {
      expect(csp).toMatch(new RegExp(`(^|; )${directive} `));
    }
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("script-src 'self' 'nonce-abc'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("names the socket origin for the request's scheme", () => {
    expect(contentSecurityPolicy("n", new URL("https://gantree.example.com/"))).toContain("connect-src 'self' wss://gantree.example.com");
    expect(contentSecurityPolicy("n", new URL("http://127.0.0.1:3112/"))).toContain("connect-src 'self' ws://127.0.0.1:3112");
  });
});

describe("withSecurityHeaders", () => {
  it("stamps a fresh nonce per response and hands the same one to the app", async () => {
    const s = serve();
    const a = await s.get("https://gantree.example.com/login");
    const b = await s.get("https://gantree.example.com/login");
    const na = scriptNonce(a.headers);
    const nb = scriptNonce(b.headers);
    expect(na).toMatch(/^[\w-]{22}$/);
    expect(nb).toMatch(/^[\w-]{22}$/);
    expect(na).not.toBe(nb);
    expect(scriptNonce(s.seen[0].headers)).toBe(na);
    expect(scriptNonce(s.seen[1].headers)).toBe(nb);
  });

  it("drops a policy the client sent", async () => {
    const s = serve();
    const res = await s.get("https://gantree.example.com/login", {
      headers: { "content-security-policy": "script-src 'nonce-evil'", "content-security-policy-report-only": "script-src 'nonce-evil'" },
    });
    expect(scriptNonce(s.seen[0].headers)).toBe(scriptNonce(res.headers));
    expect(s.seen[0].headers.get("content-security-policy")).not.toContain("evil");
    expect(s.seen[0].headers.has("content-security-policy-report-only")).toBe(false);
  });

  it("sends HSTS on https only, never on plain-http loopback", async () => {
    const s = serve();
    expect((await s.get("https://gantree.example.com/login")).headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect((await s.get("http://127.0.0.1:3112/login")).headers.has("strict-transport-security")).toBe(false);
  });

  it("puts nosniff and referrer on JSON but the policy and framing on HTML only", async () => {
    const s = serve();
    const json = await s.get("https://gantree.example.com/api/health");
    expect(json.headers.get("x-content-type-options")).toBe("nosniff");
    expect(json.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(json.headers.has("content-security-policy")).toBe(false);
    expect(json.headers.has("x-frame-options")).toBe(false);
    const page = await s.get("https://gantree.example.com/login");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
  });

  it("leaves the policy off in dev but keeps the rest", async () => {
    const s = serve(true);
    const page = await s.get("http://127.0.0.1:3111/login");
    expect(page.headers.has("content-security-policy")).toBe(false);
    expect(s.seen[0].headers.has("content-security-policy")).toBe(false);
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
  });
});

describe("secured", () => {
  it("adds headers to an immutable redirect", () => {
    const res = secured(Response.redirect("https://gantree.example.com/login", 302), new URL("https://gantree.example.com/"), null);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://gantree.example.com/login");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("keeps both cookies the sign-in callback sets", () => {
    const headers = new Headers({ location: "https://gantree.example.com/" });
    headers.append("set-cookie", "a=1");
    headers.append("set-cookie", "b=2");
    const res = secured(new Response(null, { status: 302, headers }), new URL("https://gantree.example.com/"), null);
    expect(res.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
  });

  it("hands a socket upgrade back untouched", () => {
    const upgrade = { status: 101 } as Response;
    expect(secured(upgrade, new URL("https://gantree.example.com/ws/ada"), null)).toBe(upgrade);
  });
});

describe("scriptNonce", () => {
  it("reads the nonce from the policy header, or nothing", () => {
    expect(scriptNonce(new Headers({ "content-security-policy": "default-src 'self'; script-src 'self' 'nonce-a_b-C'" }))).toBe("a_b-C");
    expect(scriptNonce(new Headers())).toBeUndefined();
  });
});
