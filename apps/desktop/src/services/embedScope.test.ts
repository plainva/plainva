import { describe, it, expect } from "vitest";
import {
  detectEmbedScopeRelations,
  computeScopePaths,
  computeContextScope,
  buildContextScopeRelation,
  getContextFilters,
  addContextFilter,
  removeContextFilter,
  buildEmbedScopeOptions,
  SELF_MARKER,
  type EmbedScopeRelation,
} from "./embedScope";

const label = (k: string) => `L:${k}`;

describe("detectEmbedScopeRelations", () => {
  it("finds a downward relation (embedded base owns a relation to the host base)", () => {
    const rels = detectEmbedScopeRelations({
      hostBasePath: "DB/Projects.base",
      hostColumns: {},
      embeddedBasePath: "DB/Tasks.base",
      embeddedColumns: {
        project: { input: "relation", relationBase: "DB/Projects.base", relationLimit: "one" },
        title: { input: "text" },
      },
      labelOf: label,
    });
    expect(rels).toHaveLength(1);
    expect(rels[0]).toMatchObject({ column: "project", direction: "down", limitOne: true, selfRelation: false, label: "L:project" });
  });

  it("marks a self-relation (parent -> same base) as downward + selfRelation", () => {
    const rels = detectEmbedScopeRelations({
      hostBasePath: "DB/Tasks.base",
      hostColumns: {},
      embeddedBasePath: "DB/Tasks.base",
      embeddedColumns: { parent: { input: "relation", relationBase: "DB/Tasks.base", relationLimit: "one" } },
      labelOf: label,
    });
    expect(rels).toHaveLength(1);
    expect(rels[0]).toMatchObject({ column: "parent", direction: "down", selfRelation: true });
  });

  it("finds an upward relation (embedded base has a reverse column the host base owns)", () => {
    const rels = detectEmbedScopeRelations({
      hostBasePath: "DB/Tasks.base",
      hostColumns: { project: { input: "relation", relationBase: "DB/Projects.base", relationLimit: "one" } },
      embeddedBasePath: "DB/Projects.base",
      embeddedColumns: { tasks: { reverseOf: { base: "DB/Tasks.base", property: "project" } } },
      labelOf: label,
    });
    expect(rels).toHaveLength(1);
    expect(rels[0]).toMatchObject({ column: "tasks", direction: "up", hostProperty: "project", limitOne: true });
  });

  it("normalizes paths (./ prefix and backslashes) and returns nothing for unrelated bases", () => {
    const rels = detectEmbedScopeRelations({
      hostBasePath: "DB/Projects.base",
      hostColumns: {},
      embeddedBasePath: "DB/Tasks.base",
      embeddedColumns: {
        project: { input: "relation", relationBase: "./DB\\Projects.base" },
        area: { input: "relation", relationBase: "DB/Areas.base" },
      },
      labelOf: label,
    });
    expect(rels.map((r) => r.column)).toEqual(["project"]);
    expect(rels[0].limitOne).toBe(false); // no relationLimit -> unlimited
  });

  it("returns all matching relations when several connect to the host base", () => {
    const rels = detectEmbedScopeRelations({
      hostBasePath: "DB/Projects.base",
      hostColumns: {},
      embeddedBasePath: "DB/Tasks.base",
      embeddedColumns: {
        project: { input: "relation", relationBase: "DB/Projects.base" },
        sponsor: { input: "relation", relationBase: "DB/Projects.base" },
      },
      labelOf: label,
    });
    expect(rels.map((r) => r.column).sort()).toEqual(["project", "sponsor"]);
  });
});

type Sources = { path: string; title: string }[];

function fakeQuery(opts: {
  tree?: Record<string, Sources>;
  props?: Record<string, any>;
  notes?: string[];
}) {
  return {
    async getRelationSources(targets: string[], _prop: string) {
      const m = new Map<string, Sources>();
      for (const t of targets) if (opts.tree?.[t]) m.set(t, opts.tree[t]);
      return m;
    },
    async getFileProperties(_path: string) {
      return opts.props ?? {};
    },
    async listNotes() {
      return (opts.notes ?? []).map((path) => ({ path }));
    },
  };
}

