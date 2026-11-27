/* global process, console */
// The files the note budget's search and check read (`note-budget.ts` and every module it imports, by relative
// path), and the files beside them that change what they measure: the calibration, the dependencies and their
// patches, the workflow. The performance workflow runs the check only when a push changes one of them (and
// daily on main); this is its list, taken from the imports so that it cannot fall behind them. Of the
// dependencies (`package.json`, `pnpm-lock.yaml`) a change counts where a line of it names a package the
// parses read with — micromark and its extensions, mdast and remark, the editor's Markdown — or the script of
// the measure: a lockfile that moves other packages alone (a dependency update elsewhere) measures nothing new.
//
//   node packages/core/scripts/perf/note-budget-inputs.mjs            # the list, one path a line
//   node packages/core/scripts/perf/note-budget-inputs.mjs --changed <base>   # "true" if a file of it differs from <base>
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const ENTRY = resolve(ROOT, "packages/core/scripts/perf/note-budget.ts");
const BESIDE = ["packages/core/scripts/perf/noteBudgetShells.json", "packages/core/package.json", "package.json", "pnpm-lock.yaml", "patches/", ".github/workflows/perf.yml"];
/** The dependency files whose change counts only where a changed line names what the parses read with. */
const DEPENDENCIES = new Set(["packages/core/package.json", "package.json", "pnpm-lock.yaml"]);
const PARSER_PACKAGES = /micromark|mdast-util|remark-|unified|@codemirror\/lang-markdown|@lezer\/markdown|"perf:notes"|"tsx"/;

function resolved(from, spec) {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(from), spec.replace(/\.(m?js)$/, ""));
  for (const end of ["", ".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts"]) {
    if (existsSync(base + end) && statSync(base + end).isFile()) return base + end;
  }
  return null;
}

export function noteBudgetInputs() {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:import|export)[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const next = resolved(file, match[1] ?? match[2]);
      if (next) walk(next);
    }
  };
  walk(ENTRY);
  return [...[...seen].map((file) => relative(ROOT, file)).sort(), ...BESIDE];
}

const args = process.argv.slice(2);
if (args[0] === "--changed") {
  const changed = execFileSync("git", ["diff", "--name-only", args[1], "HEAD"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const inputs = noteBudgetInputs();
  const parserLines = (path) =>
    execFileSync("git", ["diff", "--unified=0", args[1], "HEAD", "--", path], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
      .split("\n")
      .some((line) => /^[-+](?![-+])/.test(line) && PARSER_PACKAGES.test(line));
  const hit = changed.filter((path) => inputs.some((input) => (input.endsWith("/") ? path.startsWith(input) : path === input)) && (!DEPENDENCIES.has(path) || parserLines(path)));
  for (const path of hit) console.error(`changed: ${path}`);
  console.log(hit.length > 0 ? "true" : "false");
} else {
  console.log(noteBudgetInputs().join("\n"));
}
