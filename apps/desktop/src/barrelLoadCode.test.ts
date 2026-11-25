import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseSync } from "vite";
import { PACKAGE_BARRELS } from "../../../scripts/vite/packageBarrels.mjs";

/**
 * Load code behind the build plugin (review of L5, round 2, 2026-11-25).
 *
 * In a build, `barrelImports.mjs` points each named import of a package entry at the module that defines the name.
 * A module the entries reach through `export *` or `export { … } from` therefore runs only where something imports
 * a name from it — no longer because the entry ran. Code such a module runs while it loads (a registration, a
 * listener, a global it sets) would be skipped silently in a module nobody imports a name from. Every module the
 * entries reach that runs code at load is listed here, with why that is safe; a new one fails until it is.
 *
 * Load code: a top-level statement that is no declaration, import or export; an import for its effect alone; or a
 * top-level initializer that calls something that acts outside the module (register, install, subscribe, a listener,
 * a timer, `window`/`document`/`globalThis`).
 */
const ROOT = resolve(__dirname, "../../..");

const ACTS = /^(?:register\w*|install\w*|subscribe\w*|addEventListener|setInterval|setTimeout|configure\w*|init\w*|patch\w*|polyfill\w*|define)$/;
const GLOBAL = /^(?:window|document|globalThis|self|navigator)$/;
const DECLARATIONS = new Set(["VariableDeclaration", "FunctionDeclaration", "ClassDeclaration", "TSInterfaceDeclaration", "TSTypeAliasDeclaration", "TSEnumDeclaration", "TSModuleDeclaration", "TSDeclareFunction", "EmptyStatement"]);

type Node = { type: string; [key: string]: unknown };

/** The name a call reaches for (`a.b.register(…)` → register), and the object it starts from (`a`). */
function callee(node: Node): { name: string; root: string } | null {
  let target = node.callee as Node;
  if (!target) return null;
  if (target.type === "Identifier") return { name: target.name as string, root: target.name as string };
  if (target.type === "MemberExpression" || target.type === "StaticMemberExpression") {
    const name = ((target.property as Node)?.name as string) ?? "";
    while (target.type === "MemberExpression" || target.type === "StaticMemberExpression") target = target.object as Node;
    return { name, root: target.type === "Identifier" ? (target.name as string) : "" };
  }
  return null;
}

/** Whether an initializer calls something that acts outside the module (`Facet.define` of CodeMirror is local). */
function initializerActs(init: Node | null | undefined): boolean {
  if (!init) return false;
  if (init.type !== "CallExpression" && init.type !== "NewExpression" && init.type !== "AwaitExpression") return false;
  if (init.type === "AwaitExpression") return true;
  const c = callee(init);
  if (!c) return false;
  if (GLOBAL.test(c.root)) return true;
  if (c.name === "define" && /^(?:Facet|StateEffect|StateField|Annotation|HighlightStyle|ViewPlugin)$/.test(c.root)) return false;
  return ACTS.test(c.name);
}

/** Load code of a module, as short descriptions; empty when it runs none. */
function loadCodeOf(file: string, code: string): string[] {
  const { program, errors } = parseSync(file, code, { lang: file.endsWith(".tsx") ? "tsx" : "ts" });
  if (errors.length) throw new Error(`${file}: ${errors[0]!.message}`);
  const found: string[] = [];
  for (const node of program.body as unknown as Node[]) {
    const text = code.slice(node.start as number, Math.min(node.end as number, (node.start as number) + 60)).replace(/\s+/g, " ");
    if (node.type === "ImportDeclaration") {
      if ((node.specifiers as unknown[]).length === 0 && node.importKind !== "type") found.push(`import for its effect: ${text}`);
      continue;
    }
    if (node.type === "ExportAllDeclaration" || node.type === "ExportDefaultDeclaration") continue;
    const declaration = node.type === "ExportNamedDeclaration" ? (node.declaration as Node | null) : node;
    if (!declaration) continue;
    if (declaration.type === "VariableDeclaration") {
      for (const d of declaration.declarations as Node[]) if (initializerActs(d.init as Node)) found.push(`initializer acts: ${text}`);
      continue;
    }
    if (!DECLARATIONS.has(declaration.type)) found.push(`statement: ${text}`);
  }
  return found;
}

