import { describe, expect, it } from "vitest";
import { VaultFileNotFoundError } from "@plainva/core";
import {
  addTemplateForAssignment,
  applyTemplatePlaceholders,
  groupTemplatesForBase,
  listTemplatesScoped,
  parseTemplateForTargets,
  removeTemplateForAssignment,
  retargetTemplateForInFolder,
  retargetTemplateForMoves,
  templateAsNewNote,
  templateMatchesBase,
  type ScopedTemplateItem,
  type ScopedTemplateListAdapter,
} from "@plainva/ui";

const now = new Date(2026, 6, 16, 9, 30);

describe("parseTemplateForTargets (plainva.templateFor contract)", () => {
  it("reads a list of wiki links and strips alias/anchor", () => {
    const raw = '---\ntype: Note\nplainva:\n  templateFor:\n    - "[[Tasks.base]]"\n    - "[[Projects/Meetings.base#sec|My alias]]"\n---\nBody\n';
    expect(parseTemplateForTargets(raw)).toEqual(["Tasks.base", "Projects/Meetings.base"]);
  });

  it("tolerates a scalar value and bare strings", () => {
    expect(parseTemplateForTargets('---\nplainva:\n  templateFor: "[[Tasks.base]]"\n---\n')).toEqual(["Tasks.base"]);
    expect(parseTemplateForTargets("---\nplainva:\n  templateFor: Tasks.base\n---\n")).toEqual(["Tasks.base"]);
  });

  it("returns [] without frontmatter, namespace or key", () => {
    expect(parseTemplateForTargets("# Just a body")).toEqual([]);
    expect(parseTemplateForTargets("---\ntype: Note\n---\n")).toEqual([]);
    expect(parseTemplateForTargets('---\nplainva:\n  icon: "🚀"\n---\n')).toEqual([]);
  });

  it("returns [] for malformed YAML and non-string entries", () => {
    expect(parseTemplateForTargets("---\nplainva: [unclosed\n---\n")).toEqual([]);
    expect(parseTemplateForTargets("---\nplainva:\n  templateFor:\n    - 42\n    - {}\n---\n")).toEqual([]);
  });
});

describe("templateMatchesBase", () => {
  it("matches a bare file name regardless of the base's folder (folder-move safe)", () => {
    expect(templateMatchesBase(["Tasks.base"], "Projects/Tasks.base")).toBe(true);
    expect(templateMatchesBase(["Tasks.base"], "Tasks.base")).toBe(true);
  });

  it("matches a qualified path exactly and only exactly", () => {
    expect(templateMatchesBase(["Projects/Tasks.base"], "Projects/Tasks.base")).toBe(true);
    expect(templateMatchesBase(["Other/Tasks.base"], "Projects/Tasks.base")).toBe(false);
  });

  it("is case-insensitive, slash-tolerant and unicode-form-tolerant", () => {
    expect(templateMatchesBase(["projects\\tasks.BASE"], "Projects/Tasks.base")).toBe(true);
    const nfd = "Café.base";
    const nfc = "Café.base";
    expect(templateMatchesBase([nfd], `Ordner/${nfc}`)).toBe(true);
  });

  it("does not match without targets or without the extension", () => {
    expect(templateMatchesBase([], "Projects/Tasks.base")).toBe(false);
    expect(templateMatchesBase(["Tasks"], "Projects/Tasks.base")).toBe(false);
  });
});

describe("groupTemplatesForBase (decisions E2 + D1)", () => {
  const tpl = (path: string, templateFor: string[]): ScopedTemplateItem => ({
    path,
    title: path.split("/").pop()!.replace(/\.md$/i, ""),
    templateFor,
  });

  it("puts assigned templates into forBase, everything else behind 'show all'", () => {
    const items = [
      tpl("Templates/Task.md", ["Tasks.base"]),
      tpl("Templates/Generic.md", []),
      tpl("Templates/Meeting.md", ["Meetings.base"]),
    ];
    const groups = groupTemplatesForBase(items, "Projects/Tasks.base", null);
    expect(groups.forBase.map((t) => t.path)).toEqual(["Templates/Task.md"]);
    expect(groups.others.map((t) => t.path)).toEqual(["Templates/Generic.md", "Templates/Meeting.md"]);
  });

  it("always keeps the base's default template visible (D1), without duplicating it", () => {
    const items = [tpl("Templates/Generic.md", []), tpl("Templates/Task.md", ["Tasks.base"])];
    const groups = groupTemplatesForBase(items, "Projects/Tasks.base", "Templates/Generic.md");
    expect(groups.forBase.map((t) => t.path)).toEqual(["Templates/Generic.md", "Templates/Task.md"]);
    expect(groups.others).toEqual([]);
    expect(groups.forBase.length + groups.others.length).toBe(items.length);
  });
});

