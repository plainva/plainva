import { describe, it, expect, vi } from "vitest";
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Walks the whole source tree from disk: about half a second on its own, but past
// the 5 s unit-test default under the full suite's parallel load — six of these
// guards timed out at once and passed in isolation (2026-08-24). A default meant
// for unit tests is the wrong yardstick for a check whose runtime grows with the
// repo; 30 s still catches a hang.
vi.setConfig({ testTimeout: 30_000 });

/**
 * C20: work that runs while a MODULE is loading and reaches across a package
 * boundary.
 *
 * Twice this shipped a white window, and both times only the production smoke
 * caught it:
 *
 * - v0.3.0: `searchSnippet.tsx` read `VaultQueryService.SNIPPET_MARK_START` at
 *   module top level. In the bundle that module was evaluated BEFORE the chunk
 *   holding the class, so the read hit `undefined` and the app never mounted.
 * - S20 (2026-08-14): `settingsProfile` built its field list at load time from
 *   a constant in another chunk, and the new import edge made rolldown run an
 *   interop call before the chunk it referenced.
 *
 * Dev is fine in both cases, and so are the unit tests and the E2E — they
 * import modules in source order, not in the order a bundler decides. Only a
 * production bundle reorders chunks, which is why nothing short of the smoke
 * ever noticed.
 *
 * The rule this enforces: at module top level, do not CALL a function or READ a
 * property off a binding imported from another package. Inside a function body
 * the same code is fine — by the time anything calls it, every chunk is loaded.
 *
 * The budget below freezes what exists today. It is NOT a clean bill of health:
 * these fourteen files carry the very pattern that broke twice, they simply
 * have not been hit by a chunk order that exposes it. The budget only ever
 * shrinks; a new entry needs a reason in the same commit, and the honest fix is
 * to move the work into a function and call it from one.
 *
 * A related but different cycle risk — a module in packages/ui importing from
 * its own barrel — has its own rule in sharedUiPurity.test.ts, since that one
 * is never acceptable and needs no budget.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const REPO = join(SRC, "../../..");
const ROOTS = ["apps/desktop/src", "apps/mobile/src", "packages/ui/src", "packages/core/src"];

/** Per file: how many cross-boundary module-init sites are tolerated today. */
const BUDGET: Record<string, number> = {
  // Four bar definitions built from a shared factory while the module loads.
  "apps/desktop/src/components/AppRibbon.tsx": 1,
  "apps/desktop/src/components/LeftPinnedSections.tsx": 1,
  "apps/desktop/src/components/LeftSidebarTabs.tsx": 1,
  "apps/desktop/src/components/RightSidebar.tsx": 1,
  // Twenty-one of them in this one file — the S20 shape, at scale.
  "apps/mobile/src/services/mobileSettingsScope.ts": 21,
  "apps/mobile/src/services/mobileSettingsSync.ts": 1,
  // Entry points: these run first by construction, so their chunk cannot be
  // reordered ahead of themselves. The least risky of the lot. Down from 6 with
  // multi-window P0: the mail platform registration and the two token resolvers
  // now run inside the owner-window branch, so they are no longer module-init
  // work at all.
  "apps/desktop/src/main.tsx": 4,
  "apps/mobile/src/main.tsx": 2,
  "apps/desktop/src/test-setup.ts": 4,
  // Shape of the v0.3.0 defect: reading off an imported constant at load time.
  "apps/mobile/src/screens/base/BaseConfigSheet.tsx": 2,
  "apps/desktop/src/services/deviceSignIn.ts": 1,
  "apps/mobile/src/services/deviceSignIn.ts": 1,
};

interface Finding {
  file: string;
  kind: "call" | "read";
  name: string;
  line: number;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

/** Value bindings this file imports from ANOTHER package. Types are erased at
 *  build time and can never run, so they are not part of the question. */
function crossPackageBindings(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!st.moduleSpecifier.text.startsWith("@plainva/")) continue;
    const clause = st.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) names.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) if (!el.isTypeOnly) names.add(el.name.text);
    }
    if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
  }
  return names;
}

