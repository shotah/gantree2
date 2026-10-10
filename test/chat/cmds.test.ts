import { describe, expect, it } from "vitest";
import { agentPublishedCmds, parseCommands, phoneMustNotPublishCmds } from "@/lib/chat/cmds";

describe("cmds frames", () => {
  it("only the crane may publish the catalog", () => {
    expect(phoneMustNotPublishCmds("phone", "cmds")).toBe(true);
    expect(phoneMustNotPublishCmds("crane", "cmds")).toBe(false);
    expect(phoneMustNotPublishCmds("phone", "inbound")).toBe(false);
    expect(agentPublishedCmds("crane", "cmds")).toBe(true);
    expect(agentPublishedCmds("phone", "cmds")).toBe(false);
  });

  it("parses a crane cmds payload and drops junk", () => {
    expect(parseCommands(null)).toEqual([]);
    expect(parseCommands([{ name: "NEW", hint: "reset this session", args: true }])).toEqual([
      { name: "new", hint: "reset this session", args: true },
    ]);
    expect(parseCommands([
      { name: "ok", hint: "fine hint here" },
      { name: "no spaces", hint: "nope" },
      { name: "x", hint: "ab" },
      { name: "/new", hint: "slash in name" },
      "nope",
    ])).toEqual([{ name: "ok", hint: "fine hint here" }]);
  });
});
