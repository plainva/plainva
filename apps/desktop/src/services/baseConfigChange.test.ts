import { describe, it, expect } from "vitest";
import {
  BaseConfigChangeRefusedError,
  composeLineage,
  deletePropertyFromConfig,
  lineageBetween,
  lineageOfChange,
  renamePropertyInConfig,
  loadBaseConfigText,
  rebaseBaseConfigText,
  serializeBaseConfig,
  writeBaseConfigChange,
} from "@plainva/ui";

// Finding B20 (0.9.0 defect list): a database view change wrote the copy of
// the `.base` loaded when the database was opened, and undid what another
// device or window wrote to the file meanwhile. These tests pin the shared
// building block both shells write view changes through.

const BASE = [
  "properties:",
  "  note.status:",
  "    displayName: Status",
  "views:",
  "  - type: table",
  "    name: Table",
  "    order:",
  "      - file.name",
  "      - note.status",
  "  - type: cards",
  "    name: Cards",
  "    order:",
  "      - file.name",
  "  - type: table",
  "    name: 2024",
  "    order:",
  "      - file.name",
  "  - type: table",
  "    name: true",
  "    order:",
  "      - file.name",
  "",
].join("\n");

function fakeFiles(text: string) {
  const files: Record<string, string> = { "Tasks.base": text };
  const writes: string[] = [];
  return {
    files,
    writes,
    adapter: {
      readTextFile: async (p: string) => {
        if (!(p in files)) throw new Error("not found: " + p);
        return files[p];
      },
      writeTextFile: async (p: string, c: string) => {
        files[p] = c;
        writes.push(p);
      },
    },
  };
}

/** A change as the screens make one: a copy of the config with one view replaced. */
function withView(config: any, name: string, patch: Record<string, unknown>): any {
  const views = config.views.map((v: any) => (String(v.name) === name ? { ...v, ...patch } : v));
  return { ...config, views };
}

function viewOf(text: string, name: string): any {
  return loadBaseConfigText(text).views.find((v: any) => String(v.name) === name);
}

const sortBy = (property: string) => [{ property, direction: "ASC" }];

describe("a database view change lands on the file as it lies there (B20)", () => {
  it("keeps another device's change to a different view", async () => {
    const f = fakeFiles(BASE);
    const shown = loadBaseConfigText(BASE);
    // Another device sorted "Cards" meanwhile.
    f.files["Tasks.base"] = serializeBaseConfig(withView(shown, "Cards", { sort: sortBy("file.name") }));
    // Here, "Table" gets a third column.
    const next = withView(shown, "Table", { order: ["file.name", "note.status", "file.mtime"] });
    await writeBaseConfigChange(f.adapter, "Tasks.base", shown, next);
    const now = f.files["Tasks.base"];
    expect(viewOf(now, "Table").order).toEqual(["file.name", "note.status", "file.mtime"]);
    expect(viewOf(now, "Cards").sort).toEqual(sortBy("file.name"));
  });

  it("keeps another device's change to a different key of the same view; the same key is this change's", async () => {
    const f = fakeFiles(BASE);
    const shown = loadBaseConfigText(BASE);
    f.files["Tasks.base"] = serializeBaseConfig(withView(shown, "Table", { sort: sortBy("note.status"), coverImage: "note.cover" }));
    const next = withView(shown, "Table", { order: ["note.status"], coverImage: "note.photo" });
    await writeBaseConfigChange(f.adapter, "Tasks.base", shown, next);
    const table = viewOf(f.files["Tasks.base"], "Table");
    expect(table.order).toEqual(["note.status"]);
    expect(table.sort).toEqual(sortBy("note.status"));
    expect(table.coverImage).toBe("note.photo");
  });

  it("refuses a change to a view deleted meanwhile, and writes nothing", async () => {
    const f = fakeFiles(BASE);
    const shown = loadBaseConfigText(BASE);
    const elsewhere = serializeBaseConfig({ ...shown, views: shown.views.filter((v: any) => v.name !== "Cards") });
    f.files["Tasks.base"] = elsewhere;
    const next = withView(shown, "Cards", { sort: sortBy("file.name") });
    await expect(writeBaseConfigChange(f.adapter, "Tasks.base", shown, next)).rejects.toBeInstanceOf(BaseConfigChangeRefusedError);
    await expect(writeBaseConfigChange(f.adapter, "Tasks.base", shown, next)).rejects.toMatchObject({ reason: "viewGone", viewName: "Cards" });
    expect(f.writes).toEqual([]);
    expect(f.files["Tasks.base"]).toBe(elsewhere);
  });

  it("finds a view only renamed meanwhile, and refuses one renamed and changed: nothing is guessed", async () => {
    const f = fakeFiles(BASE);
    const shown = loadBaseConfigText(BASE);
    f.files["Tasks.base"] = serializeBaseConfig(withView(shown, "Cards", { name: "Gallery" }));
    await writeBaseConfigChange(f.adapter, "Tasks.base", shown, withView(shown, "Cards", { sort: sortBy("file.name") }));
    expect(viewOf(f.files["Tasks.base"], "Gallery").sort).toEqual(sortBy("file.name"));
    expect(viewOf(f.files["Tasks.base"], "Cards")).toBeUndefined();
    // Renamed and changed: it might be "Gallery", it might not.
    const g = fakeFiles(BASE);
    const elsewhere = serializeBaseConfig(withView(shown, "Cards", { name: "Gallery", coverImage: "note.cover" }));
    g.files["Tasks.base"] = elsewhere;
    const refused = writeBaseConfigChange(g.adapter, "Tasks.base", shown, withView(shown, "Cards", { sort: sortBy("file.name") }));
    await expect(refused).rejects.toMatchObject({ name: "BaseConfigChangeRefusedError", reason: "viewUnclear", viewName: "Cards" });
    expect(g.writes).toEqual([]);
    expect(g.files["Tasks.base"]).toBe(elsewhere);
  });

  it("leaves a view deleted or renamed meanwhile as it is when this change is to another view", async () => {
    const f = fakeFiles(BASE);
    const shown = loadBaseConfigText(BASE);
    const views = shown.views.filter((v: any) => v.name !== "Cards").map((v: any) => (v.name === "Table" ? { ...v, name: "All" } : v));
    f.files["Tasks.base"] = serializeBaseConfig({ ...shown, views });
    const next = withView(shown, "2024", { coverImage: "note.cover" });
    await writeBaseConfigChange(f.adapter, "Tasks.base", shown, next);
    const names = loadBaseConfigText(f.files["Tasks.base"]).views.map((v: any) => String(v.name));
    expect(names).toEqual(["All", "2024", "true"]);
    expect(viewOf(f.files["Tasks.base"], "2024").coverImage).toBe("note.cover");
  });

  it("finds a view whose name YAML reads as a number or a truth value", async () => {
    const f = fakeFiles(BASE);
    const shown = loadBaseConfigText(BASE);
    expect(shown.views.map((v: any) => v.name)).toEqual(["Table", "Cards", "2024", "true"]);
    // The other device wrote the names quoted: the same views.
    f.files["Tasks.base"] = BASE.replace("name: 2024", 'name: "2024"').replace("name: true", 'name: "true"') + "";
    f.files["Tasks.base"] = serializeBaseConfig(withView(loadBaseConfigText(f.files["Tasks.base"]), "Table", { coverImage: "note.cover" }));
    let next = withView(shown, "2024", { sort: sortBy("file.name") });
    next = withView(next, "true", { pinboardOrder: ["A.md", "B.md"] });
    await writeBaseConfigChange(f.adapter, "Tasks.base", shown, next);
    const now = f.files["Tasks.base"];
    expect(viewOf(now, "2024").sort).toEqual(sortBy("file.name"));
    expect(viewOf(now, "true").pinboardOrder).toEqual(["A.md", "B.md"]);
    expect(viewOf(now, "Table").coverImage).toBe("note.cover");
    expect(loadBaseConfigText(now).views).toHaveLength(4);
  });

  it("adds, deletes and moves views without losing a view another device added", async () => {
    const shown = loadBaseConfigText(BASE);
    const theirs = { ...shown, views: [...shown.views, { type: "table", name: "Theirs" }] };
    const theirText = serializeBaseConfig(theirs);
    // Added here.
    let made = rebaseBaseConfigText(shown, { ...shown, views: [...shown.views, { type: "cards", name: "Mine" }] }, theirText);
    expect(made.config.views.map((v: any) => String(v.name))).toEqual(["Table", "Cards", "2024", "true", "Mine", "Theirs"]);
    // Deleted here.
    made = rebaseBaseConfigText(shown, { ...shown, views: shown.views.filter((v: any) => v.name !== "Cards") }, theirText);
    expect(made.config.views.map((v: any) => String(v.name))).toEqual(["Table", "2024", "true", "Theirs"]);
    // Moved here: "true" to the front.
    const moved = [shown.views[3], shown.views[0], shown.views[1], shown.views[2]];
    made = rebaseBaseConfigText(shown, { ...shown, views: moved }, theirText);
    expect(made.config.views.map((v: any) => String(v.name))).toEqual(["true", "Table", "Cards", "2024", "Theirs"]);
    // Deep-cloned and deleted (the phone clones the whole config).
    const clone = JSON.parse(JSON.stringify(shown));
    clone.views.splice(0, 1);
    made = rebaseBaseConfigText(shown, clone, theirText);
    expect(made.config.views.map((v: any) => String(v.name))).toEqual(["Cards", "2024", "true", "Theirs"]);
  });

  it("keeps another device's property settings when this change is to a view", () => {
    const shown = loadBaseConfigText(BASE);
    const theirs = JSON.parse(JSON.stringify(shown));
    theirs.columns = { ...(theirs.columns ?? {}), priority: { input: "select", options: [{ value: "high" }] } };
    const made = rebaseBaseConfigText(shown, withView(shown, "Table", { coverImage: "note.cover" }), serializeBaseConfig(theirs));
    expect(made.config.columns.priority?.input).toBe("select");
    expect(made.config.views[0].coverImage).toBe("note.cover");
  });

  it("lets two quick changes of one screen both land: the second reads the file once the first is written", async () => {
    const f = fakeFiles(BASE);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow = {
      ...f.adapter,
      writeTextFile: async (p: string, c: string) => { await gate; await f.adapter.writeTextFile(p, c); },
    };
    const shown = loadBaseConfigText(BASE);
    const first = withView(shown, "Table", { coverImage: "note.one" });
    const second = withView(first, "Cards", { coverImage: "note.two" });
    const a = writeBaseConfigChange(slow, "Tasks.base", shown, first);
    const b = writeBaseConfigChange(slow, "Tasks.base", first, second);
    release();
    await Promise.all([a, b]);
    expect(viewOf(f.files["Tasks.base"], "Table").coverImage).toBe("note.one");
    expect(viewOf(f.files["Tasks.base"], "Cards").coverImage).toBe("note.two");
  });
});

