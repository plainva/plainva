import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSync } from "vite";
import { PACKAGE_BARRELS } from "../../../scripts/vite/packageBarrels.mjs";
import { barrelImports } from "../../../scripts/vite/barrelImports.mjs";

/**
 * Surfaces that are no surface of the AI load no code of the AI when they open (review of L5, round 2, 2026-11-25):
 * the phone's search loaded 26 modules of the harness with its first opening, the desktop's settings 222 with the
 * dialog. Each surface's static imports are followed the way the build follows them — through the plugin that points
 * an import of a package entry at the defining module — and none may reach `packages/{core,ui}/src/ai/`. A part of the
 * AI they draw comes through `aiComponent` / a dynamic import, which this leaves out, as the build loads it later.
 */
const ROOT = resolve(__dirname, "../../..");
const SURFACES = [
  "apps/mobile/src/screens/SearchScreen.tsx",
  "apps/mobile/src/screens/base/BaseScreen.tsx",
  "apps/mobile/src/SettingsScreen.tsx",
  "apps/desktop/src/components/SettingsModal.tsx",
  "apps/desktop/src/components/BaseViewer.tsx",
];
const AI = /packages\/(?:core|ui)\/src\/ai\//;
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

function resolveFile(base: string): string | null {
  const stem = base.replace(/\.(js|mjs|ts|tsx)$/, "");
  for (const candidate of [base, ...EXTENSIONS.map((e) => stem + e), ...EXTENSIONS.map((e) => join(base, "index" + e))]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function target(from: string, spec: string): string | null {
  if (spec.startsWith(".")) return resolveFile(resolve(dirname(from), spec));
  if ((PACKAGE_BARRELS as Record<string, string>)[spec]) return (PACKAGE_BARRELS as Record<string, string>)[spec]!;
  const own = /^@plainva\/(core|ui)\/(.+)$/.exec(spec);
  if (own) return resolveFile(join(ROOT, "packages", own[1]!, "src", own[2]!));
  if (spec.startsWith("/")) return resolveFile(spec);
  return null; // a package of node_modules
}

type Node = { type: string; [key: string]: unknown };
const plugin = barrelImports(PACKAGE_BARRELS) as unknown as { buildStart(): void; transform(code: string, id: string): { code: string } | null };

/** The modules a file reaches by static value imports, as the build sees them. */
function staticClosure(entry: string): Set<string> {
  plugin.buildStart();
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file) || /\.(json|css|d\.ts|d\.mts)$/.test(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    const code = plugin.transform(text, file)?.code ?? text;
    const { program } = parseSync(file, code, { lang: file.endsWith(".tsx") ? "tsx" : "ts" });
    for (const node of program.body as unknown as Node[]) {
      const source = node.source as Node | undefined;
      if (!source || typeof source.value !== "string") continue;
      if (node.type === "ImportDeclaration") {
        if (node.importKind === "type") continue;
        const specifiers = node.specifiers as Node[];
        if (specifiers.length > 0 && specifiers.every((s) => s.importKind === "type")) continue;
      } else if (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") {
        if (node.exportKind === "type") continue;
      } else continue;
      const next = target(file, source.value);
      if (next) queue.push(next);
    }
  }
  return seen;
}

describe("surfaces that are no surface of the AI", () => {
  for (const surface of SURFACES) {
    it(`${surface} reaches no module of the AI by its static imports`, () => {
      expect.hasAssertions();
      const reached = [...staticClosure(join(ROOT, surface))].map((file) => relative(ROOT, file));
      expect(reached.length).toBeGreaterThan(20);
      expect(reached.filter((file) => AI.test(file))).toEqual([]);
    }, 60_000);
  }
});

/**
 * The sync worker stays out of the start: the status lines of both shells name the minutes of a stuck sync, and
 * taking that number from `SyncWorker.ts` put the whole worker (about 50 KB) into the start files of both shells
 * (review of B2, 2026-11-27). The same plugin the build uses points the import at its defining module, which must be
 * `sync/syncStuck.ts`; the worker loads when a sync starts.
 */
describe("status lines that name a stuck sync", () => {
  for (const surface of ["apps/desktop/src/components/StatusBar.tsx", "apps/mobile/src/components/syncSubtitle.ts"]) {
    it(`${surface} takes the minutes of a stuck sync from a module that is not the sync worker`, () => {
      expect.hasAssertions();
      plugin.buildStart();
      const file = join(ROOT, surface);
      const code = plugin.transform(readFileSync(file, "utf8"), file)?.code ?? "";
      const line = code.split("\n").find((l) => /\bSYNC_STUCK_AFTER_MINUTES\b/.test(l) && /\bfrom\b/.test(l)) ?? "";
      expect(line.split("\\").join("/")).toContain("packages/core/src/sync/syncStuck");
      expect(line).not.toMatch(/SyncWorker/);
    }, 60_000);
  }
});
