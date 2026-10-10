import eslint from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "coverage/**",
      "dist/**",
      ".next/**",
      ".vinext/**",
      ".wrangler/**",
      "worker-configuration.d.ts",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    // Type-aware rules read the TS project (tsconfig.json). Everything a test imports is in it.
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  stylistic.configs.customize({
    indent: 2,
    quotes: "double",
    semi: true,
    jsx: true,
    arrowParens: true,
    braceStyle: "1tbs",
    blockSpacing: true,
    quoteProps: "as-needed",
    commaDangle: "always-multiline",
  }),
  {
    rules: {
      "@stylistic/quotes": ["error", "double", { allowTemplateLiterals: "always", avoidEscape: true }],
      "@stylistic/jsx-one-expression-per-line": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
  {
    // Service worker: a classic script in a ServiceWorkerGlobalScope.
    files: ["public/sw.js"],
    languageOptions: {
      sourceType: "script",
      globals: { self: "readonly", fetch: "readonly", Response: "readonly", caches: "readonly", clients: "readonly", URL: "readonly" },
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "error",
      // Type-aware: deprecated APIs and `any` leaking in from untyped values are errors, not style.
      "@typescript-eslint/no-deprecated": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      // @cloudflare/workers-types declares the global `Buffer` as `any`. The import is typed.
      "no-restricted-globals": ["error", {
        name: "Buffer",
        message: "Global Buffer is `any` under @cloudflare/workers-types. Use `import { Buffer } from \"node:buffer\"`.",
      }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Test callbacks are `async` for uniformity even when a case has nothing to await.
    files: ["test/**/*.ts", "test/**/*.tsx"],
    rules: { "@typescript-eslint/require-await": "off" },
  },
  {
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-assignment": "error",
      "no-control-regex": "error",
    },
  },
);
