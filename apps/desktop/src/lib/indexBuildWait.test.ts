// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  awaitAnyWholeIndex,
  awaitWholeIndex,
  beginIndexBuild,
  endIndexBuild,
  isAnyIndexBuilding,
  planLinkOpen,
  renameFileWithLinkUpdates,
  toastStore,
  whenIndexBuilt,
} from "@plainva/ui";

/**
 * The first index of a vault is built behind the open app on both shells
 * (performance plan L3 on the desktop, issue 143 on the phone). What needs the
 * WHOLE index waits for it — in the shared code, so both shells wait the same:
 * the store itself, a link whose note the index does not know yet (created at
 * once, it would be a second note of a name the vault holds), and a rename
 * that rewrites the links onto a note.
 */
afterEach(() => {
  endIndexBuild("/vault");
  endIndexBuild("/other");
});

const settled = async (promise: Promise<unknown>) => {
  let done = false;
  void promise.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  return done;
};

describe("waiting for the whole first index", () => {
  it("resolves at once where no build runs, and at the end of the build where one does", async () => {
    await expect(whenIndexBuilt("/vault")).resolves.toBeUndefined();
    beginIndexBuild("/vault");
    expect(isAnyIndexBuilding()).toBe(true);
    const waiting = whenIndexBuilt("/vault");
    expect(await settled(waiting)).toBe(false);
    endIndexBuild("/vault");
    expect(await settled(waiting)).toBe(true);
  });

  it("lets the waiters of a vault go when another vault's build begins (the first was left)", async () => {
    beginIndexBuild("/vault");
    const waiting = whenIndexBuilt("/vault");
    beginIndexBuild("/other");
    expect(await settled(waiting)).toBe(true);
    expect(isAnyIndexBuilding()).toBe(true);
  });

  it("says once that it waits, without a vault's own promise as well", async () => {
    const shown = toastStore.get().length;
    beginIndexBuild("/vault");
    const a = awaitWholeIndex({ vaultId: "/vault" });
    const b = awaitAnyWholeIndex();
    expect(toastStore.get().length).toBeGreaterThan(shown);
    expect(await settled(a)).toBe(false);
    expect(await settled(b)).toBe(false);
    endIndexBuild("/vault");
    expect(await settled(a)).toBe(true);
    expect(await settled(b)).toBe(true);
  });
});

describe("a link while the first index is built", () => {
  it("is opened where the whole index finds its note, never created a second time", async () => {
    let indexed = false;
    const deps = {
      resolveWiki: async (target: string) => (indexed && target === "Plan" ? "Projects/Plan.md" : null),
      resolveMarkdown: async () => null,
      fileExists: async () => false,
      folderExists: async () => false,
    };
    beginIndexBuild("/vault");
    const plan = planLinkOpen({ text: "Plan", kind: "wiki", sourcePath: "Inbox/Today.md" }, deps);
    expect(await settled(plan)).toBe(false);
    indexed = true;
    endIndexBuild("/vault");
    expect(await plan).toEqual({ action: "open", path: "Projects/Plan.md", anchor: null });
  });

  it("is created once the whole index does not know its note either", async () => {
    const deps = { resolveWiki: async () => null, resolveMarkdown: async () => null, fileExists: async () => false, folderExists: async () => false };
    beginIndexBuild("/vault");
    const plan = planLinkOpen({ text: "New idea", kind: "wiki" }, deps);
    endIndexBuild("/vault");
    expect(await plan).toMatchObject({ action: "create", target: "New idea" });
  });

  it("does not wait where the index found the note", async () => {
    const deps = { resolveWiki: async () => "Projects/Plan.md", resolveMarkdown: async () => null, fileExists: async () => false, folderExists: async () => false };
    beginIndexBuild("/vault");
    expect(await planLinkOpen({ text: "Plan", kind: "wiki" }, deps)).toEqual({ action: "open", path: "Projects/Plan.md", anchor: null });
  });

  it("a bare Markdown link name waits as well", async () => {
    let indexed = false;
    const deps = {
      resolveWiki: async () => null,
      resolveMarkdown: async () => (indexed ? { kind: "file" as const, path: "Projects/Plan.md" } : null),
      fileExists: async () => false,
      folderExists: async () => false,
    };
    beginIndexBuild("/vault");
    const plan = planLinkOpen({ text: "Plan", kind: "markdown", sourcePath: "Inbox/Today.md" }, deps);
    expect(await settled(plan)).toBe(false);
    indexed = true;
    endIndexBuild("/vault");
    expect(await plan).toEqual({ action: "open", path: "Projects/Plan.md", anchor: null });
  });
});

describe("a rename while the first index is built", () => {
  it("waits for the whole index before it plans the links it rewrites", async () => {
    const asked: string[] = [];
    const queryService = {
      getBacklinks: async () => { asked.push("backlinks"); return []; },
      db: { query: async () => { asked.push("query"); return []; } },
    } as never;
    const moved: string[] = [];
    const adapter = {
      renameItem: async (from: string, to: string) => { moved.push(`${from}->${to}`); },
      readTextFile: async () => "",
      writeTextFile: async () => {},
      exists: async () => true,
    } as never;
    beginIndexBuild("/vault");
    const rename = renameFileWithLinkUpdates({ adapter, queryService, oldPath: "a.md", newPath: "b.md" }).catch(() => null);
    expect(await settled(rename)).toBe(false);
    expect(asked).toEqual([]);
    expect(moved).toEqual([]);
    endIndexBuild("/vault");
    await rename;
    expect(moved).toEqual(["a.md->b.md"]);
  });
});
