import { describe, expect, it } from "vitest";
import { readFrontmatterPath } from "@plainva/core";
import { buildTaskDbFile, parseBaseConfig, resolveTaskPriorityModel, setDbTaskPriority, taskDbRows, resolveTaskCompletionModel } from "@plainva/ui";

/**
 * Plan Aufgaben-Oberfläche, B3: a task database made before priorities existed
 * gets its priority column the first time a priority is SET — never by merely
 * being read — and a database created now brings the column along.
 */

const LABELS = { key: "priorität", options: ["hoch", "mittel", "niedrig"] as [string, string, string] };

function vault(files: Record<string, string>) {
  const writes: string[] = [];
  return {
    files,
    writes,
    deps: {
      readTextFile: async (path: string) => files[path],
      writeTextFile: async (path: string, content: string) => {
        writes.push(path);
        files[path] = content;
      },
      writeNote: async (path: string, mutate: (raw: string) => string) => {
        const next = mutate(files[path]);
        if (next !== files[path]) {
          writes.push(path);
          files[path] = next;
        }
      },
    },
  };
}

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
      - note.status
      - note.frist
filters:
  and:
    - file.folder == "Aufgaben"
`;

describe("setDbTaskPriority", () => {
  it("adds the column on the first SET, writes the option of the rank, and says so once", async () => {
    const v = vault({ "Aufgaben.base": OLD_DB, "Aufgaben/Angebot.md": "---\nstatus: Offen\n---\n# Angebot\n" });
    const first = await setDbTaskPriority(v.deps, "Aufgaben.base", "Aufgaben/Angebot.md", 1, LABELS);
    expect(first.columnAdded).toBe("priorität");
    expect(v.writes).toEqual(["Aufgaben.base", "Aufgaben/Angebot.md"]);
    expect(readFrontmatterPath(v.files["Aufgaben/Angebot.md"], ["priorität"])).toBe("hoch");

    const config = parseBaseConfig(v.files["Aufgaben.base"]);
    expect(resolveTaskPriorityModel(config)).toEqual({ key: "priorität", options: ["hoch", "mittel", "niedrig"] });
    // Everything that was there is still there — the database is extended, not rebuilt.
    expect(v.files["Aufgaben.base"]).toContain('file.folder == "Aufgaben"');
    expect(Object.keys(config.columns)).toEqual(expect.arrayContaining(["status", "frist", "priorität"]));

    const second = await setDbTaskPriority(v.deps, "Aufgaben.base", "Aufgaben/Angebot.md", 3, LABELS);
    expect(second.columnAdded).toBeNull();
    expect(readFrontmatterPath(v.files["Aufgaben/Angebot.md"], ["priorität"])).toBe("niedrig");
  });

  it("clearing removes the property — and in a database without the column it touches nothing", async () => {
    const v = vault({ "Aufgaben.base": OLD_DB, "Aufgaben/Angebot.md": "---\nstatus: Offen\n---\n# Angebot\n" });
    await setDbTaskPriority(v.deps, "Aufgaben.base", "Aufgaben/Angebot.md", 0, LABELS);
    expect(v.writes).toEqual([]);

    await setDbTaskPriority(v.deps, "Aufgaben.base", "Aufgaben/Angebot.md", 2, LABELS);
    await setDbTaskPriority(v.deps, "Aufgaben.base", "Aufgaben/Angebot.md", 0, LABELS);
    expect(readFrontmatterPath(v.files["Aufgaben/Angebot.md"], ["priorität"]) ?? null).toBeNull();
    expect(v.files["Aufgaben/Angebot.md"]).toContain("status: Offen");
  });

  it("a database created now brings the column, and its rows carry the rank", () => {
    const built = buildTaskDbFile("Aufgaben", {
      viewTable: "Tabelle", viewBoard: "Board", viewTimeline: "Zeitleiste", doneKey: "erledigt", dueKey: "frist",
      statusOptions: ["Offen", "In Arbeit", "Erledigt"], priorityKey: "priorität", priorityOptions: ["hoch", "mittel", "niedrig"],
    });
    const config = parseBaseConfig(built.content);
    expect(resolveTaskPriorityModel(config)?.options).toEqual(["hoch", "mittel", "niedrig"]);
    const rows = taskDbRows(
      [{ "file.path": "Aufgaben/A.md", "file.name": "A", priorität: "mittel" }, { "file.path": "Aufgaben/B.md", "file.name": "B" }],
      config,
      resolveTaskCompletionModel(config),
    );
    expect(rows.map((r) => r.priority)).toEqual([2, 0]);
  });
});
