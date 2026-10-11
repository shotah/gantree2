import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTERVAL_SEC,
  FEEDS_DEFAULT_SEC,
  FEEDS_FLOOR_SEC,
  GRID_MS,
  TWITTER_DEFAULT_SEC,
  TWITTER_FLOOR_SEC,
  defaultIntervalSec,
  kindFloorSec,
  parseInterval,
  snapUpGrid,
} from "@/brain/watch";

describe("parseInterval", () => {
  it("accepts empty, Go durations, integer seconds, and short values the tool clamps", () => {
    expect(DEFAULT_INTERVAL_SEC).toBe(60 * 60);
    expect(parseInterval("")).toBe(DEFAULT_INTERVAL_SEC);
    expect(parseInterval("15m")).toBe(15 * 60);
    expect(parseInterval("1h")).toBe(60 * 60);
    expect(parseInterval("900")).toBe(15 * 60);
    expect(parseInterval("30s")).toBe(30);
  });

  it("rejects zero, junk, and anything past a week", () => {
    expect(() => parseInterval("0")).toThrow(/positive/);
    expect(() => parseInterval("nope")).toThrow(/use 15m, 1h, or seconds/);
    expect(() => parseInterval("240h")).toThrow(/168h0m0s/);
  });
});

describe("kind intervals", () => {
  it("defaults feeds to 60m, twitter to 6h, and everything else to 60m", () => {
    expect(defaultIntervalSec("feeds__items_list")).toBe(FEEDS_DEFAULT_SEC);
    expect(FEEDS_DEFAULT_SEC).toBe(60 * 60);
    expect(defaultIntervalSec("twitter__posts_list")).toBe(TWITTER_DEFAULT_SEC);
    expect(TWITTER_DEFAULT_SEC).toBe(6 * 60 * 60);
    expect(defaultIntervalSec("rentals__listings_search")).toBe(60 * 60);
  });

  it("floors feeds and other tools at 15m and twitter at 1h", () => {
    expect(kindFloorSec("feeds__items_list")).toBe(FEEDS_FLOOR_SEC);
    expect(FEEDS_FLOOR_SEC).toBe(15 * 60);
    expect(kindFloorSec("twitter__posts_list")).toBe(TWITTER_FLOOR_SEC);
    expect(TWITTER_FLOOR_SEC).toBe(60 * 60);
    expect(kindFloorSec("rentals__listings_search")).toBe(15 * 60);
  });
});

describe("snapUpGrid", () => {
  it("keeps a grid instant and rounds the rest up", () => {
    expect(snapUpGrid(0)).toBe(0);
    expect(snapUpGrid(GRID_MS)).toBe(GRID_MS);
    expect(snapUpGrid(1)).toBe(GRID_MS);
    expect(snapUpGrid(GRID_MS + 1)).toBe(GRID_MS * 2);
    const off = Date.UTC(2026, 0, 1, 0, 7, 0);
    expect(snapUpGrid(off)).toBe(Date.UTC(2026, 0, 1, 0, 10, 0));
  });
});
