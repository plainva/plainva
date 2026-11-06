import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DELETION_NET_LIST_MAX, deletionNetQuestion } from "../../../../packages/ui/src/lib/deletionNet";

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