// The guard stood against `applyTemplatePlaceholders`, which took the key out
// itself — for the notes nobody is asked about, the only ones it fills. The
// builder of the note takes it out now, for every note (finding 2026-10-11:
// an item a person made on the phone, and a pinboard entry on both shells,
// kept their template's assignment). The same templates, through the way a
// database item without questions is built.
describe("a note made from a template does not carry plainva.templateFor (leak guard)", () => {
  const noteFrom = (raw: string, title: string) => templateAsNewNote({ text: applyTemplatePlaceholders(raw, title, now), cursor: null }, "Note").content;

  it("removes only templateFor; icon, other keys and the body survive byte-identically", () => {
    const raw =
      '---\ntype: Note\nstatus: Offen\nplainva:\n  icon: "🚀"\n  templateFor:\n    - "[[Tasks.base]]"\n---\n# {{title}}\n\nBody line\n';
    const out = noteFrom(raw, "My Task");
    expect(out).not.toContain("templateFor");
    expect(out).toContain('icon: "🚀"');
    expect(out).toContain("status: Offen");
    expect(out).toContain("# My Task\n\nBody line\n");
  });

  it("removes an empty plainva namespace left behind by the strip", () => {
    const raw = '---\ntype: Note\nplainva:\n  templateFor: "[[Tasks.base]]"\n---\nBody\n';
    const out = noteFrom(raw, "X");
    expect(out).not.toContain("templateFor");
    expect(out).not.toContain("plainva:");
  });

  it("still strips plainva.tasks (existing behavior kept)", () => {
    const raw = '---\nplainva:\n  tasks: false\n  templateFor: "[[Tasks.base]]"\n---\nBody\n';
    const out = noteFrom(raw, "X");
    expect(out).not.toContain("tasks: false");
    expect(out).not.toContain("templateFor");
  });

});

describe("applyTemplatePlaceholders", () => {
  it("leaves templates without frontmatter or with malformed frontmatter as-is", () => {
    expect(applyTemplatePlaceholders("Hello {{title}}", "World", now)).toBe("Hello World");
    const malformed = "---\nplainva: [unclosed\n---\nBody {{title}}\n";
    expect(applyTemplatePlaceholders(malformed, "X", now)).toBe("---\nplainva: [unclosed\n---\nBody X\n");
  });
});

describe("add/removeTemplateForAssignment (quick-assign + target-databases dialog)", () => {
  const files = ["db/Tasks.base", "Other/Tasks.base", "Meetings.base", "Note.md"];

  it("appends a collision-safe link and keeps existing entries verbatim", () => {
    const raw = '---\nplainva:\n  templateFor:\n    - "[[Meetings.base]]"\n---\nBody\n';
    const res = addTemplateForAssignment(raw, "db/Tasks.base", files);
    expect(res.changed).toBe(true);
    // Two same-named Tasks.base exist in the vault → the link is qualified.
    expect(parseTemplateForTargets(res.content)).toEqual(["Meetings.base", "db/Tasks.base"]);
  });

  it("is a no-op when an entry already matches (bare form covers any folder)", () => {
    const bare = '---\nplainva:\n  templateFor: "[[Tasks.base]]"\n---\n';
    expect(addTemplateForAssignment(bare, "db/Tasks.base", files).changed).toBe(false);
  });

  it("creates the namespace on an unassigned template", () => {
    const res = addTemplateForAssignment("# Body\n", "Meetings.base", files);
    expect(res.changed).toBe(true);
    expect(parseTemplateForTargets(res.content)).toEqual(["Meetings.base"]);
  });

  it.each([
    ["a YAML list", "---\n- a\n- list\n---\n# {{title}}\n", /^Frontmatter is not a YAML map/],
    ["YAML that cannot be parsed", "---\ntitle: [unclosed\n---\n# {{title}}\n", /^Frontmatter is not parseable YAML/],
  ])("does not pass a template it cannot write off as assigned already: %s", (_label, raw, reason) => {
    // "Nothing changed" is the answer for a template that IS assigned. A block
    // the writer refuses used to get the same answer (finding 2026-10-12), and
    // the menu that asked said nothing.
    expect(() => addTemplateForAssignment(raw, "Meetings.base", files)).toThrow(reason);
    // Removing finds nothing to remove there, and says so.
    expect(removeTemplateForAssignment(raw, "Meetings.base")).toEqual({ content: raw, changed: false });
  });

  it("removes matching entries and deletes an emptied plainva namespace", () => {
    const raw = '---\ntype: Note\nplainva:\n  templateFor:\n    - "[[Meetings.base]]"\n---\nBody\n';
    const res = removeTemplateForAssignment(raw, "Meetings.base");
    expect(res.changed).toBe(true);
    expect(res.content).not.toContain("plainva");
    expect(res.content).toContain("type: Note");
  });

  it("keeps entries for other bases and reports no change when nothing matches", () => {
    const raw = '---\nplainva:\n  templateFor:\n    - "[[Meetings.base]]"\n    - "[[Tasks.base]]"\n---\n';
    const res = removeTemplateForAssignment(raw, "Meetings.base");
    expect(parseTemplateForTargets(res.content)).toEqual(["Tasks.base"]);
    expect(removeTemplateForAssignment(raw, "Unrelated.base").changed).toBe(false);
  });
});

