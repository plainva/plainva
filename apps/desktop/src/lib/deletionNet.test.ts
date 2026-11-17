import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SnapshotBeforeDeleteError } from "@plainva/core";
import { DELETION_NET_LIST_MAX, deleteEachWithNet, deleteWithNet, deletionNetManyQuestion, deletionNetQuestion, registerDeletionNetQuestion, type DeletionNetQuestion } from "../../../../packages/ui/src/lib/deletionNet";

/**
 * The words of "Delete without a backup?" (D1, data-safety plan 2026-11-06),
 * shared by both shells: a file, a folder with what has no copy, a folder
 * that could not be listed — each with the net it lacks — in every language.
 */
const LOCALES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "packages", "ui", "src", "locales");
const langs: Record<string, Record<string, Record<string, string>>> = Object.fromEntries(
  readdirSync(LOCALES).filter((f) => f.endsWith(".json")).map((f) => [f.replace(".json", ""), JSON.parse(readFileSync(join(LOCALES, f), "utf8"))]),
);
const tIn = (lang: string) => (key: string, options?: Record<string, unknown>) => {
  const [ns, name] = key.split(".");
  let text = langs[lang][ns]?.[name];
  if (text === undefined) throw new Error(`${lang}: ${key} missing`);
  for (const [k, v] of Object.entries(options ?? {})) text = text.split(`{{${k}}}`).join(String(v));
  return text;
};