describe("computeScopePaths", () => {
  const down: EmbedScopeRelation = { column: "project", direction: "down", limitOne: true, selfRelation: false, label: "" };

  it("down: the notes that link to the host via the relation", async () => {
    const qs = fakeQuery({ tree: { "Projects/Web.md": [{ path: "Tasks/T1.md", title: "T1" }, { path: "Tasks/T2.md", title: "T2" }] } });
    const scope = await computeScopePaths(qs, "Projects/Web.md", down, { subtree: false });
    expect([...scope].sort()).toEqual(["Tasks/T1.md", "Tasks/T2.md"]);
  });

  it("self + subtree: the whole descendant subtree, cycle-safe", async () => {
    const self: EmbedScopeRelation = { column: "parent", direction: "down", limitOne: true, selfRelation: true, label: "" };
    const qs = fakeQuery({
      tree: {
        "Tasks/Root.md": [{ path: "Tasks/A.md", title: "A" }, { path: "Tasks/B.md", title: "B" }],
        "Tasks/A.md": [{ path: "Tasks/A1.md", title: "A1" }],
        "Tasks/B.md": [{ path: "Tasks/A.md", title: "A" }], // already visited -> ignored
      },
    });
    const scope = await computeScopePaths(qs, "Tasks/Root.md", self, { subtree: true });
    expect([...scope].sort()).toEqual(["Tasks/A.md", "Tasks/A1.md", "Tasks/B.md"]);
    expect(scope.has("Tasks/Root.md")).toBe(false); // the host itself is never in scope
  });

  it("self WITHOUT subtree: only the direct children", async () => {
    const self: EmbedScopeRelation = { column: "parent", direction: "down", limitOne: true, selfRelation: true, label: "" };
    const qs = fakeQuery({
      tree: {
        "Tasks/Root.md": [{ path: "Tasks/A.md", title: "A" }],
        "Tasks/A.md": [{ path: "Tasks/A1.md", title: "A1" }],
      },
    });
    const scope = await computeScopePaths(qs, "Tasks/Root.md", self, { subtree: false });
    expect([...scope]).toEqual(["Tasks/A.md"]);
  });

  it("up: the rows the host itself points at (resolved outgoing links)", async () => {
    const up: EmbedScopeRelation = { column: "tasks", direction: "up", limitOne: true, selfRelation: false, hostProperty: "project", label: "" };
    const qs = fakeQuery({ props: { project: "[[Web]]" }, notes: ["Projects/Web.md", "Tasks/T1.md"] });
    const scope = await computeScopePaths(qs, "Tasks/T1.md", up, { subtree: false });
    expect([...scope]).toEqual(["Projects/Web.md"]);
  });

  it("up: resolves a list value and ignores unresolvable links", async () => {
    const up: EmbedScopeRelation = { column: "tasks", direction: "up", limitOne: false, selfRelation: false, hostProperty: "project", label: "" };
    const qs = fakeQuery({ props: { project: ["[[Web]]", "[[Gone]]"] }, notes: ["Projects/Web.md", "Tasks/T1.md"] });
    const scope = await computeScopePaths(qs, "Tasks/T1.md", up, { subtree: false });
    expect([...scope]).toEqual(["Projects/Web.md"]);
  });

  it("up: empty when the host has no value for the owning property", async () => {
    const up: EmbedScopeRelation = { column: "tasks", direction: "up", limitOne: true, selfRelation: false, hostProperty: "project", label: "" };
    const qs = fakeQuery({ props: {}, notes: ["Projects/Web.md"] });
    const scope = await computeScopePaths(qs, "Tasks/T1.md", up, { subtree: false });
    expect(scope.size).toBe(0);
  });
});

