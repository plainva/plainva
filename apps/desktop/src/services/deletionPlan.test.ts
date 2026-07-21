import { describe, it, expect } from "vitest";
import {
  buildDeletionPlan,
  cleanupRefsFor,
  effectiveGroupChecked,
  groupId,
  initialSelection,
  planNeedsDialog,
  selectedPaths,
  serializeBaseConfig,
  type DeletionPlanDeps,
} from "@plainva/ui";

/**
 * Cascade deletion plan kernel (plan Kaskadenloeschung P1): BFS over incoming
 * property links, shared/multi-membership defaults, linked-database two-step
 * groups. Runs on fake deps; `.base` configs go through the REAL
 * serialize/parse roundtrip so the column contract stays honest.
 */

interface Edge {
  source: string;
  title?: string;
  target: string;
  key: string;
}

function makeDeps(opts: {
  bases: Record<string, unknown>; // path -> in-memory config (serialized on read)
  membersByFolder: Record<string, Array<{ path: string; title?: string }>>;
  edges: Edge[];
  outgoing?: Record<string, string[]>; // `${source} ${key}` -> resolved targets
}): DeletionPlanDeps {
  return {
    async getIncomingRelationRefs(targetPaths) {
      const map = new Map<string, { path: string; title: string; propertyKey: string }[]>();
      for (const t of targetPaths) {
        const refs = opts.edges
          .filter((e) => e.target === t)
          .map((e) => ({ path: e.source, title: e.title ?? e.source, propertyKey: e.key }));
        if (refs.length > 0) map.set(t, refs);
      }
      return map;
    },
    async getOutgoingRelationTargets(sourcePath, propertyKey) {
      return opts.outgoing?.[`${sourcePath} ${propertyKey}`] ?? [];
    },
    async queryDatabaseFiles(config: any) {
      const clause: unknown = config?.filters?.and?.[0];
      const m = typeof clause === "string" ? clause.match(/file\.folder\s*==\s*"([^"]+)"/) : null;
      return m ? (opts.membersByFolder[m[1]] ?? []) : [];
    },
    async listBaseFilePaths() {
      return Object.keys(opts.bases);
    },
    async readTextFile(path) {
      const cfg = opts.bases[path];
      if (!cfg) throw new Error(`no base at ${path}`);
      return serializeBaseConfig(cfg);
    },
  };
}

const projectsBase = {
  columns: { status: { input: "select" } },
  views: [{ type: "table", name: "Alle" }],
  filters: { and: ['file.folder == "Projekte"'] },
};

const tasksBase = {
  columns: {
    projekt: { input: "relation", relationBase: "Projekte.base" },
    parent: { input: "relation", relationBase: "Aufgaben.base" },
  },
  views: [{ type: "table", name: "Alle" }],
  filters: { and: ['file.folder == "Aufgaben"'] },
};

