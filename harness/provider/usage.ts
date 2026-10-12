import type { Usage } from "@/harness/core/provider";

const ZERO: Usage = { prompt: 0, completion: 0 };

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/** Any native count was on the response. The all-zero object means omitted. */
export function usagePresent(usage: Usage): boolean {
  return (usage.prompt
    || usage.completion
    || usage.total
    || usage.cached
    || usage.cacheWrite
    || usage.reasoning
    || usage.promptAudio
    || usage.completionAudio
    || usage.acceptedPrediction
    || usage.rejectedPrediction
    || 0) !== 0;
}

/** Field-wise sum (fold completer rounds onto one turn). */
export function addUsage(left: Usage, right: Usage): Usage {
  return {
    prompt: left.prompt + right.prompt,
    completion: left.completion + right.completion,
    total: (left.total ?? 0) + (right.total ?? 0),
    cached: (left.cached ?? 0) + (right.cached ?? 0),
    cacheWrite: (left.cacheWrite ?? 0) + (right.cacheWrite ?? 0),
    reasoning: (left.reasoning ?? 0) + (right.reasoning ?? 0),
    promptAudio: (left.promptAudio ?? 0) + (right.promptAudio ?? 0),
    completionAudio: (left.completionAudio ?? 0) + (right.completionAudio ?? 0),
    acceptedPrediction: (left.acceptedPrediction ?? 0) + (right.acceptedPrediction ?? 0),
    rejectedPrediction: (left.rejectedPrediction ?? 0) + (right.rejectedPrediction ?? 0),
  };
}

/** Map an OpenAI-compat `usage` object. Missing or all-zero becomes the zero usage. */
export function usageFrom(raw: unknown): Usage {
  const usage = record(raw);
  if (!usage) {
    return ZERO;
  }
  const promptDetails = record(usage.prompt_tokens_details);
  const completionDetails = record(usage.completion_tokens_details);
  const parsed: Usage = {
    prompt: num(usage.prompt_tokens),
    completion: num(usage.completion_tokens),
    total: num(usage.total_tokens),
    cached: num(promptDetails?.cached_tokens),
    cacheWrite: num(promptDetails?.cache_write_tokens),
    reasoning: num(completionDetails?.reasoning_tokens),
    promptAudio: num(promptDetails?.audio_tokens),
    completionAudio: num(completionDetails?.audio_tokens),
    acceptedPrediction: num(completionDetails?.accepted_prediction_tokens),
    rejectedPrediction: num(completionDetails?.rejected_prediction_tokens),
  };
  return usagePresent(parsed) ? parsed : ZERO;
}