describe("explicit context filters (Diese Notiz)", () => {
  const columns = {
    project: { input: "relation", relationBase: "DB/Projects.base", relationLimit: "one" },
    parent: { input: "relation", relationBase: "DB/Tasks.base", relationLimit: "one" },
    tasks: { reverseOf: { base: "DB/Tasks.base", property: "project" } },
  };

  it("config mutators add/remove/read (deduped)", () => {
    let cfg: any = {};
    expect(getContextFilters(cfg)).toEqual([]);
    cfg = addContextFilter(cfg, "project");
    cfg = addContextFilter(cfg, "project"); // dedup
    expect(getContextFilters(cfg)).toEqual(["project"]);
    cfg = removeContextFilter(cfg, "project");
    expect(cfg.contextFilters).toBeUndefined();
    expect(SELF_MARKER).toBe("@this");
  });

  it("buildContextScopeRelation: owning relation -> down, reverse -> up, plain property -> down", () => {
    const down = buildContextScopeRelation(columns, "project", "DB/Tasks.base", label);
    expect(down).toMatchObject({ column: "project", direction: "down", selfRelation: false, limitOne: true });
    const self = buildContextScopeRelation(columns, "parent", "DB/Tasks.base", label);
    expect(self).toMatchObject({ direction: "down", selfRelation: true });
    const up = buildContextScopeRelation(columns, "tasks", "DB/Projects.base", label);
    expect(up).toMatchObject({ direction: "up", hostProperty: "project" });
    const plain = buildContextScopeRelation({}, "context", "DB/X.base", label);
    expect(plain).toMatchObject({ column: "context", direction: "down", selfRelation: false });
  });

  it("computeContextScope AND-intersects several relations", async () => {
    const relA: EmbedScopeRelation = { column: "project", direction: "down", limitOne: true, selfRelation: false, label: "" };
    const relB: EmbedScopeRelation = { column: "owner", direction: "down", limitOne: false, selfRelation: false, label: "" };
    const qs = {
      async getRelationSources(targets: string[], prop: string) {
        const m = new Map<string, { path: string; title: string }[]>();
        if (prop === "project") m.set(targets[0], [{ path: "T1.md", title: "T1" }, { path: "T2.md", title: "T2" }]);
        if (prop === "owner") m.set(targets[0], [{ path: "T2.md", title: "T2" }, { path: "T3.md", title: "T3" }]);
        return m;
      },
      async getFileProperties() { return {}; },
      async listNotes() { return []; },
    };
    const scope = await computeContextScope(qs, "Host.md", [relA, relB], new Set());
    expect([...scope]).toEqual(["T2.md"]); // intersection
  });
});

describe("buildEmbedScopeOptions", () => {
  const labels = { thisNote: "Diese Notiz", showAll: "Alle anzeigen" };

  it("uses a single 'this note' option when context filters exist (precedence)", () => {
    const opts = buildEmbedScopeOptions(true, [{ label: "Projekt" }, { label: "Bereich" }], "Host", labels);
    expect(opts).toEqual([
      { value: "0", label: "Diese Notiz: Host" },
      { value: "off", label: "Alle anzeigen" },
    ]);
  });

  it("labels a single auto relation by the host title only", () => {
    const opts = buildEmbedScopeOptions(false, [{ label: "Projekt" }], "Host", labels);
    expect(opts).toEqual([
      { value: "0", label: "Host" },
      { value: "off", label: "Alle anzeigen" },
    ]);
  });

  it("disambiguates multiple auto relations by their label", () => {
    const opts = buildEmbedScopeOptions(false, [{ label: "Projekt" }, { label: "Bereich" }], "Host", labels);
    expect(opts).toEqual([
      { value: "0", label: "Host · Projekt" },
      { value: "1", label: "Host · Bereich" },
      { value: "off", label: "Alle anzeigen" },
    ]);
  });
});
