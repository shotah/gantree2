/**
 * Harness command catalog. Phones receive this list as the `cmds` frame.
 * Aliases (/clear, /stop, /quit) stay out of the menu; /quit is only on the
 * stdio ready line.
 */
import type { SlashCommand } from "@/lib/chat/cmds";

export type { SlashCommand };

function cmd(name: string, hint: string, args = false): SlashCommand {
  if (args) {
    return { name, hint, args: true };
  }
  return { name, hint };
}

/** Menu the mouths publish. Order is the picker order. */
export function catalog(): SlashCommand[] {
  return [
    cmd("new", "reset this session's history"),
    cmd("cancel", "stop the in-flight turn"),
    cmd("status", "uptime, model, history, tools, turns"),
    cmd("tools", "prefixed tool catalog (published vs available)"),
    cmd("examples", "capability idea (on|off)", true),
    cmd("perf", "last turns: invocations, tools, batch, recoveries"),
    cmd("memstats", "memory row counts and consolidation"),
    cmd("toolstats", "per-tool call ledger since boot"),
    cmd("tokens", "prompt token breakdown (estimates)"),
    cmd("auth", "remote OAuth (url / paste code)", true),
    cmd("help", "this list"),
    cmd("brief", "hold a prefix ~6h", true),
    cmd("short", "hold a prefix ~27h", true),
    cmd("off", "drop a prefix hold", true),
    cmd("planner", "daily planning session (on|off|HH:MM)", true),
    cmd("aims", "aim ledger (area | rubric | block)", true),
    cmd("todo", "pocket list (done <id|slug>, prio <id|slug> [!!|!])", true),
  ];
}

/** `/help`. Same strings as `catalog`. */
export function helpText(): string {
  return catalog().map((c) => `/${c.name} — ${c.hint}`).join("\n");
}

/** Stdio banner: catalog plus REPL `/quit`. */
export function readyLine(): string {
  const parts = catalog().map((c) => `/${c.name}`);
  parts.push("/quit");
  return `gantry stdio ready — ${parts.join(" ")}`;
}