const TWINS = [
  "views:",
  "  - type: table",
  "    name: Tabelle",
  "    order:",
  "      - note.a",
  "  - type: table",
  "    name: Tabelle",
  "    order:",
  "      - note.z",
  "",
].join("\n");
const orders = (text: string) => loadBaseConfigText(text).views.map((v: any) => v.order);

describe("views with the same name, or none: found by what they are, never by their place (B20)", () => {
  it("two views called alike, swapped elsewhere: the change lands on its own view, the other stays whole", async () => {
    const f = fakeFiles(TWINS);
    const shown = loadBaseConfigText(TWINS);
    f.files["Tasks.base"] = serializeBaseConfig({ ...shown, views: [shown.views[1], shown.views[0]] });
    const next = { ...shown, views: [{ ...shown.views[0], order: ["note.a", "note.b"], sort: sortBy("note.a") }, shown.views[1]] };
    const { placeOf } = await writeBaseConfigChange(f.adapter, "Tasks.base", shown, next);
    expect(orders(f.files["Tasks.base"])).toEqual([shown.views[1].order, ["note.a", "note.b"]]);
    // The changed view stands second now: the screen's active view follows it.
    expect(placeOf).toEqual([1, 0]);
  });

  it("two views called alike, the changed one deleted elsewhere: refused as gone, nothing written", async () => {
    const f = fakeFiles(TWINS);
    const shown = loadBaseConfigText(TWINS);
    const elsewhere = serializeBaseConfig({ ...shown, views: [shown.views[1]] });
    f.files["Tasks.base"] = elsewhere;
    const next = { ...shown, views: [{ ...shown.views[0], order: ["note.a", "note.b"] }, shown.views[1]] };
    await expect(writeBaseConfigChange(f.adapter, "Tasks.base", shown, next)).rejects.toMatchObject({ reason: "viewGone" });
    expect(f.files["Tasks.base"]).toBe(elsewhere);
  });

  it("two views called alike, both changed elsewhere: refused as unclear, nothing written", async () => {
    const f = fakeFiles(TWINS);
    const shown = loadBaseConfigText(TWINS);
    const elsewhere = serializeBaseConfig({ ...shown, views: shown.views.map((v: any) => ({ ...v, coverImage: "note.cover" })) });
    f.files["Tasks.base"] = elsewhere;
    const next = { ...shown, views: [{ ...shown.views[0], order: ["note.b"] }, shown.views[1]] };
    await expect(writeBaseConfigChange(f.adapter, "Tasks.base", shown, next)).rejects.toMatchObject({ reason: "viewUnclear", viewName: "Tabelle" });
    expect(f.files["Tasks.base"]).toBe(elsewhere);
  });

  it("a handwritten file without view names, changed elsewhere: the change lands, the other change stays", async () => {
    const text = ["views:", "  - type: table", "    order:", "      - file.name", "  - type: cards", ""].join("\n");
    const f = fakeFiles(text);
    const shown = loadBaseConfigText(text);
    // Another program gave the cards a limit — a key Plainva does not edit.
    f.files["Tasks.base"] = text.replace("  - type: cards\n", "  - type: cards\n    limit: 5\n");
    const next = { ...shown, views: [{ ...shown.views[0], order: ["file.name", "note.status"] }, shown.views[1]] };
    await writeBaseConfigChange(f.adapter, "Tasks.base", shown, next);
    expect(orders(f.files["Tasks.base"])[0]).toEqual(["file.name", "note.status"]);
    expect(f.files["Tasks.base"]).toContain("limit: 5");
  });

  it("a view removed here that the file only renamed is removed; one the file renamed and changed refuses", () => {
    const shown = loadBaseConfigText(BASE);
    const removed = { ...shown, views: shown.views.filter((v: any) => v.name !== "Cards") };
    let made = rebaseBaseConfigText(shown, removed, serializeBaseConfig(withView(shown, "Cards", { name: "Gallery" })));
    expect(made.config.views.map((v: any) => String(v.name))).toEqual(["Table", "2024", "true"]);
    expect(() => rebaseBaseConfigText(shown, removed, serializeBaseConfig(withView(shown, "Cards", { name: "Gallery", coverImage: "note.c" }))))
      .toThrow(BaseConfigChangeRefusedError);
    // Moved here while the file renamed and changed a view: nothing guessed either.
    const moved = { ...shown, views: [shown.views[1], shown.views[0], shown.views[2], shown.views[3]] };
    expect(() => rebaseBaseConfigText(shown, moved, serializeBaseConfig(withView(shown, "Cards", { name: "Gallery", coverImage: "note.c" }))))
      .toThrow(BaseConfigChangeRefusedError);
    made = rebaseBaseConfigText(shown, moved, serializeBaseConfig(withView(shown, "Table", { coverImage: "note.c" })));
    expect(made.config.views.map((v: any) => String(v.name))).toEqual(["Cards", "Table", "2024", "true"]);
    expect(made.config.views[1].coverImage).toBe("note.c");
  });
});

