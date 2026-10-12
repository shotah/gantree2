/**
 * Operator persona files for a native agent, outside the harness. The store
 * reads `persona_file` on every call. SELF.md stays in the self-note store.
 */
import { systemClock } from "@/harness/core/clock";
import { consoleSink, makeLogger, type LogSink } from "@/harness/core/log";
import { doSql } from "@/harness/core/sql";
import type { LogFrame } from "@/harness/core/wire";
import { filePersona, fileSelf, resolveTimezone, PersonaStore } from "@/harness/persona";
import { CONFIG_STORE_KEY, parseConfig } from "@/lib/agents/config";
import { parseStoredSlug, SLUG_STORE_KEY } from "@/lib/chat/allow";

export type PersonaStoreOpts = {
  slug?: string;
  /** Fold one `log` frame the way a crane `log` line is folded. Also mirrored to console. */
  foldLog: (frame: LogFrame) => void | Promise<void>;
};

/**
 * Opens the store and copies `config.persona` into PERSONA.md once.
 * A later call is a no-op once any row exists.
 */
export async function openPersonaStore(ctx: DurableObjectState, opts: PersonaStoreOpts): Promise<PersonaStore> {
  const config = parseConfig(await ctx.storage.get(CONFIG_STORE_KEY));
  const stored = parseStoredSlug(await ctx.storage.get(SLUG_STORE_KEY));
  const slug = opts.slug ?? stored ?? "";
  const clock = systemClock(resolveTimezone(config.persona, config.env.CRON_TZ ?? "").name);
  const log = makeLogger(roomSink(opts.foldLog), () => clock.now(), slug ? { slug } : {});
  const store = new PersonaStore(doSql(ctx.storage.sql), clock, log, slug || undefined);
  store.importLegacy(config.persona);
  return store;
}

/** PERSONA.md, then every other persona file. SELF.md is not one of these. */
export function personaParts(store: PersonaStore): { name: string; text: string }[] {
  const parts: { name: string; text: string }[] = [];
  for (const file of store.list()) {
    if (file.name === fileSelf) {
      continue;
    }
    parts.push({ name: file.name, text: file.text });
  }
  return parts;
}

export { filePersona };

function roomSink(foldLog: PersonaStoreOpts["foldLog"]): LogSink {
  return (record) => {
    consoleSink(record);
    const frame: LogFrame = {
      kind: "log",
      level: record.level,
      message: record.message,
      at: new Date(record.at).toISOString(),
    };
    try {
      const pending = foldLog(frame);
      if (pending) {
        void pending.then(() => undefined, () => undefined);
      }
    } catch {
      // console already has the line; the agents screen misses this one
    }
  };
}
