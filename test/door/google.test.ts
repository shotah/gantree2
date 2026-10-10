import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { authorizeUrl, exchangeCode, pkceChallenge, redirectUri, verifyIdToken } from "@/lib/door/google";

const CLIENT = "123-abc.apps.googleusercontent.com";

async function signedIdToken(claims: Record<string, unknown>, aud = CLIENT, iss = "https://accounts.google.com") {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return { token, publicKey, jwk };
}

describe("authorizeUrl", () => {
  it("is Google, code flow, PKCE S256, our redirect, state and nonce", async () => {
    const u = new URL(await authorizeUrl({ clientId: CLIENT, origin: "https://g.test", state: "st", nonce: "no", verifier: "ver" }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("client_id")).toBe(CLIENT);
    expect(u.searchParams.get("redirect_uri")).toBe("https://g.test/api/auth/callback/google");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("openid email profile");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("nonce")).toBe("no");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBe(await pkceChallenge("ver"));
    expect(redirectUri("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000/api/auth/callback/google");
  });
});

describe("exchangeCode", () => {
  it("posts the form and returns the id_token", async () => {
    let seen: { url: string; body: string } | null = null;
    const fetchFn: typeof fetch = async (input, init) => {
      seen = { url: String(input), body: String(init?.body) };
      return new Response(JSON.stringify({ id_token: "idt" }), { status: 200 });
    };
    const got = await exchangeCode({
      env: { GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: "sec" },
      origin: "https://g.test",
      code: "c0de",
      verifier: "ver",
      fetchFn,
    });
    expect(got).toEqual({ ok: true, idToken: "idt" });
    const body = new URLSearchParams(seen!.body);
    expect(seen!.url).toBe("https://oauth2.googleapis.com/token");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("c0de");
    expect(body.get("code_verifier")).toBe("ver");
    expect(body.get("redirect_uri")).toBe("https://g.test/api/auth/callback/google");
  });

  it("fails without a client, on a non-200, and on a body without id_token", async () => {
    expect((await exchangeCode({ env: {}, origin: "https://g.test", code: "c", verifier: "v" })).ok).toBe(false);
    const bad: typeof fetch = async () => new Response("nope", { status: 400 });
    expect((await exchangeCode({ env: { GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: "s" }, origin: "https://g.test", code: "c", verifier: "v", fetchFn: bad })).ok).toBe(false);
    const empty: typeof fetch = async () => new Response("{}", { status: 200 });
    expect((await exchangeCode({ env: { GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: "s" }, origin: "https://g.test", code: "c", verifier: "v", fetchFn: empty })).ok).toBe(false);
  });
});

describe("verifyIdToken", () => {
  it("accepts a good token and lowercases email", async () => {
    const { token, publicKey } = await signedIdToken({ sub: "118212345678901234567", email: "Ada@Example.com", email_verified: true, nonce: "n1" });
    const got = await verifyIdToken({ idToken: token, clientId: CLIENT, nonce: "n1", key: publicKey });
    expect(got).toEqual({ ok: true, who: { sub: "118212345678901234567", email: "ada@example.com", emailVerified: true } });
  });

  it("refuses wrong nonce, wrong audience, wrong issuer, unverified email stays unverified", async () => {
    const good = await signedIdToken({ sub: "1", email: "a@b.co", email_verified: true, nonce: "n1" });
    expect((await verifyIdToken({ idToken: good.token, clientId: CLIENT, nonce: "other", key: good.publicKey })).ok).toBe(false);

    const aud = await signedIdToken({ sub: "1", nonce: "n1" }, "someone-else");
    expect((await verifyIdToken({ idToken: aud.token, clientId: CLIENT, nonce: "n1", key: aud.publicKey })).ok).toBe(false);

    const iss = await signedIdToken({ sub: "1", nonce: "n1" }, CLIENT, "https://evil.test");
    expect((await verifyIdToken({ idToken: iss.token, clientId: CLIENT, nonce: "n1", key: iss.publicKey })).ok).toBe(false);

    const unverified = await signedIdToken({ sub: "1", email: "a@b.co", email_verified: false, nonce: "n1" });
    const got = await verifyIdToken({ idToken: unverified.token, clientId: CLIENT, nonce: "n1", key: unverified.publicKey });
    expect(got.ok && got.who.emailVerified).toBe(false);
  });
});
