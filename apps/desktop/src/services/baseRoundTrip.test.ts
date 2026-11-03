import { describe, it, expect } from "vitest";
import * as yaml from "yaml";
import { parseBaseConfig, serializeBaseConfig } from "@plainva/ui";

/**
 * Round-trip guard for `.base` files: reading a file and writing it back with
 * no change made in the app must give a file whose YAML DATA equals the input
 * (key order may differ). Plainva's promise is that an Obsidian vault is never
 * silently reformatted, and a `.base` is rewritten as a whole on every save —
 * so everything Plainva does not know, or knows in a different spelling, has
 * to come back exactly as it was. The fixtures cover the places where it did
 * not: unknown keys in a column's `plainva` block, a rollup Plainva cannot
 * read, a view type Plainva does not know, Obsidian's own `groupBy`, and the
 * native keys of a view after another view is deleted or moved.
 *
 * Plainva's own legacy forms (a top-level `columns:` map, `type: board`, the
 * two-key filter root) are migrated on save on purpose and are not fixtures
 * here; baseFormat.test.ts covers them.
 */

const OBSIDIAN_AUTHORED = `
filters:
  and:
    - file.hasTag("project")
    - 'status != "done"'
formulas:
  total: price * qty
  late: if(due < today(), "late", "")
properties:
  note.status:
    displayName: Status
  formula.total:
    displayName: Total
summaries:
  doubled: values.sum() * 2
views:
  - type: table
    name: Table
    order:
      - file.name
      - note.status
      - formula.total
    sort:
      - property: note.status
        direction: DESC
    limit: 10
    groupBy:
      property: note.status
      direction: ASC
    columnSize:
      note.status: 200
    summaries:
      note.price: Sum
      formula.total: doubled
  - type: cards
    name: Cards
    image: note.cover
    cardSize: 200
    filters:
      or:
        - 'priority == "high"'
        - price > 2
  - type: map
    name: Map
    coordinates: note.location
    markerIcon: pin
`;

const PLAINVA_AUTHORED = `
filters:
  or:
    - file.folder == "Projects"
    - file.hasTag("work")
properties:
  note.status:
    displayName: State
    plainva:
      input: select
      options:
        - Open
        - value: Done
          color: green
          backgroundColor: "#00ff00"
      futureColumnKey:
        nested: [1, 2]
  note.open:
    plainva:
      rollup:
        through: tasks
        fn: notAFunction
  note.project:
    plainva:
      input: relation
      relationBase: Projects.base
      relationLimit: many
  note.rating:
    plainva:
      input: rating
      ratingMax: 5
views:
  - type: table
    name: Board
    plainva:
      render: board
      groupBy: status
      fileIconColor: "#2f6f6f"
      futureViewKey: true
    order:
      - status
      - note.project
  - type: list
    name: List
    plainva:
      dateFormat: default
    sort:
      - field: file.mtime
  - type: table
    name: Not
    filters:
      not:
        - file.hasTag("archive")
        - and:
            - 'status == "x"'
            - or:
                - file.inFolder("Old")
                - 'a && b'
`;

const UNKNOWN_TOP_LEVEL = `
x-custom:
  keep: me
views:
  - type: table
    name: Only
    futureNativeKey: 3
`;

const FIXTURES: Record<string, string> = {
  "an Obsidian-authored base (formulas, summaries, groupBy, limit, unknown view type)": OBSIDIAN_AUTHORED,
  "a Plainva-authored base (unknown plainva keys, unreadable rollup, legacy limit)": PLAINVA_AUTHORED,
  "a base with an unknown top-level key and an unknown view key": UNKNOWN_TOP_LEVEL,
};

