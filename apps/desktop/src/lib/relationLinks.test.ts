import { describe, it, expect } from "vitest";
import { wholeIndexReader } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { addRelationLink, editReverseRelation, removeRelationLinksToNote, sayReverseRelationOutcome, type RelationWriteAdapter } from "@plainva/ui";

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
  const queryService = wholeIndexReader({
    db: { query: async () => Array.from(store.keys()).map((path) => ({ path })) },
    // The link rule's corpus, as the index holds it: a note's title is its file's name.
    linkTargets: async () => Array.from(store.keys()).map((path) => ({ path, title: path.split("/").pop()!.replace(/\.md$/, ""), mode: "obsidian" })),
  } as any);
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

/**
 * What the note holds is read from the note (finding 2026-10-12).
 *
 * The values a link is added to came from the reader of the index, whose
 * schema rejected a proper YAML map with a value it did not take — an empty
 * `tags:`, a year among the tags (until 2026-10-22, ADR 0009). "Could not be
 * read" then passed for "holds no link", and adding one link replaced the
 * list that was there.
 */
describe("addRelationLink: a note the index's reader did not take", () => {
  const EMPTY_TAGS = '---\ntags:\nrefs:\n  - "[[Eins]]"\n  - "[[Zwei]]"\n---\nText.\n';

  it("keeps the links the note holds when one is added", async () => {
    const { store, adapter, queryService } = makeVault({
      "Aufgaben/A1.md": EMPTY_TAGS,
      "Notizen/Eins.md": "x\n",
      "Notizen/Zwei.md": "x\n",
      "Notizen/Drei.md": "x\n",
    });
    const res = await addRelationLink({ adapter, queryService, notePath: "Aufgaben/A1.md", propertyKey: "refs", targetNotePath: "Notizen/Drei.md" });
    expect(res.changed).toBe(true);
    expect(store.get("Aufgaben/A1.md")).toBe('---\ntags:\nrefs:\n  - "[[Eins]]"\n  - "[[Zwei]]"\n  - "[[Drei]]"\n---\nText.\n');
  });

  it("writes nothing where such a note already links the target", async () => {
    const { store, adapter, queryService } = makeVault({
      "Aufgaben/A1.md": EMPTY_TAGS,
      "Notizen/Eins.md": "x\n",
      "Notizen/Zwei.md": "x\n",
    });
    const res = await addRelationLink({ adapter, queryService, notePath: "Aufgaben/A1.md", propertyKey: "refs", targetNotePath: "Notizen/Zwei.md" });
    expect(res.changed).toBe(false);
    expect(store.get("Aufgaben/A1.md")).toBe(EMPTY_TAGS);
  });

  it.each([
    ["a YAML list", "---\n- a\n- list\n---\nText.\n", /^Frontmatter is not a YAML map/],
    ["YAML that cannot be parsed", "---\ntitle: [unclosed\nrefs: x\n---\nText.\n", /^Frontmatter is not parseable YAML/],
  ])("refuses %s and leaves the note byte for byte", async (_label, note, reason) => {
    const { store, adapter, queryService } = makeVault({ "Aufgaben/A1.md": note, "Notizen/Drei.md": "x\n" });
    await expect(
      addRelationLink({ adapter, queryService, notePath: "Aufgaben/A1.md", propertyKey: "refs", targetNotePath: "Notizen/Drei.md" })
    ).rejects.toThrow(reason);
    expect(store.get("Aufgaben/A1.md")).toBe(note);
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

  it("removes the link from a note the index's reader did not take", async () => {
    // An empty `tags:` — a proper YAML map the reader's schema rejected until
    // 2026-10-22. Read through that reader the note held no property at all,
    // and a link to a note that was being deleted stayed in it without a word
    // (finding 2026-10-12).
    const note = '---\ntags:\nrefs:\n  - "[[P1]]"\n  - "[[Bleibt]]"\n---\nBody.\n';
    const { store, adapter, queryService } = makeVault({ "Aufgaben/A1.md": note, "Projekte/P1.md": "x\n", "Notizen/Bleibt.md": "x\n" });
    const res = await removeRelationLinksToNote({ adapter, queryService, notePath: "Aufgaben/A1.md", propertyKey: "refs", targetNotePath: "Projekte/P1.md" });
    expect(res).toEqual({ changed: true, removed: 1 });
    expect(store.get("Aufgaben/A1.md")).toBe('---\ntags:\nrefs:\n  - "[[Bleibt]]"\n---\nBody.\n');
  });

  it("finds nothing to remove in a block that is no YAML map, and leaves the note alone", async () => {
    const note = "---\n- a\n- list\n---\nBody.\n";
    const { store, adapter, queryService } = makeVault({ "Aufgaben/A1.md": note, "Projekte/P1.md": "x\n" });
    const res = await removeRelationLinksToNote({ adapter, queryService, notePath: "Aufgaben/A1.md", propertyKey: "refs", targetNotePath: "Projekte/P1.md" });
    expect(res).toEqual({ changed: false, removed: 0 });
    expect(store.get("Aufgaben/A1.md")).toBe(note);
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


/**
 * The cell of a reverse relation (Sammelplan § 3.71 no. 3): both shells edit
 * it through `editReverseRelation`, which writes the OTHER notes' owning
 * property — one write per note, a failure counted and the cell left showing
 * what that note holds.
 */
describe("editReverseRelation", () => {
  function setup(files: Record<string, string>) {
    const v = makeVault(files);
    const failing = new Set<string>();
    const write = v.adapter.writeTextFile;
    v.adapter.writeTextFile = async (p, c) => {
      if (failing.has(p)) throw new Error("disk full");
      await write(p, c);
    };
    // The link rule, as the index answers it: a note by its file's name.
    v.queryService.resolveNotePath = async (target: string) =>
      Array.from(v.store.keys()).find((p) => p.split("/").pop()!.replace(/\.md$/, "").toLowerCase() === target.toLowerCase()) ?? null;
    return { ...v, failing };
  }
  const projects = "properties:\n  note.kunde:\n    plainva:\n      input: relation\n      relationLimit: one\n";

  it("adds the link in the other note's owning property, under its cardinality", async () => {
    const { store, adapter, queryService } = setup({
      "Cockpit.base": projects,
      "Kunden/Globex.md": "# Globex\n",
      "Projekte/Alpha.md": '---\nkunde: "[[ACME]]"\n---\n# Alpha\n',
      "Kunden/ACME.md": "# ACME\n",
    });
    const outcome = await editReverseRelation({
      adapter, queryService, rowPath: "Kunden/Globex.md", owning: { base: "Cockpit.base", property: "kunde" },
      current: [], next: ["[[Alpha]]"],
    });
    expect(outcome.failures).toBe(0);
    expect(outcome.owningLimit).toBe("one");
    expect([...outcome.changed]).toEqual([["Projekte/Alpha.md", "added"]]);
    expect(outcome.shown).toEqual(["[[Alpha]]"]);
    // "One" replaces the link the note had; the row's own note is untouched.
    expect(store.get("Projekte/Alpha.md")).toMatch(/^---\nkunde: "?\[\[Globex\]\]"?\n---\n# Alpha\n$/);
    expect(store.get("Kunden/Globex.md")).toBe("# Globex\n");
  });

  it("takes the link out where it lives, and never links the row to itself", async () => {
    const { store, adapter, queryService } = setup({
      "Kunden/Globex.md": "---\nparent: x\n---\n# Globex\n",
      "Projekte/Alpha.md": '---\nstatus: open\nkunde:\n  - "[[Globex]]"\n  - "[[ACME]]"\n---\n',
      "Kunden/ACME.md": "# ACME\n",
    });
    const outcome = await editReverseRelation({
      adapter, queryService, rowPath: "Kunden/Globex.md", owning: { property: "kunde" },
      current: ["[[Alpha]]"], next: ["[[Globex]]"],
    });
    expect([...outcome.changed]).toEqual([["Projekte/Alpha.md", "removed"]]);
    expect(store.get("Projekte/Alpha.md")).not.toContain("Globex");
    expect(store.get("Projekte/Alpha.md")).toContain("ACME");
    expect(store.get("Kunden/Globex.md")).toBe("---\nparent: x\n---\n# Globex\n");
  });

  it("goes on past a note that refuses, and the cell shows what the notes hold", async () => {
    const { store, adapter, queryService, failing } = setup({
      "Kunden/Globex.md": "# Globex\n",
      "Projekte/Alpha.md": "# Alpha\n",
      "Projekte/Beta.md": "# Beta\n",
      "Projekte/Gamma.md": '---\nkunde: "[[Globex]]"\n---\n',
    });
    failing.add("Projekte/Alpha.md");
    failing.add("Projekte/Gamma.md");
    const outcome = await editReverseRelation({
      adapter, queryService, rowPath: "Kunden/Globex.md", owning: { property: "kunde" },
      current: ["[[Gamma]]"], next: ["[[Alpha]]", "[[Beta]]"],
    });
    expect(outcome.failures).toBe(2);
    expect((outcome.firstFailure as Error).message).toBe("disk full");
    expect([...outcome.changed]).toEqual([["Projekte/Beta.md", "added"]]);
    // Alpha could not be given the link, Gamma could not be relieved of it.
    expect(outcome.shown).toEqual(["[[Beta]]", "[[Gamma]]"]);
    expect(store.get("Projekte/Beta.md")).toMatch(/kunde:/);

    const said: string[] = [];
    sayReverseRelationOutcome(outcome, { error: (m) => said.push(m) });
    expect(said).toEqual([i18n.t("database.bulkSetPartial", { done: 1, failed: 2 })]);
  });

  it("changes nothing where the cell did not change", async () => {
    const { store, adapter, queryService } = setup({ "Kunden/Globex.md": "# Globex\n", "Projekte/Alpha.md": "# Alpha\n" });
    const outcome = await editReverseRelation({
      adapter, queryService, rowPath: "Kunden/Globex.md", owning: { property: "kunde" },
      current: ["[[Alpha]]"], next: ["[[alpha]]"],
    });
    expect(outcome.changed.size).toBe(0);
    expect(store.get("Projekte/Alpha.md")).toBe("# Alpha\n");
    const said: string[] = [];
    sayReverseRelationOutcome(outcome, { error: (m) => said.push(m) });
    expect(said).toEqual([]);
  });
});
