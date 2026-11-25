/* global console, process */
/**
 * Imports from the packages' entries go straight to the module that defines each name (performance plan L5).
 *
 * `@plainva/core` and `@plainva/ui` are barrels: one `index.ts` that re-exports hundreds of modules with
 * `export * from`. The production bundles keep `strictExecutionOrder` (modules run in the order their imports say,
 * whichever chunk they land in), and under it the barrel's own initialisation runs every module it re-exports. A
 * single `import { toast } from "@plainva/ui"` in the start bundle therefore carried the whole package into it — the
 * AI harness, the database views, the templates, a catalogue no runtime code reads. This plugin reads the barrels'
 * export statements and rewrites each named import of a barrel to the defining module, so a module runs, and is
 * bundled, only where something imports it. What the barrels export does not change; tests and the dev server keep
 * the barrels as they are (the plugin applies to builds only).
 *
 * Read by text, as the build reads the sources: `export * from`, `export { a, b as c } from`, and the local
 * `export function|class|const|let|var|enum|interface|type|abstract class|async function` and `export { a, b }`
 * of each module. A name the map cannot place, a namespace import or a dynamic import keeps the barrel.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const EXTENSIONS = [".ts", ".tsx", ".mts", ".js"];

function resolveFile(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  const stem = base.replace(/\.(js|mjs|ts|tsx)$/, "");
  for (const candidate of [base, ...EXTENSIONS.map((ext) => stem + ext), ...EXTENSIONS.map((ext) => path.join(base, "index" + ext))]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/.*$/gm, "$1");

/** The entry file of a package specifier among the barrels, set by `barrelImports`. */
let packageEntries = {};
const targetOf = (from, spec) => (spec.startsWith(".") ? resolveFile(from, spec) : (packageEntries[spec] ?? null));

