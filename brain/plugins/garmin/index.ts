import type { Plugin, PluginContext, SkipReason } from "@/brain/core/tools";
import { activityTools } from "./activities";
import { putSession, type Session } from "./http";
import { hrvTools } from "./hrv";
import { metricsTools } from "./metrics";
import { clearPending, ensureGarminSchema, loadPending, savePending } from "./pending";
import { sleepTools } from "./sleep";
import { authorizedInstruction, AUTH_GUIDE_URL, creds, exchangeServiceTicket, hasCreds, loginStart, MFA_TTL_MS, mfaInstruction, submitMfa } from "./sso";
import { summaryTools } from "./summary";
import { utilityTools } from "./utility";
import { weightTools } from "./weight";
import { wellnessTools } from "./wellness";
import { GarminError } from "./json";

export { keys } from "./keys";

async function storeToken(ctx: PluginContext, token: {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  tokenType: string;
  clientId: string;
}, domain: string): Promise<void> {
  const previous = await ctx.tokens.get("garmin");
  const session: Session = {
    accessToken: token.accessToken,
    diClientId: token.clientId,
    domain,
    expiresAt: token.expiresAt,
    extra: { ...(previous?.extra ?? {}), diClientId: token.clientId, domain },
    refreshToken: token.refreshToken,
    scope: token.scope || undefined,
    tokenType: token.tokenType || undefined,
  };
  await putSession(ctx.tokens, session);
}

export const garmin: Plugin = {
  name: "garmin",

  async ready(ctx: PluginContext): Promise<SkipReason | null> {
    ensureGarminSchema(ctx.sql);
    if (!hasCreds(ctx.env)) return "no_key";
    if (await ctx.tokens.get("garmin") === null) return "no_oauth";
    return null;
  },

  tools(ctx: PluginContext) {
    ensureGarminSchema(ctx.sql);
    return [
      ...sleepTools(ctx),
      ...wellnessTools(ctx),
      ...hrvTools(ctx),
      ...weightTools(ctx),
      ...activityTools(ctx),
      ...metricsTools(ctx),
      ...utilityTools(ctx),
      ...summaryTools(ctx),
    ];
  },

  async authStart(ctx, redirectUri, state) {
    ensureGarminSchema(ctx.sql);
    const { email, password } = creds(ctx.env);
    const started = await loginStart({
      domain: "garmin.com",
      email,
      fetch: ctx.fetch,
      password,
    });
    if (started.mfa) {
      savePending(ctx.sql, {
        cookies: started.cookies,
        domain: started.domain,
        expiresAt: ctx.clock.now() + MFA_TTL_MS,
        loginParams: started.loginParams,
        mfaMethod: started.method,
        redirectUri,
        state,
      });
      ctx.log.info("garmin mfa required", { method: started.method });
      return { instruction: mfaInstruction(started.method), url: AUTH_GUIDE_URL };
    }
    clearPending(ctx.sql);
    try {
      const token = await exchangeServiceTicket({
        domain: "garmin.com",
        fetch: ctx.fetch,
        nowMs: ctx.clock.now(),
        ticket: started.ticket,
      });
      await storeToken(ctx, token, "garmin.com");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new GarminError(`failed to exchange service ticket for DI token: ${message}`);
    }
    ctx.log.info("garmin authorized");
    return { instruction: authorizedInstruction(), url: AUTH_GUIDE_URL };
  },

  async authFinish(ctx, _redirectUri, code) {
    ensureGarminSchema(ctx.sql);
    const trimmed = code.trim();
    if (trimmed === "") throw new GarminError("garmin: empty MFA code");
    const pending = loadPending(ctx.sql, ctx.clock.now());
    const ticket = await submitMfa({
      code: trimmed,
      cookies: pending.cookies,
      domain: pending.domain,
      fetch: ctx.fetch,
      loginParams: pending.loginParams,
      method: pending.mfaMethod,
    });
    try {
      const token = await exchangeServiceTicket({
        domain: pending.domain,
        fetch: ctx.fetch,
        nowMs: ctx.clock.now(),
        ticket,
      });
      await storeToken(ctx, token, pending.domain);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new GarminError(`failed to exchange service ticket for DI token: ${message}`);
    }
    clearPending(ctx.sql);
    ctx.log.info("garmin authorized");
  },
};
