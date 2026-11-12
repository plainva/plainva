import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Nothing plans a write from half an index (performance plan L3, review of 11.11.).
 *
 * The first index of a vault is built behind the open app, and an index owed a
 * full scan is not whole either. What only SHOWS from the index says so (the
 * strip). What PLANS A WRITE from it — the links a rename rewrites, the listing
 * an overview writes, the files find and replace changes, what a slice gives
 * access to, which reminders stay — is refused over one that is not whole
 * (core `indexWholeness.ts`). The gate sits where a plan is made, not at each
 * feature: this file holds both halves of that.
 *
 * 1. Every planner asks the gate (`requireWholeIndex`) before its first read of
 *    the index.
 * 2. Every file that reads the index in a way a plan can be made from is on a
 *    reviewed list, with what it does over half an index: a new reader fails
 *    here until somebody decided — gated (it calls a planner), refused, says
 *    "partial", or safe for a named reason.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

/** [file, the function or method that plans] — each must ask the gate before it reads. */
const PLANNERS: Array<[string, string]> = [
  ["packages/core/src/vault/VaultQueryService.ts", "async findInVault("],
  ["packages/core/src/vault/VaultQueryService.ts", "async linksNamingFile("],
  ["packages/core/src/vault/GraphService.ts", "async cleanupVerdicts("],
  ["packages/core/src/vault/GraphService.ts", "async findUnlinkedMentions("],
  ["packages/core/src/workspace/sliceObjects.ts", "export async function loadWorkspaceSliceObjects("],
  ["packages/ui/src/lib/renameNote.ts", "export async function planLinkUpdates("],
  ["packages/ui/src/lib/renameNote.ts", "export async function renameFileWithLinkUpdates("],
  ["packages/ui/src/lib/indexMd.ts", "export async function adoptFileAsIndex("],
  ["packages/ui/src/lib/indexMd.ts", "export async function planOverviewLinkPins("],
  ["packages/ui/src/lib/indexMdGenerate.ts", "export async function listMarkdownPaths("],
  ["packages/ui/src/base/pinboardSweep.ts", "export async function sweepPinboardRefs("],
  ["packages/ui/src/base/deletionPlan.ts", "export async function buildDeletionPlan("],
  ["packages/ui/src/base/relationLinks.ts", "async function linkRule("],
  ["packages/ui/src/services/graphActions.ts", "export async function appendWikiLink("],
  ["packages/ui/src/services/graphActions.ts", "export async function removeLinksTo("],
  ["packages/ui/src/services/graphActions.ts", "export async function createBrokenLinkTarget("],
  ["packages/ui/src/services/graphActions.ts", "export async function applyInlineLink("],
  ["packages/ui/src/services/graphRelationTargets.ts", "export async function writeRelationLink("],
  ["packages/ui/src/services/graphRelationTargets.ts", "export async function removeRelationLink("],
  ["packages/ui/src/ai/writeTools.ts", "export async function noteRenamePlan("],
  ["packages/ui/src/hooks/useTaskDuplicates.ts", "const options = async ("],
  ["packages/ui/src/hooks/useTaskNameCleanup.ts", "const scan = useStableHandler("],
  ["packages/ui/src/lib/linkOpen.ts", "function refusal("],
  ["apps/desktop/src/services/fileActions.ts", "export async function renameToName("],
  ["apps/desktop/src/services/fileActions.ts", "export async function moveItems("],
  ["apps/desktop/src/services/okfConversion.ts", "export async function scanVaultOkf("],
  ["apps/desktop/src/services/okfMigration.ts", "export async function scanVaultOkfVersion("],
  ["apps/desktop/src/components/QuickSwitcher.tsx", "const handleCreate = async ("],
  ["apps/mobile/src/services/okfConversion.ts", "export async function scanVaultOkf("],
  ["apps/mobile/src/services/okfMigration.ts", "export async function scanVaultOkfVersion("],
  ["apps/mobile/src/services/vaultService.ts", "async createNoteFromWikiTarget("],
  ["apps/mobile/src/services/vaultService.ts", "async moveFolder("],
  ["apps/mobile/src/services/vaultService.ts", "async moveNote("],
];

