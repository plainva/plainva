import { describe, it, expect } from "vitest";
import { VaultQueryService } from "../src/vault/VaultQueryService.ts";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";

describe("VaultQueryService.listTasks", () => {
  it("flattens tasks across notes with path and title", async () => {
    const db = new MockDatabaseAdapter();
    db.mockedResults = [
      [
        { path: "a.md", title: "A", content: "- [ ] one\n- [x] two" },
        { path: "sub/b.md", title: null, content: "no tasks here" },
        { path: "c.md", title: "C", content: "- [ ] three #tag 📅 2026-08-01" },
      ],
    ];
    const tasks = await new VaultQueryService(db).listTasks();
    expect(tasks.map((t) => [t.path, t.title, t.ordinal, t.done, t.text])).toEqual([
      ["a.md", "A", 0, false, "one"],
      ["a.md", "A", 1, true, "two"],
      ["c.md", "C", 0, false, "three #tag 📅 2026-08-01"],
    ]);
    expect(tasks[2].tags).toEqual(["tag"]);
    expect(tasks[2].due).toBe("2026-08-01");
  });

  it("derives a title from the filename when the index has none", async () => {
    const db = new MockDatabaseAdapter();
    db.mockedResults = [[{ path: "notes/Todo.md", title: null, content: "- [ ] x" }]];
    const tasks = await new VaultQueryService(db).listTasks();
    expect(tasks[0].title).toBe("Todo");
  });

  it("marks a note excluded when its frontmatter carries plainva.tasks: false", async () => {
    const db = new MockDatabaseAdapter();
    db.mockedResults = [
      [
        { path: "Templates/Weekly.md", title: "Weekly", content: "---\nplainva:\n  tasks: false\n---\n- [ ] placeholder" },
        { path: "Real.md", title: "Real", content: "---\nplainva:\n  tasks: true\n---\n- [ ] do it" },
        { path: "Plain.md", title: "Plain", content: "- [ ] no frontmatter" },
      ],
    ];
    const tasks = await new VaultQueryService(db).listTasks();
    const excludedByPath = Object.fromEntries(tasks.map((t) => [t.path, t.excluded]));
    expect(excludedByPath["Templates/Weekly.md"]).toBe(true);
    expect(excludedByPath["Real.md"]).toBe(false);
    expect(excludedByPath["Plain.md"]).toBe(false);
  });
});
