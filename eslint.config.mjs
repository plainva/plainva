import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import regexp from "eslint-plugin-regexp";
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
    "no-real-clock-in-tests": {
      meta: {
        type: "problem",
        docs: {
          description:
            "End-to-end tests run on the fixed test clock and zone (stability plan R9): the page clock starts at TEST_NOW, and the runner side reads the same moment through testNow().",
        },
        schema: [],
        messages: {
          clock:
            "'{{what}}' on the runner side of an E2E test reads the real clock, which the page does not run on. Use testNow() from the shared clockedTest module (a test about the real clock: test.use({ testClock: \"real\" }) and realDateNow() from scripts/test-clock.mjs, with the reason).",
          import:
            "Import `test` from the app's clockedTest module, not from @playwright/test: only that `test` puts the page on the fixed test clock (stability plan R9).",
        },
      },
      create(context) {
        // Code inside a function handed to the page runs in the browser, on the
        // page clock that the shared `test` fixed — that is the clock to use there.
        const PAGE_SIDE = new Set(["addInitScript", "evaluate", "evaluateHandle", "evaluateAll", "waitForFunction", "$eval", "$$eval"]);
        function onPageSide(node) {
          for (let cur = node.parent; cur; cur = cur.parent) {
            if ((cur.type === "ArrowFunctionExpression" || cur.type === "FunctionExpression") && cur.parent && cur.parent.type === "CallExpression" && cur.parent.arguments.includes(cur)) {
              const callee = cur.parent.callee;
              if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" && PAGE_SIDE.has(callee.property.name)) return true;
            }
          }
          return false;
        }
        const isDate = (n) => n && n.type === "Identifier" && n.name === "Date";
        return {
          ImportDeclaration(node) {
            if (node.source.value !== "@playwright/test" || node.importKind === "type") return;
            for (const spec of node.specifiers) {
              if (spec.type === "ImportSpecifier" && spec.importKind !== "type" && spec.imported.name === "test") context.report({ node: spec, messageId: "import" });
            }
          },
          NewExpression(node) {
            if (isDate(node.callee) && node.arguments.length === 0 && !onPageSide(node)) context.report({ node, messageId: "clock", data: { what: "new Date()" } });
          },
          CallExpression(node) {
            const c = node.callee;
            if (isDate(c) && !onPageSide(node)) context.report({ node, messageId: "clock", data: { what: "Date()" } });
            if (c.type === "MemberExpression" && !c.computed && isDate(c.object) && c.property.name === "now" && !onPageSide(node)) context.report({ node, messageId: "clock", data: { what: "Date.now()" } });
          },
        };
      },
    },
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
      "**/dist-e2e/**",
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
    // Files served verbatim from public/ — Vite copies them without bundling
    // or transpiling. The boot guard lives here deliberately: it must run on an
    // engine that cannot parse the bundle, so it is plain ES5 with no imports
    // (see apps/desktop/public/boot-guard.js). ES5 has no optional catch
    // binding, hence caughtErrors: "none".
    files: ["apps/*/public/**/*.js"],
    languageOptions: {
      ecmaVersion: 5,
      sourceType: "script",
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { caughtErrors: "none" }],
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
  {
    // The fixed test clock (stability plan R9, scripts/test-clock.mjs). Unit
    // tests get it from the first vitest setup file without any rule; E2E specs
    // have a runner side that Playwright does not shift, so this rule keeps the
    // real clock out of it and every spec on the shared, clocked `test`.
    files: ["apps/*/e2e/**/*.ts", "apps/*/e2e-prod/**/*.ts"],
    ignores: ["apps/desktop/e2e/fixtures/clockedTest.ts", "apps/mobile/e2e-prod/clockedTest.ts"],
    plugins: { plainva: plainvaPlugin },
    rules: {
      "plainva/no-real-clock-in-tests": "error",
    },
  },
  {
    // Linear text scanning (docs/engineering/Text_Scanning.md). Text from
    // vaults, mail, calendars, providers and publications reaches these
    // patterns, and one that backtracks or moves super-linearly freezes the
    // window on a hostile note: code scanning found nineteen in five days
    // (September 2026), one of them exponential. Shipped sources only — tests
    // scan the repository's own files, never input from users or outside.
    files: [
      "packages/core/src/**/*.ts",
      "packages/ui/src/**/*.{ts,tsx}",
      "apps/desktop/src/**/*.{ts,tsx}",
      "apps/mobile/src/**/*.{ts,tsx}",
    ],
    ignores: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
    plugins: { regexp },
    rules: {
      "regexp/no-super-linear-backtracking": "error",
      "regexp/no-super-linear-move": "error",
    },
  },
  {
    // A promise nobody awaits, catches or marks (stability plan R4): its
    // failure was nobody's — a save, a deletion or an index step that went
    // wrong without a word. Every floating promise in shipped code is either
    // handled, or marked `void` on purpose: a marked one that rejects still
    // reaches the diagnostics through each shell's `unhandledrejection`
    // listener. Typed linting (the project service reads each package's own
    // tsconfig); measured 2026-11-11 at 17-81 s per package, about the time
    // of the untyped lint of the same package.
    files: [
      "packages/core/src/**/*.ts",
      "packages/ui/src/**/*.{ts,tsx}",
      "apps/desktop/src/**/*.{ts,tsx}",
      "apps/mobile/src/**/*.{ts,tsx}",
    ],
    ignores: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
);
