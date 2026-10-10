/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KitAvatar } from "@/app/components/chat/KitAvatar";
import { copyImageElement, downloadImage, uploadAvatarFile } from "@/app/lib/avatar";

vi.mock("@/app/lib/avatar", () => ({
  uploadAvatarFile: vi.fn(),
  copyImageElement: vi.fn(),
  downloadImage: vi.fn(),
}));

vi.mock("@/app/lib/blobUrl", () => ({
  blobCacheKey: () => "look:avatar:kit",
  useBlobUrl: () => "blob:face",
}));

const upload = vi.mocked(uploadAvatarFile);
const copy = vi.mocked(copyImageElement);
const download = vi.mocked(downloadImage);

beforeEach(() => {
  upload.mockReset();
  copy.mockReset();
  download.mockReset();
});

afterEach(() => {
  cleanup();
});

function pngFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
}

describe("KitAvatar", () => {
  it("stays a picture until the face can be edited", () => {
    const { container } = render(<KitAvatar slug="kit" rev={1} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:face");
    expect(screen.queryByRole("button", { name: "Kit's photo" })).toBeNull();
  });

  it("opens a sheet to copy, download, or replace the photo", async () => {
    const onRev = vi.fn();
    const onError = vi.fn();
    render(<KitAvatar slug="ada" rev={2} secret="s" editable onRev={onRev} onError={onError} />);

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ada's photo" }));
    expect(screen.getByRole("dialog", { name: "Ada's photo" })).toBeTruthy();
    expect(screen.getByText("Ada's photo")).toBeTruthy();

    copy.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    expect(copy).toHaveBeenCalledWith(expect.any(HTMLImageElement));

    download.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(download).toHaveBeenCalledWith("/api/chat/avatar?slug=ada&v=2&secret=s", "ada"));

    upload.mockResolvedValue({ ok: true, rev: 9 });
    fireEvent.click(screen.getByRole("button", { name: "Upload photo" }));
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile()] } });
    await waitFor(() => expect(onRev).toHaveBeenCalledWith(9));
    const uploaded = upload.mock.calls[0]?.[0];
    expect(uploaded?.slug).toBe("ada");
    expect(uploaded?.file).toBeInstanceOf(File);
    expect(uploaded?.secret).toBe("s");
    expect(uploaded?.bearer).toBeUndefined();
    expect(onError).toHaveBeenCalledWith("");
    expect(screen.getByRole("dialog", { name: "Ada's photo" })).toBeTruthy();
  });

  it("keeps a failed upload in the sheet", async () => {
    const onError = vi.fn();
    render(<KitAvatar slug="kit" rev={1} editable onError={onError} />);
    fireEvent.click(screen.getByRole("button", { name: "Kit's photo" }));
    upload.mockResolvedValue({ ok: false, error: "need a JPEG" });
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile()] } });
    expect((await screen.findByRole("alert")).textContent).toBe("need a JPEG");
    expect(onError).toHaveBeenCalledWith("need a JPEG");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("says when copy fails and closes on Escape or the scrim", async () => {
    render(<KitAvatar slug="kit" rev={1} editable />);
    fireEvent.click(screen.getByRole("button", { name: "Kit's photo" }));
    copy.mockRejectedValue(new Error("could not copy that image"));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect((await screen.findByRole("alert")).textContent).toBe("could not copy that image");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Kit's photo" }));
    fireEvent.click(screen.getByTestId("avatar-scrim"));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Kit's photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Close photo" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Kit's photo" }));
    download.mockRejectedValue(new Error("nope"));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect((await screen.findByRole("alert")).textContent).toBe("could not download that image");
  });
});
