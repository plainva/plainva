import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

// Local flat-config plugin. Guards the exact footgun behind the v0.3.0
// production white-screen: searchSnippet.tsx read `VaultQueryService.SNIPPET_MARK_START`
// at module top level, and in the bundled build this module evaluated before
// VaultQueryService initialized (module ordering differs from the Vite dev
// server), throwing at startup. The rule flags eager (module-init-time) reads of
// SCREAMING_SNAKE statics off an imported binding — read them lazily instead.
const plainvaPlugin = {
  rules: {
    "no-top-level-imported-static-read": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow reading a CONSTANT-style static member off an imported binding at module-init time (production bundle ordering can leave the import uninitialized).",
        },
        schema: [],
        messages: {
          eager:
            "Do not read '{{object}}.{{property}}' from an imported binding at module top level: in the production bundle this module can evaluate before '{{object}}' is initialized (module ordering differs from the Vite dev server), throwing at startup. Read it lazily inside a function/getter instead (v0.3.0 white-screen: searchSnippet.tsx).",
        },
      },
      create(context) {
        const importedNames = new Set();

        // A member read is "eager" when it runs while the module initializes —
        // module top level, a top-level declaration's initializer, or a static
        // class-field initializer. Crossing any function boundary on the way up
        // to Program means the read is deferred to call time, which is safe.
        function isEager(node) {
          let cur = node.parent;
          while (cur && cur.type !== "Program") {
            if (
              cur.type === "FunctionDeclaration" ||
              cur.type === "FunctionExpression" ||
              cur.type === "ArrowFunctionExpression"
            ) {
              return false;
            }
            cur = cur.parent;
          }
          return true;
        }

        function recordImport(node) {
          // Type-only imports are erased at build time and cannot be read as
          // values, so they are never the footgun.
          if (node.importKind === "type") return;
          if (node.parent && node.parent.importKind === "type") return;
          importedNames.add(node.local.name);
        }

        return {
          ImportDefaultSpecifier: recordImport,
          ImportNamespaceSpecifier: recordImport,
          ImportSpecifier: recordImport,
          MemberExpression(node) {
            if (node.computed) return;
            if (node.object.type !== "Identifier") return;
            if (node.property.type !== "Identifier") return;
            // Only CONSTANT_CASE members — the class-static-constant shape. Keeps
            // the rule off ordinary camelCase property reads of imported objects.
            if (!/^[A-Z][A-Z0-9_]*$/.test(node.property.name)) return;
            if (!importedNames.has(node.object.name)) return;
            if (!isEager(node)) return;
            context.report({
              node,
              messageId: "eager",
              data: { object: node.object.name, property: node.property.name },
            });
          },
        };
      },
    },
  },
};

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
      // Capacitor native projects (generated shells, not our source).
      "apps/mobile/android/**",
      "apps/mobile/ios/**",
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
    // Native WebDriver smoke (B2): mocha globals + node; not part of the app build.
    files: ["apps/desktop/wdio/**/*.ts", "apps/desktop/wdio.conf.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.mocha,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
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
    // Dev tool scripts run under Node (e.g. the mobile WebDAV test server).
    files: ["apps/*/scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: [
      "apps/desktop/src/**/*.{ts,tsx}",
      "apps/desktop/vite.config.ts",
      // Shared UI layer (ADR 0011): same browser/React rule set as the
      // desktop sources it was extracted from.
      "packages/ui/src/**/*.{ts,tsx}",
      // Mobile shell (M1): same browser/React rule set.
      "apps/mobile/src/**/*.{ts,tsx}",
      "apps/mobile/vite.config.ts",
      "apps/mobile/capacitor.config.ts",
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
  {
    // Production-bundle init-order guard across all shipped source (desktop, ui,
    // core, mobile). Scoped to `src`, minus co-located tests: test files run
    // under Vitest (eager, correct module order like the dev server) and are
    // never in the shipped bundle, so the footgun cannot apply to them.
    files: ["**/src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
    plugins: { plainva: plainvaPlugin },
    rules: {
      "plainva/no-top-level-imported-static-read": "error",
    },
  },
);
