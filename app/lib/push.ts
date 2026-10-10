import { vapidPublicKeyBytes } from "@/lib/chat/push/vapid";
import {
  parsePushTestCounts,
  PushRegister,
  PushTestFail,
  sameServerKey,
  type PushRegisterResult,
  type PushTestResult,
} from "@/lib/phone/pushState";
import { notifyPermission } from "./notify";

/**
 * Register this browser for lock-screen push in `slug`. A subscription the
 * browser still holds for an older VAPID key is dropped and made again —
 * otherwise the Worker's sends are refused forever and nobody hears it.
 */
export async function browserRegisterPush(slug: string): Promise<PushRegisterResult> {
  if (!slug) {
    return PushRegister.Rejected;
  }
  if (notifyPermission() !== "granted") {
    return PushRegister.NoPermission;
  }
  if (typeof navigator === "undefined" || !navigator.serviceWorker) {
    return PushRegister.NoPushApi;
  }
  if (typeof PushManager === "undefined") {
    return PushRegister.NoPushApi;
  }
  try {
    const keyRes = await fetch("/api/chat/push", { credentials: "include" });
    if (keyRes.status === 404) {
      return PushRegister.NoVapid;
    }
    if (keyRes.status === 401 || keyRes.status === 403) {
      return PushRegister.Unauthorized;
    }
    if (!keyRes.ok) {
      return PushRegister.Failed;
    }
    const json: unknown = await keyRes.json();
    const publicKey = json && typeof json === "object" && "publicKey" in json
      && typeof json.publicKey === "string"
      ? json.publicKey
      : "";
    const bytes = vapidPublicKeyBytes(publicKey);
    if (!bytes) {
      return PushRegister.NoVapid;
    }
    const applicationServerKey = new Uint8Array(bytes.byteLength);
    applicationServerKey.set(bytes);
    const reg = await navigator.serviceWorker.ready;
    if (!reg.pushManager) {
      return PushRegister.NoPushApi;
    }
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameServerKey(sub.options?.applicationServerKey, applicationServerKey)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    const put = await fetch("/api/chat/push", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, subscription: sub.toJSON() }),
    });
    if (put.ok) {
      return PushRegister.Ok;
    }
    if (put.status === 401 || put.status === 403) {
      return PushRegister.Unauthorized;
    }
    return put.status === 404 ? PushRegister.NoVapid : PushRegister.Rejected;
  } catch {
    return PushRegister.Failed;
  }
}

/** Ask the Worker to push a real test card to every subscription it holds for you in `slug`. */
export async function browserTestPush(slug: string): Promise<PushTestResult> {
  if (!slug) {
    return PushTestFail.Failed;
  }
  try {
    const res = await fetch("/api/chat/push", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    if (res.status === 404) {
      return PushTestFail.NoVapid;
    }
    if (res.status === 401 || res.status === 403) {
      return PushTestFail.Unauthorized;
    }
    if (!res.ok) {
      return PushTestFail.Failed;
    }
    return parsePushTestCounts(await res.json()) ?? PushTestFail.Failed;
  } catch {
    return PushTestFail.Failed;
  }
}