const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs"];
function resolveFile(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  const stem = base.replace(/\.(js|mjs|ts|tsx)$/, "");
  for (const candidate of [base, ...EXTENSIONS.map((e) => stem + e), ...EXTENSIONS.map((e) => join(base, "index" + e))]) {
    try {
      if (readFileSync(candidate)) return candidate;
    } catch {
      // not this one
    }
  }
  return null;
}

/** Every module the entries reach through their re-exports (`export *`, `export { … } from`), entries included. */
function reached(entries: string[], barrels: Record<string, string>): Map<string, string> {
  const seen = new Map<string, string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    const code = readFileSync(file, "utf8");
    seen.set(file, code);
    const { program } = parseSync(file, code, { lang: file.endsWith(".tsx") ? "tsx" : "ts" });
    for (const node of program.body as unknown as Node[]) {
      if ((node.type === "ExportAllDeclaration" || (node.type === "ExportNamedDeclaration" && node.source)) && node.exportKind !== "type") {
        const spec = (node.source as Node).value as string;
        const target = spec.startsWith(".") ? resolveFile(file, spec) : (barrels[spec] ?? null);
        if (target && !/\.d\.m?ts$/.test(target)) visit(target);
      }
    }
  };
  for (const entry of entries) visit(entry);
  return seen;
}

/** Modules with load code the entries reach, each with why skipping it can do no harm. */
const KNOWN: Record<string, string> = {
  "packages/core/src/import/index.ts":
    "an entry: its registrations fill `defaultImportRegistry`, which it exports itself — whoever reads the registry imports it from here and runs them (barrelImports never steps over it)",
  "packages/core/src/markdown-ast.ts": "assigns its own lazily built schemas to its own bindings; nothing outside the module",
  "packages/core/src/pim/mailColour.ts": "fills its own table of named colours from a string; nothing outside the module",
  "packages/ui/src/mail/net/charsets.ts": "adds aliases to its own table of charsets; nothing outside the module",
  "packages/ui/src/components/ui/AreaBoundary.tsx":
    "hands the e2e build its crash seam on `window` (`TEST_SEAM`, nothing in a release build); every area imports `AreaBoundary` from it by name, so it runs wherever an area is drawn",
};

describe("load code behind the build plugin", () => {
  const fixture = mkdtempSync(join(tmpdir(), "barrel-load-code-"));
  afterAll(() => rmSync(fixture, { recursive: true, force: true }));
  const write = (rel: string, text: string) => {
    const at = join(fixture, rel);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, text);
    return at;
  };

  it("finds load code in a module reached only through `export *` — the case this guard is for", () => {
    expect.hasAssertions();
    write("pkg/plain.ts", "export const plainValue = 1;\n");
    write("pkg/reg.ts", 'import { registry } from "./registry";\nexport const innerValue = 2;\nregistry.register("x");\n');
    write("pkg/init.ts", 'import { registry } from "./registry";\nexport const svc = registry.register("y");\nexport const theme = Facet.define();\n');
    write("pkg/side.ts", 'import "./polyfill";\nexport const s = 3;\n');
    write("pkg/registry.ts", "export const registry = { register(_: string) { return 1; } };\n");
    const entry = write("pkg/index.ts", 'export * from "./plain";\nexport * from "./reg";\nexport * from "./init";\nexport * from "./side";\n');
    const found = [...reached([entry], {})].map(([file, code]) => [relative(fixture, file), loadCodeOf(file, code)] as const).filter(([, hits]) => hits.length > 0);
    expect(Object.fromEntries(found)).toEqual({
      "pkg/reg.ts": ['statement: registry.register("x");'],
      "pkg/init.ts": ['initializer acts: export const svc = registry.register("y");'],
      "pkg/side.ts": ['import for its effect: import "./polyfill";'],
    });
  });

  it("is listed with its reason for every module of the seven entries that runs code at load", () => {
    expect.hasAssertions();
    const modules = reached(Object.values(PACKAGE_BARRELS) as string[], PACKAGE_BARRELS as Record<string, string>);
    expect(modules.size).toBeGreaterThan(500);
    const found: Record<string, string[]> = {};
    for (const [file, code] of modules) {
      const hits = loadCodeOf(file, code);
      if (hits.length > 0) found[relative(ROOT, file)] = hits;
    }
    expect(Object.keys(found).sort(), JSON.stringify(found, null, 2)).toEqual(Object.keys(KNOWN).sort());
  });
});