function scan(file: string, text: string): Finding[] {
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const cross = crossPackageBindings(sf);
  if (cross.size === 0) return [];

  const found: Finding[] = [];
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;

  // Only what RUNS at load time: every function and class body is skipped, so
  // the same call inside a component or a handler is deliberately not a finding.
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isGetAccessor(node) ||
      ts.isSetAccessor(node)
    ) {
      return;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const root = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
          ? callee.expression.text
          : null;
      if (root && cross.has(root)) found.push({ file, kind: "call", name: root, line: line(node) });
    } else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      cross.has(node.expression.text)
    ) {
      found.push({
        file,
        kind: "read",
        name: `${node.expression.text}.${node.name.text}`,
        line: line(node),
      });
    }
    ts.forEachChild(node, visit);
  };

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) continue;
    if (ts.isVariableStatement(st)) {
      for (const decl of st.declarationList.declarations) if (decl.initializer) visit(decl.initializer);
    } else if (ts.isExpressionStatement(st)) {
      visit(st.expression);
    }
  }
  return found;
}

function scanAll(): Finding[] {
  const all: Finding[] = [];
  for (const root of ROOTS) {
    for (const file of walk(join(REPO, root))) {
      const rel = relative(REPO, file).replace(/\\/g, "/");
      all.push(...scan(rel, readFileSync(file, "utf8")));
    }
  }
  return all;
}

function countByFile(findings: Finding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.file, (counts.get(f.file) ?? 0) + 1);
  return counts;
}

describe("module-init work across package boundaries (C20)", () => {
  const findings = scanAll();
  const counts = countByFile(findings);

  it("no file exceeds its budget of cross-boundary module-init sites", () => {
    const over: string[] = [];
    for (const [file, n] of counts) {
      const allowed = BUDGET[file] ?? 0;
      if (n > allowed) {
        const where = findings
          .filter((f) => f.file === file)
          .map((f) => `${f.kind} ${f.name}:${f.line}`)
          .join(", ");
        over.push(`${file}: ${n} > ${allowed} (${where})`);
      }
    }
    expect(over.sort()).toEqual([]);
  });

  it("the budget only shrinks — no stale entries", () => {
    const stale = Object.entries(BUDGET)
      .filter(([file, allowed]) => (counts.get(file) ?? 0) < allowed)
      .map(([file, allowed]) => `${file}: budget ${allowed}, actual ${counts.get(file) ?? 0}`);
    expect(stale.sort()).toEqual([]);
  });

  it("catches both shapes that shipped a white window", () => {
    // v0.3.0: reading a class static off an imported binding at module level.
    const v030 = scan(
      "probe.ts",
      `import { VaultQueryService } from "@plainva/core";\nconst MARK = VaultQueryService.SNIPPET_MARK_START;\n`
    );
    expect(v030).toHaveLength(1);
    expect(v030[0]!.kind).toBe("read");

    // S20: calling an imported function while the module loads.
    const s20 = scan(
      "probe.ts",
      `import { profileDefault } from "@plainva/ui";\nconst FIELDS = profileDefault("a");\n`
    );
    expect(s20).toHaveLength(1);
    expect(s20[0]!.kind).toBe("call");

    // …and the same code inside a function is deliberately fine: by the time
    // anything calls it, every chunk is loaded. A guard that flagged this too
    // would be turned off within a week.
    expect(
      scan(
        "probe.ts",
        `import { profileDefault } from "@plainva/ui";\nexport function build() { return profileDefault("a"); }\n`
      )
    ).toEqual([]);

    // A type-only import cannot run at all.
    expect(
      scan("probe.ts", `import type { Thing } from "@plainva/ui";\nconst X: Thing[] = [];\n`)
    ).toEqual([]);
  });
});