/** A read of the index a write can be planned from. */
const PLANNING_READ = /\.(getBacklinks|linkTargets|linksNamingFile|getTaskAnchors|listTasks|findInVault|listBaseFilePaths|listNotes|getBrokenLinks|getOrphans)\(|\blistMarkdownPaths\(|\bfindUnlinkedMentions\(|\bcleanupVerdicts\(|\bloadWorkspaceSliceObjects\(/;

/** The body of the planner whose header is `header`: up to the next declaration at its own depth or above. */
function bodyOf(source: string, header: string): string {
  const at = source.indexOf(header);
  if (at < 0) return "";
  const indent = source.slice(source.lastIndexOf("\n", at) + 1, at).match(/^\s*/)?.[0] ?? "";
  const rest = source.slice(at + header.length);
  const end = rest.search(new RegExp(`\\n${indent}(?:export |async |function |private |const |public |static |[a-zA-Z_]+\\()`));
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * Every source file that reads the index a plan can be made from, and what it
 * does over half an index. Gated: it plans through a gated planner above (or
 * is one). Refuses / waits: its own gate. Partial: it only shows, and the strip
 * says the index is not whole. Safe: named.
 */
const READERS: Record<string, string> = {
  "apps/desktop/src/components/BacklinksPanel.tsx": "partial: shows the links found so far",
  "apps/desktop/src/components/BaseViewer.tsx": "partial: shows rows; its writes go through gated relation/rename planners",
  "apps/desktop/src/components/CascadeDeleteHost.tsx": "gated: the plan (buildDeletionPlan) refuses; the note count only makes the large-deletion question come sooner",
  "apps/desktop/src/components/Editor.tsx": "partial: link completion and decorations; creating a note from a link goes through planLinkOpen",
  "apps/desktop/src/components/PropertiesSection.tsx": "partial: suggestions; relation writes go through linkRule",
  "apps/desktop/src/components/RightSidebar.tsx": "partial: shows",
  "apps/desktop/src/components/VaultFindReplaceModal.tsx": "refuses: findInVault",
  "apps/desktop/src/components/ai/useDesktopEmbeddings.ts": "safe: a derived cache under .plainva, filled again on every index change, the end of the build included",
  "apps/desktop/src/components/ai/useDesktopGists.ts": "safe: as the embeddings",
  "apps/desktop/src/components/base/useBaseCells.tsx": "partial: cell display; writes through linkRule",
  "apps/desktop/src/components/graph/CleanupPanel.tsx": "refuses: cleanupVerdicts and findUnlinkedMentions, said in the panel",
  "apps/desktop/src/components/graph/VaultGraphView.tsx": "partial: draws the graph and counts orphans; its rename goes through renameFileWithLinkUpdates",
  "apps/desktop/src/components/journal/JournalView.tsx": "partial: shows",
  "apps/desktop/src/components/pimcal/CalendarView.tsx": "partial: shows",
  "apps/desktop/src/components/tasks/TasksQueryView.tsx": "partial: shows; a tick writes the line that is shown, in a note that was read",
  "apps/desktop/src/components/tasks/TasksView.tsx": "partial: shows; clean-up and duplicates through their gated hooks",
  "apps/desktop/src/contexts/VaultContext.tsx": "gated: slices refused (kept as published), task sync creates no note until a scan went through (coldIndexOwed), enqueueAllLocalFiles waits for the whole index",
  "apps/desktop/src/hooks/useDocumentIcons.ts": "partial: shows",
  "apps/desktop/src/services/ai/desktopAi.ts": "partial: the assistant reads what is there; its rename asks noteRenamePlan, its writes go through the write gate of the note itself",
  "apps/desktop/src/services/cascadeDelete.ts": "gated: buildDeletionPlan",
  "apps/desktop/src/services/commentNotifier.ts": "safe: notifications about remarks, read only",
  "apps/desktop/src/services/reminderScheduler.ts": "waits: planned again the moment the index is whole (in-app timers, nothing cleared on the system)",
  "apps/mobile/src/components/NoteContextSheet.tsx": "partial: shows",
  "apps/mobile/src/components/NotePickSheet.tsx": "partial: a list to pick from",
  "apps/mobile/src/components/PhoneTasksQuery.tsx": "partial: shows",
  "apps/mobile/src/components/useTaskRowActions.tsx": "partial: acts on the row that is shown",
  "apps/mobile/src/lib/useLinkTargetLookup.ts": "partial: draws links as resolved or not",
  "apps/mobile/src/screens/BrowseScreen.tsx": "partial: shows",
  "apps/mobile/src/screens/CleanupScreen.tsx": "refuses: cleanupVerdicts and findUnlinkedMentions, said on the screen",
  "apps/mobile/src/screens/FindReplaceScreen.tsx": "refuses: findInVault",
  "apps/mobile/src/screens/JournalScreen.tsx": "partial: shows",
  "apps/mobile/src/screens/NoteScreen.tsx": "partial: shows",
  "apps/mobile/src/screens/SearchScreen.tsx": "partial: search; creating a note refuses (createNoteFromWikiTarget)",
  "apps/mobile/src/screens/SecurityAreaScreen.tsx": "refuses: loadWorkspaceSliceObjects; the slice counts are not re-published",
  "apps/mobile/src/screens/TasksScreen.tsx": "partial: shows",
  "apps/mobile/src/screens/base/BaseScreen.tsx": "partial: shows; writes through gated planners",
  "apps/mobile/src/screens/base/CellEditSheet.tsx": "partial: a list to pick from; the write goes through linkRule",
  "apps/mobile/src/services/ai/mobileAi.ts": "partial: as the desktop assistant",
  "apps/mobile/src/services/ai/mobileEmbeddings.ts": "safe: as the desktop embeddings",
  "apps/mobile/src/services/ai/mobileGists.ts": "safe: as the desktop gists",
  "apps/mobile/src/services/baseOps.ts": "partial: candidates for a relation cell; the write goes through linkRule",
  "apps/mobile/src/services/cascadeDelete.ts": "gated: buildDeletionPlan",
  "apps/mobile/src/services/commentNotifier.ts": "safe: as the desktop",
  "apps/mobile/src/services/dueTasks.ts": "partial: shows",
  "apps/mobile/src/services/noteLinkRoute.ts": "safe: opens a note an address names, read only",
  "apps/mobile/src/services/pim/taskSyncRuntime.ts": "gated: creates no note until a full scan went through (indexPassSettled)",
  "apps/mobile/src/services/reminderActions.ts": "partial: acts on the reminder that fired",
  "apps/mobile/src/services/reminderScheduler.ts": "waits: replans nothing until the index is whole, so nothing scheduled is cleared",
  "packages/ui/src/ai/writeTools.ts": "gated: noteRenamePlan",
  "packages/ui/src/base/baseMembership.ts": "partial: membership for display; the deletion plan is gated",
  "packages/ui/src/base/embedScope.ts": "partial: shows the rows of an embedded database",
  "packages/ui/src/base/pinboardSweep.ts": "gated: sweepPinboardRefs",
  "packages/ui/src/base/relationLinks.ts": "gated: linkRule",
  "packages/ui/src/base/templateFiles.ts": "gated: runs with a move, which is refused before anything moves",
  "packages/ui/src/hooks/useTaskDuplicates.ts": "gated: the removal; the count only shows",
  "packages/ui/src/hooks/useTaskNameCleanup.ts": "gated: nothing resumed or offered",
  "packages/ui/src/lib/commentNotifierCycle.ts": "safe: as the comment notifiers",
  "packages/ui/src/lib/indexMd.ts": "gated: adoptFileAsIndex, planOverviewLinkPins, collectFolderIndexInfos through listMarkdownPaths",
  "packages/ui/src/lib/indexMdGenerate.ts": "gated: listMarkdownPaths",
  "packages/ui/src/lib/renameNote.ts": "gated: planLinkUpdates",
  "packages/ui/src/pim/taskDuplicates.ts": "gated: through useTaskDuplicates",
  "packages/ui/src/pim/taskNameCleanup.ts": "gated: through useTaskNameCleanup",
  "packages/ui/src/pim/taskSync.ts": "gated: mayCreateNotes is false until a full scan went through",
  "packages/ui/src/services/graphActions.ts": "gated: each writer",
  "packages/ui/src/services/graphRelationTargets.ts": "gated: writeRelationLink, removeRelationLink",
};

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\.d\.ts$|^test-/.test(name)) out.push(relative(REPO, full).replace(/\\/g, "/"));
    }
  };
  walk(join(REPO, root));
  return out;
}

describe("planning a write from the index (performance plan L3)", () => {
  it.each(PLANNERS)("%s: %s asks the gate before it reads", (file, header) => {
    const body = bodyOf(read(file), header);
    expect(body, `${header} not found in ${file}`).not.toBe("");
    // `?.()`: a query service that does not know wholeness (a test double) counts as whole, as before L3.
    const gate = body.search(/requireWholeIndex(\?\.)?\(/);
    expect(gate, `${header} in ${file} plans without asking whether the index is whole`).toBeGreaterThanOrEqual(0);
    const firstRead = body.search(PLANNING_READ);
    if (firstRead >= 0) expect(gate).toBeLessThan(firstRead);
  });

  it("every reader of the index a write can be planned from is decided", () => {
    const readers = ["packages/ui/src", "apps/desktop/src", "apps/mobile/src"]
      .flatMap(sourceFiles)
      .filter((file) => PLANNING_READ.test(read(file)))
      .sort();
    const undecided = readers.filter((file) => !(file in READERS));
    expect(undecided, "a new reader of the index: decide what it does over half an index and add it to READERS").toEqual([]);
    const gone = Object.keys(READERS).filter((file) => !readers.includes(file));
    expect(gone, "these no longer read the index: take them off READERS").toEqual([]);
  });

  it("the app builds a graph service only with the index's wholeness", () => {
    const bare = ["packages/ui/src", "apps/desktop/src", "apps/mobile/src"]
      .flatMap(sourceFiles)
      .filter((file) => /\bnew GraphService\(/.test(read(file)));
    expect(bare, "use GraphService.forIndex(queryService)").toEqual([]);
  });
});
