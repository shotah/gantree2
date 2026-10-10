import { describe, expect, it } from "vitest";
import exampleToml from "../../harness/examples/mcp.toml.example?raw";
import evalToml from "../../harness/internal/agent/testdata/eval/mcp.toml?raw";
import { grantsFromToml, tomlFromGrants } from "@/lib/agents/mcpToml";
import type { Grant } from "@/lib/agents/types";

const HARNESS = `dynamic_tools = false

[[server]] # pinned
name    = "garmin"
command = "garmin"
args = ["mcp", "--tool-tier", "core"]
env = ["FOO=bar"]
tools = ["get_sleep", "get_weight"]
exclude = ["raw_*"]
tools_prefix = "garm"
force  =  true
budget = "1/day"
auth_command = "garmin"
auth_args = ["login"]
download_url = "https://example.test/{tag}/garmin.tar.gz"
download_tag = "latest"
home_only = true
# inside
meta = { note = "x", inner = { a = "b]" } }

# before rentals
[[server]]
name = "rentals"
command = "rentals-search-mcp"
download_url = "https://example.test/rentals.tar.gz"
`;

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPECIALS = ["a", "b", " ", "=", "\"", "\\", "\n", "\t", "\r", "\b", "\f", "'", "]", "#", "q"];

function randStr(rng: () => number): string {
  const n = 1 + Math.floor(rng() * 6);
  let out = "";
  for (let i = 0; i < n; i++) {
    out += SPECIALS[Math.floor(rng() * SPECIALS.length)] ?? "a";
  }
  return out;
}

function randomGrants(rng: () => number, count: number): Grant[] {
  const grants: Grant[] = [];
  for (let i = 0; i < count; i++) {
    const grant: Grant = { name: `s${count}-${i}`, command: `c${randStr(rng)}z` };
    const roll = rng();
    if (roll < 0.33) {
      grant.args = [];
    } else if (roll < 0.7) {
      grant.args = [randStr(rng), randStr(rng)];
    }
    if (rng() < 0.6) {
      grant.env = [`K${i}=${randStr(rng)}`];
    }
    grants.push(grant);
  }
  return grants;
}

describe("grantsFromToml", () => {
  it("reads name, command, args, and env in file order", () => {
    expect(grantsFromToml(HARNESS)).toEqual([
      {
        name: "garmin",
        command: "garmin",
        args: ["mcp", "--tool-tier", "core"],
        env: ["FOO=bar"],
      },
      { name: "rentals", command: "rentals-search-mcp" },
    ]);
  });

  it("parses escapes, literal strings, and multiline arrays", () => {
    const toml = `
[[server]]
name = "a\\q\\b\\fz"
command = 'literal'
args = [
  "a]b", # keep the bracket
  "b",
]
env = ["K=V=W",]
`;
    expect(grantsFromToml(toml)).toEqual([{
      name: "aq\b\fz",
      command: "literal",
      args: ["a]b", "b"],
      env: ["K=V=W"],
    }]);
  });

  it("skips comments, commented servers, and blocks without a string command", () => {
    const toml = `
# [[server]]
# name = "example"
[[server]]
name = "broken"
command = true
[[server]]
name = "open"
command = 'unterminated
[[server]]
command = "no-name"
`;
    expect(grantsFromToml(toml)).toEqual([]);
    expect(grantsFromToml("")).toEqual([]);
    expect(grantsFromToml("# only\n")).toEqual([]);
  });

  it("ignores args that are not a string array", () => {
    const toml = `
[[server]]
name = "a"
command = "a"
args = [1]
env = [,]
`;
    expect(grantsFromToml(toml)).toEqual([{ name: "a", command: "a" }]);
    const open = `
[[server]]
name = "b"
command = "b"
args = ["no-close"
`;
    expect(grantsFromToml(open)).toEqual([{ name: "b", command: "b" }]);
  });

  it("trims name and command and keeps an empty args array", () => {
    const toml = "[[server]]\r\nname = \"  math  \"\r\ncommand = \" mcp \"\r\nargs = []\r\n";
    expect(grantsFromToml(toml)).toEqual([{ name: "math", command: "mcp", args: [] }]);
  });

  it("reads the commented example as no grants and the eval manifest as three servers", () => {
    expect(grantsFromToml(exampleToml)).toEqual([]);
    expect(grantsFromToml(evalToml).map((grant) => grant.name)).toEqual(["rentals", "flights", "google"]);
    expect(grantsFromToml(evalToml)[0]?.env).toEqual(["RENTCAST_API_KEY=eval-placeholder"]);
  });
});

