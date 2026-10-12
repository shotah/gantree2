/**
 * Crane frames. `draft` is cumulative text (a blank one clears the bubble).
 * `reply` is the final text plus any photos. Harness-only `status`, `perf`,
 * and `log` ride the same emit.
 */
import { IMAGE_MAX } from "@/lib/chat/caps";
import { catalog } from "@/harness/slash";
import type { Clock } from "@/harness/core/clock";
import type { Logger, LogLevel } from "@/harness/core/log";
import { makeLogger } from "@/harness/core/log";
import type { AimRow, AimLink } from "@/lib/chat/aims";
import type { TodoItem } from "@/lib/chat/todo";
import type { BrainFrame, Emit, PerfFrame, StatusFrame } from "@/harness/core/wire";

const DRAFT_MAX = 8000;
const LOG_MAX = 2000;
const LOG_GAP_MS = 1000;

export type PerfInput = Omit<PerfFrame, "kind" | "tokens"> & {
  tokens: { prompt: number; completion: number };
};

export function clipRunes(s: string, max: number): string {
  const runes = Array.from(s);
  if (runes.length <= max) return s;
  return `${runes.slice(0, max - 1).join("")}…`;
}

export class DraftStream {
  private status = "";
  private body = "";
  private answer = "";
  private started = false;
  private replied = false;

  constructor(
    private readonly emit: Emit,
    private readonly userId: string,
  ) {}

  get didStart(): boolean {
    return this.started;
  }

  get didReply(): boolean {
    return this.replied;
  }

  update(fullText: string): void {
    this.status = "";
    this.setAnswer(fullText);
    this.push();
  }

  progress(note: string): void {
    const line = note.trim();
    if (line === "") return;
    this.commitAnswer();
    if (line === "Making Calls:" && trailingMakingCalls(this.body)) {
      this.push();
      return;
    }
    if (line === "✓" || line === "✗") {
      this.body = appendMakingCallsMark(this.body, line);
    } else {
      this.body = this.body === "" ? line : `${this.body}\n${line}`;
    }
    this.push();
  }

  /** Blank draft. The phone drops the bubble. */
  discard(): void {
    if (!this.started || this.replied) return;
    this.status = "";
    this.body = "";
    this.answer = "";
    this.started = false;
    this.emit({ kind: "draft", user_id: this.userId, text: "" });
  }

  /**
   * Promote the bubble to a reply. Returns the text that went on the wire
   * (tool trace included when it was already on the draft).
   */
  finish(final: string, images: readonly string[], id: string): string {
    if (this.replied) return "";
    let text = final.trim();
    if (text === "") {
      this.commitAnswer();
      text = this.body;
    } else if (this.answer !== "" && (text === this.answer || text.startsWith(this.answer))) {
      this.answer = text;
      text = this.visible();
    } else {
      const visible = this.visible();
      if (visible !== "" && (text === visible || visible.endsWith(text) || visible.includes(text))) {
        text = visible;
      } else if (visible !== "") {
        this.commitAnswer();
        text = this.body === "" ? text : `${this.body}\n\n${text}`;
      }
    }
    this.body = text;
    this.answer = "";
    this.replied = true;
    if (text.trim() === "" && images.length === 0) {
      if (this.started) this.emit({ kind: "draft", user_id: this.userId, text: "" });
      return "";
    }
    emitReply(this.emit, "reply", this.userId, text, images, id);
    return text;
  }

  private setAnswer(content: string): void {
    if (content === "") return;
    if (this.answer !== "" && !content.startsWith(this.answer)) this.commitAnswer();
    this.answer = content;
  }

  private commitAnswer(): void {
    const ans = this.answer.trim();
    this.answer = "";
    if (ans === "") return;
    this.body = this.body === "" ? ans : `${this.body}\n\n${ans}`;
  }

  private visible(): string {
    if (this.body === "") return this.answer;
    if (this.answer === "") return this.body;
    return `${this.body}\n\n${this.answer}`;
  }

  private push(): void {
    const display = this.display();
    this.started = true;
    if (display === "") return;
    this.emit({ kind: "draft", user_id: this.userId, text: display });
  }

  private display(): string {
    const answer = this.visible();
    if (this.status === "") return clipRunes(answer, DRAFT_MAX);
    if (answer === "") return clipRunes(this.status, DRAFT_MAX);
    return clipRunes(`${this.status}\n${answer}`, DRAFT_MAX);
  }
}

