import { beforeEach, describe, expect, it } from "vitest";
import i18n from "@plainva/ui/i18n";
import {
  notesCarryingProperty,
  refusedNoteRewrites,
  removePropertyAcrossNotes,
  renamePropertyAcrossNotes,
  renameRefusedText,
  rewriteNoteTexts,
  type PropertyWriteAdapter,
} from "@plainva/ui";
import { renameFrontmatterKey } from "@plainva/core";

/**
 * A property renamed across the notes of a database, and one removed from
 * them (finding 2026-10-09).
 *
 * Both shells ran a loop of their own. The desktop logged each note it could
 * not write to the console and then showed every row as changed; the phone
 * swallowed the error. By then the database carried the new name: a note that
 * could not follow kept the old key under a column that no longer existed.
 *
 * Decided here, for both shells: a rename asks every note first and does not
 * start where one refuses — nothing is written, the database included. A
 * removal does not ask first and counts what it could not write.
 *
 * The vault is a map of files; the loops and the surgical helpers run for real.
 */

const LIST = "---\n- a\n- list\n---\nText\n";
const UNPARSEABLE = "---\ntitle: [unclosed\nprio: 1\n---\nSecret line of the note\n";
const BOTH = "---\nprio: 1\npriority: high\n---\nText\n";
const PLAIN = "---\ntype: note\nprio: 2 # kept\nowner: Anna\n---\nText\n";

function vault(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  const writes: string[] = [];
  const failing = new Set<string>();
  const adapter: PropertyWriteAdapter = {
    readTextFile: async (path) => {
      const text = store.get(path);
      if (text === undefined) throw new Error(`no such file: ${path}`);
      return text;
    },
    writeTextFile: async (path, text) => {
      if (failing.has(path)) throw new Error("Operation not permitted (os error 1)");
      writes.push(path);
      store.set(path, text);
    },
  };
  return { store, writes, failing, adapter };
}