describe("which view of the screen is which (B20)", () => {
  it("a view renamed here while another is added is no edit of the added one", () => {
    const shown = loadBaseConfigText(BASE);
    const next = { ...shown, views: [...shown.views.map((v: any) => (v.name === "Cards" ? { ...v, name: "Gallery" } : v)), { type: "table", name: "New" }] };
    const theirs = withView(shown, "Cards", { coverImage: "note.cover" });
    const made = rebaseBaseConfigText(shown, next, serializeBaseConfig(theirs));
    expect(made.config.views.map((v: any) => String(v.name))).toEqual(["Table", "Gallery", "2024", "true", "New"]);
    expect(made.config.views[1].coverImage).toBe("note.cover");
    expect(made.config.views[4].coverImage).toBeUndefined();
  });

  it("where both sides removed views until none would be left, the user's own stays", () => {
    const text = ["views:", "  - type: table", "    name: A", "  - type: cards", "    name: B", ""].join("\n");
    const shown = loadBaseConfigText(text);
    const made = rebaseBaseConfigText(shown, { ...shown, views: [shown.views[1]] }, serializeBaseConfig({ ...shown, views: [shown.views[0]] }));
    expect(made.config.views.map((v: any) => v.name)).toEqual(["B"]);
    expect(made.placeOf).toEqual([0]);
  });

  it("a move of a view the file moved too follows the screen; one of a view the file removed moves nothing", () => {
    const shown = loadBaseConfigText(BASE);
    // The screen moves "Cards" to the front; the file removed "Cards".
    const moved = { ...shown, views: [shown.views[1], shown.views[0], shown.views[2], shown.views[3]] };
    const file = { ...shown, views: [shown.views[0], shown.views[3], shown.views[2]] };
    const made = rebaseBaseConfigText(shown, moved, serializeBaseConfig(file));
    expect(made.config.views.map((v: any) => String(v.name))).toEqual(["Table", "true", "2024"]);
  });
});

describe("lists both sides changed: entry by entry, the order the screen's (B20)", () => {
  it("a column the file added stays when the screen reorders the columns", () => {
    const shown = loadBaseConfigText(BASE);
    const theirs = withView(shown, "Table", { order: ["file.name", "note.status", "note.c"] });
    const mine = withView(shown, "Table", { order: ["note.status", "file.name"] });
    const made = rebaseBaseConfigText(shown, mine, serializeBaseConfig(theirs));
    // It stands after the column it follows in the file.
    expect(made.config.views[0].order).toEqual(["note.status", "note.c", "file.name"]);
  });

  it("a column the file removed stays removed; one the screen removed too", () => {
    const shown = loadBaseConfigText(BASE);
    const start = withView(shown, "Table", { order: ["note.a", "note.b", "note.c", "note.d"] });
    const startText = serializeBaseConfig(start);
    const base = loadBaseConfigText(startText);
    const theirs = withView(base, "Table", { order: ["note.a", "note.c", "note.d"] });
    const mine = withView(base, "Table", { order: ["note.d", "note.c", "note.b"] });
    const made = rebaseBaseConfigText(base, mine, serializeBaseConfig(theirs));
    expect(made.config.views[0].order).toEqual(["note.d", "note.c"]);
  });

  it("a board group another device added stays when this one drags the columns", () => {
    const text = [
      "properties:", "  note.status:", "    plainva:", "      input: select", "      options:",
      "        - value: Open", "        - value: Doing", "        - value: Done",
      "views:", "  - type: table", "    name: Board", "",
    ].join("\n");
    const shown = loadBaseConfigText(text);
    const theirs = JSON.parse(JSON.stringify(shown));
    theirs.columns.status.options.push({ value: "Waiting" });
    const mine = JSON.parse(JSON.stringify(shown));
    mine.columns.status.options = [mine.columns.status.options[2], mine.columns.status.options[0], mine.columns.status.options[1]];
    const made = rebaseBaseConfigText(shown, mine, serializeBaseConfig(theirs));
    expect(made.config.columns.status.options.map((o: any) => o.value)).toEqual(["Done", "Waiting", "Open", "Doing"]);
  });

  it("a card the file pinned stays pinned when the screen reorders the pinboard", () => {
    const shown = loadBaseConfigText(BASE);
    const start = loadBaseConfigText(serializeBaseConfig(withView(shown, "Cards", { pinboardOrder: ["A.md", "B.md"], pinboardPinned: [] })));
    const theirs = withView(start, "Cards", { pinboardOrder: ["A.md", "B.md", "C.md"], pinboardPinned: ["D.md"] });
    const mine = withView(start, "Cards", { pinboardOrder: ["B.md", "A.md"] });
    const made = rebaseBaseConfigText(start, mine, serializeBaseConfig(theirs));
    const cards = made.config.views.find((v: any) => v.name === "Cards");
    expect(cards.pinboardOrder).toEqual(["B.md", "C.md", "A.md"]);
    expect(cards.pinboardPinned).toEqual(["D.md"]);
  });

  it("a single value both changed is the screen's; a view the screen removed goes though the file changed it", () => {
    const shown = loadBaseConfigText(BASE);
    const theirs = withView(shown, "Table", { sort: sortBy("note.status"), coverImage: "note.c" });
    let made = rebaseBaseConfigText(shown, withView(shown, "Table", { sort: sortBy("file.name") }), serializeBaseConfig(theirs));
    expect(made.config.views[0].sort).toEqual(sortBy("file.name"));
    expect(made.config.views[0].coverImage).toBe("note.c");
    made = rebaseBaseConfigText(shown, { ...shown, views: shown.views.filter((v: any) => v.name !== "Table") }, serializeBaseConfig(theirs));
    expect(made.config.views.map((v: any) => String(v.name))).toEqual(["Cards", "2024", "true"]);
  });

  it("the active view follows its view where the file moved views", () => {
    const shown = loadBaseConfigText(BASE);
    const theirs = { ...shown, views: [shown.views[2], shown.views[0], shown.views[1], shown.views[3]] };
    const made = rebaseBaseConfigText(shown, withView(shown, "Cards", { coverImage: "note.c" }), serializeBaseConfig(theirs));
    expect(made.config.views.map((v: any) => String(v.name))).toEqual(["2024", "Table", "Cards", "true"]);
    expect(made.placeOf).toEqual([1, 2, 0, 3]);
  });
});

