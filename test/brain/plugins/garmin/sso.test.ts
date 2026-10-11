import { describe, expect, it } from "vitest";
import { DI_CLIENT_IDS, exchangeServiceTicket, jwtPayload, loginStart, refreshDiToken, submitMfa } from "@/brain/plugins/garmin/sso";
import { bodyText, header, jsonResponse, jwt, NOW, scripted } from "./harness";

const access = jwt({ client_id: "from-jwt", exp: 1893456000 });

function sso(handler: (url: URL, init: RequestInit | undefined) => Response): typeof fetch {
  return scripted(handler);
}

describe("mobile login", () => {
  const cases: { name: string; status: number; body: string; cookie?: boolean; boom?: string; wantTicket?: string; wantMethod?: string; wantErr: string }[] = [
    { body: `{"responseStatus":{"type":"SUCCESSFUL"},"serviceTicketId":"ST-1"}`, name: "success", status: 200, wantErr: "", wantTicket: "ST-1" },
    { body: `{"responseStatus":{"type":"SUCCESSFUL"}}`, name: "empty ticket", status: 200, wantErr: "empty service ticket" },
    { body: `{"responseStatus":{"type":"MFA_REQUIRED"},"customerMfaInfo":{"mfaLastMethodUsed":"phone"}}`, cookie: true, name: "mfa phone", status: 200, wantErr: "", wantMethod: "phone" },
    { body: `{"responseStatus":{"type":"MFA_REQUIRED"}}`, name: "mfa email", status: 200, wantErr: "", wantMethod: "email" },
    { body: `{"responseStatus":{"type":"INVALID_USERNAME_PASSWORD"}}`, name: "bad password", status: 200, wantErr: "invalid username" },
    { body: `{"responseStatus":{"type":"CAPTCHA_REQUIRED"}}`, name: "captcha", status: 200, wantErr: "captcha" },
    { body: `{"responseStatus":{"type":"LOCKED","message":"nope"}}`, name: "message", status: 200, wantErr: "LOCKED: nope" },
    { body: `{"responseStatus":{}}`, name: "empty status", status: 418, wantErr: "HTTP 418" },
    { body: `{}`, name: "http 429", status: 429, wantErr: "429" },
    { body: `{}`, name: "http 403", status: 403, wantErr: "403" },
    { body: `{"error":{"status-code":"429"}}`, name: "error status 429", status: 200, wantErr: "429" },
    { body: `not-json`, name: "bad json", status: 200, wantErr: "parse mobile login" },
    { body: ``, boom: "dial", name: "transport", status: 200, wantErr: "submit mobile login" },
  ];

  for (const tc of cases) {
    it(tc.name, async () => {
      const fetchFn = sso((url, init) => {
        expect(url.host).toBe("sso.garmin.com");
        expect(url.pathname).toBe("/mobile/api/login");
        expect(url.searchParams.get("clientId")).toBe("GCM_IOS_DARK");
        expect(init?.method).toBe("POST");
        if (tc.boom) throw new Error(tc.boom);
        const headers: HeadersInit = {};
        if (tc.cookie) headers["set-cookie"] = "SESSION=abc; Path=/";
        return jsonResponse(tc.status, tc.body, headers);
      });
      try {
        const started = await loginStart({ email: "ada@example.com", fetch: fetchFn, password: "secret" });
        expect(tc.wantErr).toBe("");
        if (tc.wantMethod) {
          expect(started.mfa).toBe(true);
          if (started.mfa) {
            expect(started.method).toBe(tc.wantMethod);
            expect(started.domain).toBe("garmin.com");
            expect(started.loginParams.clientId).toEqual(["GCM_IOS_DARK"]);
            if (tc.cookie) expect(started.cookies[0]?.name).toBe("SESSION");
          }
          return;
        }
        expect(started.mfa).toBe(false);
        if (!started.mfa) expect(started.ticket).toBe(tc.wantTicket);
      } catch (err) {
        expect(tc.wantErr).not.toBe("");
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain(tc.wantErr);
      }
    });
  }

  it("posts MFA with the saved cookie", async () => {
    const fetchFn = sso((url, init) => {
      expect(url.host).toBe("sso.garmin.cn");
      expect(url.pathname).toBe("/mobile/api/mfa/verifyCode");
      expect(header(init, "cookie")).toBe("SESSION=abc");
      expect(bodyText(init)).toContain(`"mfaVerificationCode":"999"`);
      return jsonResponse(200, `{"responseStatus":{"type":"SUCCESSFUL"},"serviceTicketId":"ST-2"}`);
    });
    const ticket = await submitMfa({
      code: "999",
      cookies: [{ name: "SESSION", path: "/", value: "abc" }],
      domain: "garmin.cn",
      fetch: fetchFn,
      loginParams: { service: ["https://example"] },
      method: "email",
    });
    expect(ticket).toBe("ST-2");
  });

  it("reports MFA failures", async () => {
    const fetchFn = sso(() => jsonResponse(200, `{"responseStatus":{"type":"INVALID","message":"bad"}}`));
    await expect(submitMfa({
      code: "1",
      cookies: [],
      domain: "garmin.com",
      fetch: fetchFn,
      loginParams: { service: ["https://example"] },
      method: "email",
    })).rejects.toThrow(/MFA failed/);
  });
});

