import { describe, expect, it } from "vitest";
import { parseEnvPaste } from "@/app/components/agents/envPaste";

describe("parseEnvPaste", () => {
  it("ignores blank lines and comments", () => {
    expect(parseEnvPaste("\n  \n# secret\n# FOO=bar\n")).toEqual({ entries: [], skipped: [] });
  });

  it("strips export prefix and carriage returns", () => {
    expect(parseEnvPaste("export FOO=1\r\nBAR=two")).toEqual({
      entries: [
        { key: "FOO", value: "1" },
        { key: "BAR", value: "two" },
      ],
      skipped: [],
    });
  });

  it("unwraps one pair of quotes and keeps inline equals in the value", () => {
    expect(parseEnvPaste('A="hello"\nB=\'world\'\nC=x=y')).toEqual({
      entries: [
        { key: "A", value: "hello" },
        { key: "B", value: "world" },
        { key: "C", value: "x=y" },
      ],
      skipped: [],
    });
  });

  it("splits on the first equals only", () => {
    expect(parseEnvPaste("URL=https://x?a=b&c=d")).toEqual({
      entries: [{ key: "URL", value: "https://x?a=b&c=d" }],
      skipped: [],
    });
  });

  it("last duplicate key wins", () => {
    expect(parseEnvPaste("FOO=1\nFOO=2\nFOO=3")).toEqual({
      entries: [{ key: "FOO", value: "3" }],
      skipped: [],
    });
  });

  it("skips lines without equals", () => {
    expect(parseEnvPaste("not-a-line\nOK=1")).toEqual({
      entries: [{ key: "OK", value: "1" }],
      skipped: ["not-a-line"],
    });
  });

  it("skips bad keys and empty values without echoing values", () => {
    const out = parseEnvPaste("123BAD=x\nEMPTY=\n__proto__=nope\nVALID=ok");
    expect(out.entries).toEqual([{ key: "VALID", value: "ok" }]);
    expect(out.skipped).toEqual([
      "Invalid key: 123BAD",
      "Empty value: EMPTY",
      "Invalid key: __proto__",
    ]);
    expect(JSON.stringify(out)).not.toContain("nope");
    expect(JSON.stringify(out)).not.toContain("x\n");
  });

  it("rejects prototype and constructor keys", () => {
    expect(parseEnvPaste("prototype=1\nconstructor=2")).toEqual({
      entries: [],
      skipped: ["Invalid key: prototype", "Invalid key: constructor"],
    });
  });
});