// --- Where nobody else changed the file: the text main writes, byte for byte ---

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ["Table", "Cards", "2024", "true", "1.5", "null", "Board", "Pinboard", "Table", ""];
const COLS = ["file.name", "note.status", "note.due", "file.mtime", "note.prio"];

function randomBase(r: () => number): string {
  const lines = ["properties:", "  note.status:", "    displayName: Status", "views:"];
  const n = 1 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    lines.push(`  - type: ${r() < 0.5 ? "table" : "cards"}`);
    const name = NAMES[Math.floor(r() * NAMES.length)];
    if (name !== "") lines.push(`    name: ${name}`);
    if (r() < 0.7) {
      lines.push("    order:");
      for (const c of COLS.slice(0, 1 + Math.floor(r() * COLS.length))) lines.push(`      - ${c}`);
    }
    if (r() < 0.3) lines.push("    limit: " + (1 + Math.floor(r() * 20)));
  }
  return lines.join("\n") + "\n";
}

function pick<T>(r: () => number, list: T[]): T {
  return list[Math.floor(r() * list.length)];
}

/** One change as a screen makes it, from the config it shows. */
function randomChange(r: () => number, shown: any): any {
  const views = Array.isArray(shown.views) ? shown.views : [];
  const i = Math.floor(r() * views.length);
  switch (Math.floor(r() * 9)) {
    case 0: return { ...shown, views: views.map((v: any, k: number) => (k === i ? { ...v, order: COLS.filter(() => r() < 0.5) } : v)) };
    case 1: return { ...shown, views: views.map((v: any, k: number) => (k === i ? { ...v, sort: sortBy(pick(r, COLS)) } : v)) };
    case 2: return { ...shown, views: [...views, { type: "table", name: pick(r, NAMES) || "New" }] };
    case 3: return views.length > 1 ? { ...shown, views: views.filter((_: any, k: number) => k !== i) } : shown;
    case 4: {
      const next = [...views];
      const [m] = next.splice(i, 1);
      next.splice(Math.floor(r() * (next.length + 1)), 0, m);
      return { ...shown, views: next };
    }
    case 5: return { ...shown, views: views.map((v: any, k: number) => (k === i ? { ...v, name: pick(r, NAMES) || undefined } : v)) };
    case 6: {
      const clone = JSON.parse(JSON.stringify(shown));
      if (clone.views[i]) clone.views[i].filters = { and: ['note.status == "open"'], or: [] };
      return clone;
    }
    case 7: {
      const next = [...views];
      const copy = JSON.parse(JSON.stringify(views[i]));
      copy.name = `${String(copy.name ?? "View")} copy`;
      next.splice(i + 1, 0, copy);
      return { ...shown, views: next };
    }
    default: return { ...shown, columns: { ...(shown.columns ?? {}), status: { input: "select", options: [{ value: pick(r, ["a", "b"]) }] } } };
  }
}

describe("a database view change where nobody else changed the file (B20)", () => {
  it("writes exactly what a whole-config save writes, over many random changes", () => {
    const r = rng(20261116);
    let compared = 0;
    for (let round = 0; round < 3000; round++) {
      const text = randomBase(r);
      let shown = loadBaseConfigText(text);
      let disk = text;
      // A few changes in a row, each from the config the one before left.
      for (let step = 0; step < 3; step++) {
        const next = randomChange(r, shown);
        const made = rebaseBaseConfigText(shown, next, disk);
        expect(made.text).toBe(serializeBaseConfig(next));
        disk = made.text;
        shown = next;
        compared++;
      }
    }
    expect(compared).toBe(9000);
  });

  it("applies a change to one view on top of another device's change to another view, as if made one after the other", () => {
    const r = rng(7);
    let compared = 0;
    for (let round = 0; round < 2000; round++) {
      const text = randomBase(r);
      const shown = loadBaseConfigText(text);
      const views = shown.views;
      const named = views.map((v: any) => String(v.name ?? "")).filter((n: string, k: number, all: string[]) => n !== "" && all.indexOf(n) === k && all.lastIndexOf(n) === k);
      if (named.length < 2) continue;
      const [mine, theirs] = [named[0], named[1]];
      const theirsDone = withView(shown, theirs, { sort: sortBy(pick(r, COLS)) });
      const mineDone = withView(shown, mine, { order: COLS.filter(() => r() < 0.5), coverImage: pick(r, COLS) });
      const made = rebaseBaseConfigText(shown, mineDone, serializeBaseConfig(theirsDone));
      const both = withView(loadBaseConfigText(serializeBaseConfig(theirsDone)), mine, {
        order: mineDone.views.find((v: any) => String(v.name) === mine).order,
        coverImage: mineDone.views.find((v: any) => String(v.name) === mine).coverImage,
      });
      expect(made.text).toBe(serializeBaseConfig(both));
      compared++;
    }
    expect(compared).toBeGreaterThan(200);
  });
});

// --- Second review of B20 (17.11.): views never named, emptied containers, filters, deleted properties ---

/** A handwritten database whose views carry no names: the screens keep them unnamed all session. */
const UNNAMED = ["views:", "  - type: table", "    order:", "      - file.name", "  - type: cards", "    order:", "      - file.name", ""].join("\n");

