import { describe, expect, it } from "vitest";
import { google } from "@/harness/plugins/google/index";
import { googleHealth } from "@/harness/plugins/google-health";
import { EMAIL_REQUIRED_MESSAGE, authFinish, buildAuthUrl, GOOGLE_SCOPES } from "@/harness/plugins/google/oauth";
import { NOW, callTool, jsonResponse, liveToken, recordingFetch, testCtx, textOf } from "@/test/harness/plugins/google/harness";

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
    expect(params.get("prompt")).toBe("consent select_account");
    expect(params.get("include_granted_scopes")).toBe("true");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBeTruthy();
    expect(params.get("scope")?.split(" ")).toEqual([...GOOGLE_SCOPES]);
    const pending = ctx.sql.one<{ verifier: string; redirect_uri: string }>(
      "SELECT verifier, redirect_uri FROM google_oauth_pending WHERE plugin = 'google'",
    );
    expect(pending?.redirect_uri).toBe("https://app.example/callback");
    expect(pending?.verifier).toBeTruthy();
  });

  it("honors custom scopes and client credentials in buildAuthUrl and authFinish", async () => {
    const customScopes = ["openid", "https://www.googleapis.com/auth/drive"] as const;
    const ctx = testCtx({ env: { GOOGLE_OAUTH_CLIENT_ID: "default-id", GOOGLE_OAUTH_CLIENT_SECRET: "default-secret" } });
    const url = await buildAuthUrl(ctx, "https://app.example/callback", "state-custom", {
      scopes: customScopes,
      creds: { id: "health-id", secret: "health-secret" },
    });
    const params = new URL(url).searchParams;
    expect(params.get("client_id")).toBe("health-id");
    expect(params.get("scope")?.split(" ")).toEqual([...customScopes]);
    expect(params.get("include_granted_scopes")).toBe("true");
    const pending = ctx.sql.one<{ verifier: string }>("SELECT verifier FROM google_oauth_pending WHERE plugin = 'google'");
    const { fetch, hits } = recordingFetch((hit) => {
      const body = new URLSearchParams(hit.body);
      expect(body.get("client_id")).toBe("health-id");
      expect(body.get("client_secret")).toBe("health-secret");
      expect(body.get("code_verifier")).toBe(pending?.verifier);
      return jsonResponse({
        access_token: "ya29.custom",
        refresh_token: "1//custom",
        expires_in: 3600,
        token_type: "Bearer",
        id_token: idToken("custom@example.com"),
      });
    });
    ctx.fetch = fetch;
    await authFinish(ctx, "https://app.example/callback", "code-custom", {
      creds: { id: "health-id", secret: "health-secret" },
    });
    expect(hits).toHaveLength(1);
    expect(ctx.tokens.saved.get("google:custom@example.com")?.accessToken).toBe("ya29.custom");
  });

  it("exchanges the code and stores the google token", async () => {
    const ctx = testCtx({ env: { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "csecret" } });
    if (!google.authStart || !google.authFinish) {
      throw new Error("google auth methods missing");
    }
    await google.authStart(ctx, "https://app.example/callback", "state-1");
    const pending = ctx.sql.one<{ verifier: string }>("SELECT verifier FROM google_oauth_pending WHERE plugin = 'google'");
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
    const stored = ctx.tokens.saved.get("google:ada@gmail.com");
    expect(stored?.accessToken).toBe("ya29.new");
    expect(stored?.refreshToken).toBe("1//new");
    expect(stored?.expiresAt).toBe(Date.parse("2026-07-28T15:00:00Z") + 3600 * 1000);
    expect(stored?.extra?.email).toBe("ada@gmail.com");
    expect(ctx.sql.one("SELECT plugin FROM google_oauth_pending WHERE plugin = 'google'")).toBeNull();
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
    expect(ctx.tokens.saved.get("google:test@example.com")?.accessToken).toBe("ya29.refreshed");
    expect(ctx.tokens.saved.get("google:test@example.com")?.refreshToken).toBe("1//refresh");
    expect(ctx.tokens.saved.get("google:test@example.com")?.extra?.email).toBe("test@example.com");
    expect(ctx.tokens.saved.has("google")).toBe(false);
  });

  it("does not refresh a token that is still valid", async () => {
    const { fetch, hits } = recordingFetch(() => jsonResponse({ items: [] }));
    const ctx = testCtx({ token: liveToken(), fetch });
    await callTool(ctx, "calendar_list_calendars");
    expect(hits.every((h) => h.url.pathname !== "/token")).toBe(true);
    expect(ctx.tokens.saved.get("google:test@example.com")?.accessToken).toBe("ya29.access");
    expect(ctx.tokens.saved.has("google")).toBe(false);
  });
});

