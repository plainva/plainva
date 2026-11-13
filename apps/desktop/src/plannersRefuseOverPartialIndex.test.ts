// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { buildingIndexReader, isIndexNotWholeError, loadWorkspaceSliceObjects, type IVaultAdapter, type VaultQueryService } from "@plainva/core";
import {
  __resetTaskSyncPauseForTest,
  addRelationLink,
  adoptFileAsIndex,
  appendWikiLink,
  applyInlineLink,
  buildDeletionPlan,
  createBrokenLinkTarget,
  editReverseRelation,
  generateIndexForFolder,
  listMarkdownPaths,
  noteRenamePlan,
  notesCarryingProperty,
  pinLinksBeforeOverviews,
  planLinkOpen,
  planLinkUpdates,
  planOverviewLinkPins,
  removeLinksTo,
  removeRelationLink,
  removeRelationLinksToNote,
  renameFileWithLinkUpdates,
  sweepPinboardRefs,
  taskNamesJournalKey,
  useTaskDuplicates,
  useTaskNameCleanup,
  writeRelationLink,
  type LinkOpenDeps,
  type TaskDuplicatesDeps,
  type TaskDuplicatesState,
  type TaskNameCleanupDeps,
  type TaskNameCleanupState,
} from "@plainva/ui";

/**
 * Every planner refuses over an index that is not whole, and writes nothing
 * (third review of 11.11., performance plan L3).
 *
 * The first index of a vault is built behind the open app. Code that PLANS a
 * write from the index — renames that rewrite links, overviews, graph link
 * actions, relation links, deletion plans, pinboard sweeps, OKF conversion,
 * task clean-up, AI write tools, a note made for a link, moves — must not
 * plan over half of one. The guard for each is a `requireWholeIndex()` of its
 * own; a test per planner is what keeps a new one from going without.
 *
 * Every test hands the planner `buildingIndexReader` (core): each read of the
 * index rejects with `IndexNotWholeError`, and `requireWholeIndex()` throws
 * it. The files are a recording adapter that notes every write method. The
 * phone's planners are in `apps/mobile/src/plannersRefuseOverPartialIndex.test.ts`.
 */

vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({ get: async () => undefined }));
  return { Store: { load }, load };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true), open: vi.fn() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every write the planners could make through the files, as "method path". */
const writes: string[] = [];
/** Every query the planners put to the index's tables (`db` is not a function member: the fake leaves it as it is). */
const dbReads: string[] = [];

beforeEach(() => {
  writes.length = 0;
  dbReads.length = 0;
});

/** An index whose first build is still running, with the members a planner's type asks for. */
function building(): VaultQueryService {
  return buildingIndexReader({
    getBacklinks: async () => [],
    listNotes: async () => [],
    linkTargets: async () => [],
    linksNamingFile: async () => [],
    resolveNotePath: async () => null,
    listBaseFilePaths: async () => [],
    queryDatabaseFiles: async () => [],
    getTaskAnchors: async () => new Map(),
    db: { query: async () => { dbReads.push("query"); return []; } },
  }) as unknown as VaultQueryService;
}

/** A vault adapter that has the file asked for nowhere and records every write method. */
function recorder(): IVaultAdapter {
  const record = (method: string) => async (...args: unknown[]) => { writes.push(`${method} ${String(args[0])}`); };
  return {
    exists: async () => false,
    readTextFile: async (path: string) => { throw new Error(`missing ${path}`); },
    readBinaryFile: async (path: string) => { throw new Error(`missing ${path}`); },
    listDir: async () => [],
    getFileInfo: async (path: string) => { throw new Error(`missing ${path}`); },
    writeTextFile: record("writeTextFile"),
    writeBinaryFile: record("writeBinaryFile"),
    renameItem: record("renameItem"),
    deleteItem: record("deleteItem"),
    createDir: record("createDir"),
    updateTextFile: record("updateTextFile"),
    writeTextFileChange: record("writeTextFileChange"),
    writeEditorText: record("writeEditorText"),
  } as unknown as IVaultAdapter;
}

