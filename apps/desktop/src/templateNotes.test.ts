// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isTemplateTokenName, TEMPLATE_CARET_TOKEN, TEMPLATE_EVENT_TOKENS, TEMPLATE_FILLED_TOKENS, TEMPLATE_QUESTION_TOKENS } from "@plainva/core";
import { followTemplateNotes, resolveTemplate, templateNotesOf, type TemplateContext } from "@plainva/ui";
import { FEATURES_SAVED_EVENT, featuresSavedFor } from "./services/vaultFeaturesRelay";

/**
 * Which notes are templates, and how the index hears of a change (Fehlerliste
 * 0.9.0, B26): one rule from the settings of either shell, the names of the
 * placeholders from one source, and both shells hand the rule to their indexer.
 */
describe("which notes are templates", () => {
  const settings = {
    templateFolder: "Vorlagen",
    dailyTemplate: "Tag.md",
    meetingTemplate: "Setup/Besprechung",
    folderTemplates: [{ folder: "Projekte", template: "Projekt" }],
    typeTemplates: [{ type: "Person", template: "Leute/Person.md" }],
  };

  it("are the notes in the templates folder and every template a setting names", () => {
    const isTemplate = templateNotesOf(settings);
    for (const path of ["Vorlagen/Tag.md", "Vorlagen/Projekt.md", "Vorlagen/Unter/Etwas.md", "vorlagen/Groß.md", "Setup/Besprechung.md", "Leute/Person.md"]) expect(isTemplate(path), path).toBe(true);
    for (const path of ["Projekte/Plan.md", "Vorlagen.md", "VorlagenAlt/X.md", "Setup/Anderes.md", "Leute/Anna.md"]) expect(isTemplate(path), path).toBe(false);
  });

  it("are in `Templates` where the folder is left empty", () => {
    const isTemplate = templateNotesOf({ ...settings, templateFolder: "" });
    expect(isTemplate("Templates/Tag.md")).toBe(true);
    expect(isTemplate("Vorlagen/Tag.md")).toBe(false);
  });
});

describe("the index follows the settings", () => {
  const follow = (vaultPath: string) => {
    const setTemplateNotes = vi.fn(async (_templateNotes: (path: string) => boolean) => 0);
    const controller = new AbortController();
    const read = vi.fn(async () => (path: string) => path.startsWith("Neu/"));
    followTemplateNotes({ indexer: { setTemplateNotes }, read, event: FEATURES_SAVED_EVENT, forVault: (event) => featuresSavedFor(event, vaultPath), signal: controller.signal, onError: () => {} });
    return { setTemplateNotes, read, controller };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("hears a save in this window and one carried from another window for its vault", async () => {
    const { setTemplateNotes, controller } = follow("/v/A");
    window.dispatchEvent(new CustomEvent(FEATURES_SAVED_EVENT));
    // As `installVaultFeaturesRelay` hands on a save of another window.
    window.dispatchEvent(new CustomEvent(FEATURES_SAVED_EVENT, { detail: { vaultPath: "/v/A" } }));
    await settle();
    expect(setTemplateNotes).toHaveBeenCalledTimes(2);
    const templateNotes = setTemplateNotes.mock.calls[0]![0];
    expect(templateNotes("Neu/X.md")).toBe(true);
    controller.abort();
  });

  it("passes over a save for another vault, and stops with its vault", async () => {
    const { setTemplateNotes, controller } = follow("/v/A");
    window.dispatchEvent(new CustomEvent(FEATURES_SAVED_EVENT, { detail: { vaultPath: "/v/B" } }));
    controller.abort();
    window.dispatchEvent(new CustomEvent(FEATURES_SAVED_EVENT));
    await settle();
    expect(setTemplateNotes).not.toHaveBeenCalled();
  });
});

describe("the names of the placeholders", () => {
  const NOW = new Date(2026, 10, 19, 9, 30);
  const ctx: TemplateContext = {
    title: "T", now: NOW, folder: "F", vaultName: "V",
    clipboard: () => "C", selection: () => "S", dailyPath: () => "Journal/2026-11-19",
    event: { start: NOW, end: NOW, allDay: false, location: "L", attendees: ["A"], organizer: "O", link: "https://e", description: "D" },
  };

  it("are every one the template engine fills in, from the one source in the core", () => {
    const filled = (raw: string) => {
      const out = resolveTemplate(raw, ctx, "interactive");
      return out.text !== raw || out.requests.length > 0;
    };
    // `{{weekday}}` names its day: alone it names none.
    for (const name of TEMPLATE_FILLED_TOKENS) expect(filled(name === "weekday" ? "{{weekday:monday}}" : `{{${name}}}`), name).toBe(true);
    for (const name of TEMPLATE_EVENT_TOKENS) expect(filled(`{{${name}}}`), name).toBe(true);
    for (const name of TEMPLATE_QUESTION_TOKENS) expect(filled(`{{${name}:Frage}}`), name).toBe(true);
    // The caret is placed last (`finalizeTemplate`): resolving leaves it for that step.
    expect(resolveTemplate(`{{${TEMPLATE_CARET_TOKEN}}}`, ctx, "interactive").late.length).toBeGreaterThan(0);
    for (const name of ["each", "variable", "nothing"]) {
      expect(isTemplateTokenName(name), name).toBe(false);
      expect(filled(`{{${name}}}`), name).toBe(false);
    }
  });
});

describe("both shells hand their indexer the templates", () => {
  // Every indexer a shell builds for a vault (not a test's) is told which notes
  // are templates, and follows a change of the settings.
  for (const file of ["contexts/VaultContext.tsx", "../../mobile/src/services/vaultService.ts"]) {
    it(file, () => {
      const source = readFileSync(resolve(__dirname, file), "utf8");
      const calls = [...source.matchAll(/new VaultIndexer\(/g)];
      expect(calls.length, file).toBeGreaterThan(0);
      for (const call of calls) {
        let depth = 0, at = call.index! + "new VaultIndexer".length;
        const from = at;
        for (; at < source.length; at++) {
          if (source[at] === "(") depth++;
          else if (source[at] === ")" && --depth === 0) break;
        }
        expect(source.slice(from, at), `${file} at ${from}`).toMatch(/\btemplateNotes:/);
      }
      expect(source, file).toMatch(/followTemplateNotes\(/);
    });
  }
});
