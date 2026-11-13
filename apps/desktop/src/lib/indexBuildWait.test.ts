// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  applyIndexBuildState,
  beginIndexBuild,
  errorText,
  indexBuildState,
  indexWholenessFor,
  markIndexClosed,
  markIndexFailed,
  markIndexWhole,
  adoptFileAsIndex,
  buildDeletionPlan,
  generateIndexForFolder,
  pinLinksBeforeOverviews,
  planLinkOpen,
  renameFileWithLinkUpdates,
  resetIndexBuildsForTests,
  sweepPinboardRefs,
} from "@plainva/ui";
import { GraphService, IndexNotWholeError, isIndexNotWholeError, loadWorkspaceSliceObjects, untilWholeIndex, VaultQueryService } from "@plainva/core";

/**
 * Whether the index of a vault is whole, per vault and from one owner
 * (performance plan L3, review of 11.11.). Whoever plans a write from the
 * index is refused over one that is not whole — with the reason; background
 * work waits until it is whole and is refused only when the vault closes.
 *
 * The first build of this store had one slot for "the" build: two vaults in
 * the desktop's central window, or a vault shown in a second window, released
 * or held the wrong waiters, and a rename in the second window planned over
 * half an index. Each case below failed at that build.
 */
afterEach(() => resetIndexBuildsForTests());

const settled = async (promise: Promise<unknown>) => {
  let done = false;
  void promise.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  return done;
};

/** A query service over the store's entry for `vault`, as both shells build it. */
function service(vault: string, db: unknown = {}): VaultQueryService {
  const queryService = new VaultQueryService(db as never);
  queryService.setIndexWholeness(indexWholenessFor(vault));
  return queryService;
}

describe("the index of each vault", () => {
  it("is kept per vault: two vaults build at once, and each ends on its own", async () => {
    beginIndexBuild("/a");
    beginIndexBuild("/b");
    const a = untilWholeIndex(indexWholenessFor("/a"));
    const b = untilWholeIndex(indexWholenessFor("/b"));
    markIndexWhole("/b");
    expect(await settled(b)).toBe(true);
    expect(await settled(a)).toBe(false);
    expect(indexBuildState("/a").kind).toBe("building");
    markIndexWhole("/a");
    expect(await settled(a)).toBe(true);
  });

  it("refuses a planner of one vault while another builds — and not the whole one", () => {
    beginIndexBuild("/b");
    expect(() => service("/a").requireWholeIndex()).not.toThrow();
    expect(() => service("/b").requireWholeIndex()).toThrow(IndexNotWholeError);
  });

  it("refuses with the reason, in the person's language", () => {
    beginIndexBuild("/a");
    let refusal: unknown;
    try { service("/a").requireWholeIndex(); } catch (e) { refusal = e; }
    expect(isIndexNotWholeError(refusal)).toBe(true);
    expect(errorText(refusal)).toMatch(/search index is still being built/i);
  });

  it("a failed build refuses until a scan goes through; whoever waits is not let go by the failure", async () => {
    beginIndexBuild("/a");
    const waiting = untilWholeIndex(indexWholenessFor("/a"));
    markIndexFailed("/a", "the disk went away");
    expect(await settled(waiting)).toBe(false);
    expect(() => service("/a").requireWholeIndex()).toThrow(/incomplete/);
    markIndexWhole("/a");
    expect(await settled(waiting)).toBe(true);
    expect(() => service("/a").requireWholeIndex()).not.toThrow();
  });

  it("a vault that closes refuses whoever still waits for it", async () => {
    beginIndexBuild("/a");
    const waiting = untilWholeIndex(indexWholenessFor("/a"));
    markIndexClosed("/a");
    await expect(waiting).rejects.toThrow(IndexNotWholeError);
    // Opened again later, the vault starts over.
    expect(indexBuildState("/a").kind).toBe("whole");
  });
});

describe("a second window that shows the vault", () => {
  it("mirrors the owner's word: building, progress, whole", async () => {
    // The owner's store is another process; this window only hears it.
    applyIndexBuildState("/b", { kind: "building", done: 0, total: 0 });
    const queryService = service("/b");
    expect(() => queryService.requireWholeIndex()).toThrow(IndexNotWholeError);
    const waiting = queryService.untilWholeIndex();
    applyIndexBuildState("/b", { kind: "building", done: 10, total: 100 });
    expect(indexBuildState("/b")).toEqual({ kind: "building", done: 10, total: 100 });
    expect(await settled(waiting)).toBe(false);
    applyIndexBuildState("/b", { kind: "whole" });
    expect(await settled(waiting)).toBe(true);
    expect(() => queryService.requireWholeIndex()).not.toThrow();
  });
});

