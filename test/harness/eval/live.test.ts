import { expect, it } from "vitest";
import { liveConfigured, runLiveEval } from "@/harness/eval/live";

const ready = liveConfigured();

if (!ready) {
  process.stdout.write(
    "LLM_BASE_URL, LLM_API_KEY, LLM_MODEL required; put them in .dev.vars and run npm run eval\n",
  );
}

it.skipIf(!ready)(
  "replays every selected fixture against the live model",
  async () => {
    const failed = await runLiveEval((line) => {
      process.stdout.write(`${line}\n`);
    });
    expect(failed).toBe(0);
  },
  120 * 60 * 1000,
);
