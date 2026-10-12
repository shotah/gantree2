import { describe, expect, it } from "vitest";
import { google } from "@/harness/plugins/google/index";
import { GOOGLE_SCOPES } from "@/harness/plugins/google/oauth";
import { callTool, jsonResponse, liveToken, recordingFetch, testCtx, textOf } from "@/test/harness/plugins/google/harness";

function idToken(email: string): string {
  const payload = btoa(JSON.stringify({ email })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
  return `hdr.${payload}.sig`;
}

describe("google plugin ready", () => {
  it("is no_key without the client id or secret", async () => {
    expect(await google.ready(testCtx({ env: {} }))).toBe("no_key");
    expect(await google.ready(testCtx({ env: { GOOGLE_OAUTH_CLIENT_ID: "cid" } }))).toBe("no_key");
    expect(await google.ready(testCtx({ env: { GOOGLE_OAUTH_CLIENT_SECRET: "sec" } }))).toBe("no_key");
  });

  it("is no_oauth when the client is configured but no token is stored", async () => {
    expect(await google.ready(testCtx())).toBe("no_oauth");
  });

  it("is ready when the client and the google token are present", async () => {
    expect(await google.ready(testCtx({ token: liveToken() }))).toBeNull();
  });
});

describe("google oauth", () => {
  it("builds an authorize URL with every scope, offline access, and consent", async () => {
    const ctx = testCtx();
    if (!google.authStart) {
      throw new Error("google authStart missing");
    }
    const { url } = await google.authStart(ctx, "https://app.example/callback", "state-1");
    const params = new URL(url).searchParams;
    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe("cid");
    expect(params.get("redirect_uri")).toBe("https://app.example/callback");
    expect(params.get("state")).toBe("state-1");
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("prompt")).toBe("consent");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBeTruthy();
    expect(params.get("scope")?.split(" ")).toEqual([...GOOGLE_SCOPES]);
    const pending = ctx.sql.one<{ verifier: string; redirect_uri: string }>(
      "SELECT verifier, redirect_uri FROM google_oauth_pending WHERE id = 1",
    );
    expect(pending?.redirect_uri).toBe("https://app.example/callback");
    expect(pending?.verifier).toBeTruthy();
  });

  it("exchanges the code and stores the google token", async () => {
    const ctx = testCtx({ env: { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "csecret" } });
    if (!google.authStart || !google.authFinish) {
      throw new Error("google auth methods missing");
    }
    await google.authStart(ctx, "https://app.example/callback", "state-1");
    const pending = ctx.sql.one<{ verifier: string }>("SELECT verifier FROM google_oauth_pending WHERE id = 1");
    const { fetch, hits } = recordingFetch((hit) => {
      expect(hit.url.origin + hit.url.pathname).toBe("https://oauth2.googleapis.com/token");
      const body = new URLSearchParams(hit.body);
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("auth-code");
      expect(body.get("redirect_uri")).toBe("https://app.example/callback");
      expect(body.get("code_verifier")).toBe(pending?.verifier);
      expect(body.get("client_secret")).toBe("csecret");
      return jsonResponse({
        access_token: "ya29.new",
        refresh_token: "1//new",
        expires_in: 3600,
        scope: GOOGLE_SCOPES.join(" "),
        token_type: "Bearer",
        id_token: idToken("Ada@gmail.com"),
      });
    });
    ctx.fetch = fetch;
    await google.authFinish(ctx, "https://app.example/callback", "auth-code");
    expect(hits).toHaveLength(1);
    const stored = ctx.tokens.saved.get("google");
    expect(stored?.accessToken).toBe("ya29.new");
    expect(stored?.refreshToken).toBe("1//new");
    expect(stored?.expiresAt).toBe(Date.parse("2026-07-28T15:00:00Z") + 3600 * 1000);
    expect(stored?.extra?.email).toBe("ada@gmail.com");
    expect(ctx.sql.one("SELECT id FROM google_oauth_pending WHERE id = 1")).toBeNull();
  });

  it("does not call Google when no login is in progress", async () => {
    const code = "auth-code";
    const { fetch, hits } = recordingFetch(() => jsonResponse({ access_token: "nope" }));
    const ctx = testCtx({ fetch });
    const logged: string[] = [];
    ctx.log.error = (message, fields) => {
      logged.push(message);
      expect(fields).toBeUndefined();
    };
    if (!google.authFinish) {
      throw new Error("google authFinish missing");
    }
    await expect(google.authFinish(ctx, "https://app.example/callback", code)).rejects.toThrow(
      "no login in progress; click Connect again",
    );
    expect(hits).toEqual([]);
    expect(logged).toEqual(["no login in progress; click Connect again"]);
    expect(logged.join("")).not.toContain(code);
    expect(logged.join("")).not.toContain("csecret");
  });

  it("keeps a redirect mismatch off Google", async () => {
    const { fetch, hits } = recordingFetch(() => jsonResponse({ access_token: "nope" }));
    const ctx = testCtx({ fetch });
    if (!google.authStart || !google.authFinish) {
      throw new Error("google auth methods missing");
    }
    await google.authStart(ctx, "https://app.example/callback", "state-1");
    await expect(google.authFinish(ctx, "https://other.example/callback", "auth-code")).rejects.toThrow(
      "redirect_uri does not match the pending auth session",
    );
    expect(hits).toEqual([]);
  });

  it("refreshes an expired token and writes it back", async () => {
    const expired = liveToken();
    expired.expiresAt = Date.parse("2026-07-28T15:00:00Z") - 1000;
    const { fetch, hits } = recordingFetch((hit) => {
      if (hit.url.pathname === "/token") {
        const body = new URLSearchParams(hit.body);
        expect(body.get("grant_type")).toBe("refresh_token");
        expect(body.get("refresh_token")).toBe("1//refresh");
        return jsonResponse({ access_token: "ya29.refreshed", expires_in: 1800, token_type: "Bearer" });
      }
      expect(hit.authorization).toBe("Bearer ya29.refreshed");
      return jsonResponse({ items: [] });
    });
    const ctx = testCtx({ token: expired, fetch });
    const result = await callTool(ctx, "calendar_list_calendars", { user_google_email: "test@example.com" });
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain("No calendars found");
    expect(hits.some((h) => h.url.pathname === "/token")).toBe(true);
    expect(ctx.tokens.saved.get("google")?.accessToken).toBe("ya29.refreshed");
    expect(ctx.tokens.saved.get("google")?.refreshToken).toBe("1//refresh");
    expect(ctx.tokens.saved.get("google")?.extra?.email).toBe("test@example.com");
  });

  it("does not refresh a token that is still valid", async () => {
    const { fetch, hits } = recordingFetch(() => jsonResponse({ items: [] }));
    const ctx = testCtx({ token: liveToken(), fetch });
    await callTool(ctx, "calendar_list_calendars");
    expect(hits.every((h) => h.url.pathname !== "/token")).toBe(true);
    expect(ctx.tokens.saved.get("google")?.accessToken).toBe("ya29.access");
  });
});
