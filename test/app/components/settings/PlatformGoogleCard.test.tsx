/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformGoogleCard, platformGoogleDraftError } from "@/app/components/settings/PlatformGoogleCard";

const loaded = {
  google: {
    clientId: "964653715043-abc.apps.googleusercontent.com",
    secretSet: true,
    idFromDeploy: true,
    secretFromDeploy: true,
  },
};

afterEach(() => {
  cleanup();
});

function client(onPatch?: (body: string) => void) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/platform/keys") && init?.method === "PATCH") {
      onPatch?.(typeof init.body === "string" ? init.body : "");
      return new Response(JSON.stringify({ google: { ...loaded.google, idFromDeploy: false } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(loaded), { status: 200, headers: { "content-type": "application/json" } });
  });
}

describe("platformGoogleDraftError", () => {
  it("accepts a Google client id and rejects a lookalike", () => {
    expect(platformGoogleDraftError({ clientId: "964653715043-abc.apps.googleusercontent.com" })).toBeNull();
    expect(platformGoogleDraftError({ clientId: "not-a-client" })).toMatch(/apps\.googleusercontent\.com/);
    expect(platformGoogleDraftError({ clientId: "" })).toBeNull();
    expect(platformGoogleDraftError({ clientSecret: "GOCSPX-abcdefgh" })).toBeNull();
    expect(platformGoogleDraftError({ clientSecret: "short" })).toMatch(/no spaces/);
  });
});

describe("PlatformGoogleCard", () => {
  it("asks before saving and names the Cloudflare screen", async () => {
    const patches: string[] = [];
    render(<PlatformGoogleCard client={client((body) => patches.push(body))} />);
    const id = await screen.findByLabelText("Google client id");
    fireEvent.change(id, { target: { value: "not-a-client" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toMatch(/apps\.googleusercontent\.com/);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(patches).toEqual([]);

    fireEvent.change(id, { target: { value: "111-abc.apps.googleusercontent.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const dialog = screen.getByRole("dialog", { name: "Change Google sign-in?" });
    expect(dialog.textContent).toContain("locks everyone out");
    expect(dialog.textContent).toContain("Workers & Pages → gantree2 → Settings → Runtime variables and secrets");
    expect(dialog.textContent).toContain("GOOGLE_CLIENT_ID");
    expect(dialog.textContent).toContain("GOOGLE_CLIENT_SECRET");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(patches).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm you want to make these changes" }));
    await waitFor(() => expect(patches).toEqual([JSON.stringify({ clientId: "111-abc.apps.googleusercontent.com" })]));
  });
});
