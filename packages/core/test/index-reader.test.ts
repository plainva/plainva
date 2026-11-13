import { describe, expect, it } from "vitest";
import { realSqlite } from "./helpers/realSqlite.js";
import { VaultQueryService, indexReadMethodNames, type IndexReader, type IndexView } from "../src/vault/VaultQueryService.js";
import { isIndexNotWholeError, type IndexWholenessState } from "../src/vault/indexWholeness.js";

/**
 * Reading is safe by default (performance plan L3, second review of 11.11.):
 * the reader the app hands out refuses while its index is not whole; a
 * surface that only shows asks for the view, by its name. Two reviews had
 * found a planner that read half an index because it was not on a list of
 * planners — the default is now the other way round.
 */
function building() {
  let state: IndexWholenessState = { kind: "building", done: 3, total: 10 };
  return {
    wholeness: { state: () => state, changed: () => new Promise<IndexWholenessState>(() => {}) },
    whole: () => { state = { kind: "whole" }; },
  };
}

async function indexWithANote() {
  const db = await realSqlite();
  await db.execute(
    `INSERT INTO files (id, path, title, sha256, mtime_local, ctime, size_bytes, is_cached, mode, sync_state, fts_rowid) VALUES ('a', 'A.md', 'A', 'x', 1, 1, 1, 1, 'obsidian', 'synced', 0)`,
  );
  return db;
}

describe("the reader and its view", () => {
  it("refuses every read while the index is not whole, and reads once it is", async () => {
    const db = await indexWithANote();
    const qs = new VaultQueryService(db);
    const build = building();
    qs.setIndexWholeness(build.wholeness);
    for (const call of [() => qs.listNotes(), () => qs.queryDatabaseFiles({}), () => qs.resolveNotePath("A"), () => qs.getBacklinks("A.md")]) {
      const refused = await call().then(() => null, (e: unknown) => e);
      expect(isIndexNotWholeError(refused)).toBe(true);
    }
    build.whole();
    expect((await qs.listNotes()).map((n) => n.path)).toEqual(["A.md"]);
    await db.close();
  });

  it("refuses a raw query on its database too, and the view's database reads", async () => {
    const db = await indexWithANote();
    const qs = new VaultQueryService(db);
    qs.setIndexWholeness(building().wholeness);
    const refused = await qs.db.query("SELECT path FROM files").then(() => null, (e: unknown) => e);
    expect(isIndexNotWholeError(refused)).toBe(true);
    expect(await qs.view().db.query("SELECT path FROM files")).toEqual([{ path: "A.md" }]);
    await db.close();
  });

  it("gives a view that reads the index as it stands and shares the reader's state", async () => {
    const db = await indexWithANote();
    const qs = new VaultQueryService(db);
    const build = building();
    qs.setIndexWholeness(build.wholeness);
    const view: IndexView = qs.view();
    expect(view.partialIndex).toBe(true);
    expect((await view.listNotes()).map((n) => n.path)).toEqual(["A.md"]);
    expect(view.indexWholeness().kind).toBe("building");
    build.whole();
    expect(view.indexWholeness().kind).toBe("whole");
    expect(qs.view()).toBe(view);
    await db.close();
  });

  it("refuses every asynchronous method the class has, whatever is added later", () => {
    const proto = VaultQueryService.prototype as unknown as Record<string, unknown>;
    const asyncMethods = Object.getOwnPropertyNames(proto).filter((name) => {
      const value = Object.getOwnPropertyDescriptor(proto, name)?.value;
      return typeof value === "function" && value.constructor?.name === "AsyncFunction";
    });
    // The detection itself must see the class's async methods (a build target
    // that compiled them to generators would leave the list empty).
    expect(asyncMethods.length).toBeGreaterThan(30);
    expect([...indexReadMethodNames()].sort()).toEqual(asyncMethods.filter((n) => n !== "untilWholeIndex").sort());
    for (const name of ["listNotes", "queryDatabaseFiles", "resolveNotePath", "linkTargets", "getBacklinks", "fileRecords", "searchFullText"]) {
      expect(indexReadMethodNames()).toContain(name);
    }
  });

  it("keeps a view out of a planner's parameter (types)", () => {
    const plans = (reader: IndexReader<"listNotes">) => reader;
    const qs = new VaultQueryService({} as never);
    plans(qs);
    // @ts-expect-error a view is not a whole reader
    plans(qs.view());
    expect(true).toBe(true);
  });
});
