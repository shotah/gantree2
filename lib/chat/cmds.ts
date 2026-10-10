export const CMDS_STORE_KEY = "cmds";
export const COMMANDS_MAX = 32;
export const COMMAND_NAME_MAX = 32;
export const COMMAND_HINT_MAX = 256;

export type SlashCommand = {
  name: string;
  hint: string;
  args?: boolean;
};

const NAME_RE = /^[a-z][a-z0-9_]{0,31}$/;

export function phoneMustNotPublishCmds(role: "phone" | "crane", kind?: string): boolean {
  return role === "phone" && kind === "cmds";
}

export function agentPublishedCmds(role: "phone" | "crane", kind?: string): boolean {
  return role === "crane" && kind === "cmds";
}

/** Untrusted wire → menu rows. Invalid entries are dropped. */
export function parseCommands(raw: unknown): SlashCommand[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: SlashCommand[] = [];
  for (const item of raw) {
    if (out.length >= COMMANDS_MAX) {
      break;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim().toLowerCase() : "";
    const hint = typeof o.hint === "string" ? o.hint.trim() : "";
    if (!NAME_RE.test(name) || name.length > COMMAND_NAME_MAX) {
      continue;
    }
    if (hint.length < 3 || hint.length > COMMAND_HINT_MAX) {
      continue;
    }
    const row: SlashCommand = { name, hint };
    if (o.args === true) {
      row.args = true;
    }
    out.push(row);
  }
  return out;
}
