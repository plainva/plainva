import { beforeEach, describe, expect, it, vi } from "vitest";
import { composeLineage, lineageBetween, migrateFiltersToPerView, parseBaseConfig, serializeBaseConfig } from "@plainva/ui";

const loadBaseConfigText = (text: string) => migrateFiltersToPerView(parseBaseConfig(text));

/**
 * Finding B20 (0.9.0 defect list): a change to a database's views on the
 * phone wrote the config loaded when the database was opened — and undid
 * whatever another device or the desktop wrote to the file since. The change
 * lands on the file as it lies there now.
 */

vi.mock("./vaultService", () => ({ vaultOps: {}, noteSaver: {} }));
vi.mock("./mobileSettings", () => ({ getMobileSettings: () => ({}) }));
vi.mock("./syncService", () => ({ syncSoon: () => {} }));
vi.mock("./vaultRegistry", () => ({ getActiveVaultEntry: async () => ({ name: "Vault" }) }));
vi.mock("./templateInteractive", () => ({ answerTemplateFile: vi.fn(), buildNewNoteFromTemplate: vi.fn() }));

import { deleteBaseProperty, saveBaseConfig } from "./baseOps";

const PATH = "Projects/Tasks.base";
const files = new Map<string, string>();
const vault = {
  files: {
    exists: async (p: string) => files.has(p),
    readTextFile: async (p: string) => {
      const text = files.get(p);
      if (text === undefined) throw new Error("not found: " + p);
      return text;
    },
    writeTextFile: vi.fn(async (p: string, text: string) => { files.set(p, text); }),
  },
  indexer: null,
} as any;

const TEXT = [
  "properties:",
  "  note.prio:",
  "    plainva:",
  "      input: number",
  "views:",
  "  - type: table",
  "    name: Table",
  "    order:",
  "      - file.name",
  "  - type: cards",
  "    name: Cards",
  "",
].join("\n");

beforeEach(() => {
  files.clear();
  vault.files.writeTextFile.mockClear();
});

const view = (name: string) => loadBaseConfigText(files.get(PATH)!).views.find((v: any) => v.name === name);

describe("a database change on the phone lands on the file as it lies there (B20)", () => {
  it("keeps what another device changed in another view meanwhile", async () => {
    const shown = loadBaseConfigText(TEXT);
    const elsewhere = JSON.parse(JSON.stringify(shown));
    elsewhere.views[1].sort = [{ property: "file.name", direction: "DESC" }];
    files.set(PATH, serializeBaseConfig(elsewhere));
    const next = JSON.parse(JSON.stringify(shown));
    next.views[0].order = ["file.name", "note.prio"];
    await saveBaseConfig(vault, PATH, next, { shown });
    expect(view("Table").order).toEqual(["file.name", "note.prio"]);
    expect(view("Cards").sort).toEqual([{ property: "file.name", direction: "DESC" }]);
  });

  it("writes nothing when the view it changes was deleted meanwhile", async () => {
    const shown = loadBaseConfigText(TEXT);
    const elsewhere = serializeBaseConfig({ ...shown, views: [shown.views[0]] });
    files.set(PATH, elsewhere);
    const next = JSON.parse(JSON.stringify(shown));
    next.views[1].coverImage = "note.cover";
    await expect(saveBaseConfig(vault, PATH, next, { shown })).rejects.toThrow(/Cards/);
    expect(vault.files.writeTextFile).not.toHaveBeenCalled();
    expect(files.get(PATH)).toBe(elsewhere);
  });

  it("answers where the screen's views stand now, so its active view follows its view", async () => {
    const shown = loadBaseConfigText(TEXT);
    files.set(PATH, serializeBaseConfig({ ...shown, views: [shown.views[1], shown.views[0]] }));
    const next = JSON.parse(JSON.stringify(shown));
    next.views[0].coverImage = "note.cover";
    const saved = await saveBaseConfig(vault, PATH, next, { shown });
    expect(saved.config.views.map((v: any) => v.name)).toEqual(["Cards", "Table"]);
    expect(saved.placeOf).toEqual([1, 0]);
  });

  it("\"Save here again\" sets the waiting change on a file that stands there again, and writes it whole where none does", async () => {
    const shown = loadBaseConfigText(TEXT);
    const next = JSON.parse(JSON.stringify(shown));
    next.views[0].order = ["note.prio"];
    const elsewhere = JSON.parse(JSON.stringify(shown));
    elsewhere.views[1].coverImage = "note.cover";
    files.set(PATH, serializeBaseConfig(elsewhere));
    await saveBaseConfig(vault, PATH, next, { recreate: true, shown });
    expect(view("Table").order).toEqual(["note.prio"]);
    expect(view("Cards").coverImage).toBe("note.cover");
    files.clear();
    await saveBaseConfig(vault, PATH, next, { recreate: true, shown });
    expect(files.get(PATH)).toBe(serializeBaseConfig(next));
  });

  it("\"Save here again\" onto a file whose views stand in another order answers where they stand, so the active view follows", async () => {
    const shown = loadBaseConfigText(TEXT);
    files.set(PATH, serializeBaseConfig({ ...shown, views: [shown.views[1], shown.views[0]] }));
    const next = JSON.parse(JSON.stringify(shown));
    next.views[0].order = ["note.prio"];
    const saved = await saveBaseConfig(vault, PATH, next, { recreate: true, shown });
    expect(saved.placeOf).toEqual([1, 0]);
    expect(saved.config.views[1].order).toEqual(["note.prio"]);
  });

  it("removes a property without undoing a view change made elsewhere", async () => {
    const shown = loadBaseConfigText(TEXT);
    const elsewhere = JSON.parse(JSON.stringify(shown));
    elsewhere.views[0].coverImage = "note.cover";
    files.set(PATH, serializeBaseConfig(elsewhere));
    await deleteBaseProperty(vault, PATH, shown, "prio", [], false);
    expect(view("Table").coverImage).toBe("note.cover");
    expect(loadBaseConfigText(files.get(PATH)!).columns?.prio).toBeUndefined();
  });
});

describe("a view removed on the phone and a new one added under its name are two views (B20)", () => {
  it("the change that waited for both is refused where another device changed the old view, and nothing is written", async () => {
    const shown = loadBaseConfigText(TEXT);
    const mid = { ...shown, views: shown.views.filter((_: any, i: number) => i !== 0) };
    const next = { ...mid, views: [...mid.views, { type: "table", name: "Table" }] };
    const lineage = composeLineage(lineageBetween(shown, mid, { remove: 0 }), lineageBetween(mid, next, { add: 1 }));
    const theirs = TEXT.replace("    name: Table\n", "    name: Table\n    limit: 9\n");
    files.set(PATH, theirs);
    await expect(saveBaseConfig(vault, PATH, next, { shown, lineage })).rejects.toMatchObject({ reason: "viewUnclear" });
    expect(files.get(PATH)).toBe(theirs);
  });
});
