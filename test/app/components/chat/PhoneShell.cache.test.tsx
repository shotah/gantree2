/** @vitest-environment jsdom */

// The on-device thread: IndexedDB is real here (fake-indexeddb), so hydrate,
// dedup, and the write path run for real. PhoneShell.test.tsx has no IndexedDB
// and covers everything else with the cache inert.

import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhoneShell } from "@/app/components/chat/PhoneShell";
import { blobCacheKey } from "@/app/lib/blobUrl";
import { kvDel } from "@/app/lib/kv";
import { loadThread, saveThread, threadCacheKey } from "@/app/lib/threadStore";
import { DEV_USER } from "@/app/lib/samples";
import { clearGeoCache } from "@/lib/phone/geo";

const KIT = threadCacheKey("kit", DEV_USER.sub);
const ADA = threadCacheKey("ada", DEV_USER.sub);

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function stubAuth(mode: "spike" | "oidc", cranes: string[] = ["kit"]) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("/api/auth/config")) {
      return mode === "spike"
        ? Response.json({ mode: "spike", google: false, dev: true })
        : Response.json({ mode: "oidc", google: true, dev: false });
    }
    if (url.includes("/api/auth/me")) {
      return Response.json({ sub: DEV_USER.sub, email: DEV_USER.email, cranes });
    }
    return new Response(null, { status: 404 });
  });
}

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];

  readonly url: string;
  readyState = FakeSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent<string>) => void) | null = null;
  send = vi.fn<(data: string) => void>();

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  close() {
    if (this.readyState === FakeSocket.CLOSED) {
      return;
    }
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.(new Event("close"));
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  deliver(data: string) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

function liveSocket() {
  const ws = FakeSocket.instances.at(-1);
  expect(ws).toBeTruthy();
  return ws as FakeSocket;
}

async function connectSpike() {
  stubAuth("spike");
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  render(<PhoneShell />);
  expect(await screen.findByText("live")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "settings" }));
  fireEvent.change(screen.getByLabelText("Agent access secret"), { target: { value: "s" } });
  fireEvent.click(screen.getByRole("button", { name: "settings" }));
  return liveSocket();
}

function listed() {
  return screen.getAllByRole("listitem").map((el) => el.textContent);
}

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeSocket.instances = [];
  clearGeoCache();
  await Promise.all([KIT, ADA, blobCacheKey("avatar", "kit"), blobCacheKey("avatar", "ada")].map((k) => kvDel(k)));
});

describe("PhoneShell thread on the device", () => {
  it("paints the last thread before the socket opens and acks from it", async () => {
    await saveThread(KIT, [
      { id: "old-in", from: "you", text: "last hatch", at: 10, seq: 1, kind: "inbound" },
      { id: "old-out", from: "kit", text: "latched", at: 20, seq: 2, kind: "reply" },
    ]);
    const ws = await connectSpike();
    expect(await screen.findByText("latched")).toBeTruthy();
    expect(listed()).toEqual(["last hatch", "latched"]);
    expect(ws.readyState).not.toBe(FakeSocket.OPEN);
    act(() => {
      ws.open();
    });
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ kind: "ack", since: "2", seen: true }));
  });

  it("folds replay under the cached bubbles and saves new turns", async () => {
    await saveThread(KIT, [
      { id: "old-in", from: "you", text: "last hatch", at: 10, seq: 1, kind: "inbound" },
    ]);
    const ws = await connectSpike();
    expect(await screen.findByText("last hatch")).toBeTruthy();
    act(() => {
      ws.open();
    });
    act(() => {
      ws.deliver(JSON.stringify({ id: "old-in", kind: "inbound", text: "last hatch", seq: 1, at: 10, replay: true }));
      ws.deliver(JSON.stringify({ id: "new-out", kind: "reply", text: "latched", seq: 2, at: 20 }));
    });
    expect(listed()).toEqual(["last hatch", "latched"]);
    await waitFor(async () => {
      expect((await loadThread(KIT)).map((m) => m.id)).toEqual(["old-in", "new-out"]);
    });
  });

  it("keeps a sending bubble off the device until the mailbox acks it", async () => {
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(id);
    await saveThread(KIT, [{ id: "seed", from: "kit", text: "earlier", at: 1, seq: 1, kind: "reply" }]);
    const ws = await connectSpike();
    expect(await screen.findByText("earlier")).toBeTruthy();
    act(() => {
      ws.open();
    });
    fireEvent.change(screen.getByPlaceholderText(/Message Kit/), { target: { value: "hello kit" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("hello kit")).toBeTruthy();
    expect(screen.getByText("sending")).toBeTruthy();
    expect((await loadThread(KIT)).map((m) => m.id)).toEqual(["seed"]);
    act(() => {
      ws.deliver(JSON.stringify({ kind: "ack", id }));
    });
    expect(screen.queryByText("sending")).toBeNull();
    await waitFor(async () => {
      expect((await loadThread(KIT)).map((m) => m.id)).toEqual(["seed", id]);
    });
  });

  it("does not save Kit's draft", async () => {
    await saveThread(KIT, [{ id: "seed", from: "kit", text: "earlier", at: 1, seq: 1, kind: "reply" }]);
    const ws = await connectSpike();
    expect(await screen.findByText("earlier")).toBeTruthy();
    act(() => {
      ws.open();
    });
    act(() => {
      ws.deliver(JSON.stringify({ kind: "draft", user_id: DEV_USER.sub, text: "⏳ spinning up" }));
    });
    expect(await screen.findByText("⏳ spinning up")).toBeTruthy();
    expect((await loadThread(KIT)).map((m) => m.id)).toEqual(["seed"]);
  });

  it("drops the thread on a room switch and never files it under the new room", async () => {
    stubAuth("oidc", ["kit", "ada"]);
    FakeSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeSocket);
    render(<PhoneShell />);
    await waitFor(() => {
      expect(FakeSocket.instances.some((s) => s.url.includes("/ws/kit"))).toBe(true);
    });
    const ws = liveSocket();
    act(() => {
      ws.open();
    });
    act(() => {
      ws.deliver(JSON.stringify({ id: "k1", kind: "reply", text: "kit says hi", seq: 1, at: 10 }));
    });
    expect(await screen.findByText("kit says hi")).toBeTruthy();
    await waitFor(async () => {
      expect((await loadThread(KIT)).map((m) => m.id)).toEqual(["k1"]);
    });
    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "ada" } });
    await waitFor(() => {
      expect(screen.queryByText("kit says hi")).toBeNull();
    });
    await waitFor(() => {
      expect(FakeSocket.instances.some((s) => s.url.includes("/ws/ada"))).toBe(true);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(await loadThread(ADA)).toEqual([]);
    expect((await loadThread(KIT)).map((m) => m.id)).toEqual(["k1"]);
  });
});
