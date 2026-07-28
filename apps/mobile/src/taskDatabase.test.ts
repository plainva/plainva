import { describe, expect, it } from "vitest";
import {
  createTaskInDatabase,
  promoteTask,
  resolveTaskCompletionModel,
  taskDbDueKey,
  taskDbRows,
  type TaskPromotionAdapter,
} from "@plainva/ui";

/**
 * The task database as the phone sees it (S22b/S23).
 *
 * The desktop already covers the model itself; what these pin is the part that
 * was new: that the phone derives the SAME rows from a query result and that a
 * promotion through the phone's read/save/exists adapter produces the same note
 * and the same rewritten line the desktop produces.
 */

/** A German task database — status column and due column carry localized keys,
 * which is exactly why nothing may be resolved by column NAME. */
const GERMAN_DB = {
  columns: {
    erledigt: { input: "checkbox" },
    status: { input: "status", options: ["Offen", "In Arbeit", "Erledigt"] },
    frist: { input: "date" },
  },
  filters: { and: ['file.folder == "Aufgaben"'] },
};

function memoryAdapter(files: Record<string, string>): TaskPromotionAdapter & { files: Record<string, string> } {
  return {
    files,
    async readTextFile(path: string) {
      const v = files[path];
      if (v === undefined) throw new Error(`missing ${path}`);
      return v;
    },
    async writeTextFile(path: string, content: string) {
      files[path] = content;
    },
    async exists(path: string) {
      return Object.prototype.hasOwnProperty.call(files, path);
    },
  };
}

describe("task database rows", () => {
  it("reads the due column from the schema, not from its name", () => {
    expect(taskDbDueKey(GERMAN_DB)).toBe("frist");
    expect(taskDbDueKey({ columns: { due: { input: "date" } } })).toBe("due");
    expect(taskDbDueKey({ columns: { note: { input: "text" } } })).toBeNull();
  });

  it("derives path, title, status, done and due like the desktop does", () => {
    const completion = resolveTaskCompletionModel(GERMAN_DB);
    const rows = taskDbRows(
      [
        { "file.path": "Aufgaben/Steuer.md", "file.name": "Steuer", erledigt: false, status: "In Arbeit", frist: "2026-08-01" },
        { "file.path": "Aufgaben/Abgabe.md", "file.name": "Abgabe", erledigt: true, status: "Erledigt", frist: "" },
      ],
      GERMAN_DB,
      completion
    );
    expect(rows).toEqual([
      { path: "Aufgaben/Steuer.md", title: "Steuer", status: "In Arbeit", done: false, due: "2026-08-01" },
      { path: "Aufgaben/Abgabe.md", title: "Abgabe", status: "Erledigt", done: true, due: null },
    ]);
  });

  it("takes the checkbox as the truth when it disagrees with the status column", () => {
    // A provider check-off writes the checkbox; a stale status column must not
    // make the entry look open again.
    const rows = taskDbRows(
      [{ "file.path": "a.md", "file.name": "a", erledigt: true, status: "Offen" }],
      GERMAN_DB,
      resolveTaskCompletionModel(GERMAN_DB)
    );
    expect(rows[0].done).toBe(true);
  });

  it("reads index property values that travel as strings", () => {
    const rows = taskDbRows(
      [{ "file.path": "a.md", "file.name": "a", erledigt: "true" }],
      GERMAN_DB,
      resolveTaskCompletionModel(GERMAN_DB)
    );
    expect(rows[0].done).toBe(true);
  });

  it("falls back to the file name when the query has no title field", () => {
    expect(taskDbRows([{ "file.path": "Aufgaben/Ohne Titel.md" }], GERMAN_DB, null)[0].title).toBe("Ohne Titel");
  });
});

