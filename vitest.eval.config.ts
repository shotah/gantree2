import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Live behavioral eval. `npm test` uses vitest.config.ts and skips
 * test/brain/eval/live.test.ts. `npm run eval` uses this file, which
 * runs the runner unit tests and then the live fixtures.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname),
    },
  },
  test: {
    include: ["test/brain/eval/**/*.test.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    disableConsoleIntercept: true,
    testTimeout: 120 * 60 * 1000,
  },
});
