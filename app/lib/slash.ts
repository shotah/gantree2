/** Command picker helpers. The catalog itself comes from the crane (cmds frame). */

import type { SlashCommand } from "@/lib/chat/cmds";

export type { SlashCommand };

/** Draft after `/` while the user is still on the command token (no space). */
export function slashToken(text: string): string | null {
  if (!text.startsWith("/") || /\s/.test(text)) {
    return null;
  }
  return text.slice(1).toLowerCase();
}

export function matchSlash(text: string, catalog: readonly SlashCommand[]): SlashCommand[] {
  const token = slashToken(text);
  if (token == null) {
    return [];
  }
  return catalog.filter((c) => c.name.startsWith(token));
}

export function slashInsert(cmd: SlashCommand): string {
  return cmd.args ? `/${cmd.name} ` : `/${cmd.name}`;
}
