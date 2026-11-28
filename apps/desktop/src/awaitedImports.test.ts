import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import UNBOUNDED from "./awaitedImports.unbounded.json";

/**
 * A step that waits for a module goes through `loadPart` (review of B1b, round 1, M-1): the wait has an end
 * (`PART_LOAD_TIMEOUT_MS`), and a failure is a `PartLoadError` that `errorText` and the boundaries say in the app's
 * words — never the browser's sentence, never a step that waits for ever.
 *
 * An `await import(…)` counts as bounded when it stands inside a `loadPart(` call (the destructuring form
 * `loadPart(async () => { const { x } = await import("@plainva/ui"); return x; })` keeps the build's rewrite of a
 * package entry to the defining module). `awaitedImports.unbounded.json` lists, per file, the awaited imports that are
 * not bounded yet (2026-11-28, 158 in 84 files); all stood on `main` before B1b. The list is a ratchet: a new
 * unbounded wait fails here, and a file whose count fell must lower its entry, so the list only shrinks (follow-up in
 * the maintainer's plan). What the person meets when such a load fails or hangs, by kind:
 *
 * - Platform bindings (`@tauri-apps/*`, `@capacitor/*`, 58): windows, dialogs, files, events of the native shell. A
 *   failure ends the step with its own message (most steps catch and toast it, through `errorText` the app's words); a
 *   hang leaves that step waiting — a dialog that does not open, an import or export that does not start. Writes that
 *   wait on one: the import wizard, the settings and archive export/import and the skill import read or write files
 *   through `plugin-fs` only after the person started them; no note is saved through them.
 * - The shells' services (66): account pages, sign-in and sign-out, PIM and widget wiring, window messages, the splash
 *   screen's window calls, the phone's settings sync. A failure ends the step with its message; a hang leaves it
 *   waiting. None of them is the save of a note, a send or a deletion: those waits go through `loadPart` since this rule
 *   (the draft journal in the editor and when a tab moves, the send queue and the mail transport, forgetting a vault,
 *   leaving before an update, completing a task from a widget or an intent, the phone's atomic file write and its sync
 *   modules).
 * - Package entries (`@plainva/core`, `@plainva/ui`, `/workspace`, `/mail`, 18): helpers a step takes on its way; as
 *   above.
 * - The AI (10): loads only while the AI is switched on; its surfaces report their failure.
 * - Diagnostics (4, `perfMetrics`): a measurement that does not come; nothing else depends on it.
 * - `packages/core` (4) and `packages/ui` (1): the core has no `loadPart` (no UI); the starter template registry.
 * - Rendering (1, mermaid): the diagram shows its error in place.
 */
const ROOT = resolve(__dirname, "../../..");
const DIRS = ["apps/desktop/src", "apps/mobile/src", "packages/ui/src", "packages/core/src"];

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "node_modules" && name !== "e2e") yield* sources(path);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) yield path;
  }
}

/** The awaited imports of a source text that stand outside a `loadPart(` call. */
export function unboundedAwaits(text: string): number {
  const code = text.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/[^\n]*/g, "$1");
  let count = 0;
  for (const match of code.matchAll(/await\s+import\s*\(/g)) {
    const before = code.slice(0, match.index);
    const at = before.lastIndexOf("loadPart(");
    if (at >= 0 && !before.slice(at).includes(";")) continue;
    count += 1;
  }
  return count;
}

describe("a step that waits for a module goes through loadPart", () => {
  it("tells bounded from unbounded waits", () => {
    expect.hasAssertions();
    expect(unboundedAwaits('const m = await import("./x");')).toBe(1);
    expect(unboundedAwaits('const m = await loadPart(() => import("./x"));')).toBe(0);
    expect(unboundedAwaits('const f = await loadPart(async () => {\n  const { f } = await import("@plainva/ui");\n  return f;\n});')).toBe(0);
    expect(unboundedAwaits('// await import("./x")\nconst a = 1;')).toBe(0);
  });

  it("finds no unbounded wait beyond the list, and the list holds no more than there is", () => {
    expect.hasAssertions();
    const found: Record<string, number> = {};
    for (const dir of DIRS) {
      for (const file of sources(join(ROOT, dir))) {
        const count = unboundedAwaits(readFileSync(file, "utf8"));
        if (count > 0) found[relative(ROOT, file).split("\\").join("/")] = count;
      }
    }
    const listed = UNBOUNDED as Record<string, number>;
    const grown = Object.entries(found).filter(([file, count]) => count > (listed[file] ?? 0)).map(([file, count]) => `${file}: ${count} (listed ${listed[file] ?? 0})`);
    const shrunk = Object.entries(listed).filter(([file, count]) => (found[file] ?? 0) < count).map(([file, count]) => `${file}: ${found[file] ?? 0} (listed ${count})`);
    expect(grown, "an awaited import() outside loadPart — wrap it in loadPart").toEqual([]);
    expect(shrunk, "fewer unbounded waits than listed — lower the entry in awaitedImports.unbounded.json").toEqual([]);
  });
});
