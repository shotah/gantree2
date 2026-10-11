/**
 * The brain speaks the room's wire. It receives the frames a phone sends and
 * emits exactly the frames the Go harness emitted on its crane socket, so
 * `edge/agent.do.ts` fans them out unchanged and phones cannot tell which
 * runtime answered.
 *
 * Harness-only frames (`status`, `perf`, `log`) fold into the Agent DO's
 * status/log rings the same way (`lib/agents/status.ts`).
 */
import type { WireFrame } from "@/lib/chat/frame";

export type { WireFrame };

/** `status` frame: which plugins published, which were skipped and why. */
export type StatusFrame = {
  kind: "status";
  published: string[];
  skipped: { name: string; reason: string }[];
};

/**
 * `perf` frame: one finished turn. `tokens` is provider usage (zero when the
 * provider omitted it). The optional fields are the `turn perf` counters
 * settings charts (docs/contract.md). Go's socket frame only required
 * `turn` / `source` / `outcome` / `tokens`; these extras are optional so an
 * older reader still accepts the frame.
 */
export type PerfFrame = {
  kind: "perf";
  turn?: string;
  source?: string;
  outcome?: string;
  tokens: { prompt: number; completion: number };
  user_id?: string;
  session_id?: string;
  iterations?: number;
  tool_calls?: number;
  max_batch?: number;
  recoveries?: number;
  tools_per_inv?: number;
  prompt_est_tokens?: number;
  gen_est_tokens?: number;
  model_ms?: number;
  tool_ms?: number;
  total_ms?: number;
  duration_ms?: number;
  hydration_est_tokens?: number;
  model?: string;
  finish_reason?: string;
  total_tokens?: number;
  usage_rounds?: number;
  cached_tokens?: number;
  cache_write_tokens?: number;
  reasoning_tokens?: number;
  prompt_audio_tokens?: number;
  completion_audio_tokens?: number;
  accepted_prediction_tokens?: number;
  rejected_prediction_tokens?: number;
  service_tier?: string;
};

/** `log` frame: one rate-capped log line. */
export type LogFrame = {
  kind: "log";
  level: string;
  message: string;
  at?: string;
  dropped?: number;
};

export type BrainFrame = WireFrame | StatusFrame | PerfFrame | LogFrame;

/** Where the brain's frames go: the Agent DO's crane-side fan-out. */
export type Emit = (frame: BrainFrame) => void;

/** Inbound from a phone after the DO stamped identity on it. */
export type Inbound = WireFrame & {
  kind: "inbound" | "react" | "ack" | "pin";
  user_id: string;
};