describe(".base round-trip guard", () => {
  for (const [label, text] of Object.entries(FIXTURES)) {
    it(`writes ${label} back unchanged when nothing was changed`, () => {
      const written = serializeBaseConfig(parseBaseConfig(text));
      expect(yaml.parse(written)).toEqual(yaml.parse(text));
    });

    it(`writes ${label} back unchanged after a second round`, () => {
      const once = serializeBaseConfig(parseBaseConfig(text));
      const twice = serializeBaseConfig(parseBaseConfig(once));
      expect(yaml.parse(twice)).toEqual(yaml.parse(text));
    });
  }

  it("keeps unknown plainva keys and an unreadable rollup when another key of the column changes", () => {
    const cfg = parseBaseConfig(PLAINVA_AUTHORED);
    cfg.columns.status.options = [...cfg.columns.status.options, { value: "Later" }];
    cfg.columns.open.input = "number";
    const out = yaml.parse(serializeBaseConfig(cfg));
    expect(out.properties["note.status"].plainva.futureColumnKey).toEqual({ nested: [1, 2] });
    expect(out.properties["note.status"].plainva.options.map((o: any) => o.value ?? o)).toEqual(["Open", "Done", "Later"]);
    expect(out.properties["note.status"].displayName).toBe("State");
    expect(out.properties["note.open"].plainva.rollup).toEqual({ through: "tasks", fn: "notAFunction" });
    expect(out.properties["note.open"].plainva.input).toBe("number");
  });

  it("keeps a view type Plainva does not know, shown as a table", () => {
    const cfg = parseBaseConfig(OBSIDIAN_AUTHORED);
    expect(cfg.views[2].type).toBe("table");
    cfg.views[2].sort = [{ property: "file.name", direction: "ASC" }];
    const out = yaml.parse(serializeBaseConfig(cfg));
    expect(out.views[2].type).toBe("map");
    expect(out.views[2].plainva).toBeUndefined();
    expect(out.views[2].coordinates).toBe("note.location");
  });

  it("writes the new type when the user changes the view type of an unknown view", () => {
    const cfg = parseBaseConfig(OBSIDIAN_AUTHORED);
    cfg.views[2].type = "board";
    const out = yaml.parse(serializeBaseConfig(cfg));
    expect(out.views[2].type).toBe("table");
    expect(out.views[2].plainva.render).toBe("board");
  });

  it("reads Obsidian's groupBy as the property name and never copies it into plainva", () => {
    const cfg = parseBaseConfig(OBSIDIAN_AUTHORED);
    expect(cfg.views[0].groupBy).toBe("status");
    const out = yaml.parse(serializeBaseConfig(cfg));
    expect(out.views[0].plainva).toBeUndefined();
    expect(out.views[0].groupBy).toEqual({ property: "note.status", direction: "ASC" });
  });

  it("writes a changed grouping into Obsidian's groupBy when the view has one, keeping its direction", () => {
    const cfg = parseBaseConfig(OBSIDIAN_AUTHORED);
    cfg.views[0].groupBy = "priority";
    const out = yaml.parse(serializeBaseConfig(cfg));
    expect(out.views[0].groupBy).toEqual({ property: "note.priority", direction: "ASC" });
    expect(out.views[0].plainva).toBeUndefined();
  });
});

describe(".base views keep their own native keys when views are deleted or moved", () => {
  const THREE_VIEWS = `
views:
  - type: table
    name: A
    limit: 5
    groupBy:
      property: note.a
      direction: ASC
  - type: cards
    name: B
    image: note.cover
  - type: table
    name: C
    columnSize:
      note.c: 120
`;

  const byName = (out: any) => Object.fromEntries(out.views.map((v: any) => [v.name, v]));

  it("deleting the first view (desktop: filter) leaves B and C with their own keys", () => {
    const cfg = parseBaseConfig(THREE_VIEWS);
    const next = { ...cfg, views: cfg.views.filter((_: any, i: number) => i !== 0) };
    const views = byName(yaml.parse(serializeBaseConfig(next)));
    expect(Object.keys(views)).toEqual(["B", "C"]);
    expect(views.B).toEqual({ type: "cards", name: "B", image: "note.cover" });
    expect(views.C).toEqual({ type: "table", name: "C", columnSize: { "note.c": 120 } });
  });

  it("deleting a view in place (phone: splice) leaves the others with their own keys", () => {
    const cfg = parseBaseConfig(THREE_VIEWS);
    cfg.views.splice(1, 1);
    const views = byName(yaml.parse(serializeBaseConfig(cfg)));
    expect(views.A.limit).toBe(5);
    expect(views.A.groupBy).toEqual({ property: "note.a", direction: "ASC" });
    expect(views.C).toEqual({ type: "table", name: "C", columnSize: { "note.c": 120 } });
  });

  it("moving a view takes its keys along", () => {
    const cfg = parseBaseConfig(THREE_VIEWS);
    const views = [...cfg.views];
    const [moved] = views.splice(2, 1);
    views.splice(0, 0, moved);
    const out = yaml.parse(serializeBaseConfig({ ...cfg, views }));
    expect(out.views.map((v: any) => v.name)).toEqual(["C", "A", "B"]);
    expect(out.views[0]).toEqual({ type: "table", name: "C", columnSize: { "note.c": 120 } });
    expect(out.views[1].limit).toBe(5);
    expect(out.views[2]).toEqual({ type: "cards", name: "B", image: "note.cover" });
  });

  it("a new view starts without another view's keys, a duplicate keeps its source's", () => {
    const cfg = parseBaseConfig(THREE_VIEWS);
    const copy = JSON.parse(JSON.stringify(cfg.views[1]));
    copy.name = "B copy";
    const views = [...cfg.views, copy, { type: "table", name: "New" }];
    const out = byName(yaml.parse(serializeBaseConfig({ ...cfg, views })));
    expect(out["B copy"]).toEqual({ type: "cards", name: "B copy", image: "note.cover" });
    expect(out.New).toEqual({ type: "table", name: "New" });
  });

  it("moving a view keeps the file-wide options on the first view", () => {
    const text = `
views:
  - type: table
    name: A
    plainva:
      fileIconColor: "#2f6f6f"
      newItemFolder: Inbox
  - type: table
    name: B
`;
    const cfg = parseBaseConfig(text);
    const out = yaml.parse(serializeBaseConfig({ ...cfg, views: [cfg.views[1], cfg.views[0]] }));
    expect(out.views[0].name).toBe("B");
    expect(out.views[0].plainva).toEqual({ fileIconColor: "#2f6f6f", newItemFolder: "Inbox" });
    expect(out.views[1].plainva).toBeUndefined();
    expect(parseBaseConfig(serializeBaseConfig({ ...cfg, views: [cfg.views[1], cfg.views[0]] })).iconColor).toBe("#2f6f6f");
  });
});
