import { describe, expect, it } from "vitest";
import { applyEmoji, emojiCatalog, emojiForShortcode, searchEmoji } from "@/app/lib/emoji";

describe("emoji shortcodes", () => {
  it("resolves colon names and aliases", () => {
    expect(emojiForShortcode("shrug")).toBe("🤷");
    expect(emojiForShortcode("person_shrugging")).toBe("🤷");
    expect(emojiForShortcode("+1")).toBe("👍");
    expect(emojiForShortcode("thumbs-up")).toBe("👍");
    expect(emojiForShortcode("nope")).toBeUndefined();
  });

  it("converts a finished :name: and leaves unknown codes", () => {
    const next = applyEmoji("well :shrug: ok", 13, "type");
    expect(next.text).toBe("well 🤷 ok");
    expect(next.cursor).toBe(8);

    expect(applyEmoji("see :notacode: later", 18, "type").text).toBe("see :notacode: later");
    expect(applyEmoji("https://example.com", 19, "type").text).toBe("https://example.com");
  });

  it("converts :D when the token is finished, and on send", () => {
    expect(applyEmoji("yo :D", 5, "type").text).toBe("yo :D");
    expect(applyEmoji("yo :D ", 6, "type").text).toBe("yo 😀 ");
    expect(applyEmoji("yo :D", 5, "send").text).toBe("yo 😀");
    expect(applyEmoji(":D!", 3, "type").text).toBe("😀!");
    expect(applyEmoji("wow :dog:", 9, "type").text).toBe("wow 🐶");
  });

  it("converts closed faces immediately and keeps a mid-word colon", () => {
    expect(applyEmoji("hi :)", 5, "type").text).toBe("hi 😊");
    expect(applyEmoji("see:(", 6, "type").text).toBe("see:(");
    expect(applyEmoji("xD ", 3, "type").text).toBe("😆 ");
  });

  it("parks the caret after a replacement that contains it", () => {
    const next = applyEmoji(":shrug:", 4, "type");
    expect(next.text).toBe("🤷");
    expect(next.cursor).toBe(next.text.length);
  });

  it("filters the picker catalog", () => {
    const idle = searchEmoji("");
    expect(idle.some((e) => e.name === "shrug")).toBe(true);
    expect(idle.some((e) => e.name === "sunny")).toBe(true);
    expect(idle.length).toBe(44);
    expect(idle.length).toBeLessThan(emojiCatalog.length);
    expect(searchEmoji(":fire").map((e) => e.name)).toEqual(["fire"]);
    expect(searchEmoji("no-such-face")).toEqual([]);
    const names = emojiCatalog.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
