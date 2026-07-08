import { describe, it, expect } from "vitest";
import { addRelationLink, removeRelationLinksToNote, type RelationWriteAdapter } from "./relations";

/** In-memory adapter + minimal query-service stub (renameNote.test.ts pattern). */
function makeVault(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  const adapter: RelationWriteAdapter = {
    readTextFile: async (p) => {
      const c = store.get(p);
      if (c === undefined) throw new Error(`missing ${p}`);
      return c;
    },
    writeTextFile: async (p, c) => {
      store.set(p, c);
    },
  };
  const queryService = {
    db: { query: async () => Array.from(store.keys()).map((path) => ({ path })) },
  } as any;
  return { store, adapter, queryService };
}

describe("addRelationLink", () => {
  it("creates a list value on an empty property (no limit)", async () => {
    const { store, adapter, queryService } = makeVault({
      "Aufgaben/A1.md": "---\nstatus: offen\n---\nText.\n",
      "Projekte/P1.md": "# P1\n",
    });
    const res = await addRelationLink({
      adapter,
      queryService,
      notePath: "Aufgaben/A1.md",
      propertyKey: "projekt",
      targetNotePath: "Projekte/P1.md",
    });
    expect(res.changed).toBe(true);
    const text = store.get("Aufgaben/A1.md")!;
    expect(text).toContain("projekt:");
    expect(text).toContain('"[[P1]]"');
    expect(text).toContain("status: offen");
    expect(text).toContain("Text.");
  });

  it("writes a scalar and replaces the previous value with limit one (steal semantics)", async () => {
    const { store, adapter, queryService } = makeVault({
      "Aufgaben/A1.md": '---\nprojekt: "[[Alt]]"\n---\n',
      "Projekte/Alt.md": "# Alt\n",
      "Projekte/Neu.md": "# Neu\n",
    });
    const res = await addRelationLink({
      adapter,
      queryService,
      notePath: "Aufgaben/A1.md",
      propertyKey: "projekt",
      targetNotePath: "Projekte/Neu.md",
      limit: "one",
    });
    expect(res.changed).toBe(true);
    const text = store.get("Aufgaben/A1.md")!;
    expect(text).toContain('projekt: "[[Neu]]"');
    expect(text).not.toContain("[[Alt]]");
  });

  it("appends to an existing list and promotes scalar legacy values", async () => {
    const { store, adapter, queryService } = makeVault({
      "Aufgaben/A1.md": '---\nrefs: "[[Eins]]"\n---\n',
      "Notizen/Eins.md": "x\n",
      "Notizen/Zwei.md": "x\n",
    });
    await addRelationLink({
      adapter,
      queryService,
      notePath: "Aufgaben/A1.md",
      propertyKey: "refs",
      targetNotePath: "Notizen/Zwei.md",
    });
    const text = store.get("Aufgaben/A1.md")!;
    expect(text).toContain('- "[[Eins]]"');
    expect(text).toContain('- "[[Zwei]]"');
  });

  it("is a no-op when a stored link already resolves to the target (any raw form)", async () => {
    const { store, adapter, queryService } = makeVault({
      "Aufgaben/A1.md": '---\nprojekt:\n  - "[[Projekte/P1#Intro|Anzeige]]"\n---\n',
      "Projekte/P1.md": "# P1\n",
    });
    const before = store.get("Aufgaben/A1.md");
    const res = await addRelationLink({
      adapter,
      queryService,
      notePath: "Aufgaben/A1.md",
      propertyKey: "projekt",
      targetNotePath: "Projekte/P1.md",
    });
    expect(res.changed).toBe(false);
    expect(store.get("Aufgaben/A1.md")).toBe(before);
  });

  it("qualifies the link text on basename collision", async () => {
    const { store, adapter, queryService } = makeVault({
      "Aufgaben/A1.md": "---\nx: 1\n---\n",
      "Projekte/Task.md": "x\n",
      "Archiv/Task.md": "x\n",
    });
    await addRelationLink({
      adapter,
      queryService,
      notePath: "Aufgaben/A1.md",
      propertyKey: "projekt",
      targetNotePath: "Projekte/Task.md",
    });
    expect(store.get("Aufgaben/A1.md")).toContain("[[Projekte/Task]]");
  });
});

describe("removeRelationLinksToNote", () => {
  it("removes every raw form resolving to the target and keeps others", async () => {
    const { store, adapter, queryService } = makeVault({
      "Aufgaben/A1.md":
        '---\nrefs:\n  - "[[P1]]"\n  - "[[Projekte/P1#Intro|Alias]]"\n  - "[[Bleibt]]"\n---\n',
      "Projekte/P1.md": "x\n",
      "Notizen/Bleibt.md": "x\n",
    });
    const res = await removeRelationLinksToNote({
      adapter,
      queryService,
      notePath: "Aufgaben/A1.md",
      propertyKey: "refs",
      targetNotePath: "Projekte/P1.md",
    });
    expect(res).toEqual({ changed: true, removed: 2 });
    const text = store.get("Aufgaben/A1.md")!;
    expect(text).toContain('- "[[Bleibt]]"');
    expect(text).not.toContain("P1");
  });

  it("deletes the key when the value empties", async () => {
    const { store, adapter, queryService } = makeVault({
      "Aufgaben/A1.md": '---\nprojekt: "[[P1]]"\nstatus: offen\n---\nBody.\n',
      "Projekte/P1.md": "x\n",
    });
    const res = await removeRelationLinksToNote({
      adapter,
      queryService,
      notePath: "Aufgaben/A1.md",
      propertyKey: "projekt",
      targetNotePath: "Projekte/P1.md",
    });
    expect(res).toEqual({ changed: true, removed: 1 });
    const text = store.get("Aufgaben/A1.md")!;
    expect(text).not.toContain("projekt");
    expect(text).toContain("status: offen");
    expect(text).toContain("Body.");
  });

  it("is a no-op when nothing resolves to the target or the key is missing", async () => {
    const { store, adapter, queryService } = makeVault({
      "Aufgaben/A1.md": '---\nprojekt: "[[Anderes]]"\n---\n',
      "Projekte/P1.md": "x\n",
      "Notizen/Anderes.md": "x\n",
    });
    const before = store.get("Aufgaben/A1.md");
    expect(
      await removeRelationLinksToNote({
        adapter,
        queryService,
        notePath: "Aufgaben/A1.md",
        propertyKey: "projekt",
        targetNotePath: "Projekte/P1.md",
      })
    ).toEqual({ changed: false, removed: 0 });
    expect(
      await removeRelationLinksToNote({
        adapter,
        queryService,
        notePath: "Aufgaben/A1.md",
        propertyKey: "fehlt",
        targetNotePath: "Projekte/P1.md",
      })
    ).toEqual({ changed: false, removed: 0 });
    expect(store.get("Aufgaben/A1.md")).toBe(before);
  });
});
