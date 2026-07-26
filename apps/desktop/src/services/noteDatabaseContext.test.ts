import { describe, it, expect } from "vitest";
import {
  buildNoteDatabaseContext,
  hasNoteDatabaseContext,
  EMPTY_NOTE_DATABASE_CONTEXT,
  type BaseDataDeps,
  type IncomingRelationRef,
} from "@plainva/ui";

/**
 * P4 — "which database does this note belong to?". The kernel is shared with
 * the cascade deletion (baseMembership), so these tests also pin the one rule
 * both features must agree on: membership is the DATABASE, not a view — a note
 * filtered out of every view still belongs to the base.
 */

const taskBase = JSON.stringify({
  filters: { and: ['file.folder == "Aufgaben"'] },
  columns: {
    status: { input: "status" },
    parent: { input: "relation", relationBase: "Aufgaben.base" },
  },
  // On disk the sub-items key lives in the plainva namespace — the view top
  // level never carried it (baseFormat). Getting this wrong in the fixture is
  // exactly how a "works in the test, not in the app" bug is born.
  views: [{ type: "table", name: "Offen", order: ["file.name"], plainva: { subItemsProperty: "parent" } }],
});

const contactBase = JSON.stringify({
  filters: { and: ['file.folder == "Kontakte"'] },
  columns: { aufgabe: { input: "relation", relationBase: "Aufgaben.base" } },
  views: [{ type: "table", name: "Alle", order: ["file.name"] }],
});

interface FakeOpts {
  bases?: Record<string, string>;
  members?: Record<string, string[]>;
  incoming?: Record<string, IncomingRelationRef[]>;
  outgoing?: Record<string, string[]>;
}

function deps(o: FakeOpts): BaseDataDeps {
  const bases = o.bases ?? {};
  return {
    listBaseFilePaths: async () => Object.keys(bases),
    readTextFile: async (p) => bases[p] ?? "",
    // The fake keys membership by base path; the real one runs the query with
    // the view filters stripped.
    queryDatabaseFiles: async (config: any) => {
      const label = config?.filters?.and?.[0] ?? "";
      const basePath = Object.keys(bases).find((b) => {
        try {
          return (JSON.parse(bases[b]).filters?.and?.[0] ?? "") === label;
        } catch {
          return false; // an unparseable base cannot own any row
        }
      });
      return (o.members?.[basePath ?? ""] ?? []).map((path) => ({ path, title: null }));
    },
    getIncomingRelationRefs: async (targets) => {
      const map = new Map<string, IncomingRelationRef[]>();
      for (const t of targets) map.set(t, o.incoming?.[t] ?? []);
      return map;
    },
    getOutgoingRelationTargets: async (source, key) => o.outgoing?.[`${source}#${key}`] ?? [],
  };
}

describe("buildNoteDatabaseContext", () => {
  it("reports nothing for a note that belongs to no database", async () => {
    const ctx = await buildNoteDatabaseContext(
      deps({ bases: { "Aufgaben.base": taskBase }, members: { "Aufgaben.base": ["Aufgaben/Andere.md"] } }),
      "Notizen/Frei.md"
    );
    expect(ctx).toEqual(EMPTY_NOTE_DATABASE_CONTEXT);
    expect(hasNoteDatabaseContext(ctx)).toBe(false);
  });

  it("names the database and its view for a member note", async () => {
    const ctx = await buildNoteDatabaseContext(
      deps({ bases: { "Aufgaben.base": taskBase }, members: { "Aufgaben.base": ["Aufgaben/Startseite.md"] } }),
      "Aufgaben/Startseite.md"
    );
    expect(ctx.memberships).toEqual([{ basePath: "Aufgaben.base", baseLabel: "Aufgaben", viewName: "Offen" }]);
    expect(hasNoteDatabaseContext(ctx)).toBe(true);
  });

  it("lists ALL databases a note belongs to (E6)", async () => {
    const other = JSON.stringify({
      filters: { and: ['file.folder == "Archiv"'] },
      columns: {},
      views: [{ type: "table", name: "Archiv", order: [] }],
    });
    const ctx = await buildNoteDatabaseContext(
      deps({
        bases: { "Aufgaben.base": taskBase, "Archiv.base": other },
        members: { "Aufgaben.base": ["A/N.md"], "Archiv.base": ["A/N.md"] },
      }),
      "A/N.md"
    );
    expect(ctx.memberships.map((m) => m.baseLabel).sort()).toEqual(["Archiv", "Aufgaben"]);
  });

  it("derives parent and sub-items from the database's self relation", async () => {
    const ctx = await buildNoteDatabaseContext(
      deps({
        bases: { "Aufgaben.base": taskBase },
        members: { "Aufgaben.base": ["A/Relaunch.md", "A/Startseite.md", "A/Hero.md", "A/Bild.md"] },
        outgoing: { "A/Startseite.md#parent": ["A/Relaunch.md"] },
        incoming: {
          "A/Startseite.md": [
            { path: "A/Hero.md", title: "Hero-Text", propertyKey: "parent" },
            { path: "A/Bild.md", title: "Bildauswahl", propertyKey: "parent" },
          ],
        },
      }),
      "A/Startseite.md"
    );
    expect(ctx.parent).toEqual({ path: "A/Relaunch.md", title: "Relaunch", baseLabel: "Aufgaben" });
    expect(ctx.children.map((c) => c.title)).toEqual(["Hero-Text", "Bildauswahl"]);
  });

  it("counts foreign databases that reference the note, without double-counting sub-items", async () => {
    const ctx = await buildNoteDatabaseContext(
      deps({
        bases: { "Aufgaben.base": taskBase, "Kontakte.base": contactBase },
        members: { "Aufgaben.base": ["A/Startseite.md", "A/Hero.md"], "Kontakte.base": ["K/Anna.md"] },
        incoming: {
          "A/Startseite.md": [
            { path: "K/Anna.md", title: "Anna", propertyKey: "aufgabe" },
            { path: "A/Hero.md", title: "Hero-Text", propertyKey: "parent" },
          ],
        },
      }),
      "A/Startseite.md"
    );
    expect(ctx.linked).toEqual([{ basePath: "Kontakte.base", baseLabel: "Kontakte", count: 1 }]);
    // The sub-item has its own line and must not also appear as "linked".
    expect(ctx.children.map((c) => c.path)).toEqual(["A/Hero.md"]);
  });

  it("treats a .base file itself as a database, not as a row", async () => {
    const ctx = await buildNoteDatabaseContext(deps({ bases: { "Aufgaben.base": taskBase } }), "Aufgaben.base");
    expect(ctx).toEqual(EMPTY_NOTE_DATABASE_CONTEXT);
  });

  it("survives an unparseable .base instead of failing the whole context", async () => {
    const ctx = await buildNoteDatabaseContext(
      deps({
        bases: { "Kaputt.base": "{{{ not json", "Aufgaben.base": taskBase },
        members: { "Aufgaben.base": ["A/N.md"] },
      }),
      "A/N.md"
    );
    expect(ctx.memberships.map((m) => m.baseLabel)).toEqual(["Aufgaben"]);
  });
});
