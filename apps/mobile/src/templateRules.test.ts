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

import { parseFolderTemplateRules, parseTypeTemplateRules, resolveTemplateForNewNote } from "@plainva/ui";
import { VAULT_DEFAULTS, VAULT_KEYS } from "./services/mobileSettingsScope";
import { templateForNewNote, templatePathOf } from "./services/templateInteractive";

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
    expect(VAULT_DEFAULTS.folderTemplates).toEqual([]);
    expect(VAULT_DEFAULTS.typeTemplates).toEqual([]);
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
