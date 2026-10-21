import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { editorTextOf, type IVaultAdapter } from "@plainva/core";

const storeValues: Record<string, unknown> = {};
vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({ get: async (key: string) => storeValues[key] }));
  return { Store: { load }, load };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true), open: vi.fn() }));

import {
  buildNewItemContent,
  clearPendingTemplateCaret,
  consumePendingTemplateCaret,
  parkTemplateCaret,
  pinboardEntryCaret,
  planPinboardEntry,
  templateCaretInNote,
  type PinboardEntryFiles,
} from "@plainva/ui";
import { folderTemplatesKey } from "../contexts/VaultContext";
import { buildNewNoteFromTemplate } from "./newNoteTemplate";
import { applyTemplateInteractive } from "./templateInteractive";

/**
 * What a note takes over from its template, on the ways a PERSON makes one on
 * the desktop (finding 2026-10-11).
 *
 * A template carries keys that are meant for itself alone: `plainva.tasks:
 * false` keeps its checkboxes out of the Tasks view — every template the app
 * creates has it —, `plainva.templateFor` says which databases offer it, and
 * a legacy one still carries `okf_version`. They were taken out on the way a
 * note takes when nobody is asked anything. The ways below run the template
 * through the shell's questions instead, and their note kept all three: its
 * tasks counted as hidden and were missing from the Tasks view.
 *
 * Each way is driven as far as it reaches without a mounted component: the
 * shell's real pipeline (`applyTemplateInteractive`) in front, the builder the
 * way the caller hands the template over. The daily note has its own file
 * (dailyNotes.test.ts), the builder itself newNote.test.ts, and the phone's
 * ways `apps/mobile/src/newNoteCreation.test.ts` and
 * `apps/mobile/src/services/noteFromTemplate.test.ts`.
 */

const VAULT = "/vault";
const NOW = new Date(2026, 9, 12, 9, 30);

/** A template as "create new template" leaves it once it is assigned to a database, with an icon of its own. */
const TEMPLATE = `---\ntype: Projekt\nokf_version: "0.1"\nplainva:\n  tasks: false\n  icon: 🚀\n  templateFor:\n    - "[[Projekte.base]]"\n---\n# {{title}}\n\n- [ ] {{cursor}}Erste Aufgabe\n`;

function frontmatterOf(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("no frontmatter");
  return parseYaml(match[1]) as Record<string, unknown>;
}

function vaultWith(files: Record<string, string>): IVaultAdapter {
  return {
    exists: async (path: string) => path in files,
    readTextFile: async (path: string) => {
      if (!(path in files)) throw new Error(`missing ${path}`);
      return files[path];
    },
  } as unknown as IVaultAdapter;
}

/** What stands behind the caret an editor is handed for the note; "" is its end. */
function behindParkedCaret(path: string, note: string, caret: number | null): string {
  parkTemplateCaret(path, note, caret);
  const parked = consumePendingTemplateCaret(path);
  if (!parked) throw new Error("no caret was parked");
  return editorTextOf(note).slice(parked.offset);
}

beforeEach(() => {
  for (const key of Object.keys(storeValues)) delete storeValues[key];
  clearPendingTemplateCaret();
});

