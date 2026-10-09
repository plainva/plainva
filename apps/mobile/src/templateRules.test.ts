import { describe, expect, it, vi } from "vitest";

const settings = {
  templateFolder: "Vorlagen",
  folderTemplates: [{ folder: "Projekte", template: "Projekt.md" }],
  typeTemplates: [{ type: "Meeting", template: "Besprechung" }],
};
vi.mock("./services/mobileSettings", () => ({ getMobileSettings: () => settings }));
vi.mock("./services/mobileDialogs", () => ({ mTemplateAnswers: vi.fn() }));
vi.mock("./services/editorSelection", () => ({ readEditorSelection: () => null }));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? "" } }));

import { buildNewNoteContent, parseFolderTemplateRules, parseTypeTemplateRules, resolveTemplateForNewNote } from "@plainva/ui";
import { vaultDefaults, VAULT_KEYS } from "./services/mobileSettingsScope";
import {
  buildNewNoteFromTemplate,
  buildNewNoteFromTemplateText,
  templateForNewNote,
  templatePathOf,
  type NewNoteContent,
} from "./services/templateInteractive";

/**
 * Folder and type template rules on the phone (plan Vorlagen-Engine P6).
 *
 * The rules are authored on the desktop and travel through the settings
 * profile; the phone only applies them. The failure this guards against is
 * quiet: a rule that reaches the phone but is never applied looks exactly like
 * "no rule", and the same vault then behaves differently depending on which
 * device is at hand. So these tests pin the two things that could break —
 * the fields being real per-vault settings, and the shared resolver deciding
 * the same way here as it does there.
 */

describe("template rules on mobile", () => {
  it("carries both rule lists as per-vault settings", () => {
    // Not app-wide: two vaults may map the same folder to different templates.
    expect(VAULT_KEYS).toContain("folderTemplates");
    expect(VAULT_KEYS).toContain("typeTemplates");
    expect(vaultDefaults().folderTemplates).toEqual([]);
    expect(vaultDefaults().typeTemplates).toEqual([]);
  });

  it("drops malformed rows instead of failing note creation", () => {
    // A newer desktop (or a hand-edited profile) must never be able to stop a
    // note from being created here. An EMPTY folder is not malformed — it is
    // the vault root, i.e. the deliberate "everything else" rule.
    const rules = parseFolderTemplateRules([
      { folder: "Projekte\\", template: "Projekt.md" },
      { folder: "", template: "Fallback.md" },
      { folder: "A" },
      "nonsense",
      null,
    ]);
    expect(rules).toEqual([
      { folder: "Projekte", template: "Projekt.md" },
      { folder: "", template: "Fallback.md" },
    ]);
    expect(parseTypeTemplateRules(undefined)).toEqual([]);
  });

  it("resolves the same way the desktop does: longest folder wins, folder beats type", () => {
    const folders = parseFolderTemplateRules([
      { folder: "Projekte", template: "Projekt.md" },
      { folder: "Projekte/Kunden", template: "Kunde.md" },
    ]);
    const types = parseTypeTemplateRules([{ type: "Meeting", template: "Meeting.md" }]);

    expect(resolveTemplateForNewNote(folders, types, "Projekte/Kunden/ACME", "Note")).toBe("Kunde.md");
    expect(resolveTemplateForNewNote(folders, types, "Projekte", "Note")).toBe("Projekt.md");
    // The folder rule wins even when a type rule would also match — the folder
    // is the more specific statement about THIS note.
    expect(resolveTemplateForNewNote(folders, types, "Projekte", "Meeting")).toBe("Projekt.md");
    expect(resolveTemplateForNewNote(folders, types, "Archiv", "Meeting")).toBe("Meeting.md");
    expect(resolveTemplateForNewNote(folders, types, "Archiv", "Note")).toBeNull();
  });
});

describe("template lookup on mobile", () => {
  it("reads the rules from the per-vault settings the profile filled in", () => {
    expect(templateForNewNote("Projekte/Kunden", "Note")).toBe("Projekt.md");
    expect(templateForNewNote("Archiv", "Meeting")).toBe("Besprechung");
    expect(templateForNewNote("Archiv", "Note")).toBe("");
  });

  it("resolves a bare rule name against the vault's template folder", () => {
    // Rules are authored on the desktop, where the picker stores the FILE name.
    expect(templatePathOf("Projekt.md")).toBe("Vorlagen/Projekt.md");
    // A missing extension is completed — Plainva templates are markdown files,
    // so "Besprechung" can only mean one thing.
    expect(templatePathOf("Besprechung")).toBe("Vorlagen/Besprechung.md");
    // A full vault path stays as it is (hand-edited profiles carry those).
    expect(templatePathOf("Archiv/Alt.md")).toBe("Archiv/Alt.md");
    expect(templatePathOf("  ")).toBe("");
  });
});

