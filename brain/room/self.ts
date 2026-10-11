/**
 * SELF.md for a native agent, outside the brain. The store reads the SQLite
 * row on every call, so this instance and the brain's see the same text.
 */
import { systemClock } from "@/brain/core/clock";
import { consoleSink, makeLogger, type LogSink } from "@/brain/core/log";
import { doSql } from "@/brain/core/sql";
import { SelfNoteStore } from "@/brain/selfnote/store";
import type { LogFrame } from "@/brain/core/wire";
import { resolveTimezone } from "@/brain/persona";
import { CONFIG_STORE_KEY, parseConfig } from "@/lib/agents/config";
import { parseStoredSlug, SLUG_STORE_KEY } from "@/lib/chat/allow";

export type SelfStoreOpts = {
  slug?: string;
  /** Fold one `log` frame the way a crane `log` line is folded. Also mirrored to console. */
  foldLog: (frame: LogFrame) => void | Promise<void>;
};

export async function openSelfStore(ctx: DurableObjectState, opts: SelfStoreOpts): Promise<SelfNoteStore> {
  const config = parseConfig(await ctx.storage.get(CONFIG_STORE_KEY));
  const stored = parseStoredSlug(await ctx.storage.get(SLUG_STORE_KEY));
  const slug = opts.slug ?? stored ?? "";
  const clock = systemClock(resolveTimezone(config.persona, config.env.CRON_TZ ?? "").name);
  const log = makeLogger(roomSink(opts.foldLog), () => clock.now(), slug ? { slug } : {});
  return new SelfNoteStore(doSql(ctx.storage.sql), clock, log);
}

function roomSink(foldLog: SelfStoreOpts["foldLog"]): LogSink {
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