describe("listTemplatesScoped", () => {
  const files: Record<string, string> = {
    "Templates/Task.md": '---\nplainva:\n  templateFor: "[[Tasks.base]]"\n---\n# {{title}}\n',
    "Templates/Generic.md": "# {{title}}\n",
    "Templates/Broken.md": "irrelevant — read throws",
    "Templates/index.md": "reserved, never listed",
  };
  const adapter: ScopedTemplateListAdapter = {
    exists: async () => true,
    listDir: async () =>
      Object.keys(files).map((path) => ({ path, isDirectory: false })),
    readTextFile: async (path: string) => {
      if (path.endsWith("Broken.md")) throw new Error("io");
      return files[path];
    },
  };

  it("attaches each template's scope; unreadable files count as unscoped", async () => {
    const items = await listTemplatesScoped(adapter, "Templates");
    expect(items.map((i) => i.path)).toEqual([
      "Templates/Broken.md",
      "Templates/Generic.md",
      "Templates/Task.md",
    ]);
    expect(items.find((i) => i.path.endsWith("Task.md"))!.templateFor).toEqual(["Tasks.base"]);
    expect(items.find((i) => i.path.endsWith("Generic.md"))!.templateFor).toEqual([]);
    expect(items.find((i) => i.path.endsWith("Broken.md"))!.templateFor).toEqual([]);
  });
});

describe("retargetTemplateForInFolder (a database renamed)", () => {
  // The sweep is the only carrier of plainva.templateFor across a rename. It
  // skipped every template it could not write without a trace (finding
  // 2026-10-12): the template went on naming a file that no longer exists,
  // and the rename reported every link as updated.
  const TASK = '---\nplainva:\n  templateFor: "[[Tasks.base]]"\n---\n# {{title}}\n';
  const LOCKED = '---\nplainva:\n  templateFor:\n    - "[[Tasks.base]]"\n---\n# {{title}}\n';
  const OTHER = '---\nplainva:\n  templateFor: "[[Notes.base]]"\n---\n# {{title}}\n';

  function folder(files: Record<string, string>, opts: { refused?: string[]; gone?: string[]; held?: string[] } = {}) {
    const store = new Map(Object.entries(files));
    const adapter = {
      exists: async () => true,
      listDir: async () => [...store.keys(), ...(opts.gone ?? [])].map((path) => ({ path, isDirectory: false })),
      readTextFile: async (path: string) => {
        if (opts.held?.includes(path)) throw new Error("The process cannot access the file because it is being used by another process. (os error 32)");
        const text = store.get(path);
        // What the vault's adapters throw for a file that is not there.
        if (text === undefined) throw new VaultFileNotFoundError(path);
        return text;
      },
      writeTextFile: async (path: string, text: string) => {
        if (opts.refused?.includes(path)) throw new Error("Operation not permitted (os error 1)");
        store.set(path, text);
      },
    };
    return { store, adapter };
  }

  const rename = (adapter: ReturnType<typeof folder>["adapter"]) =>
    retargetTemplateForInFolder({ adapter, folder: "Templates", oldBasePath: "Tasks.base", newBasePath: "Work.base", allFilePaths: ["Tasks.base", "Notes.base"] });

  it("lists a template it could not write in failed — it still names the old file", async () => {
    const { store, adapter } = folder(
      { "Templates/Task.md": TASK, "Templates/Locked.md": LOCKED, "Templates/Other.md": OTHER },
      { refused: ["Templates/Locked.md"] },
    );
    const result = await rename(adapter);
    expect(result).toEqual({ changedPaths: ["Templates/Task.md"], renamed: 1, failed: ["Templates/Locked.md"] });
    expect(parseTemplateForTargets(store.get("Templates/Task.md")!)).toEqual(["Work.base"]);
    expect(store.get("Templates/Locked.md")).toBe(LOCKED);
    expect(store.get("Templates/Other.md")).toBe(OTHER);
  });

  it("skips a template that is gone since it was listed: it names no database any more", async () => {
    const { adapter } = folder({ "Templates/Task.md": TASK }, { gone: ["Templates/Gone.md"] });
    expect(await rename(adapter)).toEqual({ changedPaths: ["Templates/Task.md"], renamed: 1, failed: [] });
  });

  it("lists a template that is there and cannot be read: it may still name the old file", async () => {
    const { store, adapter } = folder({ "Templates/Task.md": TASK, "Templates/Locked.md": LOCKED }, { held: ["Templates/Locked.md"] });
    expect(await rename(adapter)).toEqual({ changedPaths: ["Templates/Task.md"], renamed: 1, failed: ["Templates/Locked.md"] });
    expect(store.get("Templates/Locked.md")).toBe(LOCKED);
  });
});

