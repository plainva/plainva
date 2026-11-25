/* global console, process */
/**
 * Imports from the packages' entries go straight to the module that defines each name (performance plan L5).
 *
 * `@plainva/core` and `@plainva/ui` are barrels: one `index.ts` that re-exports hundreds of modules with
 * `export * from`. The production bundles keep `strictExecutionOrder` (modules run in the order their imports say,
 * whichever chunk they land in), and under it the barrel's own initialisation runs every module it re-exports. A
 * single `import { toast } from "@plainva/ui"` in the start bundle therefore carried the whole package into it — the
 * AI harness, the database views, the templates, a catalogue no runtime code reads. This plugin reads the barrels'
 * exports and rewrites each named import of a barrel to the defining module, so a module runs, and is bundled, only
 * where something imports it. What the barrels export does not change; tests and the dev server keep the barrels as
 * they are (the plugin applies to builds only).
 *
 * Read by the parser the build itself uses (oxc, through Vite), never by text: an import written inside a string, a
 * template or a comment is no import (review of L5, 2026-11-25 — the first version matched text). A module that runs
 * code while it loads — a statement that is no declaration, or an import for its effect alone (`import "./x"`) — is
 * never stepped over. A form it cannot place safely stops the build with the file and the reason, never a silent
 * guess: a name two `export *` hand on from different modules (the language exports neither), `export =`, a parse
 * error. A name the map cannot place, a default or namespace import, and a dynamic import whose names are not plain
 * keep the entry.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// The parser of the Vite the shell builds with (the plugin runs inside that build, and its tests in a shell's folder).
const viteAt = createRequire(path.join(process.cwd(), "package.json")).resolve("vite");
const { parseSync } = await import(pathToFileURL(viteAt).href);

const EXTENSIONS = [".ts", ".tsx", ".mts", ".js"];

function resolveFile(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  const stem = base.replace(/\.(js|mjs|ts|tsx)$/, "");
  for (const candidate of [base, ...EXTENSIONS.map((ext) => stem + ext), ...EXTENSIONS.map((ext) => path.join(base, "index" + ext))]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** The program of a source, or the build stops: a module this plugin cannot read is not one it may rewrite. */
function parse(file, code) {
  const result = parseSync(file, code, { lang: file.endsWith(".tsx") || file.endsWith(".jsx") ? "tsx" : "ts" });
  if (result.errors.length > 0) throw new Error(`[plainva-barrel-imports] ${file} does not parse: ${result.errors[0].message}`);
  return result.program;
}

/** The entry file of a package specifier among the barrels, set by `barrelImports`. */
let packageEntries = {};
const targetOf = (from, spec) => (spec.startsWith(".") ? resolveFile(from, spec) : (packageEntries[spec] ?? null));

const nameOf = (node) => (node.type === "Literal" ? String(node.value) : node.name);

/** The names a binding pattern declares (`const { a, b: [c] } = …`). */
function bindingNames(pattern, out = []) {
  if (!pattern) return out;
  if (pattern.type === "Identifier") out.push(pattern.name);
  else if (pattern.type === "ObjectPattern") for (const p of pattern.properties) bindingNames(p.type === "RestElement" ? p.argument : p.value, out);
  else if (pattern.type === "ArrayPattern") for (const e of pattern.elements) bindingNames(e?.type === "RestElement" ? e.argument : e, out);
  else if (pattern.type === "AssignmentPattern") bindingNames(pattern.left, out);
  return out;
}

const DECLARATIONS = new Set(["VariableDeclaration", "FunctionDeclaration", "ClassDeclaration", "TSInterfaceDeclaration", "TSTypeAliasDeclaration", "TSEnumDeclaration", "TSModuleDeclaration", "TSDeclareFunction", "TSImportEqualsDeclaration", "EmptyStatement"]);

/**
 * Whether a module runs code of its own while it loads: a statement that is no import, export or declaration
 * (`defaultImportRegistry.register(…)` in the import barrel), or an import for its effect alone. Such a module is
 * never stepped over: a name it hands on is imported from it, so its code runs as it did.
 */