describe("a link while the index is not whole", () => {
  const deps = (requireWholeIndex: () => void, resolved: string | null = null) => ({
    resolveWiki: async () => resolved,
    resolveMarkdown: async () => null,
    fileExists: async () => false,
    folderExists: async () => false,
    requireWholeIndex,
  });

  it("is not created a second time: refused with the reason", async () => {
    beginIndexBuild("/a");
    const outcome = await planLinkOpen({ text: "Plan", kind: "wiki", sourcePath: "Inbox/Today.md" }, deps(() => service("/a").requireWholeIndex()));
    expect(outcome.action).toBe("refused");
    expect(errorText((outcome as { error: unknown }).error)).toMatch(/search index/i);
  });

  it("a bare Markdown link name is refused as well", async () => {
    beginIndexBuild("/a");
    const outcome = await planLinkOpen({ text: "Plan", kind: "markdown", sourcePath: "Inbox/Today.md" }, deps(() => service("/a").requireWholeIndex()));
    expect(outcome.action).toBe("refused");
  });

  it("opens a note the index already resolves — read only, the note is there", async () => {
    beginIndexBuild("/a");
    expect(await planLinkOpen({ text: "Plan", kind: "wiki" }, deps(() => service("/a").requireWholeIndex(), "Projects/Plan.md")))
      .toEqual({ action: "open", path: "Projects/Plan.md", anchor: null });
  });

  it("is created over a whole index", async () => {
    expect(await planLinkOpen({ text: "New idea", kind: "wiki" }, deps(() => service("/a").requireWholeIndex())))
      .toMatchObject({ action: "create", target: "New idea" });
  });
});

describe("a rename while the index is not whole", () => {
  it("is refused before anything moves, in the window that shows the vault too", async () => {
    applyIndexBuildState("/b", { kind: "building", done: 3, total: 10 });
    const queryService = service("/b");
    const asked: string[] = [];
    (queryService as unknown as { getBacklinks: () => Promise<unknown[]> }).getBacklinks = async () => { asked.push("backlinks"); return []; };
    const moved: string[] = [];
    const adapter = {
      renameItem: async (from: string, to: string) => { moved.push(`${from}->${to}`); },
      readTextFile: async () => "",
      writeTextFile: async () => {},
      exists: async () => true,
    } as never;
    await expect(renameFileWithLinkUpdates({ adapter, queryService, oldPath: "Sub/Plan.md", newPath: "Sub/Plan 2.md" })).rejects.toThrow(IndexNotWholeError);
    expect(asked).toEqual([]);
    expect(moved).toEqual([]);
  });
});

describe("what plans a write from the index refuses over one that is not whole", () => {
  const building = () => {
    beginIndexBuild("/a");
    const reads: string[] = [];
    const db = { query: async (sql: string) => { reads.push(sql); return []; }, queryOne: async () => null, execute: async () => {} };
    const queryService = service("/a", db);
    return { queryService, reads };
  };

  it("an overview listing, an adoption and the links an overview takes over", async () => {
    const { queryService, reads } = building();
    const adapter = { exists: async () => false, readTextFile: async () => "", writeTextFile: async () => {}, renameItem: async () => {} } as never;
    await expect(generateIndexForFolder({ adapter, queryService, folder: "P", heading: "P", subfoldersHeading: "Sub" })).rejects.toThrow(IndexNotWholeError);
    await expect(adoptFileAsIndex({ adapter, queryService, candidatePath: "P/Plan.md", folder: "P", prepare: true, afterMove: async () => {} })).rejects.toThrow(IndexNotWholeError);
    let asked = false;
    await expect(pinLinksBeforeOverviews({ queryService, adapter, placements: [{ indexPath: "P/index.md", candidatePath: null }] as never, ask: async () => { asked = true; return true; }, changed: () => {} })).rejects.toThrow(IndexNotWholeError);
    expect(asked).toBe(false);
    expect(reads).toEqual([]);
  });

  it("find and replace, the clean-up, the slices of a workspace, the boards of a move, the deletion plan", async () => {
    const { queryService, reads } = building();
    await expect(queryService.findInVault("x")).rejects.toThrow(IndexNotWholeError);
    await expect(GraphService.forIndex(queryService).cleanupVerdicts()).rejects.toThrow(IndexNotWholeError);
    await expect(GraphService.forIndex(queryService).findUnlinkedMentions()).rejects.toThrow(IndexNotWholeError);
    await expect(loadWorkspaceSliceObjects([], queryService)).rejects.toThrow(IndexNotWholeError);
    await expect(sweepPinboardRefs({ adapter: {} as never, queryService: Object.assign(queryService, { listBaseFilePaths: async () => [] }) }, [{ from: "a.md", to: "b.md" }])).rejects.toThrow(IndexNotWholeError);
    await expect(buildDeletionPlan({ requireWholeIndex: () => queryService.requireWholeIndex() } as never, ["a.md"])).rejects.toThrow(IndexNotWholeError);
    expect(reads).toEqual([]);
  });
});
