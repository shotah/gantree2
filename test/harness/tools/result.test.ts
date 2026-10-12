import { describe, expect, it } from "vitest";
import { type ToolResult } from "@/harness/core/tools";
import { modelView } from "@/harness/tools/result";

describe("modelView", () => {
  it("joins text and leaves image bytes out of the prompt", () => {
    const result: ToolResult = {
      content: [
        { type: "text", text: "{\"prompt\":\"red bike\",\"bytes\":8}" },
        { type: "image", data: "iVBOR", mimeType: "image/png" },
      ],
    };
    const delivered = modelView(result, "photo_generate");
    expect(delivered.text).toBe("{\"prompt\":\"red bike\",\"bytes\":8}\n[image] 1 picture(s) delivered to chat");
    expect(delivered.text).not.toContain("iVBOR");
    expect(delivered.images).toEqual(["data:image/png;base64,iVBOR"]);

    const avatar = modelView(result, "avatar_get");
    expect(avatar.text).toBe("{\"prompt\":\"red bike\",\"bytes\":8}");
    expect(avatar.images).toEqual([]);
  });

  it("names an image-only result without dumping the blob", () => {
    const result: ToolResult = { content: [{ type: "image", data: "AQID", mimeType: "image/png" }] };
    expect(modelView(result, "photo_edit").text).toContain("delivered to chat");
    expect(modelView(result, "avatar_get").text).toBe("[image] 1 picture(s)");
  });

  it("skips blank text", () => {
    expect(modelView({ content: [{ type: "text", text: "  \n" }] }, "echo").text).toBe("");
  });
});