function runsCodeAtLoad(program) {
  return program.body.some((node) => {
    if (node.type === "ImportDeclaration") return node.specifiers.length === 0 && node.importKind !== "type";
    if (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration" || node.type === "ExportDefaultDeclaration") return false;
    return !DECLARATIONS.has(node.type);
  });
}

/** Names a module exports, each with the module and name that define it. */
function exportsOf(file, seen = new Map()) {
  if (seen.has(file)) return seen.get(file);
  const names = new Map();
  seen.set(file, names);
  const program = parse(file, fs.readFileSync(file, "utf8"));
  const own = runsCodeAtLoad(program);
  const self = (name) => ({ file, name });
  // What the module imported by name: a local `export { a }` of one leads to the module that defines it.
  const imported = new Map();
  for (const node of program.body) {
    if (node.type !== "ImportDeclaration" || node.importKind === "type") continue;
    const target = targetOf(file, node.source.value);
    if (!target) continue;
    for (const s of node.specifiers) {
      if (s.type === "ImportSpecifier" && s.importKind !== "type") imported.set(s.local.name, { target, name: nameOf(s.imported) });
    }
  }
  const stars = [];
  for (const node of program.body) {
    if (node.type === "TSExportAssignment" || node.type === "TSNamespaceExportDeclaration") throw new Error(`[plainva-barrel-imports] ${file}: \`export =\` cannot be placed`);
    if (node.type === "ExportAllDeclaration") {
      if (node.exportKind === "type") continue;
      // `export * as ns from "./x"`: the namespace is this module's binding.
      if (node.exported) names.set(nameOf(node.exported), self(nameOf(node.exported)));
      else stars.push(node);
      continue;
    }
    if (node.type !== "ExportNamedDeclaration" || node.exportKind === "type") continue;
    if (node.declaration) {
      const d = node.declaration;
      if (d.type === "VariableDeclaration") for (const decl of d.declarations) for (const n of bindingNames(decl.id)) names.set(n, self(n));
      else if ((d.type === "FunctionDeclaration" || d.type === "ClassDeclaration" || d.type === "TSEnumDeclaration") && d.id && !d.declare) names.set(d.id.name, self(d.id.name));
      continue;
    }
    if (node.source) {
      // `export { a, b as c } from "./x"`.
      const target = targetOf(file, node.source.value);
      for (const s of node.specifiers) {
        if (s.exportKind === "type") continue;
        const local = nameOf(s.exported);
        const name = nameOf(s.local);
        if (!target) continue;
        names.set(local, own ? self(local) : (exportsOf(target, seen).get(name) ?? { file: target, name }));
      }
      continue;
    }
    // `export { a, b as c }` of local bindings.
    for (const s of node.specifiers) {
      if (s.exportKind === "type") continue;
      const local = nameOf(s.local);
      const exported = nameOf(s.exported);
      const via = imported.get(local);
      names.set(exported, own ? self(exported) : via ? (exportsOf(via.target, seen).get(via.name) ?? { file: via.target, name: via.name }) : self(local));
    }
  }
  // `export * from "./x"`: everything x exports, unless named here already. A name two stars hand on from different
  // modules is exported by neither (the language makes it ambiguous): the build stops rather than pick one.
  const fromStar = new Map();
  for (const node of stars) {
    const target = targetOf(file, node.source.value);
    if (!target) continue;
    for (const [name, origin] of exportsOf(target, seen)) {
      if (names.has(name) || name === "default") continue;
      const was = fromStar.get(name);
      if (was && (was.file !== origin.file || was.name !== origin.name)) {
        throw new Error(`[plainva-barrel-imports] ${file}: \`${name}\` comes from two \`export *\` (${was.file}, ${origin.file}); the language exports neither — name it once`);
      }
      fromStar.set(name, origin);
    }
  }
  for (const [name, origin] of fromStar) names.set(name, own ? self(name) : origin);
  return names;
}

/** Every node of a tree, depth first. */
function* nodes(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) yield* nodes(item);
    return;
  }
  if (typeof node.type === "string") yield node;
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end" || key === "type") continue;
    const value = node[key];
    if (value && typeof value === "object") yield* nodes(value);
  }
}

/** The text in place of `whole` with as many line breaks: the lines after it keep their numbers for the source maps. */
const sameLines = (whole, text) => text + "\n".repeat((whole.match(/\n/g) ?? []).length);

/**
 * @param {Record<string, string>} barrels the specifier of each barrel and the file of its entry
 */
