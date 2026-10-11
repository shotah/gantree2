/**
 * The only eval file that imports `brain/agent`.
 *
 * Pass-through onto `createBrain`. The runner does not grow a second loop.
 * While that export still throws "not implemented", a live fixture fails at
 * construction with that error and the rest of the runner still stands.
 */
import { createBrain } from "@/brain/agent";
import type { Brain, BrainDeps } from "@/brain/core/brain";

export function createEvalBrain(deps: BrainDeps): Brain {
  return createBrain(deps);
}