/** Names a module exports, each with the module and name that define it. */
function exportsOf(file, seen = new Map()) {
  if (seen.has(file)) return seen.get(file);
  const names = new Map();
  seen.set(file, names);
  const source = stripComments(fs.readFileSync(file, "utf8"));
  // Re-exports of names: `export { a, b as c } from "./x"` (types included; they never reach the bundle).
  for (const m of source.matchAll(/export\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    if (m[1]) continue;
    const target = targetOf(file, m[3]);
    for (const part of m[2].split(",")) {
      const item = part.trim();
      if (!item || item.startsWith("type ")) continue;
      const [imported, local = imported] = item.split(/\s+as\s+/).map((s) => s.trim());
      if (!target) continue;
      const inner = exportsOf(target, seen).get(imported);
      names.set(local, inner ?? { file: target, name: imported });
    }
  }
  // Local declarations.
  for (const m of source.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(function\*?|class|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/g)) {
    names.set(m[2], { file, name: m[2] });
  }
  // `export const { a, b } = …` is not used in these packages; local `export { a, b as c }` is. A local name that
  // the module imported from another one leads there: the module that defines it is the one to load.
  const imported = new Map();
  for (const m of source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const target = targetOf(file, m[2]);
    if (!target) continue;
    for (const part of m[1].split(",")) {
      const item = part.trim().replace(/^type\s+/, "");
      if (!item) continue;
      const [name, local = name] = item.split(/\s+as\s+/).map((s) => s.trim());
      imported.set(local, { target, name });
    }
  }
  for (const m of source.matchAll(/export\s+\{([^}]*)\}\s*(?!\s*from)(?=;|\n|$)/g)) {
    for (const part of m[1].split(",")) {
      const item = part.trim();
      if (!item || item.startsWith("type ")) continue;
      const [local, exported = local] = item.split(/\s+as\s+/).map((s) => s.trim());
      if (names.has(exported)) continue;
      const via = imported.get(local);
      const origin = via ? (exportsOf(via.target, seen).get(via.name) ?? { file: via.target, name: via.name }) : { file, name: local };
      names.set(exported, origin);
    }
  }
  // `export * from "./x"`: everything x exports, unless named here already.
  for (const m of source.matchAll(/export\s+\*\s+from\s*["']([^"']+)["']/g)) {
    const target = targetOf(file, m[1]);
    if (!target) continue;
    for (const [name, origin] of exportsOf(target, seen)) if (!names.has(name)) names.set(name, origin);
  }
  return names;
}

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
  const specs = Object.keys(barrels).map((s) => s.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|");
  // `import { … } from "<entry>"` and `export { … } from "<entry>"` (a module that hands names of an entry on).
  const IMPORT = new RegExp(`(import|export)\\s+(type\\s+)?\\{([^}]*)\\}\\s*from\\s*["'](${specs})["'];?`, "g");
  // `const { a, b: c } = await import("<entry>")`: a dynamic import that takes names of an entry.
  const DYNAMIC = new RegExp(`const\\s*\\{([^}]*)\\}\\s*=\\s*await\\s+import\\(\\s*["'](${specs})["']\\s*\\)`, "g");
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
      if (!/\.(tsx?|mts|jsx?|mjs)$/.test(id.split("?")[0]) || id.includes("node_modules")) return null;
      IMPORT.lastIndex = 0;
      DYNAMIC.lastIndex = 0;
      if (!IMPORT.test(code) && !DYNAMIC.test(code)) return null;
      IMPORT.lastIndex = 0;
      DYNAMIC.lastIndex = 0;
      const dynamicOut = code.replace(DYNAMIC, (whole, list, spec) => {
        const map = mapOf(spec);
        const files = [];
        const picks = [];
        for (const part of list.split(",")) {
          const item = part.trim();
          if (!item) continue;
          const [name, binding = name] = item.split(":").map((x) => x.trim());
          const origin = map.get(name);
          if (!origin || /[=.\s]/.test(name)) return whole;
          let at = files.indexOf(origin.file);
          if (at < 0) at = files.push(origin.file) - 1;
          picks.push(`${name}: __m${at}.${origin.name}`);
          void binding;
        }
        rewritten += 1;
        const modules = files.map((file) => `import(${JSON.stringify(file)})`).join(", ");
        const params = files.map((_, i) => `__m${i}`).join(", ");
        return `const {${list}} = await Promise.all([${modules}]).then(([${params}]) => ({ ${picks.join(", ")} }))`;
      });
      const out = dynamicOut.replace(IMPORT, (whole, keyword, typeOnly, list, spec) => {
        if (typeOnly) return whole;
        const map = mapOf(spec);
        const byFile = new Map();
        const kept = [];
        for (const part of list.split(",")) {
          const item = part.trim();
          if (!item) continue;
          if (item.startsWith("type ")) continue;
          const [imported, local = imported] = item.split(/\s+as\s+/).map((s) => s.trim());
          const origin = map.get(imported);
          if (!origin) {
            unplaced.add(`${spec}:${imported}`);
            kept.push(item);
            continue;
          }
          const entry = origin.name === local ? local : `${origin.name} as ${local}`;
          if (!byFile.has(origin.file)) byFile.set(origin.file, []);
          byFile.get(origin.file).push(entry);
        }
        rewritten += 1;
        const lines = [...byFile].map(([file, items]) => `${keyword} { ${items.join(", ")} } from ${JSON.stringify(file)};`);
        if (kept.length) lines.push(`${keyword} { ${kept.join(", ")} } from "${spec}";`);
        // One line per import keeps the line numbers of the file for the source maps.
        return lines.join(" ");
      });
      return out === code ? null : { code: out, map: null };
    },
    buildEnd() {
      if (process.env.PLAINVA_BARREL_DEBUG) console.log(`barrel imports rewritten: ${rewritten}; not placed (types, or kept on the barrel): ${[...unplaced].sort().join(" ")}`);
    },
  };
}