describe("a view the screen never named is found as itself, never as an equal view of another name (B20)", () => {
  it("next to its own duplicate \"Table Kopie\", with the file's views moved: the sort lands on the view itself", () => {
    const shown = loadBaseConfigText(UNNAMED);
    // The screen wrote once (the file got the serializer's names) and duplicated the table; then another device moved the views.
    const copy = { ...JSON.parse(JSON.stringify(shown.views[0])), name: "Table Kopie" };
    const held = { ...shown, views: [shown.views[0], shown.views[1], copy] };
    const written = loadBaseConfigText(serializeBaseConfig(held));
    const file = serializeBaseConfig({ ...written, views: [written.views[2], written.views[1], written.views[0]] });
    const next = JSON.parse(JSON.stringify(held));
    next.views[0].sort = sortBy("note.status");
    const made = rebaseBaseConfigText(held, next, file);
    const byName = (n: string) => made.config.views.find((v: any) => String(v.name) === n);
    expect(byName("Table").sort).toEqual(sortBy("note.status"));
    expect(byName("Table Kopie").sort).toBeUndefined();
    expect(made.placeOf[0]).toBe(made.config.views.indexOf(byName("Table")));
  });

  it("next to its own duplicate, removed here while the file moved the views: the view itself goes, the duplicate stays", () => {
    const shown = loadBaseConfigText(UNNAMED);
    const copy = { ...JSON.parse(JSON.stringify(shown.views[0])), name: "Table Kopie" };
    const held = { ...shown, views: [shown.views[0], shown.views[1], copy] };
    const written = loadBaseConfigText(serializeBaseConfig(held));
    const file = serializeBaseConfig({ ...written, views: [written.views[2], written.views[0], written.views[1]] });
    const next = { ...held, views: [held.views[1], held.views[2]] };
    const made = rebaseBaseConfigText(held, next, file);
    expect(made.config.views.map((v: any) => String(v.name)).sort()).toEqual(["Gallery", "Table Kopie"]);
  });

  it("changed here while the file moved the views and still holds none of their names: the change lands on it", () => {
    const shown = loadBaseConfigText(UNNAMED);
    const file = UNNAMED.replace("views:\n", "views:\n  - type: list\n");
    const next = JSON.parse(JSON.stringify(shown));
    next.views[1].coverImage = "note.cover";
    const made = rebaseBaseConfigText(shown, next, file);
    expect(made.config.views.map((v: any) => v.type)).toEqual(["list", "table", "gallery"]);
    expect(made.config.views[2].coverImage).toBe("note.cover");
    expect(made.config.views[1].coverImage).toBeUndefined();
  });

  it("moved here, one of them renamed elsewhere: the name given elsewhere stays, no name the serializer made up is set", () => {
    const text = ["views:", "  - type: cards", "    limit: 2", "  - type: cards", "    order:", "      - file.name", ""].join("\n");
    const shown = loadBaseConfigText(text);
    const file = text + "    name: Reading\n";
    const next = { ...shown, views: [shown.views[1], shown.views[0]] };
    const made = rebaseBaseConfigText(shown, next, file);
    expect(made.config.views.map((v: any) => v.name ?? null)).toEqual(["Reading", null]);
  });
});

describe("a container the user emptied keeps what the other side added to it (B20)", () => {
  const view = (lines: string[]) => ["views:", "  - type: cards", "    name: T", ...lines, ""].join("\n");

  it("the last summary cleared here, another summary added elsewhere: that one stays", () => {
    const text = view(["    summaries:", "      note.a: Sum"]);
    const shown = loadBaseConfigText(text);
    const next = withView(shown, "T", { summaries: {} });
    const made = rebaseBaseConfigText(shown, next, text + "      note.b: Average\n");
    expect(made.config.views[0].summaries).toEqual({ b: "Average" });
  });

  it("the cover cleared here (the view's last plainva key), a key Plainva does not know added there: it stays", () => {
    const text = view(["    plainva:", "      coverImage: pic"]);
    const shown = loadBaseConfigText(text);
    const next = withView(shown, "T", { coverImage: undefined });
    const made = rebaseBaseConfigText(shown, next, text + "      futureKey: keepme\n");
    expect(made.text).toContain("futureKey: keepme");
    expect(made.config.views[0].coverImage).toBeUndefined();
  });

  it("the last card unpinned here, another card pinned there: the other card stays pinned", () => {
    const text = view(["    plainva:", "      pinboardOrder:", "        - a.md"]);
    const shown = loadBaseConfigText(text);
    const next = withView(shown, "T", { pinboardOrder: [] });
    const made = rebaseBaseConfigText(shown, next, text + "        - b.md\n");
    expect(made.config.views[0].pinboardOrder).toEqual(["b.md"]);
  });

  it("the last property deleted here, another property set up there: that one stays", () => {
    const text = ["properties:", "  note.a:", "    displayName: A", "views:", "  - type: table", "    name: T", ""].join("\n");
    const shown = loadBaseConfigText(text);
    const next = deletePropertyFromConfig(JSON.parse(JSON.stringify(shown)), "a");
    const file = text.replace("views:", "  note.e:\n    displayName: Estimate\nviews:");
    const made = rebaseBaseConfigText(shown, next, file);
    expect(made.text).toContain("Estimate");
    expect(made.text).not.toContain("note.a");
  });
});

describe("a property deleted here goes whole, whatever the other side set on it (B20)", () => {
  const text = ["properties:", "  note.a:", "    displayName: A", "  note.k:", "    displayName: K", "views:", "  - type: table", "    name: T", ""].join("\n");
  const file = text.replace("    displayName: A\n", "    displayName: A\n    plainva:\n      input: select\n      options:\n        - value: v1\n");

  it("deleted here, given options there: it does not come back half", () => {
    const shown = loadBaseConfigText(text);
    const made = rebaseBaseConfigText(shown, deletePropertyFromConfig(JSON.parse(JSON.stringify(shown)), "a"), file);
    expect(made.text).not.toContain("note.a");
    expect(made.config.columns?.a).toBeUndefined();
    expect(made.text).toContain("displayName: K");
  });

  it("renamed here, given options there: only the new name stands", () => {
    const shown = loadBaseConfigText(text);
    const made = rebaseBaseConfigText(shown, renamePropertyInConfig(JSON.parse(JSON.stringify(shown)), "a", "b"), file);
    expect(made.text).not.toContain("note.a:");
    expect(made.text).toContain("note.b:");
  });
});

describe("a filter both sides changed is the user's, never a rule merged from both (B20)", () => {
  const text = ["views:", "  - type: table", "    name: T", "    filters:", "      and:", '        - note.status == "open"', "        - note.prio > 1", ""].join("\n");
  const filtersOf = (cfg: any) => cfg.views[0].filters;

  it("the same rule edited on both sides: the user's rule, not both", () => {
    const shown = loadBaseConfigText(text);
    const next = withView(shown, "T", { filters: { and: ['note.status == "done"', "note.prio > 1"] } });
    const made = rebaseBaseConfigText(shown, next, text.replace('"open"', '"blocked"'));
    expect(filtersOf(made.config).and).toEqual(['note.status == "done"', "note.prio > 1"]);
  });

  it("a rule removed here that was edited there stays removed; the file's edit does not come back", () => {
    const shown = loadBaseConfigText(text);
    const next = withView(shown, "T", { filters: { and: ["note.prio > 1"] } });
    const made = rebaseBaseConfigText(shown, next, text.replace('"open"', '"blocked"'));
    expect(filtersOf(made.config).and).toEqual(["note.prio > 1"]);
  });

  it("a filter only the other side changed stays as it made it, under this side's change to another key", () => {
    const shown = loadBaseConfigText(text);
    const next = withView(shown, "T", { sort: sortBy("note.prio") });
    const made = rebaseBaseConfigText(shown, next, text.replace('"open"', '"blocked"'));
    expect(filtersOf(made.config).and).toEqual(['note.status == "blocked"', "note.prio > 1"]);
    expect(made.config.views[0].sort).toEqual(sortBy("note.prio"));
  });
});

describe("an empty database file (B20)", () => {
  it("takes a change from a screen that never had a config, and adds it to a file written meanwhile", () => {
    const next = { views: [{ type: "table", sort: sortBy("note.a") }] };
    expect(loadBaseConfigText(rebaseBaseConfigText(null, next, "").text).views[0].sort).toEqual(sortBy("note.a"));
    const made = rebaseBaseConfigText(null, next, ["views:", "  - type: cards", "    name: Elsewhere", ""].join("\n"));
    expect(made.config.views.map((v: any) => v.type).sort()).toEqual(["gallery", "table"]);
  });
});

