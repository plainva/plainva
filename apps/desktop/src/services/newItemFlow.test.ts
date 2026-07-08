import { describe, it, expect, vi } from "vitest";
import { parse as parseYaml } from "yaml";

const storeValues: Record<string, unknown> = {};
vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({ get: async (key: string) => storeValues[key] }));
  return { Store: { load }, load };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true), open: vi.fn() }));

import {
  applyTemplatePlaceholders,
  baseStemOf,
  buildNewItemContent,
  collectPrefillValues,
  listTemplates,
  nextItemName,
  relationPrefill,
} from "./newItemFlow";

function frontmatterOf(content: string): Record<string, any> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("no frontmatter");
  return parseYaml(match[1]) as Record<string, any>;
}

describe("baseStemOf", () => {
  it("returns the file stem of a .base path", () => {
    expect(baseStemOf("DB/Projekte.base")).toBe("Projekte");
    expect(baseStemOf("Projekte.base")).toBe("Projekte");
  });
});

describe("listTemplates", () => {
  const adapter = (files: string[]) => ({
    exists: async () => true,
    listDir: async () => files.map((path) => ({ path, isDirectory: false })),
  });

  it("lists .md templates by title but never the OKF reserved index.md/log.md", async () => {
    const items = await listTemplates(
      adapter(["Templates/Meeting.md", "Templates/index.md", "Templates/Log.MD", "Templates/Weekly.md", "Templates/cover.png"]),
      "Templates"
    );
    expect(items.map((i) => i.title)).toEqual(["Meeting", "Weekly"]);
  });

  it("returns nothing when the template folder is absent", async () => {
    const items = await listTemplates({ exists: async () => false, listDir: async () => [] }, "Templates");
    expect(items).toEqual([]);
  });
});

describe("nextItemName", () => {
  it('names "{stem}_{count+1}" when free', async () => {
    expect(await nextItemName("Projekte", 12, async () => false)).toBe("Projekte_13");
  });

  it("counts past collisions", async () => {
    const taken = new Set(["Projekte_13", "Projekte_14"]);
    expect(await nextItemName("Projekte", 12, async (n) => taken.has(n))).toBe("Projekte_15");
  });

  it("starts at 1 for an empty base", async () => {
    expect(await nextItemName("Projekte", 0, async () => false)).toBe("Projekte_1");
  });

  it("replaces whitespace in the stem with underscores (never spaces in created names)", async () => {
    expect(await nextItemName("Meine Projekte", 2, async () => false)).toBe("Meine_Projekte_3");
    expect(await nextItemName("A  B\tC", 0, async () => false)).toBe("A_B_C_1");
  });
});

describe("applyTemplatePlaceholders", () => {
  it("interpolates date, time and title", () => {
    const now = new Date(2026, 6, 3, 9, 5);
    const out = applyTemplatePlaceholders("# {{title}}\n{{date}} {{time}} {{date}}", "Projekte_13", now);
    expect(out).toBe("# Projekte_13\n2026-07-03 09:05 2026-07-03");
  });
});

describe("collectPrefillValues", () => {
  const getInput = (col: string) =>
    (({ status: "select", prio: "number", done: "checkbox", themen: "multiselect", kunde: "relation" }) as Record<string, string | undefined>)[col];

  it("collects typed values from simple == AND-rules", () => {
    const config = {
      filters: {
        and: [
          'file.folder == "Projekte"',
          'status == "offen"',
          'prio == "2"',
          'done == "true"',
          'contains(themen, "intern")',
        ],
      },
    };
    expect(collectPrefillValues(config, getInput)).toEqual({
      status: "offen",
      prio: 2,
      done: true,
      themen: ["intern"],
    });
  });

  it("skips relation columns, or-rules, groups and non-== operators", () => {
    const config = {
      filters: {
        and: ['contains(kunde, "[[ACME]]")', 'status != "fertig"', { or: ['status == "x"'] }],
        or: ['status == "offen"'],
      },
    };
    expect(collectPrefillValues(config, getInput)).toEqual({});
  });
});

describe("buildNewItemContent", () => {
  it("builds OKF frontmatter with tags and pre-fills without a template", () => {
    const content = buildNewItemContent({
      templateText: null,
      noteType: "Note",
      title: "Projekte_13",
      inheritTags: ["projekt"],
      prefills: { status: "offen" },
    });
    const fm = frontmatterOf(content);
    expect(fm.type).toBe("Note");
    expect(fm.tags).toEqual(["projekt"]);
    expect(fm.status).toBe("offen");
    // Template-less items start with an H1 of the title (maintainer, 2026-07-04).
    expect(content).toContain("# Projekte_13");
  });

  it("does not inject an H1 when a template defines the body", () => {
    const content = buildNewItemContent({
      templateText: "Body ohne Überschrift\n",
      noteType: "Note",
      title: "Projekte_13",
      inheritTags: [],
      prefills: {},
    });
    expect(content).not.toContain("# Projekte_13");
  });

  it("lets template frontmatter win over OKF type and pre-fills, merging tags", () => {
    const content = buildNewItemContent({
      templateText: '---\ntype: Projekt\nstatus: "entwurf"\ntags: [vorlage]\n---\n\n# {{title}}\n',
      noteType: "Note",
      title: "Projekte_13",
      inheritTags: ["projekt"],
      prefills: { status: "offen", prio: 1 },
    });
    const fm = frontmatterOf(content);
    expect(fm.type).toBe("Projekt");
    expect(fm.status).toBe("entwurf"); // template wins
    expect(fm.prio).toBe(1); // missing key pre-filled
    expect(fm.tags).toEqual(["vorlage", "projekt"]); // merged, no duplicate
    expect(content).toContain("# Projekte_13");
  });

  it("does not duplicate an already present tag", () => {
    const content = buildNewItemContent({
      templateText: "---\ntags: [projekt]\n---\n",
      noteType: "Note",
      title: "X",
      inheritTags: ["projekt"],
      prefills: {},
    });
    expect(frontmatterOf(content).tags).toEqual(["projekt"]);
  });
});

describe("relationPrefill (embed auto-link)", () => {
  const allPaths = ["Projects/Web.md", "Tasks/T1.md"];

  it("links a new item to the host with a scalar for a limit-one relation", () => {
    expect(relationPrefill("Projects/Web.md", allPaths, { column: "project", limitOne: true })).toEqual({
      project: "[[Web]]",
    });
  });

  it("uses a single-item list for an unlimited relation", () => {
    expect(relationPrefill("Projects/Web.md", allPaths, { column: "project", limitOne: false })).toEqual({
      project: ["[[Web]]"],
    });
  });

  it("path-qualifies the link when the basename collides", () => {
    const out = relationPrefill("Projects/Web.md", ["Projects/Web.md", "Archive/Web.md"], {
      column: "project",
      limitOne: true,
    });
    expect(out.project).not.toBe("[[Web]]");
    expect(String(out.project)).toContain("Web");
  });
});
