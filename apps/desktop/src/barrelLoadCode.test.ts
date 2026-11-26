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
 * Load code: a top-level statement that is no declaration, import or export (also inside a `namespace`); an import
 * for its effect alone; a top-level initializer, a default export or a static member of a class that calls something
 * acting outside the module (register, install, subscribe, a listener — `on`, `addListener` —, a timer,
 * `Object.assign`, `window`/`document`/`globalThis`), also behind `as`, `!`, `satisfies`, brackets, `??`/`||`/`&&` or
 * `?:`; an immediately called function; a `static {}` block.
 *
 * Not seen, as a sentence for whoever reads this: a call whose name says nothing (`setup()`, `x.go()`) — a module
 * that registers through such a name must be named here by hand; and code that runs only when something of the
 * module is first used (a getter, a lazy initialiser), which runs where it is used anyway.
 */
const ROOT = resolve(__dirname, "../../..");

const ACTS = /^(?:register\w*|install\w*|subscribe\w*|addEventListener|addListener|on|once|listen\w*|setInterval|setTimeout|configure\w*|init\w*|patch\w*|polyfill\w*|define|assign)$/;
const GLOBAL = /^(?:window|document|globalThis|self|navigator)$/;
const LOCAL_DEFINE = /^(?:Facet|StateEffect|StateField|Annotation|HighlightStyle|ViewPlugin)$/;
const DECLARATIONS = new Set(["VariableDeclaration", "FunctionDeclaration", "ClassDeclaration", "TSInterfaceDeclaration", "TSTypeAliasDeclaration", "TSEnumDeclaration", "TSModuleDeclaration", "TSDeclareFunction", "EmptyStatement"]);
/** Wrappers that change no value: `(x)`, `x as T`, `x!`, `x satisfies T`, `<T>x`. */
const WRAPPERS = new Set(["ParenthesizedExpression", "TSAsExpression", "TSNonNullExpression", "TSSatisfiesExpression", "TSTypeAssertion", "TSInstantiationExpression"]);

type Node = { type: string; [key: string]: unknown };

/** The name a call reaches for (`a.b.register(…)` → register), and the object it starts from (`a`). */
function callee(node: Node): { name: string; root: string } | null {
  let target = node.callee as Node;
  if (!target) return null;
  while (WRAPPERS.has(target.type)) target = target.expression as Node;
  if (target.type === "Identifier") return { name: target.name as string, root: target.name as string };
  if (target.type === "MemberExpression" || target.type === "StaticMemberExpression") {
    const name = ((target.property as Node)?.name as string) ?? "";
    while (target.type === "MemberExpression" || target.type === "StaticMemberExpression" || WRAPPERS.has(target.type)) target = (target.object ?? target.expression) as Node;
    return { name, root: target.type === "Identifier" ? (target.name as string) : "" };
  }
  return null;
}

/**
 * Whether an expression that runs while the module loads acts outside it: an immediately called function (its body
 * runs, and what it does is not read here), an `await`, a call that registers, installs, subscribes, listens, sets a
 * timer, assigns into another object (`Object.assign`) or reaches a global — also inside a wrapper, either side of
 * `??`/`||`/`&&`, a branch of `?:` or a sequence. CodeMirror's `Facet.define` and its kin are local.
 */
function exprActs(node: Node | null | undefined): boolean {
  if (!node) return false;
  if (WRAPPERS.has(node.type)) return exprActs(node.expression as Node);
  if (node.type === "AwaitExpression") return true;
  if (node.type === "LogicalExpression" || node.type === "BinaryExpression") return exprActs(node.left as Node) || exprActs(node.right as Node);
  if (node.type === "ConditionalExpression") return exprActs(node.test as Node) || exprActs(node.consequent as Node) || exprActs(node.alternate as Node);
  if (node.type === "SequenceExpression") return (node.expressions as Node[]).some(exprActs);
  if (node.type !== "CallExpression" && node.type !== "NewExpression") return false;
  let fn = node.callee as Node;
  while (WRAPPERS.has(fn.type)) fn = fn.expression as Node;
  if (fn.type === "ArrowFunctionExpression" || fn.type === "FunctionExpression") return true;
  const c = callee(node);
  if (!c) return false;
  if (GLOBAL.test(c.root)) return true;
  if (c.name === "define" && LOCAL_DEFINE.test(c.root)) return false;
  return ACTS.test(c.name) || (node.arguments as Node[]).some(exprActs);
}

/** What a class runs while it is defined: a `static {}` block, a static field's initializer. */
function classActs(node: Node): boolean {
  for (const member of ((node.body as Node)?.body as Node[]) ?? []) {
    if (member.type === "StaticBlock") return true;
    if ((member.type === "PropertyDefinition" || member.type === "AccessorProperty") && member.static && exprActs(member.value as Node)) return true;
  }
  return false;
}