describe("a name another view took meanwhile is no certain match (B20)", () => {
  const text = ["views:", "  - type: table", "    name: Open", "    order:", "      - file.name", "  - type: cards", "    name: Done", ""].join("\n");

  it("renamed elsewhere and its name given to a new view: a change to it refuses, nothing is guessed", async () => {
    const f = fakeFiles(text);
    const shown = loadBaseConfigText(text);
    f.files["Tasks.base"] = text.replace("name: Open", "name: Backlog") + "  - type: list\n    name: Open\n";
    const before = f.files["Tasks.base"];
    const next = withView(shown, "Open", { sort: sortBy("file.name") });
    await expect(writeBaseConfigChange(f.adapter, "Tasks.base", shown, next)).rejects.toMatchObject({ reason: "viewUnclear" });
    expect(f.files["Tasks.base"]).toBe(before);
  });

  it("one action that changes several views called alike (a property deleted from each) lands on each of them", () => {
    const twins = ["views:", "  - type: table", "    name: T", "    order:", "      - note.a", "      - note.x", "  - type: table", "    name: T", "    order:", "      - note.b", "      - note.x", ""].join("\n");
    const shown = loadBaseConfigText(twins);
    const next = deletePropertyFromConfig(JSON.parse(JSON.stringify(shown)), "x");
    // The file swapped the two meanwhile: the change lands on each where the file keeps it, as one edit of each.
    const swapped = ["views:", "  - type: table", "    name: T", "    order:", "      - note.b", "      - note.x", "  - type: table", "    name: T", "    order:", "      - note.a", "      - note.x", ""].join("\n");
    const made = rebaseBaseConfigText(shown, next, swapped);
    expect(made.config.views.map((v: any) => v.order)).toEqual([["b"], ["a"]]);
    expect(made.placeOf).toEqual([1, 0]);
  });
});

describe("a file another writer has written only in part is no base for a merge (B20)", () => {
  const FULL = [
    "filters:", "  and:", '    - file.inFolder("Projekte")', "formulas:", "  f1: a + 1",
    "properties:", "  note.status:", "    displayName: Status",
    "views:", "  - type: table", "    name: Offen", "    order:", "      - note.status", "  - type: cards", "    name: Karten", "    limit: 5", "",
  ].join("\n");
  /** A file whose readings are `texts` one after the other, the last one from then on. */
  function writtenMeanwhile(texts: string[]) {
    let reads = 0;
    const store = { text: texts[0] };
    const adapter = {
      readTextFile: async () => (store.text = texts[Math.min(reads++, texts.length - 1)]),
      writeTextFile: async (_p: string, c: string) => { store.text = c; texts = [c]; reads = 0; },
    };
    return { store, adapter };
  }
  const addView = (shown: any) => ({ ...shown, views: [...shown.views, { type: "list", name: "Neu" }] });

  it("an empty reading while another writer writes: read again, and the change lands on the whole file", async () => {
    const shown = loadBaseConfigText(FULL);
    const full = FULL.replace("limit: 5", "limit: 9");
    const f = writtenMeanwhile(["", full]);
    await writeBaseConfigChange(f.adapter, "Tasks.base", shown, addView(shown));
    const out = loadBaseConfigText(f.store.text);
    expect(out.views.map((v: any) => v.name)).toEqual(["Offen", "Karten", "Neu"]);
    expect(f.store.text).toContain("limit: 9");
    expect(f.store.text).toContain("f1: a + 1");
    expect(f.store.text).toContain('file.inFolder("Projekte")');
  });

  it("a reading cut off at any byte while another writer writes: nothing of the file is lost", async () => {
    const shown = loadBaseConfigText(FULL);
    const full = FULL.replace("limit: 5", "limit: 9");
    for (const cut of [1, 20, 45, 80, 120, full.length - 3]) {
      const f = writtenMeanwhile([full.slice(0, cut), full]);
      await writeBaseConfigChange(f.adapter, "Tasks.base", shown, addView(shown));
      const out = loadBaseConfigText(f.store.text);
      expect(out.views.map((v: any) => v.name)).toEqual(["Offen", "Karten", "Neu"]);
      expect(f.store.text).toContain("limit: 9");
      expect(f.store.text).toContain("displayName: Status");
    }
  });

  it("a file that never holds still refuses the change, and nothing is written", async () => {
    const shown = loadBaseConfigText(FULL);
    let n = 0;
    const writes: string[] = [];
    const adapter = {
      readTextFile: async () => FULL.slice(0, 10 + (n++ % 7) * 3),
      writeTextFile: async (_p: string, c: string) => { writes.push(c); },
    };
    await expect(writeBaseConfigChange(adapter, "Tasks.base", shown, addView(shown))).rejects.toMatchObject({ name: "BaseConfigChangeRefusedError", reason: "fileChanging" });
    expect(writes).toEqual([]);
  });

  it("a file that holds still empty while the screen showed a database is no change anybody made: refused, nothing written", async () => {
    const shown = loadBaseConfigText(FULL);
    const f = writtenMeanwhile([""]);
    await expect(writeBaseConfigChange(f.adapter, "Tasks.base", shown, addView(shown))).rejects.toMatchObject({ reason: "fileChanging" });
    expect(f.store.text).toBe("");
  });
});

describe("a view added after a view the file holds no certain place for (B20)", () => {
  const ONE = ["views:", "  - type: cards", "    order:", "      - note.a", ""].join("\n");
  const DUP = ["views:", "  - type: table", "    name: T", "    order:", "      - note.a", "  - type: table", "    name: T", "    order:", "      - note.b", ""].join("\n");

  it("goes to the end, never first, where it would become the view the database opens with", () => {
    const shown = loadBaseConfigText(DUP);
    // Both changed the second "T": it has no certain place; the user adds a view after it.
    const next = JSON.parse(JSON.stringify(shown));
    next.views.push({ type: "list", name: "Neu" });
    const file = DUP.replace("      - note.b\n", "      - note.b\n    limit: 5\n");
    const made = rebaseBaseConfigText(shown, next, file);
    expect(made.config.views.map((v: any) => v.name)).toEqual(["T", "T", "Neu"]);
  });

  it("a duplicate of the one view never named, which the file limited, stands after it", () => {
    const shown = loadBaseConfigText(ONE);
    const next = JSON.parse(JSON.stringify(shown));
    next.views.splice(1, 0, { ...JSON.parse(JSON.stringify(next.views[0])), name: "Gallery Kopie" });
    const made = rebaseBaseConfigText(shown, next, ONE + "    limit: 5\n");
    expect(made.config.views.map((v: any) => v.name ?? null)).toEqual([null, "Gallery Kopie"]);
    expect(made.text.split("Gallery Kopie")[0]).toContain("limit: 5");
  });
});

