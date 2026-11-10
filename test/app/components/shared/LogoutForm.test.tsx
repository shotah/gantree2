/** @vitest-environment jsdom */

import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogoutForm } from "@/app/components/shared/LogoutForm";
import { blobCacheKey } from "@/app/lib/blobUrl";
import { kvClear, kvGet, kvSet } from "@/app/lib/kv";
import { threadCacheKey } from "@/app/lib/threadStore";

const threadKey = threadCacheKey("kit", "1182");
const avatarKey = blobCacheKey("avatar", "kit");
const backdropKey = blobCacheKey("backdrop", "kit");

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.removeItem("gantree.theme");
  await kvClear();
});

function renderLogout() {
  render(
    <LogoutForm>
      <button type="submit" className="text-xs text-dim underline">sign out</button>
    </LogoutForm>,
  );
  const form = screen.getByRole("button", { name: "sign out" }).closest("form");
  if (!form) {
    throw new Error("logout form missing");
  }
  return form;
}

describe("LogoutForm", () => {
  it("clears cached threads and images, then posts", async () => {
    await kvSet(threadKey, [{ id: "a", from: "you", text: "the hatch", at: 10 }]);
    await kvSet(avatarKey, { rev: 3, type: "image/jpeg", bytes: new Uint8Array([1, 2, 3]).buffer });
    await kvSet(backdropKey, { rev: 4, type: "image/jpeg", bytes: new Uint8Array([4]).buffer });
    window.localStorage.setItem("gantree.theme", "night");
    const order: string[] = [];
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {
      order.push("submit");
    });
    const form = renderLogout();
    expect(form.getAttribute("action")).toBe("/api/auth/logout");
    expect(form.getAttribute("method")).toBe("post");
    const spy = vi.spyOn(IDBObjectStore.prototype, "clear");
    spy.mockImplementation(function (this: IDBObjectStore) {
      order.push("clear");
      spy.mockRestore();
      return this.clear();
    });
    fireEvent.click(screen.getByRole("button", { name: "sign out" }));
    await waitFor(() => expect(order).toEqual(["clear", "submit"]));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(await kvGet(threadKey)).toBeUndefined();
    expect(await kvGet(avatarKey)).toBeUndefined();
    expect(await kvGet(backdropKey)).toBeUndefined();
    expect(window.localStorage.getItem("gantree.theme")).toBe("night");
  });

  it("still posts when the clear rejects", async () => {
    await kvSet(threadKey, [{ id: "a", from: "you", text: "stay", at: 10 }]);
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
    vi.spyOn(IDBObjectStore.prototype, "clear").mockImplementation(() => {
      throw new Error("idb");
    });
    renderLogout();
    fireEvent.click(screen.getByRole("button", { name: "sign out" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(await kvGet(threadKey)).toEqual([{ id: "a", from: "you", text: "stay", at: 10 }]);
  });
});
