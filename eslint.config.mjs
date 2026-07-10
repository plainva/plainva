import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/target/**",
      "**/node_modules/**",
      "apps/desktop/src-tauri/**",
      "spikes/**",
      // Generated Playwright output (traces are minified bundles, not source).
      "**/test-results/**",
      "**/playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "prefer-const": "off",
    },
  },
  {
    files: ["packages/core/src/**/*.ts", "packages/core/test/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.es2022,
        ...globals.node,
        ...globals.vitest,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "off",
    },
  },
  {
    files: [
      "apps/desktop/src/**/*.{ts,tsx}",
      "apps/desktop/vite.config.ts",
      // Shared UI layer (ADR 0011): same browser/React rule set as the
      // desktop sources it was extracted from.
      "packages/ui/src/**/*.{ts,tsx}",
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/set-state-in-effect": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "off",
      "react-refresh/only-export-components": "off",
    },
  },
);
