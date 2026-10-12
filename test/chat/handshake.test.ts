import { describe, expect, it } from "vitest";
import { sealSession, sessionKey, SESSION_COOKIE } from "@/lib/door/session";
import {
  handshake,
  handshakePhone,
  handshakeSlug,
  rateId,
  roleFromQuery,
  stampEmail,
  stampUserId,
} from "@/lib/chat/handshake";

const SECRET = "s".repeat(32);
const now = Date.UTC(2026, 8, 4);

function admit(role: "admin" | "operator" | "member", slug = "kit", assignedSlugs: string[] = []) {
  return { role, assignedSlugs, slug };
}

async function cookie(human: { sub: string; email: string | null }): Promise<string> {
  const token = await sealSession(await sessionKey(SECRET), human, now);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

async function token(human: { sub: string; email: string | null }): Promise<string> {
  return sealSession(await sessionKey(SECRET), human, now);
}

describe("handshake", () => {
  it("accepts the spike secret for either role", async () => {
    const env = { CHAT_SECRET: "shared" };
    const ok = await handshake({
      env,
      slug: "kit",
      role: "phone",
      authorization: "Bearer shared",
    });
    expect(ok).toEqual({ ok: true, principal: { kind: "spike", role: "phone" } });
    const bad = await handshake({
      env,
      slug: "kit",
      role: "crane",
      querySecret: "nope",
    });
    expect(bad).toEqual({ ok: false, error: "unauthorized" });
  });

  it("in oidc, unknown sub and bad token look the same", async () => {
    const env = {
      GOOGLE_CLIENT_ID: "id",
      ALLOWED_SUBS: "1182:ada@x.com",
      SESSION_SECRET: SECRET,
      AGENT_BEARERS: "kit:crane-tok",
    };
    const session = await token({ sub: "1182", email: "ada@x.com" });
    const phone = await handshake({
      env,
      slug: "kit",
      role: "phone",
      cookieHeader: `${SESSION_COOKIE}=${encodeURIComponent(session)}`,
      admit: admit("member"),
      now,
    });
    expect(phone.ok).toBe(true);
    if (phone.ok && phone.principal.kind === "phone") {
      expect(phone.principal.sub).toBe("1182");
      expect(phone.principal.email).toBe("ada@x.com");
      expect(phone.principal.emailVerified).toBe(true);
      expect(phone.principal.exp).toBeGreaterThan(now);
    }

    const stranger = await token({ sub: "999", email: null });
    const unknown = await handshake({
      env,
      slug: "kit",
      role: "phone",
      cookieHeader: `${SESSION_COOKIE}=${encodeURIComponent(stranger)}`,
      admit: admit("member"),
      now,
    });
    const junk = await handshake({
      env,
      slug: "kit",
      role: "phone",
      cookieHeader: `${SESSION_COOKIE}=junk`,
      now,
    });
    expect(unknown).toEqual({ ok: false, error: "forbidden" });
    expect(junk).toEqual({ ok: false, error: "unauthorized" });

    const viaHeader = await handshake({
      env,
      slug: "kit",
      role: "phone",
      authorization: `Bearer ${session}`,
      admit: admit("member"),
      now,
    });
    expect(viaHeader).toEqual(phone);
    const craneAsPhone = await handshake({
      env,
      slug: "kit",
      role: "phone",
      authorization: "Bearer crane-tok",
      now,
    });
    expect(craneAsPhone).toEqual({ ok: false, error: "unauthorized" });
  });

  it("binds the harness bearer to the slug", async () => {
    const env = {
      GOOGLE_CLIENT_ID: "id",
      ALLOWED_SUBS: "1182",
      SESSION_SECRET: SECRET,
      AGENT_BEARERS: "kit:crane-tok,ada:other",
    };
    const kit = await handshake({
      env,
      slug: "kit",
      role: "crane",
      authorization: "Bearer crane-tok",
    });
    expect(kit).toEqual({ ok: true, principal: { kind: "agent", slug: "kit" } });
    const cross = await handshake({
      env,
      slug: "ada",
      role: "crane",
      authorization: "Bearer crane-tok",
    });
    expect(cross).toEqual({ ok: false, error: "unauthorized" });
  });

  it("accepts the bearer stored on the room when the env map has another slug", async () => {
    const env = {
      GOOGLE_CLIENT_ID: "id",
      SESSION_SECRET: SECRET,
      AGENT_BEARERS: "ada:other",
    };
    const ok = await handshake({
      env,
      slug: "kit",
      role: "crane",
      authorization: "Bearer from-do",
      roomBearer: "from-do",
    });
    expect(ok).toEqual({ ok: true, principal: { kind: "agent", slug: "kit" } });
    const bad = await handshake({
      env,
      slug: "kit",
      role: "crane",
      authorization: "Bearer nope",
      roomBearer: "from-do",
    });
    expect(bad).toEqual({ ok: false, error: "unauthorized" });
  });

  it("in oidc, query bearer is ignored so the harness must send Authorization", async () => {
    const env = {
      GOOGLE_CLIENT_ID: "id",
      ALLOWED_SUBS: "1182",
      SESSION_SECRET: SECRET,
      AGENT_BEARERS: "kit:crane-tok",
    };
    const queryOnly = await handshake({
      env,
      slug: "kit",
      role: "crane",
      queryBearer: "crane-tok",
    });
    expect(queryOnly).toEqual({ ok: false, error: "unauthorized" });
    const header = await handshake({
      env,
      slug: "kit",
      role: "crane",
      authorization: "Bearer crane-tok",
      queryBearer: "ignored",
    });
    expect(header).toEqual({ ok: true, principal: { kind: "agent", slug: "kit" } });
  });

  it("rejects the spike secret once Google is configured", async () => {
    const env = {
      GOOGLE_CLIENT_ID: "id",
      ALLOWED_SUBS: "1182",
      SESSION_SECRET: SECRET,
      AGENT_BEARERS: "kit:crane-tok",
      CHAT_SECRET: "shared",
    };
    const spike = await handshake({
      env,
      slug: "kit",
      role: "phone",
      authorization: "Bearer shared",
    });
    expect(spike).toEqual({ ok: false, error: "unauthorized" });
  });

  it("fails config when nothing is set, and stamps principals", async () => {
    const r = await handshake({ env: {}, slug: "kit", role: "phone" });
    expect(r).toEqual({ ok: false, error: "config" });
    expect(await handshake({
      env: { GOOGLE_CLIENT_ID: "id" },
      slug: "kit",
      role: "phone",
    })).toEqual({ ok: false, error: "config" });
    expect(roleFromQuery("phone")).toBe("phone");
    expect(roleFromQuery("crane")).toBe("crane");
    expect(roleFromQuery("agent")).toBe("crane");
    expect(roleFromQuery("nope")).toBeNull();
    expect(rateId("oidc", { kind: "phone", sub: "1182", exp: 1 })).toBe("sub:1182");
    expect(rateId("oidc", { kind: "agent", slug: "kit" })).toBe("bearer:kit");
    expect(rateId("spike", { kind: "spike", role: "phone" })).toBe("spike:phone");
    expect(stampUserId({ kind: "phone", sub: "1182" })).toBe("1182");
    expect(stampEmail({ kind: "phone", sub: "1182", email: "ada@x.com" })).toBe("ada@x.com");
    expect(stampEmail({ kind: "phone", sub: "1182" })).toBeUndefined();
    expect(stampUserId({ kind: "spike", role: "phone" })).toBe("spike");
    expect(stampUserId({ kind: "spike", role: "crane" })).toBeUndefined();
    expect(stampUserId({ kind: "agent", slug: "kit" })).toBeUndefined();
    expect(stampEmail({ kind: "agent", slug: "kit" })).toBeUndefined();
  });

  it("rejects the spike secret on a public host", async () => {
    const r = await handshake({
      env: { CHAT_SECRET: "shared" },
      slug: "kit",
      role: "phone",
      authorization: "Bearer shared",
      host: "gantree.example.workers.dev",
    });
    expect(r).toEqual({ ok: false, error: "config" });
  });

  it("treats a short session secret as no session", async () => {
    const r = await handshake({
      env: { GOOGLE_CLIENT_ID: "id", SESSION_SECRET: "short" },
      slug: "kit",
      role: "phone",
      cookieHeader: `${SESSION_COOKIE}=abc`,
    });
    expect(r).toEqual({ ok: false, error: "unauthorized" });
  });
});

describe("handshakeSlug", () => {
  it("accepts the spike secret without a role", async () => {
    const env = { CHAT_SECRET: "shared" };
    const ok = await handshakeSlug({ env, slug: "kit", querySecret: "shared" });
    expect(ok.ok && ok.principal.kind).toBe("spike");
    const bad = await handshakeSlug({ env, slug: "kit", querySecret: "nope" });
    expect(bad).toEqual({ ok: false, error: "unauthorized" });
  });

  it("accepts a phone cookie or a harness bearer", async () => {
    const env = {
      GOOGLE_CLIENT_ID: "id",
      ALLOWED_SUBS: "1182:ada@x.com",
      SESSION_SECRET: SECRET,
      AGENT_BEARERS: "kit:crane-tok",
    };
    const session = await token({ sub: "1182", email: "ada@x.com" });
    const phone = await handshakeSlug({
      env,
      slug: "kit",
      cookieHeader: `${SESSION_COOKIE}=${encodeURIComponent(session)}`,
      admit: admit("member"),
      now,
    });
    expect(phone.ok && phone.principal.kind === "phone" && phone.principal.sub).toBe("1182");
    expect(phone.ok && phone.principal.kind === "phone" && phone.principal.exp).toBeDefined();
    const crane = await handshakeSlug({
      env,
      slug: "kit",
      authorization: "Bearer crane-tok",
      now,
    });
    expect(crane).toEqual({ ok: true, principal: { kind: "agent", slug: "kit" } });
    const phoneHeader = await handshakeSlug({
      env,
      slug: "kit",
      authorization: `Bearer ${session}`,
      admit: admit("member"),
      now,
    });
    expect(phoneHeader.ok && phoneHeader.principal.kind === "phone" && phoneHeader.principal.sub).toBe("1182");
    const queryCrane = await handshakeSlug({
      env,
      slug: "kit",
      queryBearer: "crane-tok",
      now,
    });
    expect(queryCrane).toEqual({ ok: false, error: "unauthorized" });
  });

  it("does not try the harness bearer after a signed-in phone is refused the room", async () => {
    const env = {
      GOOGLE_CLIENT_ID: "id",
      SESSION_SECRET: SECRET,
      AGENT_BEARERS: "kit:crane-tok",
    };
    const session = await token({ sub: "1182", email: "ada@x.com" });
    const phone = await handshakeSlug({
      env,
      slug: "kit",
      cookieHeader: `${SESSION_COOKIE}=${encodeURIComponent(session)}`,
      authorization: "Bearer crane-tok",
      admit: admit("member"),
      now,
    });
    expect(phone).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("handshake room list", () => {
  const env = {
    GOOGLE_CLIENT_ID: "id",
    SESSION_SECRET: SECRET,
    AGENT_BEARERS: "kit:crane-tok",
  };
  const ada = "118212345678901234567";

  it("admits by room sub without ALLOWED_SUBS", async () => {
    const ok = await handshake({
      env,
      slug: "kit",
      role: "phone",
      cookieHeader: await cookie({ sub: ada, email: "ada@example.com" }),
      roomList: [{ sub: ada, email: "ada@example.com" }],
      admit: admit("member"),
      now,
    });
    expect(ok.ok && ok.principal.kind === "phone" && ok.principal.sub).toBe(ada);
  });

  it("admits by verified email on the room list", async () => {
    const ok = await handshake({
      env,
      slug: "kit",
      role: "phone",
      cookieHeader: await cookie({ sub: ada, email: "ada@example.com" }),
      roomList: [{ email: "ada@example.com" }],
      admit: admit("member"),
      now,
    });
    expect(ok.ok && ok.principal.kind === "phone" && ok.principal.sub).toBe(ada);
  });

  it("still admits a static ALLOWED_SUBS extra", async () => {
    const ok = await handshake({
      env: { ...env, ALLOWED_SUBS: ada },
      slug: "kit",
      role: "phone",
      cookieHeader: await cookie({ sub: ada, email: null }),
      roomList: [],
      admit: admit("member"),
      now,
    });
    expect(ok.ok && ok.principal.kind === "phone" && ok.principal.sub).toBe(ada);
  });

  it("fails closed with a valid session and no room list", async () => {
    const refused = await handshake({
      env,
      slug: "kit",
      role: "phone",
      cookieHeader: await cookie({ sub: ada, email: "ada@example.com" }),
      admit: admit("member"),
      now,
    });
    expect(refused).toEqual({ ok: false, error: "forbidden" });
  });

  it("admits an admin on an empty room list", async () => {
    const ok = await handshake({
      env,
      slug: "kit",
      role: "phone",
      cookieHeader: await cookie({ sub: ada, email: "ada@example.com" }),
      roomList: [],
      admit: admit("admin"),
      now,
    });
    expect(ok.ok && ok.principal.kind === "phone" && ok.principal.sub).toBe(ada);
  });

  it("does not admit GANTREE_ALLOW alone on an empty room list", async () => {
    const refused = await handshake({
      env: { ...env, GANTREE_ALLOW: ada },
      slug: "kit",
      role: "phone",
      cookieHeader: await cookie({ sub: ada, email: null }),
      roomList: [],
      admit: admit("member"),
      now,
    });
    expect(refused).toEqual({ ok: false, error: "forbidden" });
  });

  it("still forbids a stranger on an empty room when floor env is set", async () => {
    const refused = await handshake({
      env: { ...env, GANTREE_ADMINS: "boss@example.com", GANTREE_ALLOW: "member@example.com" },
      slug: "kit",
      role: "phone",
      cookieHeader: await cookie({ sub: ada, email: "ada@example.com" }),
      roomList: [],
      admit: admit("member"),
      now,
    });
    expect(refused).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("handshakePhone", () => {
  it("does not load the room when the session is missing", async () => {
    const env = {
      GOOGLE_CLIENT_ID: "id",
      SESSION_SECRET: SECRET,
      AGENT_BEARERS: "kit:crane-tok",
    };
    let loaded = false;
    const r = await handshakePhone({
      env,
      slug: "kit",
      loadRoom: async () => {
        loaded = true;
        return [];
      },
    });
    expect(r).toEqual({ ok: false, error: "unauthorized" });
    expect(loaded).toBe(false);
  });

  it("does not load the room for the spike secret", async () => {
    let loaded = false;
    const r = await handshakePhone({
      env: { CHAT_SECRET: "shared" },
      slug: "kit",
      authorization: "Bearer shared",
      loadRoom: async () => {
        loaded = true;
        return [];
      },
    });
    expect(r.ok && r.principal.kind).toBe("spike");
    expect(loaded).toBe(false);
  });

  it("loads the room after a session exists", async () => {
    const env = {
      GOOGLE_CLIENT_ID: "id",
      SESSION_SECRET: SECRET,
    };
    const ada = "118212345678901234567";
    let loaded = 0;
    const r = await handshakePhone({
      env,
      slug: "kit",
      cookieHeader: await cookie({ sub: ada, email: "ada@example.com" }),
      admit: admit("member"),
      now,
      loadRoom: async () => {
        loaded += 1;
        return [{ sub: ada }];
      },
    });
    expect(loaded).toBe(1);
    expect(r.ok && r.principal.kind === "phone" && r.principal.sub).toBe(ada);
  });

  it("is config when Google is on and the session secret is missing", async () => {
    const r = await handshakePhone({
      env: { GOOGLE_CLIENT_ID: "id" },
      slug: "kit",
      loadRoom: async () => [],
    });
    expect(r).toEqual({ ok: false, error: "config" });
  });
});