describe("DI token", () => {
  it("uses expires_in and the jwt client id", async () => {
    const fetchFn = sso((url, init) => {
      expect(url.host).toBe("diauth.garmin.com");
      expect(header(init, "authorization")).toBe(`Basic ${btoa("sent:")}`);
      expect(bodyText(init)).toContain("grant_type=refresh_token");
      return jsonResponse(200, JSON.stringify({
        access_token: access,
        expires_in: 120,
        refresh_token: "r",
        scope: "s",
        token_type: "bearer",
      }));
    });
    const token = await refreshDiToken({
      clientId: "sent",
      domain: "garmin.com",
      fetch: fetchFn,
      nowMs: NOW,
      refreshToken: "refresh",
    });
    expect(token.clientId).toBe("from-jwt");
    expect(token.refreshToken).toBe("r");
    expect(token.scope).toBe("s");
    expect(token.expiresAt - NOW).toBe(120_000);
  });

  it("uses jwt exp when expires_in is zero", async () => {
    const token = await refreshDiToken({
      clientId: "client",
      domain: "garmin.com",
      fetch: sso(() => jsonResponse(200, JSON.stringify({ access_token: access, expires_in: 0 }))),
      nowMs: NOW,
      refreshToken: "refresh",
    });
    expect(token.expiresAt).toBe(1893456000 * 1000);
  });

  it("falls back to the requested client id", async () => {
    const token = await refreshDiToken({
      clientId: "fallback-id",
      domain: "garmin.com",
      fetch: sso(() => jsonResponse(200, JSON.stringify({ access_token: "plain", expires_in: 30 }))),
      nowMs: NOW,
      refreshToken: "refresh",
    });
    expect(token.clientId).toBe("fallback-id");
    expect(token.accessToken).toBe("plain");
    expect(token.expiresAt - NOW).toBe(30_000);
  });

  it("retries DI client ids then stops", async () => {
    let n = 0;
    const token = await exchangeServiceTicket({
      domain: "garmin.com",
      fetch: sso(() => {
        n += 1;
        if (n === 1) return jsonResponse(401, "no");
        return jsonResponse(200, JSON.stringify({ access_token: "ok", expires_in: 60 }));
      }),
      nowMs: NOW,
      ticket: "ST",
    });
    expect(token.accessToken).toBe("ok");
    expect(n).toBe(2);

    n = 0;
    await expect(exchangeServiceTicket({
      domain: "garmin.com",
      fetch: sso(() => {
        n += 1;
        return jsonResponse(401, "no");
      }),
      nowMs: NOW,
      ticket: "ST",
    })).rejects.toThrow(/DI token exchange failed/);
    expect(n).toBe(DI_CLIENT_IDS.length);
  });

  it("rejects a missing access token and a 429", async () => {
    await expect(refreshDiToken({
      clientId: "c",
      domain: "garmin.com",
      fetch: sso(() => jsonResponse(200, `{"refresh_token":"r"}`)),
      nowMs: NOW,
      refreshToken: "r",
    })).rejects.toThrow(/missing access_token/);
    await expect(refreshDiToken({
      clientId: "c",
      domain: "garmin.com",
      fetch: sso(() => jsonResponse(429, "slow")),
      nowMs: NOW,
      refreshToken: "r",
    })).rejects.toThrow(/429/);
    await expect(refreshDiToken({
      clientId: "c",
      domain: "garmin.com",
      fetch: sso(() => jsonResponse(200, `{`)),
      nowMs: NOW,
      refreshToken: "r",
    })).rejects.toThrow(/parse DI token/);
  });

  it("reads a padded jwt payload", () => {
    const padded = jwt({ client_id: "p", exp: 10 }, true);
    expect(padded.split(".")[1]).toContain("=");
    expect(jwtPayload(padded)?.client_id).toBe("p");
  });
});
