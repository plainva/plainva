// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";

/**
 * What a note takes over from its template, on the phone's database: a
 * pinboard entry and an item made with "+ Entry" (finding 2026-10-11).
 *
 * A template carries keys that are meant for itself alone: `plainva.tasks:
 * false` keeps its checkboxes out of the Tasks view — every template the app
 * creates has it —, `plainva.templateFor` says which databases offer it, and
 * a legacy one still carries `okf_version`. A note that was made with the
 * template's questions asked kept all three, on the phone on every way there
 * is: its tasks counted as hidden and were missing from the task list.
 *
 * Both ways run with the phone's real pipeline and the real builders behind
 * them; only the vault, the settings and the sheet are not the phone's. The
 * capture button, a picked template and the daily note run from the source of
 * `vaultOps` in `apps/mobile/src/newNoteCreation.test.ts`; the desktop's ways
 * are in `apps/desktop/src/services/noteFromTemplate.test.ts`.
 */

const files = new Map<string, string>();
vi.mock("./vaultService", () => ({
  vaultOps: {
    save: async (_v: unknown, path: string, content: string) => void files.set(path, content),
    read: async (_v: unknown, path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`missing ${path}`);
      return content;
    },
    rename: async (_v: unknown, path: string) => path,
    remove: async (_v: unknown, path: string) => void files.delete(path),
  },
  noteSaver: { flush: async () => {} },
}));
const settings = {
  templateFolder: "Vorlagen",
  folderTemplates: [],
  typeTemplates: [],
  defaultNoteType: "Note",
  dailyFormat: "YYYY-MM-DD",
  dailyFolder: "",
  attachmentFolder: "Attachments",
};
vi.mock("./mobileSettings", () => ({ getMobileSettings: () => settings }));
vi.mock("./mobileDialogs", () => ({ mTemplateAnswers: vi.fn() }));
vi.mock("./editorSelection", () => ({ readEditorSelection: () => null }));
vi.mock("./syncService", () => ({ syncSoon: () => {} }));
vi.mock("./vaultRegistry", () => ({ getActiveVaultEntry: async () => ({ name: "Vault" }) }));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? "" } }));

import { editorTextOf } from "@plainva/core";
import { clearPendingTemplateCaret, consumePendingTemplateCaret } from "@plainva/ui";
import { createBaseItem, planMobilePinboardEntry } from "./baseOps";

/** A template as "create new template" leaves it once it is assigned to a database, with an icon of its own. */
const TEMPLATE = `---\ntype: Projekt\nokf_version: "0.1"\nplainva:\n  tasks: false\n  icon: 🚀\n  templateFor:\n    - "[[Projekte.base]]"\n---\n# {{title}}\n\n- [ ] {{cursor}}Erste Aufgabe\n`;

const vault = {
  vaultId: "phone-vault",
  files: {
    exists: async (path: string) => files.has(path),
    readBinaryFile: async (path: string) => new TextEncoder().encode(files.get(path) ?? ""),
    readTextFile: async (path: string) => files.get(path) ?? "",
  },
} as any;

function frontmatterOf(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("no frontmatter");
  return parseYaml(match[1]) as Record<string, unknown>;
}

/** What stands behind the caret the note's editor is handed; "" is its end. */
function behindParkedCaret(path: string, note: string): string {
  const parked = consumePendingTemplateCaret(path);
  if (!parked) throw new Error(`no caret was parked for ${path}`);
  return editorTextOf(note).slice(parked.offset);
}

beforeEach(() => {
  files.clear();
  files.set("Vorlagen/Projekt.md", TEMPLATE);
  localStorage.clear();
  clearPendingTemplateCaret();
});

describe("a pinboard entry on the phone", () => {
  it("the board's default template: the draft carries none of the template-only keys", async () => {
    const config = {
      filters: { and: ['file.hasTag("zettel")'] },
      newItemFolder: "Zettel",
      newItemTemplate: "Vorlagen/Projekt.md",
      views: [{ type: "table", name: "Pinnwand", filters: { and: ['status == "offen"'] } }],
    };
    const plan = await planMobilePinboardEntry(vault, config, { viewIndex: 0, activeLabels: [], labelProperty: null });
    if (plan.status !== "ready") throw new Error(`not ready: ${plan.status}`);
    const written = files.get(plan.draft.path)!;
    expect(written).toBe(plan.draft.initial);
    expect(frontmatterOf(written)).toEqual({ type: "Projekt", plainva: { icon: "🚀" }, status: "offen", tags: ["zettel"] });
    expect(written).toContain("- [ ] Erste Aufgabe\n");
    expect(behindParkedCaret(plan.draft.path, written)).toBe("Erste Aufgabe\n");
  });
});

describe("a database item on the phone (\"+ Entry\")", () => {
  it("the database's template: the item carries none of the template-only keys, and what the view asks of it", async () => {
    // The desktop's item went through the builder of the paths without
    // questions and lost the keys there; the phone's kept them.
    const config = {
      filters: { and: ['file.hasTag("projekt")'] },
      newItemFolder: "Projekte",
      newItemTemplate: "Vorlagen/Projekt.md",
      views: [{ type: "table", name: "Tabelle", filters: { and: ['status == "offen"'] } }],
    };
    const made = await createBaseItem(vault, "Projekte.base", config, 0);
    expect(made).toEqual({ status: "created", path: "Projekte/Projekte_1.md" });
    const item = files.get("Projekte/Projekte_1.md")!;
    expect(frontmatterOf(item)).toEqual({ type: "Projekt", plainva: { icon: "🚀" }, status: "offen", tags: ["projekt"] });
    expect(item.endsWith("---\n# Projekte_1\n\n- [ ] Erste Aufgabe\n")).toBe(true);
    expect(behindParkedCaret("Projekte/Projekte_1.md", item)).toBe("Erste Aufgabe\n");
  });
});