/** What a rename is handed besides the vault, and what it did with it. */
function gesture(answer = true) {
  const steps: string[] = [];
  return {
    steps,
    confirm: async () => { steps.push("asked"); return answer; },
    saveConfig: async () => { steps.push("database saved"); },
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

describe("a property renamed across notes", () => {
  it("asks, renames the database, then every note — and leaves the rest of each block as it stands", async () => {
    const v = vault({ "a.md": PLAIN, "b.md": "---\nprio: 3\n---\nB\n", "c.md": "No block at all\n" });
    const g = gesture();
    const progress: string[] = [];
    const outcome = await renamePropertyAcrossNotes({
      adapter: v.adapter, paths: ["a.md", "b.md", "c.md"], oldName: "prio", newName: "priority",
      confirm: g.confirm, saveConfig: g.saveConfig, onProgress: (done, total) => progress.push(`${done}/${total}`),
    });
    expect(outcome).toEqual({ status: "renamed", result: { written: ["a.md", "b.md"], unchanged: ["c.md"], failed: [] } });
    expect(g.steps).toEqual(["asked", "database saved"]);
    expect(v.store.get("a.md")).toBe("---\ntype: note\npriority: 2 # kept\nowner: Anna\n---\nText\n");
    expect(v.store.get("b.md")).toBe("---\npriority: 3\n---\nB\n");
    expect(v.store.get("c.md")).toBe("No block at all\n");
    expect(progress).toEqual(["1/3", "2/3", "3/3"]);
  });

  it.each([
    ["a YAML list", LIST, /cannot be read as properties/],
    ["YAML that cannot be parsed", UNPARSEABLE, /cannot be read as properties/],
    ["a property of the new name", BOTH, /already has a property with the new name/],
  ])("does not start where a note cannot take the new name: %s", async (_label, note, reason) => {
    const files = { "Tasks/Alpha.md": PLAIN, "Tasks/Refusing.md": note, "Tasks/Omega.md": "---\nprio: 9\n---\n" };
    const v = vault(files);
    const g = gesture();
    const outcome = await renamePropertyAcrossNotes({
      adapter: v.adapter, paths: Object.keys(files), oldName: "prio", newName: "priority", confirm: g.confirm, saveConfig: g.saveConfig,
    });

    expect(outcome.status).toBe("refused");
    // Not the question, not the database, not a single note …
    expect(g.steps).toEqual([]);
    expect(v.writes).toEqual([]);
    // … and every note is what it was, byte for byte — the ones that could
    // have been renamed as well.
    for (const [path, text] of Object.entries(files)) expect(v.store.get(path)).toBe(text);

    if (outcome.status !== "refused") return;
    expect(outcome.refused.map((r) => r.path)).toEqual(["Tasks/Refusing.md"]);
    const said = renameRefusedText("prio", outcome.refused);
    expect(said).toMatch(/^“prio” was not renamed and nothing was changed\. Notes that cannot take the new name: 1 \(Refusing\)\. /);
    expect(said).toMatch(reason);
    // Nothing of a note's text in the message: the YAML parser quotes the line it failed on.
    expect(said).not.toContain("unclosed");
    expect(said).not.toContain("Secret");
  });

  it("names the first three notes of many and says there are more", async () => {
    const paths = ["one.md", "two.md", "three.md", "four.md", "five.md"];
    const v = vault(Object.fromEntries(paths.map((p) => [p, LIST])));
    const outcome = await renamePropertyAcrossNotes({ adapter: v.adapter, paths, oldName: "prio", newName: "priority", saveConfig: async () => {} });
    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") return;
    expect(renameRefusedText("prio", outcome.refused)).toContain("Notes that cannot take the new name: 5 (one, two, three, …).");
  });

  it("writes nothing when the question is answered with no", async () => {
    const v = vault({ "a.md": PLAIN });
    const g = gesture(false);
    const outcome = await renamePropertyAcrossNotes({ adapter: v.adapter, paths: ["a.md"], oldName: "prio", newName: "priority", confirm: g.confirm, saveConfig: g.saveConfig });
    expect(outcome).toEqual({ status: "cancelled" });
    expect(g.steps).toEqual(["asked"]);
    expect(v.store.get("a.md")).toBe(PLAIN);
  });

  it("counts a write that fails during the run and goes on to the next note", async () => {
    const v = vault({ "a.md": PLAIN, "locked.md": "---\nprio: 5\n---\nL\n", "z.md": "---\nprio: 7\n---\nZ\n" });
    v.failing.add("locked.md");
    const outcome = await renamePropertyAcrossNotes({ adapter: v.adapter, paths: ["a.md", "locked.md", "z.md"], oldName: "prio", newName: "priority", saveConfig: async () => {} });
    expect(outcome).toEqual({
      status: "renamed",
      result: { written: ["a.md", "z.md"], unchanged: [], failed: [{ path: "locked.md", message: "Operation not permitted (os error 1)" }] },
    });
    expect(v.store.get("locked.md")).toBe("---\nprio: 5\n---\nL\n");
    expect(v.store.get("z.md")).toBe("---\npriority: 7\n---\nZ\n");
  });

  it("does not take a note that is gone for one that refuses", async () => {
    // The index still lists it. Nothing is settled by correcting a note that
    // is not there, so the rename runs — and counts it.
    const v = vault({ "a.md": PLAIN });
    const outcome = await renamePropertyAcrossNotes({ adapter: v.adapter, paths: ["a.md", "gone.md"], oldName: "prio", newName: "priority", saveConfig: async () => {} });
    expect(outcome.status).toBe("renamed");
    if (outcome.status !== "renamed") return;
    expect(outcome.result.written).toEqual(["a.md"]);
    expect(outcome.result.failed).toEqual([{ path: "gone.md", message: "no such file: gone.md" }]);
  });

  it("leaves the notes alone when the database cannot be saved", async () => {
    const v = vault({ "a.md": PLAIN });
    await expect(
      renamePropertyAcrossNotes({ adapter: v.adapter, paths: ["a.md"], oldName: "prio", newName: "priority", saveConfig: async () => { throw new Error("read-only"); } })
    ).rejects.toThrow("read-only");
    expect(v.store.get("a.md")).toBe(PLAIN);
  });
});

describe("a property removed from the notes of a database", () => {
  it("is not checked first: what cannot be written is counted, the rest is cleaned", async () => {
    const files = { "a.md": PLAIN, "list.md": LIST, "broken.md": UNPARSEABLE, "last.md": "---\nprio: 1\n---\nBody\n", "without.md": "---\nowner: Ben\n---\n" };
    const v = vault(files);
    const result = await removePropertyAcrossNotes(v.adapter, Object.keys(files), "prio");
    expect(result.written).toEqual(["a.md", "last.md"]);
    expect(result.unchanged).toEqual(["without.md"]);
    expect(result.failed.map((f) => f.path)).toEqual(["list.md", "broken.md"]);
    expect(result.failed[0].message).toMatch(/^Frontmatter is not a YAML map/);
    expect(v.store.get("a.md")).toBe("---\ntype: note\nowner: Anna\n---\nText\n");
    // A block that lost its last entry goes, fences included.
    expect(v.store.get("last.md")).toBe("Body\n");
    expect(v.store.get("list.md")).toBe(LIST);
    expect(v.store.get("broken.md")).toBe(UNPARSEABLE);
    expect(v.store.get("without.md")).toBe(files["without.md"]);
  });
});

describe("the check and the change", () => {
  it("are answered by one function, so they cannot disagree on what a note takes", async () => {
    const files = { "a.md": PLAIN, "list.md": LIST, "both.md": BOTH };
    const v = vault(files);
    const rename = (text: string) => renameFrontmatterKey(text, "prio", "priority");
    const refused = await refusedNoteRewrites(v.adapter, Object.keys(files), rename);
    expect(v.writes).toEqual([]);
    const result = await rewriteNoteTexts(v.adapter, Object.keys(files), rename);
    expect(result.failed).toEqual(refused);
    expect(result.written).toEqual(["a.md"]);
  });
});

describe("the notes a rename or a removal goes through", () => {
  // One answer for both shells (finding 2026-10-21): the phone took the rows
  // of the view on screen. Its filters hid notes, which then kept the old key
  // under a column that no longer existed, and every row was asked — a note
  // that holds no property at all stopped a rename it had nothing to do with.
  const CONFIG = {
    filters: { and: ['file.folder == "Tasks"', "note.done == false"] },
    views: [{ type: "table", name: "Open", filters: { and: ["note.prio > 1"] } }],
  };
  const SOURCE_ROWS = [
    { "file.path": "Tasks/a.md", prio: 2 },
    { "file.path": "Tasks/hidden.md", prio: 0 },
    { "file.path": "Tasks/list.md" },
    { "file.path": "Tasks/empty.md", prio: null },
  ];

  it("are the notes of the database's sources that carry the property, whatever a view's filters hide", async () => {
    const asked: unknown[] = [];
    const paths = await notesCarryingProperty(
      { queryDatabaseFiles: async (config) => { asked.push(config); return SOURCE_ROWS; } },
      CONFIG,
      "prio",
      [{ "file.path": "Tasks/a.md", prio: 2 }],
    );
    // A note whose value is empty carries the property; one the index lists without it does not.
    expect(paths).toEqual(["Tasks/a.md", "Tasks/hidden.md", "Tasks/empty.md"]);
    // The database is asked for its sources: its own conditions on a property are not part of them.
    expect(asked).toHaveLength(1);
    expect((asked[0] as typeof CONFIG).filters.and).toEqual(['file.folder == "Tasks"']);
  });

  it("are none for a computed column: the index fills it on every row, and no note stores it", async () => {
    const config = {
      ...CONFIG,
      columns: { open: { rollup: { through: "tasks", fn: "count" } }, back: { reverseOf: { base: "Other.base", property: "project" } } },
    };
    const rows = [{ "file.path": "Tasks/a.md", open: 0, back: [] }];
    const query = { queryDatabaseFiles: async () => rows };
    expect(await notesCarryingProperty(query, config, "open", rows)).toEqual([]);
    expect(await notesCarryingProperty(query, config, "back", rows)).toEqual([]);
  });

  it("are found by the key in any casing: a column a view merely names keeps the note's spelling", async () => {
    const rows = [{ "file.path": "Tasks/upper.md", Prio: 3 }, { "file.path": "Tasks/a.md", prio: 2 }, { "file.path": "Tasks/none.md" }];
    expect(await notesCarryingProperty({ queryDatabaseFiles: async () => rows }, CONFIG, "prio")).toEqual(["Tasks/upper.md", "Tasks/a.md"]);
  });

  it("are the rows on screen that carry it, where the index cannot be asked", async () => {
    const shown = [{ "file.path": "Tasks/a.md", prio: 2 }, { "file.path": "Tasks/list.md" }];
    expect(await notesCarryingProperty(null, CONFIG, "prio", shown)).toEqual(["Tasks/a.md"]);
    const failing = { queryDatabaseFiles: async () => { throw new Error("database is locked"); } };
    expect(await notesCarryingProperty(failing, CONFIG, "prio", shown)).toEqual(["Tasks/a.md"]);
  });
});

describe("a property a note carries in another spelling", () => {
  // The index lists a note with "Prio:" under the column "prio" — it reads
  // the keys without regard to case —, and a rename in the column's spelling
  // found nothing to rename there: the note kept the old key under a column
  // that no longer exists, counted as unchanged (finding 2026-10-21).
  const UPPER = "---\nPrio: 3\nowner: Ben\n---\nText\n";

  it("is renamed and removed in the note's own spelling", async () => {
    const v = vault({ "upper.md": UPPER });
    const g = gesture();
    const outcome = await renamePropertyAcrossNotes({ adapter: v.adapter, paths: ["upper.md"], oldName: "prio", newName: "priority", confirm: g.confirm, saveConfig: g.saveConfig });
    expect(outcome).toEqual({ status: "renamed", result: { written: ["upper.md"], unchanged: [], failed: [] } });
    expect(v.store.get("upper.md")).toBe("---\npriority: 3\nowner: Ben\n---\nText\n");

    const w = vault({ "upper.md": UPPER });
    const removed = await removePropertyAcrossNotes(w.adapter, ["upper.md"], "prio");
    expect(removed).toEqual({ written: ["upper.md"], unchanged: [], failed: [] });
    expect(w.store.get("upper.md")).toBe("---\nowner: Ben\n---\nText\n");
  });

  it("leaves a note alone that carries the new spelling already — a rename of the casing", async () => {
    const files = { "done.md": "---\nPrio: 3\n---\nText\n", "old.md": "---\nprio: 1\n---\nText\n" };
    const v = vault(files);
    const g = gesture();
    const outcome = await renamePropertyAcrossNotes({ adapter: v.adapter, paths: Object.keys(files), oldName: "prio", newName: "Prio", confirm: g.confirm, saveConfig: g.saveConfig });
    expect(outcome).toEqual({ status: "renamed", result: { written: ["old.md"], unchanged: ["done.md"], failed: [] } });
    expect(v.store.get("done.md")).toBe(files["done.md"]);
    expect(v.store.get("old.md")).toBe("---\nPrio: 1\n---\nText\n");
  });

  it("does not start where a note carries both spellings: the new name is taken there", async () => {
    const v = vault({ "two.md": "---\nprio: 1\nPrio: 2\n---\nText\n" });
    const g = gesture();
    const outcome = await renamePropertyAcrossNotes({ adapter: v.adapter, paths: ["two.md"], oldName: "prio", newName: "Prio", confirm: g.confirm, saveConfig: g.saveConfig });
    expect(outcome.status).toBe("refused");
    expect(g.steps).toEqual([]);
    expect(v.writes).toEqual([]);
  });
});

describe("a new name a note carries in another casing", () => {
  it("stops the rename before anything is written: the note has a property of the new name", async () => {
    const v = vault({ "a.md": PLAIN, "taken.md": "---\nprio: 1\nPriority: high\n---\nText\n" });
    const g = gesture();
    const outcome = await renamePropertyAcrossNotes({ adapter: v.adapter, paths: ["a.md", "taken.md"], oldName: "prio", newName: "priority", confirm: g.confirm, saveConfig: g.saveConfig });
    expect(outcome.status).toBe("refused");
    expect(g.steps).toEqual([]);
    expect(v.writes).toEqual([]);
    if (outcome.status === "refused") {
      expect(outcome.refused.map((r) => r.path)).toEqual(["taken.md"]);
      expect(renameRefusedText("prio", outcome.refused)).toMatch(/already has a property with the new name/);
    }
  });

  it("is no obstacle in a note that does not carry the property at all", async () => {
    const v = vault({ "other.md": "---\nPriority: high\n---\nText\n" });
    const g = gesture();
    const outcome = await renamePropertyAcrossNotes({ adapter: v.adapter, paths: ["other.md"], oldName: "prio", newName: "priority", confirm: g.confirm, saveConfig: g.saveConfig });
    expect(outcome).toEqual({ status: "renamed", result: { written: [], unchanged: ["other.md"], failed: [] } });
  });
});
