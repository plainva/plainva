import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The loader that cut the time off had no test at all — which is precisely why
 * it could keep doing it. The database column may be `datetime`, the note may
 * carry "12:00", and everything downstream saw a bare day.
 */

const store = { get: vi.fn() };
vi.mock("../settingsStore", () => ({ getSettingsStore: async () => store }));

import { loadTaskOverlay } from "./taskOverlay";

const BASE = JSON.stringify({
  filters: { and: ['file.folder == "Tasks"'] },
  properties: { "note.faellig": { plainva: { input: "datetime" } }, "note.erledigt": { plainva: { input: "checkbox" } } },
  views: [{ type: "table", name: "Alle" }],
});

function deps(rows: Record<string, unknown>[], base = BASE) {
  return {
    vaultPath: "/v",
    vaultAdapter: { readTextFile: async () => base },
    queryService: { queryDatabaseFiles: async () => rows },
  };
}

describe("loadTaskOverlay", () => {
  beforeEach(() => {
    store.get.mockReset();
    store.get.mockResolvedValue("Tasks.base");
  });

  it("keeps the time a datetime column carries", async () => {
    const out = await loadTaskOverlay(
      deps([{ "file.path": "Tasks/a.md", "file.name": "Entwurf an Anke schicken", faellig: "2026-08-09T12:00" }]),
    );
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0]).toMatchObject({ due: "2026-08-09", dueMinutes: 720 });
  });

  it("leaves a day-granular task without a time", async () => {
    const out = await loadTaskOverlay(deps([{ "file.path": "Tasks/b.md", "file.name": "Reisekosten", faellig: "2026-08-09" }]));
    expect(out.tasks[0].due).toBe("2026-08-09");
    expect(out.tasks[0].dueMinutes).toBeUndefined();
  });

  it("still drops a value that is not a date", async () => {
    const out = await loadTaskOverlay(deps([{ "file.path": "Tasks/c.md", "file.name": "Irgendwann", faellig: "bald" }]));
    expect(out.tasks).toHaveLength(0);
  });

  it("adds the checkboxes in notes with a due day for a calendar, after the database's entries", async () => {
    // TestFlight 136: the calendars read the task database alone.
    const notes = [
      { path: "Haushalt.md", title: "Haushalt", excluded: false, line: 2, ordinal: 0, done: false, state: "open" as const, tags: [], text: "Drucker einrichten 📅 2026-08-09", due: "2026-08-09" },
      { path: "Haushalt.md", title: "Haushalt", excluded: false, line: 3, ordinal: 1, done: false, state: "open" as const, tags: [], text: "Ohne Datum", due: null },
      { path: "Vorlage.md", title: "Vorlage", excluded: true, line: 4, ordinal: 0, done: false, state: "open" as const, tags: [], text: "Vorlage 📅 2026-08-09", due: "2026-08-09" },
    ];
    const base = deps([{ "file.path": "Tasks/b.md", "file.name": "Reisekosten", faellig: "2026-08-09" }]);
    const withNotes = { ...base, queryService: { ...base.queryService, listTasks: async () => notes } };
    const out = await loadTaskOverlay(withNotes, { notes: true });
    expect(out.tasks.map((t) => [t.source, t.title, t.due, t.id])).toEqual([
      ["database", "Reisekosten", "2026-08-09", "db:Tasks/b.md"],
      ["note", "Drucker einrichten", "2026-08-09", "note:Haushalt.md#0"],
    ]);
    expect(out.tasks[1].line).toEqual({ ordinal: 0, text: "Drucker einrichten 📅 2026-08-09" });
    // The reminders ask for the database alone (decision E3, 2026-09-01).
    expect((await loadTaskOverlay(withNotes)).tasks.map((t) => t.source)).toEqual(["database"]);
    // Without a task database the checkboxes are still a calendar's.
    store.get.mockResolvedValue(null);
    expect((await loadTaskOverlay(withNotes, { notes: true })).tasks.map((t) => t.title)).toEqual(["Drucker einrichten"]);
  });

  it("says nothing at all without a task database", async () => {
    store.get.mockResolvedValue(null);
    const out = await loadTaskOverlay(deps([{ "file.path": "Tasks/a.md", faellig: "2026-08-09T12:00" }]));
    expect(out).toEqual({ tasks: [], completion: null, dueKey: null });
  });
});
