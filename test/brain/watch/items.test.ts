import { describe, expect, it } from "vitest";
import { MAX_SEEN_IDS, diffNew, formatItems, mergeSeen, parseItems, type Item } from "@/brain/watch";

function item(id: string, extra: Partial<Item> = {}): Item {
  return { id, title: "", url: "", text: "", ...extra };
}

describe("parseItems", () => {
  it("accepts the fetch shapes and drops rows without an id", () => {
    const items = parseItems(`{"items":[{"id":"a","title":"One","url":"https://x"}]}`);
    expect(items).toEqual([item("a", { title: "One", url: "https://x" })]);

    const fromArray = parseItems(`[{"guid":"g1","link":"https://y"}]`);
    expect(fromArray).toEqual([item("g1", { url: "https://y" })]);

    const numeric = parseItems(`{"entries":[{"id":1,"title":"n"}]}`);
    expect(numeric?.[0]?.id).toBe("1");

    expect(parseItems(`{"items":[{"title":"no id"}]}`)).toEqual([]);
    expect(() => parseItems("not json")).toThrow(/not JSON/);
    expect(() => parseItems(`{"foo":1}`)).toThrow(/no items array/);
    expect(parseItems("")).toBeNull();

    const tweets = parseItems(`{"tweets":[{"id":"t1","text":"hi"}]}`);
    expect(tweets?.[0]?.id).toBe("t1");

    const urlId = parseItems(`{"data":[{"url":"https://only-id"}]}`);
    expect(urlId?.[0]?.id).toBe("https://only-id");

    expect(() => parseItems(`{"items":"nope"}`)).toThrow(/not an array/);
  });

  it("reports JSON cut off by a truncated tool result", () => {
    const raw = `{"items":[{"id":"a","summary":"hello` + "\n…[truncated]";
    expect(() => parseItems(raw)).toThrow(/truncated mid-JSON/);
  });
});

describe("diffNew and mergeSeen", () => {
  it("drops seen ids, dedupes, and keeps the last cap", () => {
    const fresh = diffNew([item("a"), item("b")], ["a"]);
    expect(fresh.map((it) => it.id)).toEqual(["b"]);

    const merged = mergeSeen(["a", "", "a"], [item("a"), item(""), item("b"), item("c")]);
    expect(merged).toEqual(["a", "b", "c"]);

    const many = Array.from({ length: MAX_SEEN_IDS + 5 }, (_, i) => item(`id-${i}`));
    const got = mergeSeen([], many);
    expect(got).toHaveLength(MAX_SEEN_IDS);
    expect(got[0]).toBe("id-5");
    expect(got[got.length - 1]).toBe(`id-${MAX_SEEN_IDS + 4}`);
  });
});

describe("formatItems", () => {
  it("prints id, title, and a truncated body", () => {
    const formatted = formatItems([item("1", { title: "Hi", url: "https://x", text: "body" })]);
    expect(formatted).toContain("id=1");
    expect(formatted).toContain("Hi");

    const long = "x".repeat(300);
    const truncated = formatItems([item("2", { text: long })]);
    expect(truncated).toContain("…");
    expect(truncated).not.toContain(long);
  });
});
