import { describe, expect, it } from "vitest";
import {
  addTemplateForAssignment,
  applyTemplatePlaceholders,
  groupTemplatesForBase,
  listTemplatesScoped,
  parseTemplateForTargets,
  removeTemplateForAssignment,
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

describe("applyTemplatePlaceholders strips plainva.templateFor (leak guard)", () => {
  it("removes only templateFor; icon, other keys and the body survive byte-identically", () => {
    const raw =
      '---\ntype: Note\nstatus: Offen\nplainva:\n  icon: "🚀"\n  templateFor:\n    - "[[Tasks.base]]"\n---\n# {{title}}\n\nBody line\n';
    const out = applyTemplatePlaceholders(raw, "My Task", now);
    expect(out).not.toContain("templateFor");
    expect(out).toContain('icon: "🚀"');
    expect(out).toContain("status: Offen");
    expect(out).toContain("# My Task\n\nBody line\n");
  });

  it("removes an empty plainva namespace left behind by the strip", () => {
    const raw = '---\ntype: Note\nplainva:\n  templateFor: "[[Tasks.base]]"\n---\nBody\n';
    const out = applyTemplatePlaceholders(raw, "X", now);
    expect(out).not.toContain("templateFor");
    expect(out).not.toContain("plainva:");
  });

  it("still strips plainva.tasks (existing behavior kept)", () => {
    const raw = '---\nplainva:\n  tasks: false\n  templateFor: "[[Tasks.base]]"\n---\nBody\n';
    const out = applyTemplatePlaceholders(raw, "X", now);
    expect(out).not.toContain("tasks: false");
    expect(out).not.toContain("templateFor");
  });

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