describe("retargetTemplateForMoves (a database moved, or its folder) — 3.71 no. 4", () => {
  // Only the in-folder rename of the desktop carried the assignments: a move
  // (a file dragged into another folder, a folder renamed or moved, on either
  // shell) left a qualified entry naming a file that was no longer there.
  const QUALIFIED = '---\nplainva:\n  templateFor: "[[Projects/Tasks.base]]"\n---\n# {{title}}\n';
  const BARE = '---\nplainva:\n  templateFor: "[[Tasks.base]]"\n---\n# {{title}}\n';
  function folder(files: Record<string, string>) {
    const store = new Map(Object.entries(files));
    const adapter = {
      exists: async () => true,
      listDir: async () => [...store.keys()].map((path) => ({ path, isDirectory: false })),
      readTextFile: async (path: string) => store.get(path)!,
      writeTextFile: async (path: string, text: string) => { store.set(path, text); },
    };
    return { store, adapter };
  }
  const all = ["Projects/Tasks.base", "Notes.base"];

  it("a database moved to another folder: the qualified entry follows, the bare one still finds it", async () => {
    const { store, adapter } = folder({ "Templates/Q.md": QUALIFIED, "Templates/B.md": BARE });
    const result = await retargetTemplateForMoves({ adapter, folder: "Templates", moves: [{ from: "Projects/Tasks.base", to: "Archive/Tasks.base" }], allFilePaths: all });
    expect(result).toEqual({ changedPaths: ["Templates/Q.md"], renamed: 1, failed: [] });
    expect(parseTemplateForTargets(store.get("Templates/Q.md")!)).toEqual(["Archive/Tasks.base"]);
    expect(store.get("Templates/B.md")).toBe(BARE);
  });

  it("a folder renamed or moved carries the databases under it", async () => {
    const { store, adapter } = folder({ "Templates/Q.md": QUALIFIED });
    const result = await retargetTemplateForMoves({ adapter, folder: "Templates", moves: [{ from: "Projects", to: "Areas/Work" }], allFilePaths: all });
    expect(result.renamed).toBe(1);
    expect(parseTemplateForTargets(store.get("Templates/Q.md")!)).toEqual(["Areas/Work/Tasks.base"]);
  });

  it("renamed and moved at once: the bare entry takes the new name", async () => {
    const { store, adapter } = folder({ "Templates/B.md": BARE });
    await retargetTemplateForMoves({ adapter, folder: "Templates", moves: [{ from: "Projects/Tasks.base", to: "Archive/Work.base" }], allFilePaths: all });
    expect(parseTemplateForTargets(store.get("Templates/B.md")!)).toEqual(["Work.base"]);
  });

  it("finds the templates where they are now when the template folder moved along", async () => {
    const { store, adapter } = folder({ "Work/Templates/Q.md": '---\nplainva:\n  templateFor: "[[Work/Tasks.base]]"\n---\n' });
    await retargetTemplateForMoves({ adapter, folder: "Work/Templates", moves: [{ from: "Work", to: "Done/Work" }], allFilePaths: ["Work/Tasks.base", "Work/Templates/Q.md"] });
    expect(parseTemplateForTargets(store.get("Work/Templates/Q.md")!)).toEqual(["Done/Work/Tasks.base"]);
  });
});
