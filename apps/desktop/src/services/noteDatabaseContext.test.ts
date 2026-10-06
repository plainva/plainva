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
  /** Full rows (with property values) the VIEW returns, in view order. */
  viewRows?: Record<string, Array<Record<string, unknown>>>;
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
      // The inspector asks a second time WITH the view's filters applied
      // (`views` narrowed to one) — the fake answers that with viewRows, so a
      // test can make membership and view disagree, which is a real state.
      const single = Array.isArray(config?.views) && config.views.length === 1;
      const rows = o.viewRows?.[basePath ?? ""];
      if (single && rows) return rows as never;
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
    // Identity only — the inspector fields (columns, row, position) have their
    // own tests further down.
    expect(ctx.memberships).toHaveLength(1);
    expect(ctx.memberships[0]).toMatchObject({ basePath: "Aufgaben.base", baseLabel: "Aufgaben", viewName: "Offen" });
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

  // --- Entry inspector (plan P2) ------------------------------------------

  const inspectBase = JSON.stringify({
    filters: { and: ['file.folder == "Aufgaben"'] },
    columns: { status: { input: "status" }, frist: { input: "date" } },
    // Two views on purpose: the inspector reads the FIRST one, and the fake
    // below tells the two queries apart by how many views the config carries.
    views: [
      { type: "table", name: "Offen", order: ["file.name", "note.status", "note.frist"] },
      { type: "table", name: "Alle", order: ["file.name"] },
    ],
  });

  it("reports the view's columns, this note's values and its position", async () => {
    const ctx = await buildNoteDatabaseContext(
      deps({
        bases: { "Aufgaben.base": inspectBase },
        members: { "Aufgaben.base": ["A/Eins.md", "A/Zwei.md", "A/Drei.md"] },
        viewRows: {
          "Aufgaben.base": [
            { "file.path": "A/Eins.md", status: "Offen" },
            { "file.path": "A/Zwei.md", status: "In Arbeit", frist: "2026-08-01" },
            { "file.path": "A/Drei.md", status: "Erledigt" },
          ],
        },
      }),
      "A/Zwei.md"
    );
    const m = ctx.memberships[0];
    // `file.*` columns are derived and cannot be edited, so they stay out.
    expect(m.columns).toEqual(["status", "frist"]);
    expect(m.row?.status).toBe("In Arbeit");
    expect([m.index, m.total]).toEqual([2, 3]);
    expect([m.prevPath, m.nextPath]).toEqual(["A/Eins.md", "A/Drei.md"]);
  });

  // Decision E1 (plan Befunde 2026-10-06): the sidebar's database section used
  // to list every column of the view — and for most notes that was what the
  // properties section showed directly below. The context now says which of
  // the view's columns the database COMPUTES (those are the section's rows)
  // and which the note carries itself (those stand once, under Properties).
  const computedBase = JSON.stringify({
    filters: { and: ['file.folder == "Kunden"'] },
    columns: {
      branche: { input: "select" },
      notiz: { input: "text" },
      projekte: { reverseOf: { base: "Aufgaben.base", property: "kunde" } },
      offen: { rollup: { through: "projekte", of: "status", fn: "percentWhere", where: { op: "!=", value: "done" } } },
    },
    views: [{
      type: "table",
      name: "Tabelle",
      order: ["file.name", "note.branche", "note.notiz", "note.projekte", "note.offen", "file.mtime", "formula.summe"],
    }],
  });

  it("splits the view's columns into what the database computes and what the note carries", async () => {
    const ctx = await buildNoteDatabaseContext(
      deps({
        bases: { "Kunden.base": computedBase },
        members: { "Kunden.base": ["K/ACME.md"] },
        viewRows: {
          "Kunden.base": [{ "file.path": "K/ACME.md", "file.name": "ACME", "file.mtime": 1750000003000, branche: "tech", projekte: ["[[Alpha]]"], offen: 50 }],
        },
      }),
      "K/ACME.md"
    );
    const m = ctx.memberships[0];
    // In view order. `file.name` is the note's own title and is neither.
    expect(m.computed.map((f) => [f.column, f.kind])).toEqual([
      ["projekte", "reverse"],
      ["offen", "rollup"],
      ["file.mtime", "file"],
      ["formula.summe", "formula"],
    ]);
    expect(m.computed.find((f) => f.column === "projekte")?.value).toEqual(["[[Alpha]]"]);
    // The rollup function travels along: a percentage has to say so.
    expect(m.computed.find((f) => f.column === "offen")).toMatchObject({ value: 50, rollupFn: "percentWhere" });
    // `notiz` is a column of the view, but this note has no such key: it is not
    // "under Properties", it is nowhere yet — so it is not named.
    expect(m.shownAsProperties).toEqual(["branche"]);
    // The old list of non-file columns is unchanged for whoever reads it.
    expect(m.columns).toEqual(["branche", "notiz", "projekte", "offen", "formula.summe"]);
  });

  it("a database without computed columns has none — membership and position are all there is to show", async () => {
    const ctx = await buildNoteDatabaseContext(
      deps({
        bases: { "Aufgaben.base": inspectBase },
        members: { "Aufgaben.base": ["A/Eins.md"] },
        viewRows: { "Aufgaben.base": [{ "file.path": "A/Eins.md", status: "Offen" }] },
      }),
      "A/Eins.md"
    );
    const m = ctx.memberships[0];
    expect(m.computed).toEqual([]);
    expect(m.shownAsProperties).toEqual(["status"]);
    expect([m.index, m.total]).toEqual([1, 1]);
  });

  it("has no neighbour past either end of the view", async () => {
    const rows = [{ "file.path": "A/Eins.md" }, { "file.path": "A/Zwei.md" }];
    const first = await buildNoteDatabaseContext(
      deps({ bases: { "Aufgaben.base": inspectBase }, members: { "Aufgaben.base": ["A/Eins.md", "A/Zwei.md"] }, viewRows: { "Aufgaben.base": rows } }),
      "A/Eins.md"
    );
    const last = await buildNoteDatabaseContext(
      deps({ bases: { "Aufgaben.base": inspectBase }, members: { "Aufgaben.base": ["A/Eins.md", "A/Zwei.md"] }, viewRows: { "Aufgaben.base": rows } }),
      "A/Zwei.md"
    );
    expect(first.memberships[0].prevPath).toBeNull();
    expect(last.memberships[0].nextPath).toBeNull();
  });

  it("keeps the membership but reports no position when the view filters the note out", async () => {
    // Membership ignores view filters on purpose (it is shared with the cascade
    // deletion). So "belongs to the database" and "appears in the view" can
    // legitimately disagree — and "0 / 34" must never reach the screen.
    const ctx = await buildNoteDatabaseContext(
      deps({
        bases: { "Aufgaben.base": inspectBase },
        members: { "Aufgaben.base": ["A/Versteckt.md", "A/Sichtbar.md"] },
        viewRows: { "Aufgaben.base": [{ "file.path": "A/Sichtbar.md" }] },
      }),
      "A/Versteckt.md"
    );
    const m = ctx.memberships[0];
    expect(m.baseLabel).toBe("Aufgaben");
    expect(m.index).toBe(0);
    expect(m.row).toBeNull();
    expect([m.prevPath, m.nextPath]).toEqual([null, null]);
    // The columns still describe the view, so the block can say what it would show.
    expect(m.columns).toEqual(["status", "frist"]);
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