/** The planner refuses with the reason the first index has, and nothing was written or read from the tables. */
async function expectRefused(run: () => Promise<unknown> | unknown): Promise<void> {
  const refused = await Promise.resolve().then(run).then(() => null, (e: unknown) => e ?? new Error("rejected with nothing"));
  expect(refused, "it must refuse").not.toBeNull();
  expect(isIndexNotWholeError(refused), `refused with ${String(refused)}`).toBe(true);
  expect(writes).toEqual([]);
  expect(dbReads).toEqual([]);
}

/** A few turns of the event loop, for background work that waits instead of refusing. */
async function turns(count = 6): Promise<void> {
  for (let i = 0; i < count; i++) await act(async () => { await Promise.resolve(); });
}

describe("the shared planners refuse over an index that is not whole", () => {
  const query = building();
  const files = recorder();

  // The table is the list of planners of packages/ui (and core): a planner is added here when it is added there.
  it.each<[string, () => Promise<unknown> | unknown]>([
    ["renameNote: planLinkUpdates", () => planLinkUpdates(query, "Old.md", "New.md")],
    ["renameNote: renameFileWithLinkUpdates", () => renameFileWithLinkUpdates({ adapter: files, queryService: query, oldPath: "Old.md", newPath: "New.md" })],
    ["indexMd: adoptFileAsIndex", () => adoptFileAsIndex({ adapter: files, queryService: query, candidatePath: "Sub/Hub.md", folder: "Sub", prepare: true, afterMove: async () => { writes.push("afterMove"); } })],
    ["indexMd: planOverviewLinkPins", () => planOverviewLinkPins(query, [{ indexPath: "Sub/index.md", candidatePath: "Sub/Hub.md" } as never])],
    ["indexMdGenerate: listMarkdownPaths", () => listMarkdownPaths(query)],
    ["indexMdGenerate: generateIndexForFolder", () => generateIndexForFolder({ adapter: files, queryService: query, folder: "Sub", heading: "Sub", subfoldersHeading: "Folders" })],
    ["graphActions: appendWikiLink", () => appendWikiLink(files, query, "a.md", "b.md")],
    ["graphActions: removeLinksTo", () => removeLinksTo(files, query, "a.md", "b.md")],
    ["graphActions: createBrokenLinkTarget", () => createBrokenLinkTarget(files, query, { targetRaw: "Missing", kind: "wiki", sourcePath: "a.md" } as never, "Note")],
    ["graphActions: applyInlineLink", () => applyInlineLink(files, query, "a.md", "b.md", ["B"])],
    ["graphRelationTargets: removeRelationLink", () => removeRelationLink(files, query, "a.md", "b.md", "related")],
    ["graphRelationTargets: writeRelationLink", () => writeRelationLink(files, query, "a.md", "b.md", "related", false)],
    ["relationLinks: addRelationLink", () => addRelationLink({ adapter: files, queryService: query, notePath: "a.md", propertyKey: "related", targetNotePath: "b.md" })],
    ["relationLinks: removeRelationLinksToNote", () => removeRelationLinksToNote({ adapter: files, queryService: query, notePath: "a.md", propertyKey: "related", targetNotePath: "b.md" })],
    ["noteRewrite: notesCarryingProperty", () => notesCarryingProperty(query, { filters: { and: ['file.folder == "Tasks"'] } }, "prio")],
    ["writeTools: noteRenamePlan", () => noteRenamePlan(query, async (path) => { writes.push(`exists ${path}`); return false; }, "Old.md", "New")],
    ["core sliceObjects: loadWorkspaceSliceObjects", () => loadWorkspaceSliceObjects([{ path: "a.md" } as never], query as never)],
  ])("%s", async (_name, run) => {
    await expectRefused(run);
  });

  it("indexMd: pinLinksBeforeOverviews refuses before it asks the person anything", async () => {
    const ask = vi.fn(async () => true);
    const changed = vi.fn();
    await expectRefused(() => pinLinksBeforeOverviews({ queryService: query, adapter: files, placements: [{ indexPath: "Sub/index.md", candidatePath: "Sub/Hub.md" } as never], ask, changed }));
    expect(ask).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it("relationLinks: editReverseRelation counts the refusal as a failure of that note and writes none", async () => {
    // Its contract is to go on note by note and report: the reason of the first failure travels in the outcome.
    const outcome = await editReverseRelation({ adapter: files, queryService: query, rowPath: "Row.md", owning: { property: "related" }, current: [], next: ["[[Other]]"] });
    expect(outcome.failures).toBe(1);
    expect(isIndexNotWholeError(outcome.firstFailure)).toBe(true);
    expect(outcome.changed.size).toBe(0);
    expect(outcome.shown).toEqual([]);
    expect(writes).toEqual([]);
    expect(dbReads).toEqual([]);
  });

  it("pinboardSweep: sweepPinboardRefs refuses for a file move and for a folder move, before it lists the boards", async () => {
    const listed: string[] = [];
    const reader = Object.assign(building(), { listBaseFilePaths: async () => { listed.push("listBaseFilePaths"); return ["Board.base"]; } });
    await expectRefused(() => sweepPinboardRefs({ adapter: files, queryService: reader }, [{ from: "a.md", to: "b.md" }]));
    await expectRefused(() => sweepPinboardRefs({ adapter: files, queryService: reader }, [], [{ from: "Old", to: "New" }]));
    expect(listed).toEqual([]);
  });

  it("deletionPlan: buildDeletionPlan refuses before it reads any base or relation", async () => {
    const read: string[] = [];
    const note = (name: string) => async () => { read.push(name); return [] as never; };
    const reader = building();
    const deps = {
      getIncomingRelationRefs: note("getIncomingRelationRefs"),
      getOutgoingRelationTargets: note("getOutgoingRelationTargets"),
      queryDatabaseFiles: note("queryDatabaseFiles"),
      listBaseFilePaths: note("listBaseFilePaths"),
      readTextFile: async (path: string) => { read.push(`readTextFile ${path}`); return ""; },
      requireWholeIndex: () => reader.requireWholeIndex(),
    };
    await expectRefused(() => buildDeletionPlan(deps as never, ["Note.md"]));
    await expectRefused(() => buildDeletionPlan(deps as never, ["Tasks.base"]));
    expect(read).toEqual([]);
  });
});

describe("linkOpen: a note made for a link is refused, a note that exists still opens", () => {
  const reader = building();
  const created: string[] = [];
  const deps = (): LinkOpenDeps => ({
    resolveWiki: async (target) => (target === "Known" ? "Notes/Known.md" : null),
    resolveMarkdown: async (target) => (target === "Known.md" ? { kind: "file", path: "Notes/Known.md" } : (null as never)),
    fileExists: async () => false,
    folderExists: async () => false,
    requireWholeIndex: () => reader.requireWholeIndex(),
  });
  beforeEach(() => { created.length = 0; });

  it.each([
    ["a wiki link", { kind: "wiki" as const, text: "Brand New", sourcePath: "a.md" }],
    ["a Markdown link", { kind: "markdown" as const, text: "Brand%20New.md", sourcePath: "a.md" }],
  ])("refuses to create the note of %s, with the reason, and writes nothing", async (_name, link) => {
    const outcome = await planLinkOpen(link, deps());
    expect(outcome.action).toBe("refused");
    if (outcome.action === "refused") expect(isIndexNotWholeError(outcome.error)).toBe(true);
    expect(writes).toEqual([]);
    expect(dbReads).toEqual([]);
  });

  it.each([
    ["a wiki link", { kind: "wiki" as const, text: "Known", sourcePath: "a.md" }],
    ["a Markdown link", { kind: "markdown" as const, text: "Known.md", sourcePath: "a.md" }],
  ])("still opens the note %s names, because that is read only", async (_name, link) => {
    expect(await planLinkOpen(link, deps())).toEqual({ action: "open", path: "Notes/Known.md", anchor: null });
  });
});

describe("the task planners of the shared hooks", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    __resetTaskSyncPauseForTest();
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("useTaskDuplicates: the review is refused and no copy is looked for or removed", async () => {
    const reader = building();
    const touched: string[] = [];
    const errors: unknown[] = [];
    const deps: TaskDuplicatesDeps = {
      vault: "vault-a",
      db: { dueKey: null, completion: null },
      reloadKey: 0,
      queryService: reader as never,
      listBoundTaskNotes: async () => { touched.push("listBoundTaskNotes"); return []; },
      readTextFile: async (path) => { touched.push(`readTextFile ${path}`); return ""; },
      deleteNote: async (path) => { writes.push(`deleteNote ${path}`); },
      onRemoved: () => { writes.push("onRemoved"); },
      onError: (e) => { errors.push(e); },
    };
    let state!: TaskDuplicatesState;
    const Probe = () => { state = useTaskDuplicates(deps); return null; };
    await act(async () => { root.render(createElement(Probe)); });
    await turns();

    await act(async () => { await state.review(); });
    expect(errors).toHaveLength(1);
    expect(isIndexNotWholeError(errors[0])).toBe(true);
    expect(state.groups).toBeNull();
    expect(await act(async () => state.remove())).toBe(0);
    expect(touched).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("useTaskNameCleanup: nothing is offered and an interrupted run is not resumed, until the index is whole", async () => {
    // The person said yes to this run before; resuming it renames notes and rewrites links from the index.
    const journal = JSON.stringify({ format: "plainva-task-names", version: 1, items: [{ from: "Aufgaben/a.md", to: "Aufgaben/b.md", done: false, links: null }] });
    localStorage.setItem(taskNamesJournalKey("vault-a"), journal);
    const reader = building();
    const touched: string[] = [];
    const errors: unknown[] = [];
    const spy = <T>(name: string, result: T) => async (...args: unknown[]) => { touched.push(`${name} ${String(args[0])}`); return result; };
    const deps = {
      vault: "vault-a",
      reloadKey: 0,
      queryService: reader as never,
      exists: spy("exists", false),
      readTextFile: spy("readTextFile", ""),
      writeTextFile: async (path: string) => { writes.push(`writeTextFile ${path}`); },
      updateTextFile: async (path: string) => { writes.push(`updateTextFile ${path}`); return {} as never; },
      renameNote: async (from: string) => { writes.push(`renameNote ${from}`); return {} as never; },
      moveTaskNotePath: async (from: string) => { writes.push(`moveTaskNotePath ${from}`); },
      reindex: async () => { writes.push("reindex"); },
      onChanged: () => { writes.push("onChanged"); },
      onError: (e: unknown) => { errors.push(e); },
    } as unknown as TaskNameCleanupDeps;
    let state!: TaskNameCleanupState;
    const Probe = () => { state = useTaskNameCleanup(deps); return null; };
    await act(async () => { root.render(createElement(Probe)); });
    await turns(10);

    expect(state.items).toEqual([]);
    expect(state.visible).toBe(false);
    expect(await act(async () => state.clean())).toBeNull();
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
    expect(touched).toEqual([]);
    // The run stays on its journal for the next start, once the index is whole.
    expect(localStorage.getItem(taskNamesJournalKey("vault-a"))).toBe(journal);
  });
});

describe("the desktop's own planners refuse over an index that is not whole", () => {
  const query = building();
  const files = recorder();

  it("fileActions: renameToName refuses before a note, a heading or a link moves", async () => {
    const { renameToName } = await import("./services/fileActions");
    await expectRefused(() => renameToName({ adapter: files as never, queryService: query, oldPath: "Old.md", newName: "New", isFolder: false, carryHeading: true }));
  });

  it("fileActions: a note this flow just made (a new board entry) is renamed while the index is built — nothing links to it yet (fourth review of 11.11.)", async () => {
    const { renameToName } = await import("./services/fileActions");
    const files = recorder();
    const result = await renameToName({ adapter: files, queryService: query, oldPath: "Board/2026-11-13 1015.md", newName: "Idea", isFolder: false, fresh: true });
    expect(result).toMatchObject({ ok: true, newPath: "Board/Idea.md" });
    expect(writes).toContain("renameItem Board/2026-11-13 1015.md");
    expect(dbReads).toEqual([]);
  });

  it("fileActions: moveItems refuses before the first item moves, and says nothing of a move that cannot happen", async () => {
    const { moveItems } = await import("./services/fileActions");
    const deps = { adapter: files as never, queryService: Object.assign(building(), { listBaseFilePaths: async () => [] }), indexer: null, isFolder: () => false };
    await expectRefused(() => moveItems(deps, ["a.md", "b.md"], "Sub"));
    // Nothing to move (already in the target folder): nothing is planned, so nothing is refused.
    expect((await moveItems(deps, ["Sub/a.md"], "Sub")).moved).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("okfConversion: scanVaultOkf refuses before the list of notes is read", async () => {
    const { scanVaultOkf } = await import("./services/okfConversion");
    await expectRefused(() => scanVaultOkf({ vaultPath: "/v", queryService: query, adapter: files }));
  });

  it("okfMigration: scanVaultOkfVersion refuses before the candidates are read", async () => {
    const { scanVaultOkfVersion } = await import("./services/okfMigration");
    await expectRefused(() => scanVaultOkfVersion({ queryService: query, adapter: files }));
  });

  it("cascadeDelete: buildDesktopDeletionPlan refuses for a note and for a database", async () => {
    const { buildDesktopDeletionPlan } = await import("./services/cascadeDelete");
    await expectRefused(() => buildDesktopDeletionPlan(files, query, ["Note.md"]));
    await expectRefused(() => buildDesktopDeletionPlan(files, query, ["Tasks.base"]));
  });

  describe("openLink", () => {
    const created: unknown[] = [];
    const onCreate = (e: Event) => created.push((e as CustomEvent).detail);
    beforeEach(() => { created.length = 0; window.addEventListener("plainva-create-note-from-link", onCreate); });
    afterEach(() => window.removeEventListener("plainva-create-note-from-link", onCreate));

    const context = (onOpenPath: (path: string, newTab: boolean) => void) => {
      const original = {
        resolveNotePath: async (target: string) => (target === "Known" ? "Notes/Known.md" : null),
        resolveMarkdownLink: async () => null,
      };
      return {
        queryService: buildingIndexReader(original) as never,
        vaultAdapter: files,
        onOpenPath,
        newTab: false,
        t: (key: string) => key,
      };
    };

    it("refuses to create a note for a link, with a warning, and opens an existing one", async () => {
      const { openLink } = await import("./services/openLink");
      const { toast } = await import("@plainva/ui");
      const warning = vi.spyOn(toast, "warning").mockImplementation(() => undefined as never);
      const opened: string[] = [];
      const ctx = context((path) => opened.push(path));

      await openLink({ kind: "wiki", text: "Brand New", sourcePath: "a.md" }, ctx);
      expect(created).toEqual([]);
      expect(opened).toEqual([]);
      expect(warning).toHaveBeenCalledTimes(1);
      expect(writes).toEqual([]);

      await openLink({ kind: "wiki", text: "Known", sourcePath: "a.md" }, ctx);
      expect(opened).toEqual(["Notes/Known.md"]);
      expect(created).toEqual([]);
      warning.mockRestore();
    });
  });
});
