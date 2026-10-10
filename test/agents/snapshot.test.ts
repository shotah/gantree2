import { describe, expect, it } from "vitest";
import {
  archiveLatest,
  isSnapshotFile,
  latestKey,
  MAX_SNAPSHOT_BYTES,
  mintSnapshotKey,
  readSnapshot,
  signedSnapshotUrls,
  signSnapshot,
  SNAPSHOT_FILES,
  SNAPSHOT_TTL_MS,
  snapshotCanonical,
  snapshotKeyOk,
  snapshotTooBig,
  stampedKey,
  type SnapshotStore,
  verifySnapshot,
  writeSnapshot,
} from "@/lib/agents/snapshot";

const bearer = "room-secret";
const now = 1_700_000_000_000;
const exp = now + 60_000;

class MemR2 implements SnapshotStore {
  objects = new Map<string, Uint8Array>();
  fail = false;

  get(key: string) {
    const hit = this.objects.get(key);
    if (!hit) {
      return Promise.resolve(null);
    }
    const copy = hit.slice();
    return Promise.resolve({
      arrayBuffer: () => Promise.resolve(copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength)),
    });
  }

  put(key: string, value: ArrayBuffer | ArrayBufferView) {
    if (this.fail) {
      throw new Error("r2");
    }
    const bytes = value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    this.objects.set(key, bytes.slice());
    return Promise.resolve();
  }
}

describe("snapshot urls", () => {
  it("signs and verifies the canonical string", async () => {
    expect(snapshotCanonical("kit", "gantry_db", "GET", String(exp))).toBe(`kit|gantry_db|GET|${exp}`);
    const sig = await signSnapshot(bearer, "kit", "gantry_db", "GET", exp);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifySnapshot(bearer, "kit", "gantry_db", "GET", String(exp), sig, now)).toBe(true);
    expect(await verifySnapshot(bearer, "kit", "gantry_db", "GET", String(exp), sig.toUpperCase(), now)).toBe(true);
    expect(await verifySnapshot(bearer, "kit", "gantry_db", "PUT", String(exp), sig, now)).toBe(false);
    expect(await verifySnapshot("other", "kit", "gantry_db", "GET", String(exp), sig, now)).toBe(false);
    expect(await verifySnapshot(bearer, "kit", "gantry_db", "GET", String(exp), "ab", now)).toBe(false);
    expect(await verifySnapshot(bearer, "kit", "nope", "GET", String(exp), sig, now)).toBe(false);
    expect(await verifySnapshot(bearer, "Kit", "gantry_db", "GET", String(exp), sig, now)).toBe(false);
    expect(await verifySnapshot("", "kit", "gantry_db", "GET", String(exp), sig, now)).toBe(false);
    expect(await verifySnapshot(bearer, "kit", "gantry_db", "GET", String(exp), sig, exp)).toBe(false);
    expect(await verifySnapshot(bearer, "kit", "gantry_db", "GET", String(exp), sig, exp - SNAPSHOT_TTL_MS - 1)).toBe(false);
    expect(await verifySnapshot(bearer, "kit", "gantry_db", "GET", "15", sig, now)).toBe(false);
    expect(await verifySnapshot(bearer, "kit", "gantry_db", "POST", String(exp), sig, now)).toBe(false);
    const edge = now + SNAPSHOT_TTL_MS;
    const edgeSig = await signSnapshot(bearer, "kit", "self_md", "PUT", edge);
    expect(await verifySnapshot(bearer, "kit", "self_md", "PUT", String(edge), edgeSig, now)).toBe(true);
  });

  it("mints restore GET and put PUT urls for each snapshot file", async () => {
    expect(SNAPSHOT_FILES).toEqual(["gantry_db", "self_md", "tokens_tar"]);
    expect(isSnapshotFile("tokens_tar")).toBe(true);
    const urls = await signedSnapshotUrls({ origin: "https://gantree.test", slug: "kit", bearer, exp });
    if (!urls) {
      throw new Error("urls");
    }
    const getDb = new URL(urls.restore.gantry_db);
    const putSelf = new URL(urls.put.self_md);
    const putTokens = new URL(urls.put.tokens_tar);
    expect(getDb.origin).toBe("https://gantree.test");
    expect(getDb.pathname).toBe("/api/agents/kit/snapshot/gantry_db");
    expect(putTokens.pathname).toBe("/api/agents/kit/snapshot/tokens_tar");
    expect(await verifySnapshot(bearer, "kit", "gantry_db", "GET", getDb.searchParams.get("exp") ?? "", getDb.searchParams.get("sig") ?? "", now)).toBe(true);
    expect(await verifySnapshot(bearer, "kit", "self_md", "PUT", putSelf.searchParams.get("exp") ?? "", putSelf.searchParams.get("sig") ?? "", now)).toBe(true);
    expect(await verifySnapshot(bearer, "kit", "tokens_tar", "PUT", putTokens.searchParams.get("exp") ?? "", putTokens.searchParams.get("sig") ?? "", now)).toBe(true);
    const key = mintSnapshotKey();
    expect(snapshotKeyOk(key)).toBe(true);
    expect(key).not.toBe(mintSnapshotKey());
    expect(snapshotKeyOk("aaaa")).toBe(false);
    expect(await signedSnapshotUrls({ origin: "https://gantree.test", slug: "kit", bearer: "", exp })).toBeNull();
    expect(await signedSnapshotUrls({ origin: "https://gantree.test", slug: "NO", bearer, exp })).toBeNull();
    expect(await signedSnapshotUrls({ origin: "https://gantree.test", slug: "kit", bearer, exp: 1.5 })).toBeNull();
  });
});

describe("snapshot objects", () => {
  it("writes latest and an optional stamp, then copies latest on archive", async () => {
    const store = new MemR2();
    const body = new TextEncoder().encode("db").buffer;
    await writeSnapshot(store, "kit", "gantry_db", body, "20261010T120000Z");
    await writeSnapshot(store, "kit", "self_md", new TextEncoder().encode("me").buffer);
    await writeSnapshot(store, "kit", "tokens_tar", new Uint8Array([9]).buffer);
    expect(store.objects.has(latestKey("kit", "gantry_db"))).toBe(true);
    expect(store.objects.has(stampedKey("kit", "20261010T120000Z", "gantry_db"))).toBe(true);
    expect(store.objects.has(stampedKey("kit", "20261010T120000Z", "self_md"))).toBe(false);
    expect(new TextDecoder().decode(await readSnapshot(store, "kit", "gantry_db") ?? new ArrayBuffer())).toBe("db");
    expect(new TextDecoder().decode(await readSnapshot(store, "kit", "gantry_db", "20261010T120000Z") ?? new ArrayBuffer())).toBe("db");
    expect(await readSnapshot(store, "kit", "self_md", "20261010T120000Z")).toBeNull();
    await archiveLatest(store, "kit", "20261010T120000Z");
    expect(new TextDecoder().decode(store.objects.get(stampedKey("kit", "20261010T120000Z", "self_md")) ?? new Uint8Array())).toBe("me");
    expect(store.objects.get(stampedKey("kit", "20261010T120000Z", "tokens_tar"))).toEqual(new Uint8Array([9]));
    await archiveLatest(store, "kit", "not-a-stamp");
    await archiveLatest(store, "Nope", "20261010T120000Z");
    expect(snapshotTooBig(1)).toBe(false);
    expect(snapshotTooBig(MAX_SNAPSHOT_BYTES + 1)).toBe(true);
    expect(snapshotTooBig(4, 3)).toBe(true);
  });
});