export function barrelImports(barrels) {
  packageEntries = barrels;
  const maps = new Map();
  const mapOf = (spec) => {
    if (!maps.has(spec)) maps.set(spec, exportsOf(barrels[spec]));
    return maps.get(spec);
  };
  const specs = new Set(Object.keys(barrels));
  let rewritten = 0;
  const unplaced = new Set();
  return {
    name: "plainva-barrel-imports",
    apply: "build",
    enforce: "pre",
    buildStart() {
      maps.clear();
      rewritten = 0;
    },
    transform(code, id) {
      const file = id.split("?")[0];
      if (!/\.(tsx?|mts|jsx?|mjs)$/.test(file) || id.includes("node_modules")) return null;
      if (![...specs].some((spec) => code.includes(spec))) return null;
      const program = parse(file, code);
      const edits = [];
      // `import { … } from "<entry>"` and `export { … } from "<entry>"`, at the top of the module.
      for (const node of program.body) {
        const isImport = node.type === "ImportDeclaration";
        const isReexport = node.type === "ExportNamedDeclaration" && node.source && !node.declaration;
        if (!(isImport || isReexport) || !specs.has(node.source.value)) continue;
        if ((isImport && node.importKind === "type") || (isReexport && node.exportKind === "type")) continue;
        // A default or namespace import keeps the statement as it is (the entry is loaded for it anyway).
        if (isImport && node.specifiers.some((s) => s.type !== "ImportSpecifier")) continue;
        if (node.specifiers.length === 0) continue;
        const spec = node.source.value;
        const map = mapOf(spec);
        const keyword = isImport ? "import" : "export";
        const byFile = new Map();
        const kept = [];
        for (const s of node.specifiers) {
          if ((isImport ? s.importKind : s.exportKind) === "type") continue;
          const imported = nameOf(isImport ? s.imported : s.local);
          const local = nameOf(isImport ? s.local : s.exported);
          const origin = map.get(imported);
          const item = imported === local ? imported : `${imported} as ${local}`;
          if (!origin) {
            unplaced.add(`${spec}:${imported}`);
            kept.push(item);
            continue;
          }
          const entry = origin.name === local ? local : `${origin.name} as ${local}`;
          if (!byFile.has(origin.file)) byFile.set(origin.file, []);
          byFile.get(origin.file).push(entry);
        }
        const lines = [...byFile].map(([target, items]) => `${keyword} { ${items.join(", ")} } from ${JSON.stringify(target)};`);
        if (kept.length) lines.push(`${keyword} { ${kept.join(", ")} } from "${spec}";`);
        const whole = code.slice(node.start, node.end);
        edits.push({ start: node.start, end: node.end, text: sameLines(whole, lines.join(" ")) });
      }
      // `const { a, b: c } = await import("<entry>")`, anywhere: names of an entry taken from a dynamic import.
      for (const node of nodes(program)) {
        if (node.type !== "VariableDeclarator" || node.id.type !== "ObjectPattern") continue;
        const init = node.init;
        if (init?.type !== "AwaitExpression" || init.argument?.type !== "ImportExpression") continue;
        const source = init.argument.source;
        if (source.type !== "Literal" || !specs.has(source.value) || init.argument.options) continue;
        const map = mapOf(source.value);
        const props = node.id.properties;
        // Only plain names (`a`, `a: b`): a default, a computed key or a rest keeps the entry.
        if (props.some((p) => p.type !== "Property" || p.computed || p.key.type !== "Identifier" || p.value.type !== "Identifier")) continue;
        const files = [];
        const picks = [];
        let placed = true;
        for (const p of props) {
          const origin = map.get(p.key.name);
          if (!origin) {
            placed = false;
            break;
          }
          let at = files.indexOf(origin.file);
          if (at < 0) at = files.push(origin.file) - 1;
          picks.push(`${p.key.name}: __m${at}.${origin.name}`);
        }
        if (!placed || files.length === 0) continue;
        const modules = files.map((target) => `import(${JSON.stringify(target)})`).join(", ");
        const params = files.map((_, i) => `__m${i}`).join(", ");
        const whole = code.slice(init.start, init.end);
        edits.push({ start: init.start, end: init.end, text: sameLines(whole, `await Promise.all([${modules}]).then(([${params}]) => ({ ${picks.join(", ")} }))`) });
      }
      if (edits.length === 0) return null;
      rewritten += edits.length;
      edits.sort((a, b) => b.start - a.start);
      let out = code;
      for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
      return { code: out, map: null };
    },
    buildEnd() {
      if (process.env.PLAINVA_BARREL_DEBUG) console.log(`barrel imports rewritten: ${rewritten}; not placed (types, or kept on the barrel): ${[...unplaced].sort().join(" ")}`);
    },
  };
}