describe("OKF header of a new note on the phone", () => {
  it("stamps `type` and never a per-note okf_version (OKF v0.2 — the phone used to write a \"1.0\" that never existed)", async () => {
    // Until 2026-08-21 the phone stamped `okf_version: "1.0"` into every new
    // note while the desktop wrote "0.1": two invented versions in one vault.
    // With v0.2 neither shell writes the key into notes (E1) — the bundle
    // declaration lives in the root index.md only.
    const built = await buildNewNoteFromTemplate({
      read: async () => {
        throw new Error("no template is read on the fallback path");
      },
      exists: async () => false,
      vaultName: "Vault",
      folder: "Archiv",
      title: "Neu",
      type: "Note",
      fallbackBody: "# Neu\n",
    });
    expect(built?.content.startsWith("---\ntype: Note\n---\n")).toBe(true);
    expect(built?.content).not.toContain("okf_version");
  });

  it("asks the shared definition whether the text carries a block: a rule is none, `---` on `---` is one", async () => {
    // The phone looked at the first line only. A body that opens with a rule
    // counted as "has frontmatter" and the note got no header at all.
    const build = (fallbackBody: string) =>
      buildNewNoteFromTemplate({ read: async () => "", exists: async () => false, vaultName: "Vault", folder: "Archiv", title: "Neu", type: "Note", fallbackBody });
    // Until 2026-10-09 this test held the phone's own header in place: a blank
    // line behind it, and a block the text carries left exactly as it stood —
    // so the empty block below came out without a `type`. The header is the
    // shared writer's now, as on the desktop: nothing between it and the text,
    // and `type` goes into the block that is there.
    expect((await build("---\n\nText unter einer Linie\n"))?.content).toBe("---\ntype: Note\n---\n---\n\nText unter einer Linie\n");
    expect((await build("---\n---\n# Neu\n"))?.content).toBe("---\ntype: Note\n---\n# Neu\n");
    // A `type` the text names itself wins, and then nothing is rewritten.
    expect((await build("---\ntype: Meeting\n---\n# Neu\n"))?.content).toBe("---\ntype: Meeting\n---\n# Neu\n");
  });
});

/**
 * A new note from a template, as the desktop writes it (finding 2026-10-09).
 *
 * The phone made this header from a string of its own: in front of a text
 * without a properties block, with a blank line behind it — and not at all
 * where the template carried a block. A template whose block names no `type`
 * (also the empty block, `---` directly on `---`) therefore made a note
 * without one, where the desktop writes `type` into the block that is there.
 * Both shells ask the one shared writer now (`templateAsNewNote`); the cases
 * below are the ones that came out differently.
 */
