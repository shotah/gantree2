import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  oxc: {
    jsx: { runtime: "automatic" },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname),
    },
  },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    // The live model run is `npm run eval` (vitest.eval.config.ts).
    exclude: ["**/node_modules/**", "**/.git/**", "test/harness/eval/live.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      include: ["lib/**/*.ts", "edge/**/*.ts", "app/lib/**/*.ts"],
      // Binding glue: imports `cloudflare:workers`, nothing to assert.
      exclude: ["lib/door/runtime.ts"],
      thresholds: {
        lines: 60,
        statements: 60,
        functions: 60,
        branches: 60,
      },
    },
  },
});
