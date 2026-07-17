import { describe, it, expect } from "vitest";
import { parseBaseConfig } from "@plainva/ui";
import { taskDbFileStem, buildTaskDbFile, createTaskDatabase, type TaskDbLabels, type TaskDbAdapter } from "./taskDatabase";

const LABELS: TaskDbLabels = {
  viewTable: "Tabelle",
  viewBoard: "Board",
  dueKey: "frist",
  statusOptions: ["Offen", "In Arbeit", "Erledigt"],
};

function memoryAdapter() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const adapter: TaskDbAdapter = {
    exists: async (p) => files.has(p) || dirs.has(p),
    createDir: async (p) => { dirs.add(p); },
    writeTextFile: async (p, c) => { files.set(p, c); },
  };
  return { adapter, files, dirs };
}

describe("taskDatabase (PIM plan 1a)", () => {
  it("sanitizes user-typed names into a usable file stem", () => {
    expect(taskDbFileStem("Aufgaben")).toBe("Aufgaben");
    expect(taskDbFileStem("  My   Tasks  ")).toBe("My Tasks");
    expect(taskDbFileStem('a/b\\c:d*e?f"g<h>i|j')).toBe("a b c d e f g h i j");
    // Trailing dots would collide with the .base extension on Windows.
    expect(taskDbFileStem("Tasks...")).toBe("Tasks");
    expect(taskDbFileStem("   ")).toBeNull();
    expect(taskDbFileStem("///")).toBeNull();
  });

  it("builds a template-shaped .base (root file + source folder, status/due, table + board)", () => {
    const { path, folder, content } = buildTaskDbFile("Aufgaben", LABELS);
    expect(path).toBe("Aufgaben.base");
    expect(folder).toBe("Aufgaben");

    // Round-trip through the real parser: the on-disk YAML must load back into
    // the exact structure the app (and Obsidian) expects.
    const cfg = parseBaseConfig(content);
    expect(cfg.filters).toEqual({ and: ['file.folder == "Aufgaben"'] });
    expect(cfg.columns.status).toMatchObject({ input: "status" });
    expect((cfg.columns.status.options ?? []).map((o: { value: string }) => o.value)).toEqual(["Offen", "In Arbeit", "Erledigt"]);
    expect(cfg.columns.frist).toMatchObject({ input: "date" });
    expect(cfg.views).toHaveLength(2);
    expect(cfg.views[0]).toMatchObject({ type: "table", name: "Tabelle" });
    expect(cfg.views[0].order).toEqual(["file.name", "status", "frist"]);
    expect(cfg.views[1]).toMatchObject({ type: "board", name: "Board", groupBy: "status" });
  });

  it("creates folder + .base and returns the path", async () => {
    const { adapter, files, dirs } = memoryAdapter();
    const path = await createTaskDatabase(adapter, "Aufgaben", LABELS);
    expect(path).toBe("Aufgaben.base");
    expect(dirs.has("Aufgaben")).toBe(true);
    expect(files.has("Aufgaben.base")).toBe(true);
  });

  it("adopts an existing database instead of overwriting it", async () => {
    const { adapter, files } = memoryAdapter();
    files.set("Aufgaben.base", "ORIGINAL");
    const path = await createTaskDatabase(adapter, "Aufgaben", LABELS);
    expect(path).toBe("Aufgaben.base");
    expect(files.get("Aufgaben.base")).toBe("ORIGINAL");
  });

  it("returns null for an unusable name without touching the vault", async () => {
    const { adapter, files, dirs } = memoryAdapter();
    expect(await createTaskDatabase(adapter, "  //  ", LABELS)).toBeNull();
    expect(files.size).toBe(0);
    expect(dirs.size).toBe(0);
  });
});