describe("buildDeletionPlan — element case", () => {
  const deps = makeDeps({
    bases: { "Projekte.base": projectsBase, "Aufgaben.base": tasksBase },
    membersByFolder: {
      Projekte: [{ path: "Projekte/A.md", title: "A" }, { path: "Projekte/B.md", title: "B" }],
      Aufgaben: [
        { path: "Aufgaben/T1.md", title: "T1" },
        { path: "Aufgaben/T2.md", title: "T2" },
        { path: "Aufgaben/U1.md", title: "U1" },
      ],
    },
    edges: [
      { source: "Aufgaben/T1.md", title: "T1", target: "Projekte/A.md", key: "projekt" },
      { source: "Aufgaben/T2.md", title: "T2", target: "Projekte/A.md", key: "projekt" },
      { source: "Aufgaben/U1.md", title: "U1", target: "Aufgaben/T1.md", key: "parent" },
    ],
    outgoing: {
      "Aufgaben/T1.md projekt": ["Projekte/A.md"],
      "Aufgaben/T2.md projekt": ["Projekte/A.md", "Projekte/B.md"], // shared with B
      "Aufgaben/U1.md parent": ["Aufgaben/T1.md"],
    },
  });

  it("collects assigned elements recursively, grouped by their owning base", async () => {
    const plan = await buildDeletionPlan(deps, ["Projekte/A.md"]);
    expect(plan.primary).toEqual([{ path: "Projekte/A.md", title: "A", kind: "note" }]);
    expect(plan.groups).toHaveLength(1);
    const g = plan.groups[0];
    expect(g.kind).toBe("assigned");
    expect(g.baseLabel).toBe("Aufgaben");
    expect(g.defaultChecked).toBe(true);
    expect(g.items.map((i) => [i.path, i.depth])).toEqual([
      ["Aufgaben/T1.md", 1],
      ["Aufgaben/T2.md", 1],
      ["Aufgaben/U1.md", 2],
    ]);
    expect(planNeedsDialog(plan)).toBe(true);
  });

  it("marks shared elements (same key still points at a survivor) and excludes them initially", async () => {
    const plan = await buildDeletionPlan(deps, ["Projekte/A.md"]);
    const items = plan.groups[0].items;
    expect(items.find((i) => i.path === "Aufgaben/T2.md")?.sharedWith).toEqual(["B"]);
    expect(items.find((i) => i.path === "Aufgaben/T1.md")?.sharedWith).toEqual([]);

    const sel = initialSelection(plan);
    expect(sel.excluded.has("Aufgaben/T2.md")).toBe(true);
    const paths = selectedPaths(plan, sel);
    expect(paths.sort()).toEqual(["Aufgaben/T1.md", "Aufgaben/U1.md", "Projekte/A.md"]);
  });

  it("derives cleanup refs from surviving sources onto deleted targets", async () => {
    const plan = await buildDeletionPlan(deps, ["Projekte/A.md"]);
    const sel = initialSelection(plan);
    const refs = cleanupRefsFor(plan, new Set(selectedPaths(plan, sel)));
    // T2 survives (shared) but points at deleted A -> exactly one cleanup ref.
    expect(refs).toEqual([{ source: "Aufgaben/T2.md", target: "Projekte/A.md", propertyKey: "projekt" }]);
  });

  it("survives relation cycles", async () => {
    const cyclic = makeDeps({
      bases: { "Aufgaben.base": tasksBase },
      membersByFolder: { Aufgaben: [{ path: "Aufgaben/X.md" }, { path: "Aufgaben/Y.md" }] },
      edges: [
        { source: "Aufgaben/Y.md", target: "Aufgaben/X.md", key: "parent" },
        { source: "Aufgaben/X.md", target: "Aufgaben/Y.md", key: "parent" },
      ],
    });
    const plan = await buildDeletionPlan(cyclic, ["Aufgaben/X.md"]);
    expect(plan.groups[0].items.map((i) => i.path)).toEqual(["Aufgaben/Y.md"]);
  });

  it("keeps plain notes without incoming relations on the slim flow", async () => {
    const plan = await buildDeletionPlan(deps, ["Projekte/B.md"]);
    expect(plan.groups).toEqual([]);
    expect(planNeedsDialog(plan)).toBe(false);
  });
});

