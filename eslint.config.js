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
  ...tseslint.configs.recommended,
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
    languageOptions: { globals: { process: "readonly" } },
  },
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-assignment": "error",
      "no-control-regex": "error",
    },
  },
);