describe("a view never named that is certain is found, though both sides changed it (B20)", () => {
  const ONE = ["views:", "  - type: table", "    order:", "      - note.a", ""].join("\n");
  const sorted = (shown: any, i = 0) => {
    const next = JSON.parse(JSON.stringify(shown));
    next.views[i].sort = sortBy("note.a");
    return next;
  };

  it("the one view on each side, still without a name there: the sort lands next to the limit", () => {
    const shown = loadBaseConfigText(ONE);
    const made = rebaseBaseConfigText(shown, sorted(shown), ONE + "    limit: 5\n");
    expect(made.config.views).toHaveLength(1);
    expect(made.config.views[0].sort).toEqual(sortBy("note.a"));
    expect(made.text).toContain("limit: 5");
  });

  it("the other side is Plainva and wrote the name the serializer gives it: found under that name", () => {
    const shown = loadBaseConfigText(ONE);
    const made = rebaseBaseConfigText(shown, sorted(shown), ONE + "    limit: 5\n    name: Table\n");
    expect(made.config.views.map((v: any) => [v.name, v.sort])).toEqual([["Table", sortBy("note.a")]]);
    expect(made.text).toContain("limit: 5");
  });

  it("two views never named, the other one untouched: the changed one is the only one left on both sides", () => {
    const two = ["views:", "  - type: table", "    order:", "      - note.a", "  - type: cards", "    order:", "      - note.b", ""].join("\n");
    const shown = loadBaseConfigText(two);
    const made = rebaseBaseConfigText(shown, sorted(shown), two.replace("      - note.a\n", "      - note.a\n    limit: 5\n"));
    expect(made.config.views.map((v: any) => [v.type, v.sort ?? null])).toEqual([["table", sortBy("note.a")], ["gallery", null]]);
    expect(made.text.split("type: cards")[0]).toContain("limit: 5");
  });
});

describe("the filter rule hangs on the filter, not on a key of that name (B20)", () => {
  it("a note property called \"filters\" keeps the option the other side added", () => {
    const text = ["properties:", "  note.filters:", "    plainva:", "      input: select", "      options:", "        - value: a", "views:", "  - type: table", "    name: T", ""].join("\n");
    const shown = loadBaseConfigText(text);
    const next = JSON.parse(JSON.stringify(shown));
    next.columns.filters = { ...next.columns.filters, options: [...next.columns.filters.options, { value: "mine" }] };
    const made = rebaseBaseConfigText(shown, next, text).text;
    const file = text.replace("        - value: a\n", "        - value: a\n        - value: fromOther\n");
    const out = rebaseBaseConfigText(shown, next, file).text;
    expect(made).toContain("mine");
    expect(out).toContain("fromOther");
    expect(out).toContain("mine");
  });
});

// --- Fourth review of B20 (18.11.): decided on the text, one view kept or replaced, several actions in one save ---

/** A file another writer writes over `ms` milliseconds: each reading is what the file is at that moment — cut until then, whole after. */
function writtenOver(cut: string, whole: string, ms: number) {
  const start = Date.now();
  let written: string | null = null;
  let reads = 0;
  const now = () => written ?? (Date.now() - start < ms ? cut : whole);
  return {
    adapter: {
      readTextFile: async () => { reads += 1; return now(); },
      writeTextFile: async (_p: string, c: string) => { written = c; },
    },
    text: now,
    reads: () => reads,
    written: () => written,
  };
}

describe("a reading counts once it holds still, decided on the text (B20)", () => {
  const FULL = ["formulas:", "  f1: a + 1", "views:", "  - type: table", "    name: Offen", "    order:", "      - note.a", "  - type: cards", "    name: Karten", "    limit: 5", ""].join("\n");
  const addView = (shown: any) => ({ ...shown, views: [...shown.views, { type: "list", name: "Neu" }] });

  it("a cut that a whole file follows within the wait: the change lands on the whole file, the last view intact", async () => {
    const shown = loadBaseConfigText(FULL);
    const whole = FULL.replace("limit: 5", "limit: 9");
    const f = writtenOver(whole.slice(0, whole.indexOf("Karten") + 3), whole, 60);
    await writeBaseConfigChange(f.adapter, "Tasks.base", shown, addView(shown));
    expect(loadBaseConfigText(f.text()).views.map((v: any) => v.name)).toEqual(["Offen", "Karten", "Neu"]);
    expect(f.text()).toContain("limit: 9");
  });

  it("the text the screen knows is written at once: one reading before, one for the change, no wait", async () => {
    const shown = loadBaseConfigText(FULL);
    const f = writtenOver(FULL, FULL, 0);
    await writeBaseConfigChange(f.adapter, "Tasks.base", shown, addView(shown));
    expect(f.reads()).toBe(2);
    expect(f.text()).toBe(serializeBaseConfig(addView(shown)));
  });

  it("a file that holds still but no longer reads (half its YAML) is refused as being written, not merged and not overwritten", async () => {
    const shown = loadBaseConfigText(FULL);
    const broken = "views:\n  - type: table\n    order: [note.a\n";
    const f = writtenOver(broken, broken, 0);
    await expect(writeBaseConfigChange(f.adapter, "Tasks.base", shown, addView(shown))).rejects.toMatchObject({ name: "BaseConfigChangeRefusedError", reason: "fileChanging" });
    expect(f.written()).toBe(null);
  });
});

describe("a database of one view on each side (B20)", () => {
  it("kept its type, renamed and changed elsewhere: the same view, the change lands on it", () => {
    const text = ["views:", "  - type: cards", "    name: Galerie", "    order:", "      - note.a", ""].join("\n");
    const shown = loadBaseConfigText(text);
    const next = withView(shown, "Galerie", { sort: sortBy("note.a") });
    const made = rebaseBaseConfigText(shown, next, text.replace("name: Galerie", "name: Bilder") + "    limit: 4\n");
    expect(made.config.views.map((v: any) => [v.name, v.sort])).toEqual([["Bilder", sortBy("note.a")]]);
    expect(made.text).toContain("limit: 4");
  });

  it("replaced elsewhere by a view of another name and another type: refused, the user's filter never lands on it", () => {
    const text = ["views:", "  - type: cards", "    name: Galerie", ""].join("\n");
    const shown = loadBaseConfigText(text);
    const next = withView(shown, "Galerie", { filters: { and: ['note.a == "1"'] } });
    expect(() => rebaseBaseConfigText(shown, next, ["views:", "  - type: table", "    name: Projekte", "    limit: 3", ""].join("\n"))).toThrow(BaseConfigChangeRefusedError);
  });
});

