import { describe, it, expect } from "vitest";
import {
  BaseConfigChangeRefusedError,
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
    expect(f.writes).toEqual([]);
    expect(f.files["Tasks.base"]).toBe(elsewhere);
  });

  it("refuses a change to a view renamed meanwhile, and writes nothing", async () => {
    const f = fakeFiles(BASE);
    const shown = loadBaseConfigText(BASE);
    f.files["Tasks.base"] = serializeBaseConfig(withView(shown, "Cards", { name: "Gallery" }));
    const next = withView(shown, "Cards", { sort: sortBy("file.name") });
    await expect(writeBaseConfigChange(f.adapter, "Tasks.base", shown, next)).rejects.toThrow(/Cards/);
    expect(f.writes).toEqual([]);
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
    expect(shown.views.map((v: any) => v.name)).toEqual(["Table", "Cards", 2024, true]);
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
