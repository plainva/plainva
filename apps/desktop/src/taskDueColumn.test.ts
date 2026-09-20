import { describe, expect, it } from "vitest";
import { convertDueColumnToDateTime, dayOnlyDueColumn, parseBaseConfig, shouldOfferDueTimeColumn } from "@plainva/ui";

/**
 * Plan Aufgaben-Oberfläche, E9: a task database from before tasks had times
 * types its due column as a day. Plainva never retypes it by itself — it offers
 * it once per database and device, and the conversion touches the column's
 * type only.
 */

const OLD_DB = `properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Offen
        - value: Erledigt
  note.frist:
    plainva:
      input: date
views:
  - type: table
    name: Tabelle
    order:
      - file.name
      - note.frist
filters:
  and:
    - file.folder == "Aufgaben"
`;

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe("due column and the time of day", () => {
  it("offers the retyping once per database — and not at all where the column already holds date & time", async () => {
    const files: Record<string, string> = { "Aufgaben.base": OLD_DB, "Neu.base": OLD_DB.replace("input: date", "input: datetime") };
    const read = async (path: string) => files[path];
    const storage = memoryStorage();
    expect(await shouldOfferDueTimeColumn(read, "vault", "Aufgaben.base", storage)).toBe("frist");
    expect(await shouldOfferDueTimeColumn(read, "vault", "Aufgaben.base", storage)).toBeNull();
    expect(await shouldOfferDueTimeColumn(read, "vault", "Neu.base", storage)).toBeNull();
    // Another vault is another question.
    expect(await shouldOfferDueTimeColumn(read, "other", "Aufgaben.base", storage)).toBe("frist");
  });

  it("retypes the column and leaves everything else in the file alone", async () => {
    const files: Record<string, string> = { "Aufgaben.base": OLD_DB };
    const adapter = { readTextFile: async (p: string) => files[p], writeTextFile: async (p: string, c: string) => void (files[p] = c) };
    expect(await convertDueColumnToDateTime(adapter, "Aufgaben.base")).toBe("frist");
    const config = parseBaseConfig(files["Aufgaben.base"]);
    expect(config.columns.frist.input).toBe("datetime");
    expect(config.columns.status.options).toHaveLength(2);
    expect(files["Aufgaben.base"]).toContain('file.folder == "Aufgaben"');
    expect(dayOnlyDueColumn(config)).toBeNull();
    // A second call has nothing to do and writes nothing.
    const before = files["Aufgaben.base"];
    expect(await convertDueColumnToDateTime(adapter, "Aufgaben.base")).toBeNull();
    expect(files["Aufgaben.base"]).toBe(before);
  });
});