describe("the question for a deletion without a net", () => {
  it("a file on the phone: names it, and says there is no trash", () => {
    const q = deletionNetQuestion(tIn("en"), { path: "Projects/Offer.md", uncovered: ["Projects/Offer.md"], total: 1, net: "no-trash", folder: false });
    expect(q.title).toBe("Delete without a backup?");
    expect(q.confirmLabel).toBe("Delete anyway");
    expect(q.message.split("\n")).toEqual([
      "Plainva could not save a backup before deleting:",
      "Projects/Offer.md",
      "",
      expect.stringContaining("There is no trash on the phone"),
    ]);
    expect(q.message).toContain("this file is gone");
  });

  it("a folder on a share: counts and lists what has no copy, and cuts a long list", () => {
    const uncovered = Array.from({ length: DELETION_NET_LIST_MAX + 3 }, (_, i) => `Archive/R-${i}.pdf`);
    const q = deletionNetQuestion(tIn("de"), { path: "Archive", uncovered, total: 214, net: "trash-unavailable", folder: true });
    expect(q.title).toBe("Ohne Sicherung löschen?");
    expect(q.message).toContain(`von ${uncovered.length} der 214 Dateien`);
    expect(q.message).toContain("Archive/R-0.pdf");
    expect(q.message).not.toContain(`Archive/R-${DELETION_NET_LIST_MAX}.pdf`);
    expect(q.message).toContain("… und 3 weitere");
    expect(q.message).toContain("Diese Dateien wären endgültig weg.");
  });

  it("a folder that could not be listed is named itself, without a count", () => {
    const q = deletionNetQuestion(tIn("en"), { path: "Archive", uncovered: ["Archive"], total: 0, net: "no-trash", folder: true });
    expect(q.message).toContain("could not read everything in this folder");
    expect(q.message).toContain("these files are gone");
    expect(q.message).not.toContain("0 files");
  });

  it("every language has every text, with its placeholders", () => {
    expect(Object.keys(langs)).toHaveLength(10);
    for (const lang of Object.keys(langs)) {
      const t = tIn(lang);
      for (const net of ["no-trash", "trash-unavailable"] as const) {
        for (const folder of [false, true]) {
          const q = deletionNetQuestion(t, { path: "A", uncovered: folder ? ["A/b.md", "A/c.md"] : ["A"], total: folder ? 5 : 1, net, folder });
          expect(q.message, `${lang} ${net} ${folder}`).not.toMatch(/\{\{/);
          if (folder) expect(q.message, `${lang} ${net}`).toMatch(/2[^0-9][\s\S]*5|5[^0-9][\s\S]*2/);
        }
      }
      expect(t("backup.deleteWithoutSnapshotMore", { rest: 7 }), lang).toContain("7");
      expect(t("backup.deleteWithoutSnapshotUnlisted"), lang).toBeTruthy();
    }
  });
});

describe("several deletions at once ask once (finding A12, release 0.9.0)", () => {
  it("one question names every file of the batch without a copy", () => {
    const refusals = ["a.md", "b.md", "c.md"].map((path) => ({ path, uncovered: [path], total: 1, net: "no-trash" as const, folder: false }));
    const q = deletionNetManyQuestion(tIn("en"), refusals);
    expect(q.title).toBe("Delete without a backup?");
    expect(q.confirmLabel).toBe("Delete anyway");
    expect(q.message).toContain("3");
    for (const path of ["a.md", "b.md", "c.md"]) expect(q.message).toContain(path);
    expect(q.message).toContain("these files are gone");
    // One refusal is asked as itself.
    expect(deletionNetManyQuestion(tIn("en"), refusals.slice(0, 1))).toEqual(deletionNetQuestion(tIn("en"), refusals[0]!));
  });

  it("every language has the batch text, with its count", () => {
    for (const lang of Object.keys(langs)) {
      for (const net of ["no-trash", "trash-unavailable"] as const) {
        const refusals = ["a.md", "b.md"].map((path) => ({ path, uncovered: [path], total: 1, net, folder: false }));
        const q = deletionNetManyQuestion(tIn(lang), refusals);
        expect(q.message, `${lang} ${net}`).not.toMatch(/\{\{/);
        expect(q.message, `${lang} ${net}`).toMatch(/2/);
      }
    }
  });

  /** A storage that is full: no deletion has a net until it is told to go without one. */
  function fullStorage(broken: string[] = []) {
    const files = new Set(["a.md", "b.md", "c.md", "kept.md"]);
    const deleteItem = async (path: string, _recursive?: boolean, c?: { withoutSnapshot?: true }) => {
      if (broken.includes(path)) throw new Error(`cannot delete ${path}`);
      if (!c?.withoutSnapshot) throw new SnapshotBeforeDeleteError(path, [path], 1, "no-trash", false);
      files.delete(path);
    };
    return { files, adapter: { deleteItem } };
  }

  it("a full storage asks ONE question for the whole selection; yes deletes them all", async () => {
    const asked: DeletionNetQuestion[] = [];
    registerDeletionNetQuestion(async (q) => (asked.push(q), true));
    try {
      const { files, adapter } = fullStorage();
      const outcomes = await deleteEachWithNet(["a.md", "b.md", "c.md"], (path, ask) => deleteWithNet(adapter, path, false, { confirmed: true }, ask));
      expect(asked).toHaveLength(1);
      expect(outcomes).toEqual(["a.md", "b.md", "c.md"].map((item) => ({ item, deleted: true })));
      expect([...files]).toEqual(["kept.md"]);
    } finally {
      registerDeletionNetQuestion(null);
    }
  });

  it("Cancel keeps every file of the batch, and an error of one does not stop the others", async () => {
    const asked: DeletionNetQuestion[] = [];
    registerDeletionNetQuestion(async (q) => (asked.push(q), false));
    try {
      const { files, adapter } = fullStorage(["b.md"]);
      const outcomes = await deleteEachWithNet(["a.md", "b.md", "c.md"], (path, ask) => deleteWithNet(adapter, path, false, { confirmed: true }, ask));
      expect(asked).toHaveLength(1);
      expect(outcomes.map((o) => ("error" in o ? "error" : o.deleted))).toEqual([false, "error", false]);
      expect(files.size).toBe(4);
    } finally {
      registerDeletionNetQuestion(null);
    }
  });

  it("a batch where every file has its net asks nothing; without a dialog nothing goes without one", async () => {
    let asked = 0;
    registerDeletionNetQuestion(async () => (asked++, true));
    try {
      const removed: string[] = [];
      const adapter = { deleteItem: async (path: string) => void removed.push(path) };
      await deleteEachWithNet(["a.md", "b.md"], (path, ask) => deleteWithNet(adapter, path, false, { confirmed: true }, ask));
      expect(asked).toBe(0);
      expect(removed).toEqual(["a.md", "b.md"]);
    } finally {
      registerDeletionNetQuestion(null);
    }
    const { files, adapter } = fullStorage();
    const outcomes = await deleteEachWithNet(["a.md"], (path, ask) => deleteWithNet(adapter, path, false, { confirmed: true }, ask));
    expect(outcomes).toEqual([{ item: "a.md", deleted: false }]);
    expect(files.has("a.md")).toBe(true);
  });
});