describe("google mailboxes", () => {
  async function signIn(ctx: ReturnType<typeof testCtx>, email: string): Promise<void> {
    if (!google.authStart || !google.authFinish) {
      throw new Error("google auth methods missing");
    }
    await google.authStart(ctx, "https://app.example/callback", `state-${email}`);
    ctx.fetch = recordingFetch(() => jsonResponse({
      access_token: `ya29.${email}`,
      refresh_token: `1//${email}`,
      expires_in: 3600,
      token_type: "Bearer",
      id_token: idToken(email),
    })).fetch;
    await google.authFinish(ctx, "https://app.example/callback", `code-${email}`);
  }

  it("keeps both mailboxes after a second finish", async () => {
    const ctx = testCtx();
    await ctx.tokens.put("google", { accessToken: "unnamed", refreshToken: "1//old" });
    await ctx.tokens.put("google-health", { accessToken: "health-keep" });
    await signIn(ctx, "ada@gmail.com");
    await signIn(ctx, "bob@work.com");
    expect(ctx.tokens.saved.get("google:ada@gmail.com")?.accessToken).toBe("ya29.ada@gmail.com");
    expect(ctx.tokens.saved.get("google:bob@work.com")?.accessToken).toBe("ya29.bob@work.com");
    expect(ctx.tokens.saved.has("google")).toBe(false);
    expect(ctx.tokens.saved.get("google-health")?.accessToken).toBe("health-keep");
  });

  it("refreshes one mailbox without changing the other", async () => {
    const { fetch, hits } = recordingFetch((hit) => {
      if (hit.url.pathname === "/token") {
        const body = new URLSearchParams(hit.body);
        expect(body.get("refresh_token")).toBe("ada-refresh");
        return jsonResponse({ access_token: "ada-new", expires_in: 1800, token_type: "Bearer" });
      }
      expect(hit.authorization).toBe("Bearer ada-new");
      return jsonResponse({ items: [] });
    });
    const ctx = testCtx({ fetch });
    await ctx.tokens.put("google:ada@gmail.com", {
      accessToken: "ada-old",
      refreshToken: "ada-refresh",
      expiresAt: NOW - 1000,
      extra: { email: "ada@gmail.com" },
    });
    await ctx.tokens.put("google:bob@work.com", {
      accessToken: "bob-keep",
      refreshToken: "bob-refresh",
      expiresAt: NOW - 1000,
      extra: { email: "bob@work.com" },
    });
    const result = await callTool(ctx, "calendar_list_calendars", { user_google_email: "ada@gmail.com" });
    expect(result.isError).toBeUndefined();
    expect(ctx.tokens.saved.get("google:ada@gmail.com")?.accessToken).toBe("ada-new");
    expect(ctx.tokens.saved.get("google:bob@work.com")?.accessToken).toBe("bob-keep");
    expect(ctx.tokens.saved.get("google:bob@work.com")?.refreshToken).toBe("bob-refresh");
    expect(hits.some((hit) => hit.url.pathname === "/token")).toBe(true);
  });

  it("promotes a legacy google token that has an email", async () => {
    const listed = testCtx({ token: liveToken({ email: "ada@gmail.com" }) });
    const text = textOf(await callTool(listed, "auth_list_accounts"));
    expect(text).toContain("- ada@gmail.com");
    expect(listed.tokens.saved.has("google")).toBe(false);
    expect(listed.tokens.saved.get("google:ada@gmail.com")?.accessToken).toBe("ya29.access");

    const { fetch } = recordingFetch(() => jsonResponse({ items: [] }));
    const used = testCtx({ token: liveToken({ email: "ada@gmail.com" }), fetch });
    const calendars = await callTool(used, "calendar_list_calendars", { user_google_email: "ada@gmail.com" });
    expect(calendars.isError).toBeUndefined();
    expect(used.tokens.saved.has("google")).toBe(false);
    expect(used.tokens.saved.get("google:ada@gmail.com")?.accessToken).toBe("ya29.access");

    const kept = testCtx();
    await kept.tokens.put("google:ada@gmail.com", { accessToken: "kept", extra: { email: "ada@gmail.com" } });
    await kept.tokens.put("google", { accessToken: "legacy", extra: { email: "ada@gmail.com" } });
    await callTool(kept, "auth_list_accounts");
    expect(kept.tokens.saved.has("google")).toBe(false);
    expect(kept.tokens.saved.get("google:ada@gmail.com")?.accessToken).toBe("kept");
  });

  it("uses the only legacy mailbox when no address was passed", async () => {
    const { fetch } = recordingFetch(() => jsonResponse({ items: [] }));
    const ctx = testCtx({
      env: { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "csecret" },
      token: liveToken({ email: "ada@gmail.com" }),
      fetch,
    });
    const text = textOf(await callTool(ctx, "calendar_list_calendars"));
    expect(text).toContain("ada@gmail.com");
    expect(ctx.tokens.saved.has("google")).toBe(false);
    expect(ctx.tokens.saved.get("google:ada@gmail.com")?.accessToken).toBe("ya29.access");
  });

  it("uses a sole unnamed legacy token when no mailbox key exists", async () => {
    const { fetch, hits } = recordingFetch((hit) => {
      expect(hit.authorization).toBe("Bearer unnamed");
      return jsonResponse({ items: [] });
    });
    const ctx = testCtx({
      token: { accessToken: "unnamed", refreshToken: "1//unnamed", expiresAt: NOW + 3_600_000 },
      fetch,
    });
    const result = await callTool(ctx, "calendar_list_calendars");
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain("test@example.com");
    expect(hits).toHaveLength(1);
    expect(ctx.tokens.saved.get("google")?.accessToken).toBe("unnamed");
  });

  it("does not use another mailbox when the requested email has no token", async () => {
    let called = false;
    const ctx = testCtx({
      env: { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "csecret" },
      fetch: async () => {
        called = true;
        return jsonResponse({});
      },
      token: liveToken({ email: "ada@gmail.com" }),
    });
    const result = await callTool(ctx, "calendar_list_calendars", { user_google_email: "bob@work.com" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("authenticating for bob@work.com: no credentials found for bob@work.com; run: google-mcp auth");
    expect(called).toBe(false);
    expect(ctx.tokens.saved.get("google:ada@gmail.com")?.accessToken).toBe("ya29.access");
  });

  it("asks which account when several mailboxes are stored and none was named", async () => {
    const ctx = testCtx({
      env: { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "csecret" },
    });
    await ctx.tokens.put("google:ada@work.com", liveToken({ email: "ada@work.com" }));
    await ctx.tokens.put("google:ada@home.com", liveToken({ email: "ada@home.com" }));
    const result = await callTool(ctx, "sheets_list_spreadsheets", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(EMAIL_REQUIRED_MESSAGE);
  });

  it("lists every signed-in mailbox", async () => {
    const ctx = testCtx();
    await ctx.tokens.put("google:ada@work.com", liveToken({ email: "ada@work.com" }));
    await ctx.tokens.put("google:ada@home.com", liveToken({ email: "ada@home.com" }));
    expect(textOf(await callTool(ctx, "auth_list_accounts"))).toBe(
      "Signed-in Google accounts (2):\n- ada@home.com\n- ada@work.com\nPass one of these as user_google_email on later calls.",
    );
  });

  it("keeps workspace and health logins and readiness apart", async () => {
    const ctx = testCtx();
    if (!google.authStart || !googleHealth.authStart) {
      throw new Error("authStart missing");
    }
    await google.authStart(ctx, "https://app.example/callback", "state-w");
    const workspace = ctx.sql.one<{ verifier: string }>(
      "SELECT verifier FROM google_oauth_pending WHERE plugin = 'google'",
    );
    await googleHealth.authStart(ctx, "https://app.example/callback", "state-h");
    const workspaceAfter = ctx.sql.one<{ verifier: string }>(
      "SELECT verifier FROM google_oauth_pending WHERE plugin = 'google'",
    );
    const health = ctx.sql.one<{ verifier: string }>(
      "SELECT verifier FROM google_oauth_pending WHERE plugin = 'google-health'",
    );
    expect(workspace?.verifier).toBeTruthy();
    expect(workspaceAfter?.verifier).toBe(workspace?.verifier);
    expect(health?.verifier).toBeTruthy();
    expect(health?.verifier).not.toBe(workspace?.verifier);

    const healthOnly = testCtx();
    await healthOnly.tokens.put("google-health", { accessToken: "ya29.health" });
    expect(await google.ready(healthOnly)).toBe("no_oauth");

    const workspaceOnly = testCtx();
    await workspaceOnly.tokens.put("google:ada@work.com", { accessToken: "ya29.ada" });
    expect(await googleHealth.ready(workspaceOnly)).toBe("no_oauth");
  });
});