describe("promoting a checkbox from the phone", () => {
  const dbFile = JSON.stringify(GERMAN_DB);

  it("creates the note and turns the checkbox line into a link to it", async () => {
    const adapter = memoryAdapter({
      "Tasks.base": dbFile,
      "Notizen/Besprechung.md": "# Besprechung\n\n- [ ] Steuer abgeben #buero 📅 2026-08-01\n- [ ] Zweites\n",
    });
    const res = await promoteTask({
      adapter,
      sourcePath: "Notizen/Besprechung.md",
      task: { ordinal: 0, text: "Steuer abgeben #buero 📅 2026-08-01", tags: ["buero"], due: "2026-08-01", done: false },
      dbPath: "Tasks.base",
      noteType: "Note",
      allNotePaths: ["Notizen/Besprechung.md"],
      fallbackTitle: "Aufgabe",
    });

    expect(res).toMatchObject({ ok: true, notePath: "Aufgaben/Steuer abgeben.md", title: "Steuer abgeben" });
    const note = adapter.files["Aufgaben/Steuer abgeben.md"];
    // Structured fields, not text: the due date lands in the date column, the
    // hashtag becomes a real tag, and the note links back to where it came from.
    expect(note).toContain("frist: 2026-08-01");
    expect(note).toContain("status: Offen");
    expect(note).toContain("erledigt: false");
    expect(note).toContain("buero");
    expect(note).toContain('source: "[[Besprechung]]"');
    // The line stays where it was written — as a link, not a deletion.
    expect(adapter.files["Notizen/Besprechung.md"]).toContain("- [[Steuer abgeben]]");
    expect(adapter.files["Notizen/Besprechung.md"]).toContain("- [ ] Zweites");
  });

  it("refuses when the note changed since it was listed, instead of rewriting the wrong line", async () => {
    const adapter = memoryAdapter({
      "Tasks.base": dbFile,
      "Notizen/Besprechung.md": "- [ ] Etwas ganz anderes\n",
    });
    const res = await promoteTask({
      adapter,
      sourcePath: "Notizen/Besprechung.md",
      task: { ordinal: 0, text: "Steuer abgeben", tags: [], due: null, done: false },
      dbPath: "Tasks.base",
      noteType: "Note",
      allNotePaths: [],
      fallbackTitle: "Aufgabe",
    });
    expect(res).toEqual({ ok: false, reason: "stale" });
    expect(adapter.files["Notizen/Besprechung.md"]).toBe("- [ ] Etwas ganz anderes\n");
    expect(Object.keys(adapter.files)).toHaveLength(2);
  });

  it("asks instead of guessing when the database has several possible folders", async () => {
    const adapter = memoryAdapter({
      "Tasks.base": JSON.stringify({
        columns: GERMAN_DB.columns,
        filters: { or: ['file.folder == "A"', 'file.folder == "B"'] },
      }),
      "n.md": "- [ ] x\n",
    });
    const res = await createTaskInDatabase({ adapter, dbPath: "Tasks.base", title: "Neu", noteType: "Note" });
    expect(res).toEqual({ ok: false, reason: "noFolder" });
  });

  it("creates a database entry without a source checkbox, open and unchecked", async () => {
    const adapter = memoryAdapter({ "Tasks.base": dbFile });
    const res = await createTaskInDatabase({ adapter, dbPath: "Tasks.base", title: "Rechnung prüfen", noteType: "Note" });
    expect(res).toEqual({ ok: true, notePath: "Aufgaben/Rechnung prüfen.md" });
    const note = adapter.files["Aufgaben/Rechnung prüfen.md"];
    expect(note).toContain("status: Offen");
    expect(note).toContain("erledigt: false");
    expect(note).toContain("# Rechnung prüfen");
  });

  it("does not overwrite an entry of the same name", async () => {
    const adapter = memoryAdapter({ "Tasks.base": dbFile, "Aufgaben/Rechnung.md": "# schon da\n" });
    const res = await createTaskInDatabase({ adapter, dbPath: "Tasks.base", title: "Rechnung", noteType: "Note" });
    expect(res).toEqual({ ok: true, notePath: "Aufgaben/Rechnung 2.md" });
    expect(adapter.files["Aufgaben/Rechnung.md"]).toBe("# schon da\n");
  });
});
