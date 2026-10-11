/**
 * Structured log. In the DO the sink turns records into `log` frames for the
 * agents screen and `console.*` for Workers Logs; in tests it is an array.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogRecord = {
  level: LogLevel;
  message: string;
  /** ms epoch. */
  at: number;
  fields?: Record<string, unknown>;
};

export type Logger = {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** Same sink, extra fixed fields (`{ pkg: "memory" }`). */
  with(fields: Record<string, unknown>): Logger;
};

export type LogSink = (record: LogRecord) => void;

export function makeLogger(sink: LogSink, now: () => number, fixed: Record<string, unknown> = {}): Logger {
  const emit = (level: LogLevel, message: string, fields?: Record<string, unknown>) => {
    const merged = { ...fixed, ...fields };
    sink({ level, message, at: now(), fields: Object.keys(merged).length ? merged : undefined });
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    with: (more) => makeLogger(sink, now, { ...fixed, ...more }),
  };
}

export const consoleSink: LogSink = (r) => {
  const line = { ...r.fields, msg: r.message };
  if (r.level === "error") {
    console.error(line);
  } else if (r.level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
};

/** Tests: collect records. */
export function memorySink(): LogSink & { records: LogRecord[] } {
  const records: LogRecord[] = [];
  const sink = ((r: LogRecord) => {
    records.push(r);
  }) as LogSink & { records: LogRecord[] };
  sink.records = records;
  return sink;
}

export const silentLogger: Logger = makeLogger(() => undefined, () => 0);
