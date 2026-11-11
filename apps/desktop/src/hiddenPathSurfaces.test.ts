import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every surface the user reads asks the ONE rule for hidden files (decision
 * E8, Sammelplan § 3.121): `isHiddenPath` / `visiblePathSql` in
 * `packages/core/src/vault/internalPath.ts`. Dot files and dot folders stay in
 * the index — the sync and the content encryption read it —, so a surface
 * that lists from the index without the rule shows them again. Before E8 the
 * answer depended on the shell and on where the vault lay.
 *
 * Each entry names a place and why it is a surface. A place that reads the
 * corpus to RESOLVE a link (`linkTargets`, `listNotes` behind a link chooser,
 * `getBacklinks` for a rename) must not be listed here: a hidden file is not a
 * missing file.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");
const RULE = /isHiddenPath\(|visiblePathSql\(|visibleOnly: true|!e\.name\.startsWith\("\."\)|!base\.startsWith\("\."\)/;

/** The body of `async <name>(` / `function <name>(` up to the next member at the same indentation. */
function bodyOf(rel: string, name: string): string {
  const text = read(rel);
  const start = text.search(new RegExp(`(?:async |function |export async function |export function )${name}\\(`));
  if (start < 0) throw new Error(`${name} not found in ${rel}`);
  const rest = text.slice(start + 1);
  const end = rest.search(/\n(?: {2}async | {2}\/\*\*|export |async function |function )/);
  return text.slice(start, end < 0 ? undefined : start + 1 + end);
}

const QUERY = "packages/core/src/vault/VaultQueryService.ts";
const FUNCTIONS: [file: string, name: string, surface: string][] = [
  [QUERY, "searchFullText", "search in both shells (sidebar, quick switcher, phone search)"],
  [QUERY, "searchFilesByTitle", "title search"],
  [QUERY, "getRecentFiles", "the desktop quick switcher's recent files"],
  [QUERY, "listNotesModifiedBetween", "the phone's notes edited today"],
  [QUERY, "countNotesPerSubfolder", "the phone's folder rows"],
  [QUERY, "countAttachmentsPerSubfolder", "the phone's folder rows (attachments)"],
  [QUERY, "listBases", "the database lists of both shells"],
  [QUERY, "listTasks", "the task lists of both shells"],
  [QUERY, "findInVault", "find & replace across the vault"],
  [QUERY, "getBacklinks", "backlinks lists (`visibleOnly`)"],
  [QUERY, "getFilesByTag", "notes of a tag"],
  [QUERY, "getAllTags", "tag lists and `#` suggestions"],
  [QUERY, "queryDatabaseFiles", "database rows, boards, calendars from a database"],
  ["packages/core/src/vault/GraphService.ts", "loadGraph", "the graph of both shells, clean-up, unlinked mentions"],
  ["packages/ui/src/lib/inlineTriggers.ts", "searchLinkTargets", "`[[` suggestions in the editor and in plain fields"],
  ["packages/ui/src/components/editorTriggers.ts", "embedCompletionSource", "`![[` suggestions"],
  ["packages/ui/src/base/templateFiles.ts", "listTemplates", "template pickers of both shells"],
  ["packages/ui/src/lib/recentsFile.ts", "readRecentsOnDisk", "recently opened in both shells"],
];
const FILES: [file: string, times: number, surface: string][] = [
  ["packages/ui/src/components/AtMentionPlugin.ts", 2, "`@` suggestions: notes and databases"],
  ["apps/desktop/src/components/QuickSwitcher.tsx", 1, "the quick switcher's names"],
  ["apps/desktop/src/components/FileTree.tsx", 2, "the file tree: files and folders"],
  ["apps/desktop/src/components/BasePicker.tsx", 1, "the database picker"],
  ["apps/mobile/src/screens/SearchScreen.tsx", 1, "the phone search's names"],
  ["apps/mobile/src/services/vaultService.ts", 3, "the phone's folder screen, its recents and first-run recent list"],
];

describe("hidden files: every surface asks the one rule (E8)", () => {
  it.each(FUNCTIONS)("%s %s — %s", (file, name) => {
    expect(bodyOf(file, name)).toMatch(RULE);
  });

  it.each(FILES)("%s asks it %i times — %s", (file, times) => {
    const uses = read(file).split("\n").filter((line) => RULE.test(line)).length;
    expect(uses).toBeGreaterThanOrEqual(times);
  });

  it("every backlinks LIST asks for visible links only; the rewrites ask for all", () => {
    const shipped: string[] = [];
    for (const root of ["apps/desktop/src/components", "apps/mobile/src/components", "apps/mobile/src/screens"]) {
      (function walk(dir: string) {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) shipped.push(full);
        }
      })(join(REPO, root));
    }
    const calls: string[] = [];
    for (const full of shipped) {
      const text = readFileSync(full, "utf8");
      for (const m of text.matchAll(/getBacklinks\(([^)]*)\)/g)) calls.push(`${relative(REPO, full).replace(/\\/g, "/")}: ${m[1].includes("visibleOnly: true") ? "visible" : "ALL"}`);
    }
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.filter((c) => c.endsWith("ALL"))).toEqual([]);
  });
});