/** Load code among the statements of a module or of a namespace's body. */
function statementsActing(statements: Node[], code: string, found: string[]): void {
  for (const node of statements) {
    const text = code.slice(node.start as number, Math.min(node.end as number, (node.start as number) + 60)).replace(/\s+/g, " ");
    if (node.type === "ImportDeclaration") {
      if ((node.specifiers as unknown[]).length === 0 && node.importKind !== "type") found.push(`import for its effect: ${text}`);
      continue;
    }
    if (node.type === "ExportAllDeclaration") continue;
    if (node.type === "ExportDefaultDeclaration") {
      const d = node.declaration as Node;
      if (d.type === "ClassDeclaration" || d.type === "ClassExpression" ? classActs(d) : exprActs(d)) found.push(`default export acts: ${text}`);
      continue;
    }
    const declaration = node.type === "ExportNamedDeclaration" ? (node.declaration as Node | null) : node;
    if (!declaration) continue;
    if (declaration.type === "VariableDeclaration") {
      for (const d of declaration.declarations as Node[]) if (exprActs(d.init as Node)) found.push(`initializer acts: ${text}`);
      continue;
    }
    if (declaration.type === "ClassDeclaration") {
      if (classActs(declaration)) found.push(`class runs code: ${text}`);
      continue;
    }
    if (declaration.type === "TSModuleDeclaration") {
      let body = declaration.body as Node | null;
      while (body && body.type === "TSModuleDeclaration") body = body.body as Node | null;
      if (body && Array.isArray(body.body)) statementsActing(body.body as Node[], code, found);
      continue;
    }
    if (!DECLARATIONS.has(declaration.type)) found.push(`statement: ${text}`);
  }
}

/** Load code of a module, as short descriptions; empty when it runs none. */
function loadCodeOf(file: string, code: string): string[] {
  const { program, errors } = parseSync(file, code, { lang: file.endsWith(".tsx") ? "tsx" : "ts" });
  if (errors.length) throw new Error(`${file}: ${errors[0]!.message}`);
  const found: string[] = [];
  statementsActing(program.body as unknown as Node[], code, found);
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
  "packages/core/src/inlineParseBudget.ts": "an immediately called function builds its own table of characters (`ROW_CHAR`); nothing outside the module",
  "packages/ui/src/mail/net/mime.ts": "an immediately called function builds its own base64 table (`BASE64_VALUE`); nothing outside the module",
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

  it("sees the forms a registration can hide in: wrappers, logic, an IIFE, class statics, a default export, a namespace, a listener", () => {
    expect.hasAssertions();
    const forms: Record<string, string> = {
      "iife.ts": 'import { registry } from "./registry";\nexport const v = (() => { registry.register("a"); return 1; })();\n',
      "cast.ts": 'import { registry } from "./registry";\nexport const v = registry.register("b") as number;\n',
      "nonnull.ts": 'import { registry } from "./registry";\nexport const v = registry.register("c")!;\n',
      "logical.ts": 'import { registry } from "./registry";\nexport const v = null ?? registry.register("d");\n',
      "paren.ts": 'import { registry } from "./registry";\nexport const v = (registry.register("e"));\n',
      "staticblock.ts": 'import { registry } from "./registry";\nexport class K { static { registry.register("f"); } }\n',
      "staticfield.ts": 'import { registry } from "./registry";\nexport class L { static id = registry.register("g"); }\n',
      "assign.ts": 'import { registry } from "./registry";\nexport const v = Object.assign(registry, { extra: 1 });\n',
      "defaultcall.ts": 'import { registry } from "./registry";\nexport default registry.register("h");\nexport const w = 1;\n',
      "namespace.ts": 'import { registry } from "./registry";\nexport namespace N { registry.register("i"); }\n',
      "listen.ts": 'import { bus } from "./registry";\nexport const off = bus.on("x", () => undefined);\n',
      "pure.ts": "export const facet = Facet.define();\nexport const list = [1, 2].map((x) => x * 2);\nexport class P { static none = 1; }\n",
    };
    for (const [name, text] of Object.entries(forms)) write(`forms/${name}`, text);
    write("forms/registry.ts", "export const registry = { register(_: string) { return 1; } };\nexport const bus = { on(_: string, __: () => void) { return () => undefined; } };\n");
    const entry = write("forms/index.ts", Object.keys(forms).map((name) => `export * from "./${name.replace(/\.ts$/, "")}";`).join("\n") + "\n");
    const found = [...reached([entry], {})].filter(([, code]) => loadCodeOf("x.ts", code).length > 0).map(([file]) => relative(fixture, file)).sort();
    expect(found).toEqual(Object.keys(forms).filter((name) => name !== "pure.ts").map((name) => `forms/${name}`).sort());
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