describe("tomlFromGrants", () => {
  it("writes a fresh document as string arrays the harness can load", () => {
    expect(tomlFromGrants([
      { name: "gws", command: "gws-mcp", args: ["--tools", "gmail"], env: ["FOO=bar"] },
      { name: "math", command: "mcp-go-math" },
    ])).toBe(`[[server]]
name = "gws"
command = "gws-mcp"
args = ["--tools", "gmail"]
env = ["FOO=bar"]

[[server]]
name = "math"
command = "mcp-go-math"
`);
    expect(tomlFromGrants([])).toBe("");
  });

  it("round-trips escapes through a fresh document", () => {
    const grant: Grant = {
      name: "a\b\fz",
      command: "c\\d\"\n\t\re",
      args: ["a]b"],
      env: ["K=V=W"],
    };
    expect(grantsFromToml(tomlFromGrants([grant]))).toEqual([grant]);
    expect(tomlFromGrants(grantsFromToml(tomlFromGrants([grant])))).toBe(tomlFromGrants([grant]));
  });

  it("rewrites managed keys and keeps everything else", () => {
    const next = tomlFromGrants([
      { name: "garmin", command: "garmin", args: ["mcp"], env: ["FOO=baz"] },
      { name: "math", command: "mcp-go-math" },
    ], HARNESS);
    expect(next.startsWith("dynamic_tools = false\n")).toBe(true);
    expect(next).toContain("[[server]] # pinned");
    expect(next).toContain("tools = [\"get_sleep\", \"get_weight\"]");
    expect(next).toContain("exclude = [\"raw_*\"]");
    expect(next).toContain("tools_prefix = \"garm\"");
    expect(next).toContain("force  =  true");
    expect(next).toContain("budget = \"1/day\"");
    expect(next).toContain("auth_command = \"garmin\"");
    expect(next).toContain("auth_args = [\"login\"]");
    expect(next).toContain("download_url = \"https://example.test/{tag}/garmin.tar.gz\"");
    expect(next).toContain("download_tag = \"latest\"");
    expect(next).toContain("home_only = true");
    expect(next).toContain("# inside");
    expect(next).toContain("meta = { note = \"x\", inner = { a = \"b]\" } }");
    expect(next).toContain("# before rentals");
    expect(next).toContain("args = [\"mcp\"]");
    expect(next).toContain("env = [\"FOO=baz\"]");
    expect(next).not.toMatch(/^name {4}= /m);
    expect(grantsFromToml(next).map((grant) => grant.name)).toEqual(["garmin", "math"]);
    expect(grantsFromToml(next).some((grant) => grant.name === "rentals")).toBe(false);
  });

  it("drops a grant's block and keeps comments that sat outside it", () => {
    const toml = `# top
dynamic_tools = false

# before a
[[server]]
name = "a"
command = "a"
auth_args = ["auth"]

# before b
[[server]]
name = "b"
command = "b"
home_only = true
# tail
`;
    const next = tomlFromGrants([{ name: "b", command: "b2" }], toml);
    expect(next.startsWith("# top\ndynamic_tools = false\n")).toBe(true);
    expect(next).toContain("# before a");
    expect(next).toContain("# before b");
    expect(next).toContain("# tail");
    expect(next).toContain("home_only = true");
    expect(next).not.toMatch(/^name = "a"$/m);
    expect(grantsFromToml(next)).toEqual([{ name: "b", command: "b2" }]);
    expect(tomlFromGrants([], toml)).toBe(`# top
dynamic_tools = false

# before a

# before b
# tail
`);
  });

  it("keeps a block it cannot name and drops one it cannot grant", () => {
    const toml = `# hi
[[server]]
command = "x"
# stays
[[server]]
name = "broken"
command = true
`;
    const next = tomlFromGrants([], toml);
    expect(next).toContain("command = \"x\"");
    expect(next).toContain("# stays");
    expect(next).toContain("# hi");
    expect(next).not.toContain("broken");
  });

  it("leaves a comment-only file untouched and appends into a preamble", () => {
    expect(tomlFromGrants([], exampleToml)).toBe(exampleToml);
    expect(tomlFromGrants([], "# hi\n")).toBe("# hi\n");
    const next = tomlFromGrants([{ name: "math", command: "mcp-go-math" }], "# hi\n");
    expect(next.startsWith("# hi\n\n[[server]]\n")).toBe(true);
    expect(grantsFromToml(next)).toEqual([{ name: "math", command: "mcp-go-math" }]);
  });

  it("keeps file order, updates in place, and appends new grants", () => {
    const previous = tomlFromGrants([
      { name: "a", command: "a" },
      { name: "b", command: "b" },
    ]);
    const written = tomlFromGrants([
      { name: "c", command: "c" },
      { name: "b", command: "b2" },
      { name: "a", command: "a2", args: ["--x"] },
    ], previous);
    expect(grantsFromToml(written)).toEqual([
      { name: "a", command: "a2", args: ["--x"] },
      { name: "b", command: "b2" },
      { name: "c", command: "c" },
    ]);
  });

  it("last duplicate grant wins and blank names are skipped", () => {
    expect(grantsFromToml(tomlFromGrants([
      { name: "a", command: "first" },
      { name: " ", command: "nope" },
      { name: "a", command: "second", args: ["x"] },
      { name: "b", command: "  " },
    ]))).toEqual([{ name: "a", command: "second", args: ["x"] }]);
  });

  it("covers odd values, comments on keys, and newline joins", () => {
    expect(grantsFromToml("[[server]]\nname = \"unterminated\n")).toEqual([]);
    expect(grantsFromToml("[[server]]\nname = \"a\"\ncommand = \"a\"\nargs = ['x', 'y']\n")).toEqual([
      { name: "a", command: "a", args: ["x", "y"] },
    ]);
    expect(grantsFromToml("[[server]]\nname = \"a\"\ncommand = \"a\"\nargs = \"nope\"\nenv = true\n")).toEqual([
      { name: "a", command: "a" },
    ]);
    expect(grantsFromToml("[[server]]\nname = \"a\"\ncommand = \"a\"\nargs = [\"a\" \"b\"]\n")).toEqual([
      { name: "a", command: "a" },
    ]);

    const crlf = tomlFromGrants(
      [{ name: "a", command: "b", args: ["x"] }],
      "[[server]]\r\nname = \"a\" # kept\r\ncommand = \"a\"",
    );
    expect(crlf).toContain("name = \"a\"\r\n");
    expect(grantsFromToml(crlf)).toEqual([{ name: "a", command: "b", args: ["x"] }]);

    const appended = tomlFromGrants([{ name: "m", command: "m" }], "dynamic_tools = false");
    expect(appended.startsWith("dynamic_tools = false\n\n[[server]]\n")).toBe(true);
    expect(tomlFromGrants([], "# hi[[server]]\ncommand = \"x\"")).toBe("# hi[[server]]\ncommand = \"x\"");
  });

  it("removes managed keys the grant omits and adds ones it gains", () => {
    const previous = `[[server]]
name = "a"
command = "a"
args = ["--x"]
auth_args = ["auth"]
`;
    const removed = tomlFromGrants([{ name: "a", command: "a" }], previous);
    expect(removed).not.toMatch(/^args = /m);
    expect(removed).toContain("auth_args = [\"auth\"]");
    const added = tomlFromGrants([{ name: "a", command: "a", env: ["K=V"] }], removed);
    expect(added).toContain("env = [\"K=V\"]");
    expect(added).toContain("auth_args = [\"auth\"]");
    expect(grantsFromToml(added)).toEqual([{ name: "a", command: "a", env: ["K=V"] }]);
  });

  it("preserves the eval manifest's env lines and tool allowlist", () => {
    const grants = grantsFromToml(evalToml);
    const next = tomlFromGrants(grants, evalToml);
    expect(grantsFromToml(next)).toEqual(grants);
    expect(next).toContain("# Live MCP catalogs");
    expect(next).toContain("env = [\"RENTCAST_API_KEY=eval-placeholder\"]");
    expect(next).toContain("env = [\"SERPAPI_API_KEY=eval-placeholder\"]");
    expect(next).toContain("tools   = [\"calendar_list_events\", \"calendar_create_events\"]");
    expect(next).toContain("# Google publishes ~100 tools");
    const withoutFlights = tomlFromGrants(grants.filter((grant) => grant.name !== "flights"), evalToml);
    expect(grantsFromToml(withoutFlights).map((grant) => grant.name)).toEqual(["rentals", "google"]);
    expect(withoutFlights).toContain("# Google publishes ~100 tools");
    expect(withoutFlights).not.toContain("flights-search-mcp");
  });

  it("round-trips random grants and keeps harness keys on the servers that stay", () => {
    const rng = mulberry32(0xC0FFEE);
    for (let n = 0; n < 40; n++) {
      const count = 1 + Math.floor(rng() * 4);
      const grants = randomGrants(rng, count);
      const fresh = tomlFromGrants(grants);
      expect(grantsFromToml(fresh)).toEqual(grants);
      expect(tomlFromGrants(grantsFromToml(fresh))).toBe(fresh);

      const kept = grants.slice(0, grants.length - 1);
      const added: Grant = { name: `extra${n}`, command: `c${randStr(rng)}z`, env: [`E${n}=${randStr(rng)}`] };
      const nextGrants = [...kept, added];
      const blocks = grants.map((grant) => `[[server]]\nname = "${grant.name}"\ncommand = "old"\nauth_args = ["auth"]\nhome_only = true\n# note ${grant.name}\n`);
      const previous = `# kept\ndynamic_tools = false\n\n${blocks.join("\n")}`;
      const written = tomlFromGrants(nextGrants, previous);
      expect(written.startsWith("# kept\n")).toBe(true);
      expect(written).toContain("dynamic_tools = false");
      expect(grantsFromToml(written)).toEqual(nextGrants);
      for (const grant of kept) {
        expect(written).toContain(`# note ${grant.name}`);
      }
      if (kept.length > 0) {
        expect(written).toContain("home_only = true");
        expect(written).toContain("auth_args = [\"auth\"]");
      }
      const removed = grants[grants.length - 1];
      expect(grantsFromToml(written).some((grant) => grant.name === removed?.name)).toBe(false);
      expect(grantsFromToml(tomlFromGrants(grantsFromToml(written), written))).toEqual(grantsFromToml(written));
    }
  });
});