describe("a new note from a template on the phone", () => {
  /** The template file a rule names or a database carries, read and resolved. */
  async function fromTemplate(raw: string): Promise<NewNoteContent> {
    const built = await buildNewNoteFromTemplate({
      read: async () => raw,
      exists: async () => true,
      vaultName: "Vault",
      folder: "Archiv",
      title: "Neu",
      type: "Note",
      explicitTemplate: "Eigene.md",
      fallbackBody: "# Neu\n",
    });
    if (!built) throw new Error("a template without questions cannot be cancelled");
    return built;
  }

  /** What stands behind the caret; "" is the end of the note. */
  function behindCaret(built: NewNoteContent): string {
    if (built.caret === null) throw new Error("the template's {{cursor}} was lost");
    return built.content.slice(built.caret);
  }

  it("writes `type` INTO the block of a template that names none", async () => {
    const built = await fromTemplate("---\nstatus: entwurf\n---\n# {{title}}\n\n{{cursor}}Text\n");
    expect(built.content).toBe("---\nstatus: entwurf\ntype: Note\n---\n# Neu\n\nText\n");
    expect(behindCaret(built)).toBe("Text\n");
  });

  it("reads `---` on `---` as a block: `type` goes between its fences", async () => {
    const built = await fromTemplate("---\n---\n# {{title}}\n{{cursor}}");
    expect(built.content).toBe("---\ntype: Note\n---\n# Neu\n");
    expect(behindCaret(built)).toBe("");
  });

  it("puts the header in front of a template without a block, with no blank line of its own behind it", async () => {
    const built = await fromTemplate("# {{title}}\n\n- [ ] {{cursor}}\n");
    expect(built.content).toBe("---\ntype: Note\n---\n# Neu\n\n- [ ] \n");
    expect(behindCaret(built)).toBe("\n");
  });

  it("takes a text that opens with a rule for text: the header goes in front of the rule", async () => {
    const built = await fromTemplate("---\n\n{{cursor}}Text unter einer Linie\n");
    expect(built.content).toBe("---\ntype: Note\n---\n---\n\nText unter einer Linie\n");
    expect(behindCaret(built)).toBe("Text unter einer Linie\n");
  });

  it("hands on the template's text byte for byte: blank lines it opens with stay, and so does a `type` of its own", async () => {
    // The phone's header swallowed the blank lines a template began with and
    // set one of its own.
    expect((await fromTemplate("\n\n# {{title}}\n")).content).toBe("---\ntype: Note\n---\n\n\n# Neu\n");
    const own = await fromTemplate("---\ntype: Meeting\n---\n\n# {{title}}\n\n{{cursor}}");
    expect(own.content).toBe("---\ntype: Meeting\n---\n\n# Neu\n\n");
    expect(behindCaret(own)).toBe("");
  });

  it("keeps the line ends of a template written on Windows, in the header too", async () => {
    const block = await fromTemplate("---\r\nstatus: entwurf\r\n---\r\n# {{title}}\r\n{{cursor}}Text\r\n");
    expect(block.content).toBe("---\r\nstatus: entwurf\r\ntype: Note\r\n---\r\n# Neu\r\nText\r\n");
    expect(behindCaret(block)).toBe("Text\r\n");
    expect((await fromTemplate("# {{title}}\r\n")).content).toBe("---\r\ntype: Note\r\n---\r\n# Neu\r\n");
  });

  it("never leaves the caret in the properties block: one the template puts there goes to the start of the text", async () => {
    // The live editor hides the block and refuses a caret in it. Counted on by
    // what the header grew, such a caret came to stand in the `type` line.
    const built = await fromTemplate("---\nstatus: {{cursor}}\n---\n# {{title}}\n");
    expect(built.content).toBe("---\nstatus:\ntype: Note\n---\n# Neu\n");
    expect(behindCaret(built)).toBe("# Neu\n");
  });

  it("without a template the note is the skeleton every other new note is: the heading directly under the header", async () => {
    const built = await buildNewNoteFromTemplate({
      read: async () => {
        throw new Error("no template is read on the fallback path");
      },
      exists: async () => false,
      vaultName: "Vault",
      folder: "Archiv",
      title: "Neu",
      type: "Note",
      fallbackBody: "# Neu\n",
    });
    expect(built).toEqual({ content: "---\ntype: Note\n---\n# Neu\n", caret: null });
    // The same bytes the desktop writes for a note without a template.
    expect(built?.content).toBe(buildNewNoteContent("Note", "Neu"));
  });

  it("builds a picked template (\"New note from a template\") the same way", async () => {
    // This path had the header string a second time, with the same two gaps.
    const picked = (raw: string) => buildNewNoteFromTemplateText({ raw, vaultName: "Vault", folder: "Archiv", title: "Neu", type: "Note" });
    const block = await picked("---\nstatus: entwurf\n---\n# {{title}}\n\n{{cursor}}Text\n");
    expect(block?.content).toBe("---\nstatus: entwurf\ntype: Note\n---\n# Neu\n\nText\n");
    expect(block && behindCaret(block)).toBe("Text\n");
    expect((await picked("---\n---\n# {{title}}\n"))?.content).toBe("---\ntype: Note\n---\n# Neu\n");
    expect((await picked("# {{title}}\n"))?.content).toBe("---\ntype: Note\n---\n# Neu\n");
    expect((await picked("---\n\nText unter einer Linie\n"))?.content).toBe("---\ntype: Note\n---\n---\n\nText unter einer Linie\n");
  });
});