describe("a new note from a template (file tree, quick switcher)", () => {
  it("a picked template: the note loses the task opt-out, the database assignment and the okf_version, and keeps the rest", async () => {
    const built = await buildNewNoteFromTemplate({
      vaultPath: VAULT,
      adapter: vaultWith({ "Templates/Projekt.md": TEMPLATE }),
      folder: "Projekte",
      title: "Alpha",
      explicitTemplate: "Projekt",
    });
    expect(built?.templatePath).toBe("Templates/Projekt.md");
    expect(built?.content).toBe("---\ntype: Projekt\nplainva:\n  icon: 🚀\n---\n# Alpha\n\n- [ ] Erste Aufgabe\n");
    expect(behindParkedCaret("Projekte/Alpha.md", built!.content, built!.caret)).toBe("Erste Aufgabe\n");
  });

  it("the template a folder rule names: the same note", async () => {
    storeValues[folderTemplatesKey(VAULT)] = [{ folder: "Projekte", template: "Projekt.md" }];
    const built = await buildNewNoteFromTemplate({
      vaultPath: VAULT,
      adapter: vaultWith({ "Templates/Projekt.md": TEMPLATE }),
      folder: "Projekte/Kunden",
      title: "Beta",
    });
    expect(frontmatterOf(built!.content)).toEqual({ type: "Projekt", plainva: { icon: "🚀" } });
    expect(built!.content.endsWith("---\n# Beta\n\n- [ ] Erste Aufgabe\n")).toBe(true);
    expect(behindParkedCaret("Projekte/Kunden/Beta.md", built!.content, built!.caret)).toBe("Erste Aufgabe\n");
  });

  it("a template without those keys makes the note it always made", async () => {
    const built = await buildNewNoteFromTemplate({
      vaultPath: VAULT,
      adapter: vaultWith({ "Templates/Projekt.md": "---\nstatus: entwurf\ntags: [a, b]   # eigene\nplainva:\n  icon: 🚀\n---\n# {{title}}\n\n{{cursor}}Text\n" }),
      folder: "Projekte",
      title: "Alpha",
      explicitTemplate: "Projekt",
    });
    // `type` goes into the block as an entry of its own; every other line stays as it was.
    expect(built?.content).toBe("---\nstatus: entwurf\ntags: [a, b]   # eigene\nplainva:\n  icon: 🚀\ntype: Note\n---\n# Alpha\n\nText\n");
    expect(built!.content.slice(built!.caret!)).toBe("Text\n");
  });
});

describe("a pinboard entry, planned the way the database view plans it", () => {
  function memoryFiles(): { files: PinboardEntryFiles; store: Map<string, string> } {
    const store = new Map<string, string>();
    return {
      store,
      files: {
        exists: async (path) => store.has(path),
        read: async (path) => store.get(path)!,
        readBytes: async (path) => new TextEncoder().encode(store.get(path)!),
        write: async (path, content) => void store.set(path, content),
        rename: async (path) => path,
        remove: async (path) => void store.delete(path),
      },
    };
  }

  it("the board's default template: the draft carries none of the template-only keys", async () => {
    const { files, store } = memoryFiles();
    const plan = await planPinboardEntry(files, {
      config: {
        filters: { and: ['file.folder == "Zettel"'] },
        views: [{ type: "table", name: "Pinnwand", filters: { and: ['status == "offen"'] } }],
      },
      viewIndex: 0,
      activeLabels: [],
      labelProperty: null,
      noteType: "Note",
      now: NOW,
      // `openPinboardEntry` in BaseViewer.tsx: the template's questions first, then text and caret.
      template: async ({ title, folder }) => {
        const answered = await applyTemplateInteractive(TEMPLATE, { title, now: NOW, folder, vaultName: "Vault" }, "Fragen");
        return answered ? { text: answered.text, caret: answered.cursor } : null;
      },
    });
    if (plan.status !== "ready") throw new Error(`not ready: ${plan.status}`);
    const written = store.get(plan.draft.path)!;
    expect(frontmatterOf(written)).toEqual({ type: "Projekt", plainva: { icon: "🚀" }, status: "offen" });
    expect(written).toContain("- [ ] Erste Aufgabe\n");
    // The entry window asks the draft for its caret.
    const doc = editorTextOf(written);
    expect(doc.slice(pinboardEntryCaret(plan.draft, doc))).toBe("Erste Aufgabe\n");
  });
});

describe("a database item, built the way the database view builds it", () => {
  it("was without the template-only keys before, and is", async () => {
    // `doCreateItem` in BaseViewer.tsx hands the answered template to the
    // builder of the paths without questions, which took the keys out all along.
    const answered = await applyTemplateInteractive(TEMPLATE, { title: "Projekte_1", now: NOW, folder: "Projekte", vaultName: "Vault" }, "Fragen");
    const content = buildNewItemContent({ templateText: answered!.text, noteType: "Note", title: "Projekte_1", inheritTags: ["projekt"], prefills: { status: "offen" } });
    expect(frontmatterOf(content)).toEqual({ type: "Projekt", plainva: { icon: "🚀" }, status: "offen", tags: ["projekt"] });
    expect(content.slice(templateCaretInNote(answered!.text, content, answered!.cursor!))).toBe("Erste Aufgabe\n");
  });
});