describe("buildDeletionPlan — base case", () => {
  const deps = makeDeps({
    bases: { "Projekte.base": projectsBase, "Aufgaben.base": tasksBase },
    membersByFolder: {
      Projekte: [{ path: "Projekte/P1.md", title: "P1" }, { path: "Projekte/P2.md", title: "P2" }],
      Aufgaben: [{ path: "Aufgaben/T1.md", title: "T1" }, { path: "Aufgaben/T3.md", title: "T3" }],
    },
    edges: [{ source: "Aufgaben/T1.md", title: "T1", target: "Projekte/P1.md", key: "projekt" }],
    outgoing: { "Aufgaben/T1.md projekt": ["Projekte/P1.md"] },
  });

  it("offers own rows (checked) plus a two-step card per linked base (both off)", async () => {
    const plan = await buildDeletionPlan(deps, ["Projekte.base"]);
    expect(plan.primary).toEqual([{ path: "Projekte.base", title: "Projekte", kind: "base" }]);
    expect(plan.affectedBases).toEqual(["Projekte.base"]);

    const kinds = plan.groups.map((g) => g.kind);
    expect(kinds).toEqual(["dbItems", "linkedAssigned", "linkedAll"]);

    const [db, linkedAssigned, linkedAll] = plan.groups;
    expect(db.items.map((i) => i.path)).toEqual(["Projekte/P1.md", "Projekte/P2.md"]);
    expect(db.defaultChecked).toBe(true);

    expect(linkedAssigned.baseLabel).toBe("Aufgaben");
    expect(linkedAssigned.defaultChecked).toBe(false);
    expect(linkedAssigned.items.map((i) => i.path)).toEqual(["Aufgaben/T1.md"]);
    expect(linkedAssigned.baseTotal).toBe(2);

    expect(linkedAll.linkedBaseFile).toBe("Aufgaben.base");
    expect(linkedAll.items.map((i) => i.path)).toEqual(["Aufgaben/T3.md"]);
    expect(linkedAll.defaultChecked).toBe(false);
  });

  it("selects step-wise: default keeps the linked base untouched; step 2 implies step 1", async () => {
    const plan = await buildDeletionPlan(deps, ["Projekte.base"]);
    const sel = initialSelection(plan);
    expect(selectedPaths(plan, sel).sort()).toEqual(["Projekte.base", "Projekte/P1.md", "Projekte/P2.md"]);

    const linkedAssigned = plan.groups.find((g) => g.kind === "linkedAssigned")!;
    const linkedAll = plan.groups.find((g) => g.kind === "linkedAll")!;
    expect(effectiveGroupChecked(plan, sel, linkedAssigned)).toBe(false);

    sel.groups[groupId(linkedAll)] = true;
    expect(effectiveGroupChecked(plan, sel, linkedAssigned)).toBe(true);
    expect(selectedPaths(plan, sel).sort()).toEqual([
      "Aufgaben.base",
      "Aufgaben/T1.md",
      "Aufgaben/T3.md",
      "Projekte.base",
      "Projekte/P1.md",
      "Projekte/P2.md",
    ]);
  });

  it("excludes rows that are also members of another base by default", async () => {
    const overlapping = makeDeps({
      bases: {
        "Projekte.base": projectsBase,
        "Archiv.base": {
          columns: {},
          views: [{ type: "table", name: "Alle" }],
          filters: { and: ['file.folder == "Projekte"'] }, // same folder → full overlap
        },
      },
      membersByFolder: { Projekte: [{ path: "Projekte/P1.md", title: "P1" }] },
      edges: [],
    });
    const plan = await buildDeletionPlan(overlapping, ["Projekte.base"]);
    const db = plan.groups.find((g) => g.kind === "dbItems")!;
    expect(db.items[0].alsoMemberOf).toEqual(["Archiv"]);
    const sel = initialSelection(plan);
    expect(sel.excluded.has("Projekte/P1.md")).toBe(true);
    expect(selectedPaths(plan, sel)).toEqual(["Projekte.base"]);
  });

  it("still shows the dialog for a linked base without assigned elements", async () => {
    const noEdges = makeDeps({
      bases: { "Projekte.base": projectsBase, "Aufgaben.base": tasksBase },
      membersByFolder: { Projekte: [], Aufgaben: [] },
      edges: [],
    });
    const plan = await buildDeletionPlan(noEdges, ["Projekte.base"]);
    expect(plan.groups.some((g) => g.kind === "linkedAll")).toBe(true);
    expect(planNeedsDialog(plan)).toBe(true);
  });
});