describe("several actions in one save — a change parked for a moved file (B20)", () => {
  const TWO = ["views:", "  - type: table", "    name: A", "    order:", "      - note.a", "  - type: cards", "    name: B", ""].join("\n");
  const fileLimitsA = TWO.replace("      - note.a\n", "      - note.a\n    limit: 7\n");
  const refused = (shown: any, next: any, file: string) => {
    try { rebaseBaseConfigText(shown, next, file); return null; } catch (e) { return e instanceof BaseConfigChangeRefusedError ? e.reason : String(e); }
  };

  it("duplicated under its own name and the original changed: refused, the other side's change never lands on the copy", () => {
    const shown = loadBaseConfigText(TWO);
    const next = JSON.parse(JSON.stringify(shown));
    const copy = JSON.parse(JSON.stringify(next.views[0]));
    next.views[0].sort = sortBy("note.a");
    next.views.splice(1, 0, copy);
    expect(refused(shown, next, fileLimitsA)).toBe("viewUnclear");
  });

  it("a view removed and another added in one save: refused, the new view never takes the removed one's place", () => {
    const shown = loadBaseConfigText(["views:", "  - type: cards", "    name: V0", ""].join("\n"));
    const next = { ...shown, views: [{ type: "table", name: "Neu" }] };
    expect(refused(shown, next, ["views:", "  - type: cards", "    name: V0", "    limit: 2", ""].join("\n"))).toBe("viewUnclear");
  });

  it("a view removed and another changed in one save: refused", () => {
    const shown = loadBaseConfigText(TWO);
    const next = { ...shown, views: [{ ...shown.views[1], coverImage: "note.c" }] };
    expect(refused(shown, next, fileLimitsA.replace("    name: B\n", "    name: B\n    limit: 3\n"))).toBe("viewUnclear");
  });

  it("where the file left the views as they were (it changed a formula), the screen's views stand as a whole save writes them", () => {
    const shown = loadBaseConfigText(TWO);
    const next = JSON.parse(JSON.stringify(shown));
    const copy = JSON.parse(JSON.stringify(next.views[0]));
    next.views[0].sort = sortBy("note.a");
    next.views.splice(1, 0, copy);
    const made = rebaseBaseConfigText(shown, next, "formulas:\n  f: 1 + 1\n" + TWO);
    expect(made.config.views.map((v: any) => v.name)).toEqual(["A", "A", "B"]);
    expect(made.config.views[0].sort).toEqual(sortBy("note.a"));
    expect(made.text).toContain("f: 1 + 1");
  });
});

// --- Fifth review of B20 (18.11.): the screen says which view is which; each check of a reading on its own ---

describe("which view is which, as the screen says it (B20)", () => {
  it("follows what a change did to the list of views, and what several changes did one after the other", () => {
    expect(lineageOfChange(3, 3)).toEqual([0, 1, 2]);
    expect(lineageOfChange(2, 3, { add: 1 })).toEqual([0, null, 1]);
    expect(lineageOfChange(3, 2, { remove: 0 })).toEqual([1, 2]);
    expect(lineageOfChange(3, 3, { move: [0, 2] })).toEqual([1, 2, 0]);
    // What the change says does not add up to the views now: unknown, judged from the views.
    expect(lineageOfChange(2, 2, { add: 2 })).toBeUndefined();
    expect(lineageOfChange(2, 3)).toBeUndefined();
    expect(composeLineage([1], [0, null])).toEqual([1, null]);
    expect(composeLineage([2, 0, null], [2, 0])).toEqual([null, 2]);
    expect(composeLineage(undefined, [0])).toBeUndefined();
  });
});

describe("a view removed here and a new one added under its name are two views (B20)", () => {
  // The desktop names a new view by its type ("Tabelle"): removed and added again, it reads like the old one.
  const T0 = ["views:", "  - type: table", "    name: Tabelle", "    order:", "      - note.a", "    sort:", "      - property: note.a", "        direction: DESC", "  - type: cards", "    name: Karten", ""].join("\n");
  const withLimit = T0.replace("    name: Tabelle\n", "    name: Tabelle\n    limit: 9\n");
  /** Two changes parked for a moved file: the first view removed, then a new one added at the end. */
  const removedThenAdded = (type: string) => {
    const shown = loadBaseConfigText(T0);
    const mid = { ...shown, views: shown.views.filter((_: any, i: number) => i !== 0) };
    const next = { ...mid, views: [...mid.views, { type, name: "Tabelle" }] };
    return { shown, next, lineage: composeLineage(lineageBetween(shown, mid, { remove: 0 }), lineageBetween(mid, next, { add: 1 })) };
  };
  const refused = (f: () => unknown) => {
    try { f(); return null; } catch (e) { return e instanceof BaseConfigChangeRefusedError ? e.reason : String(e); }
  };

  it("where the other side changed the old view, refused: what it set there never lands on the new view of that name", () => {
    const same = removedThenAdded("table");
    expect(refused(() => rebaseBaseConfigText(same.shown, same.next, withLimit, { lineage: same.lineage }))).toBe("viewUnclear");
    const other = removedThenAdded("cards");
    expect(refused(() => rebaseBaseConfigText(other.shown, other.next, withLimit, { lineage: other.lineage }))).toBe("viewUnclear");
  });

  it("through the write as well: nothing written", async () => {
    const c = removedThenAdded("table");
    let now = withLimit;
    const files = { readTextFile: async () => now, writeTextFile: async (_p: string, t: string) => { now = t; } };
    await expect(writeBaseConfigChange(files, "Tasks.base", c.shown, c.next, { lineage: c.lineage })).rejects.toMatchObject({ reason: "viewUnclear" });
    expect(now).toBe(withLimit);
  });

  it("where the file left its views alone, the screen's views stand as a whole save writes them", () => {
    const c = removedThenAdded("table");
    const made = rebaseBaseConfigText(c.shown, c.next, "formulas:\n  f: 1 + 1\n" + T0, { lineage: c.lineage });
    expect(made.config.views.map((v: any) => v.name)).toEqual(["Karten", "Tabelle"]);
    // The new view as the screen made it: nothing of the removed one's sort.
    expect(made.text).not.toContain("DESC");
    expect(made.text).toContain("f: 1 + 1");
  });

  it("a view the screen kept and changed is still the file's view of that name", () => {
    const shown = loadBaseConfigText(T0);
    const next = { ...shown, views: shown.views.map((v: any, i: number) => (i === 0 ? { ...v, sort: [{ property: "a", direction: "ASC" }] } : v)) };
    const made = rebaseBaseConfigText(shown, next, withLimit, { lineage: lineageBetween(shown, next) });
    expect(made.config.views.map((v: any) => v.name)).toEqual(["Tabelle", "Karten"]);
    expect(made.text).toContain("limit: 9");
    expect(made.text).toContain("direction: ASC");
  });
});

describe("each text the change is handed for the file is the reading that held still (B20)", () => {
  const FULL = ["formulas:", "  f1: a + 1", "views:", "  - type: table", "    name: Offen", "    order:", "      - note.a", "  - type: cards", "    name: Karten", "    limit: 5", ""].join("\n");

  it("over a storage without the chain's halves: a text read again for the write that is not the settled one starts the change over", async () => {
    const whole = FULL.replace("limit: 5", "limit: 9");
    const cut = whole.slice(0, whole.indexOf("  - type: cards"));
    let reads = 0;
    let written: string | null = null;
    // The text the screen knows first; another writer starts as the change reads again — cut, then whole.
    const at = (n: number) => (n <= 1 ? FULL : n === 2 ? cut : whole);
    const files = {
      readTextFile: async () => { reads += 1; return written ?? at(reads); },
      writeTextFile: async (_p: string, t: string) => { written = t; },
    };
    const shown = loadBaseConfigText(FULL);
    await writeBaseConfigChange(files, "Tasks.base", shown, { ...shown, views: [...shown.views, { type: "list", name: "Neu" }] });
    expect(loadBaseConfigText(written ?? "").views.map((v: any) => v.name)).toEqual(["Offen", "Karten", "Neu"]);
    expect(written).toContain("limit: 9");
  });
});
