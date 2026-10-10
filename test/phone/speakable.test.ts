import { describe, expect, it } from "vitest";
import { clipForSpeech, SPEAK_BYTES_MAX, speakable } from "@/lib/phone/speakable";

describe("speakable", () => {
  it("drops asterisks, underscores, and heading marks but keeps the words", () => {
    expect(speakable("**Bold** and *soft* and _also soft_")).toBe("Bold and soft and also soft");
    expect(speakable("## Tonight\nRain after 8.")).toBe("Tonight\nRain after 8.");
    expect(speakable("~~not this~~ this")).toBe("not this this");
  });

  it("reads inline code as its text and a fenced block as the word code", () => {
    expect(speakable("Run `npm test` first.")).toBe("Run npm test first.");
    expect(speakable("Here you go:\n\n```sh\nnpm run dev\n```\n\nThen open it.")).toBe("Here you go:\ncode\nThen open it.");
  });

  it("says photo for an image and only the label for a link", () => {
    expect(speakable("![the hatch](data:image/jpeg;base64,/9j/)")).toBe("photo");
    expect(speakable("See [the map](https://maps.example/x) now")).toBe("See the map now");
  });

  it("flattens lists to one line per item and drops tables, rules, and raw HTML", () => {
    expect(speakable("- milk\n- eggs\n\n1. first\n2. second")).toBe("milk\neggs\nfirst\nsecond");
    expect(speakable("Before\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n---\n\n<br>\n\nAfter")).toBe("Before\nAfter");
  });

  it("drops emoji and their joiners so the reader does not name them", () => {
    expect(speakable("On my way 🚗💨 see you soon ❤️")).toBe("On my way see you soon");
    expect(speakable("👍🏽 done")).toBe("done");
    expect(speakable("👩‍👩‍👧 family night")).toBe("family night");
  });

  it("returns empty for blank or markdown-only input", () => {
    expect(speakable("")).toBe("");
    expect(speakable("   \n")).toBe("");
    expect(speakable("---")).toBe("");
    expect(speakable("```\nx\n```")).toBe("code");
  });

  it("keeps plain prose untouched apart from whitespace", () => {
    expect(speakable("Sure.  It's   about ten minutes out.")).toBe("Sure. It's about ten minutes out.");
  });
});

describe("clipForSpeech", () => {
  it("returns short text as is", () => {
    expect(clipForSpeech("Hi there.")).toBe("Hi there.");
  });

  it("cuts on a sentence boundary under the cap", () => {
    const sentence = "This is a sentence that goes on for a bit. ";
    const long = sentence.repeat(200);
    const clipped = clipForSpeech(long, 500);
    expect(new TextEncoder().encode(clipped).byteLength).toBeLessThanOrEqual(500);
    expect(clipped.endsWith("bit.")).toBe(true);
    expect(clipped.length).toBeGreaterThan(400);
  });

  it("hard-cuts a single oversize sentence without splitting a code point", () => {
    const run = "é".repeat(3000);
    const clipped = clipForSpeech(run, 101);
    expect(new TextEncoder().encode(clipped).byteLength).toBeLessThanOrEqual(101);
    expect(clipped.includes("\uFFFD")).toBe(false);
    expect(clipped.length).toBe(50);
  });

  it("defaults to the Chirp budget", () => {
    const long = "word ".repeat(2000);
    expect(new TextEncoder().encode(clipForSpeech(long)).byteLength).toBeLessThanOrEqual(SPEAK_BYTES_MAX);
  });
});