function trailingMakingCalls(body: string): boolean {
  const i = body.lastIndexOf("\n");
  const line = i < 0 ? body : body.slice(i + 1);
  return line.startsWith("Making Calls:");
}

function appendMakingCallsMark(body: string, mark: string): string {
  const i = body.lastIndexOf("\n");
  const prefix = i >= 0 ? body.slice(0, i + 1) : "";
  const line = i >= 0 ? body.slice(i + 1) : body;
  if (!line.startsWith("Making Calls:")) {
    return body === "" ? `Making Calls: ${mark}` : `${body}\nMaking Calls: ${mark}`;
  }
  const rest = line.slice("Making Calls:".length).trim();
  if (rest === "") return `${prefix}Making Calls: ${mark}`;
  return `${prefix}Making Calls: ${rest}, ${mark}`;
}

export function emitReply(
  emit: Emit,
  kind: "reply" | "push",
  userId: string,
  text: string,
  images: readonly string[],
  id?: string,
): void {
  const urls = images.map((u) => u.trim()).filter((u) => u !== "");
  const first = urls.slice(0, IMAGE_MAX);
  const rest = urls.slice(IMAGE_MAX);
  const frame: BrainFrame = { kind, text, user_id: userId };
  if (id) frame.id = id;
  if (first.length > 0) frame.images = first.map((url) => ({ url }));
  if (text.trim() !== "" || first.length > 0) emit(frame);
  for (const url of rest) {
    emit({ kind, user_id: userId, images: [{ url }] });
  }
}

export function emitTyping(emit: Emit, userId: string): void {
  emit({ kind: "typing", user_id: userId });
}

export function emitReact(emit: Emit, userId: string, emoji: string, replyTo: string): void {
  emit({ kind: "react", user_id: userId, id: replyTo, text: emoji });
}

export function emitCmds(emit: Emit): void {
  emit({ kind: "cmds", commands: catalog() });
}

export function emitStatus(emit: Emit, frame: StatusFrame): void {
  emit({
    kind: "status",
    published: frame.published,
    skipped: frame.skipped,
  });
}

export function emitAims(emit: Emit, aims: AimRow[], links: AimLink[]): void {
  const frame: BrainFrame = { kind: "aims", aims };
  if (links.length > 0) frame.links = links;
  emit(frame);
}

export function emitTodo(emit: Emit, todo: TodoItem[]): void {
  emit({ kind: "todo", todo });
}

export function emitPerf(emit: Emit, perf: PerfInput): void {
  const { tokens, ...rest } = perf;
  const frame: PerfFrame = {
    kind: "perf",
    tokens: { prompt: tokens.prompt, completion: tokens.completion },
    ...rest,
  };
  emit(frame);
}

/**
 * Rate-capped `log` frames. `turn perf` is not a log line — the loop emits
 * `perf` itself. The underlying logger still receives every record.
 */
export function framingLogger(base: Logger, emit: Emit, clock: Clock): Logger {
  let lastAt = -LOG_GAP_MS;
  let lastErrAt = -LOG_GAP_MS;
  let dropped = 0;
  const sink = (level: LogLevel, message: string): void => {
    if (message === "turn perf") return;
    const now = clock.now();
    const slot = level === "error" ? lastErrAt : lastAt;
    if (now - slot < LOG_GAP_MS) {
      dropped += 1;
      return;
    }
    if (level === "error") lastErrAt = now;
    else lastAt = now;
    const frame: BrainFrame = {
      kind: "log",
      level,
      message: clipRunes(message, LOG_MAX),
      at: new Date(now).toISOString(),
    };
    if (dropped > 0) {
      frame.dropped = dropped;
      dropped = 0;
    }
    emit(frame);
  };
  const wrapped = makeLogger((record) => {
    base[record.level](record.message, record.fields);
    sink(record.level, lineOf(record.message, record.fields));
  }, () => clock.now());
  return wrapped;
}

function lineOf(message: string, fields?: Record<string, unknown>): string {
  if (!fields) return message;
  const bits = [message];
  for (const [key, value] of Object.entries(fields)) {
    bits.push(`${key}=${formatField(value)}`);
  }
  return bits.join(" ");
}

function formatField(value: unknown): string {
  if (typeof value === "string") {
    if (value === "" || /[\s"=\n\t]/u.test(value)) return JSON.stringify(value);
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "";
  return JSON.stringify(value);
}
