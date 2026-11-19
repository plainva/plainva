// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
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
    // A template a rule names may lie in a subfolder of the templates folder.
    folderTemplates: [{ folder: "Projekte", template: "Projekt" }, { folder: "Kunden", template: "Vorlagen/Kunden/Kunde.md" }],
    typeTemplates: [{ type: "Person", template: "Leute/Person.md" }],
  };

  it("are the notes the app offers from the templates folder and every template a setting names", () => {
    const isTemplate = templateNotesOf(settings);
    for (const path of ["Vorlagen/Tag.md", "Vorlagen/Projekt.md", "vorlagen/Groß.md", "Vorlagen/Kunden/Kunde.md", "Setup/Besprechung.md", "Leute/Person.md"]) expect(isTemplate(path), path).toBe(true);
    // Not offered by `listTemplates`: a subfolder's note, a hidden one, the
    // reserved OKF notes, a file that is not a note.
    for (const path of ["Vorlagen/Unter/Etwas.md", "Vorlagen/.Versteckt.md", "Vorlagen/index.md", "Vorlagen/log.md", "Vorlagen/Bild.png"]) expect(isTemplate(path), path).toBe(false);
    for (const path of ["Projekte/Plan.md", "Vorlagen.md", "VorlagenAlt/X.md", "Setup/Anderes.md", "Leute/Anna.md"]) expect(isTemplate(path), path).toBe(false);
  });

  it("are in `Templates` where the folder is left empty", () => {
    const isTemplate = templateNotesOf({ ...settings, templateFolder: "" });
    expect(isTemplate("Templates/Tag.md")).toBe(true);
    expect(isTemplate("Vorlagen/Tag.md")).toBe(false);
  });
});

describe("the index follows the settings", () => {
  const follow = (vaultPath: string, read = vi.fn(async () => (path: string) => path.startsWith("Neu/"))) => {
    const setTemplateNotes = vi.fn(async (_templateNotes: (path: string) => boolean) => 0);
    const controller = new AbortController();
    const follower = followTemplateNotes({ read, event: FEATURES_SAVED_EVENT, forVault: (event) => featuresSavedFor(event, vaultPath), signal: controller.signal, onError: () => {} });
    follower.attach({ setTemplateNotes });
    return { setTemplateNotes, read, controller, follower };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("hears a save in this window and one carried from another window for its vault", async () => {
    const { setTemplateNotes, controller } = follow("/v/A");
    window.dispatchEvent(new CustomEvent(FEATURES_SAVED_EVENT));
    await settle();
    // As `installVaultFeaturesRelay` hands on a save of another window.
    window.dispatchEvent(new CustomEvent(FEATURES_SAVED_EVENT, { detail: { vaultPath: "/v/A" } }));
    await settle();
    expect(setTemplateNotes).toHaveBeenCalledTimes(2);
    const templateNotes = setTemplateNotes.mock.calls[0]![0];
    expect(templateNotes("Neu/X.md")).toBe(true);
    controller.abort();
  });

  it("listens before it reads: a save while the indexer is built is read once it is there", async () => {
    const setTemplateNotes = vi.fn(async (_templateNotes: (path: string) => boolean) => 0);
    const controller = new AbortController();
    let saved = false;
    const read = vi.fn(async () => (saved ? (path: string) => path.startsWith("Neu/") : () => false));
    const follower = followTemplateNotes({ read, event: FEATURES_SAVED_EVENT, signal: controller.signal, onError: () => {} });
    const first = await follower.first;
    // The setting is saved after the first reading, before the indexer listens.
    saved = true;
    window.dispatchEvent(new CustomEvent(FEATURES_SAVED_EVENT));
    expect(first("Neu/X.md")).toBe(false);
    follower.attach({ setTemplateNotes });
    await settle();
    expect(setTemplateNotes).toHaveBeenCalledTimes(1);
    expect(setTemplateNotes.mock.calls[0]![0]("Neu/X.md")).toBe(true);
    controller.abort();
  });

  it("takes the later of two readings that come back out of order", async () => {
    const answers: ((value: (path: string) => boolean) => void)[] = [];
    let reads = 0;
    const read = vi.fn(() => (reads++ === 0 ? Promise.resolve(() => false) : new Promise<(path: string) => boolean>((resolve) => answers.push(resolve))));
    const { setTemplateNotes, controller } = follow("/v/A", read);
    window.dispatchEvent(new CustomEvent(FEATURES_SAVED_EVENT));
    window.dispatchEvent(new CustomEvent(FEATURES_SAVED_EVENT));
    // The second save's reading answers first, the first save's after it.
    answers[1]!((path) => path === "Neu/Spaet.md");
    await settle();
    answers[0]!((path) => path === "Alt/Frueh.md");
    await settle();
    expect(setTemplateNotes).toHaveBeenCalledTimes(1);
    expect(setTemplateNotes.mock.calls[0]![0]("Neu/Spaet.md")).toBe(true);
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
      expect(source, file).toMatch(/\.attach\(indexer\)/);
    });
  }
});

describe("every writer of a template setting tells the index", () => {
  // The five settings that say which notes are templates. Whoever writes one
  // tells the windows of its vault (`vaultFeaturesSaved` or the settings
  // dialog's batched `announceVaultFeaturesSaved`), or the index keeps the old
  // rule until the vault is opened again. A write is checked within its block:
  // the lines after it down to the first that is indented less.
  const KEYS = "templateFolderKey|dailyNoteTemplateKey|meetingNoteTemplateKey|folderTemplatesKey|typeTemplatesKey";
  const WRITE = new RegExp(`\\.set\\(\\s*(?:${KEYS})\\(|persistFeature\\([^;]*?\\b(?:${KEYS})\\(`, "g");
  const TELLS = /\b(?:vaultFeaturesSaved|announceVaultFeaturesSaved)\(/;
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const at = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(at);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [at] : [];
    });
  const blockAfter = (source: string, index: number): string => {
    const lines = source.split("\n");
    let line = source.slice(0, index).split("\n").length - 1;
    const indent = (text: string) => text.length - text.trimStart().length;
    const own = indent(lines[line]!);
    const block = [lines[line]!];
    for (line++; line < lines.length; line++) {
      if (lines[line]!.trim() !== "" && indent(lines[line]!) < own) break;
      block.push(lines[line]!);
    }
    return block.join("\n");
  };
  const root = resolve(__dirname);
  const files = sources(root);

  it("finds the writers it checks", () => {
    const writers = files.filter((file) => [...readFileSync(file, "utf8").matchAll(WRITE)].length > 0);
    expect(writers.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const writes = [...source.matchAll(WRITE)];
    if (writes.length === 0) continue;
    it(relative(root, file), () => {
      for (const write of writes) {
        // `persistFeature` tells itself: its own body is checked as a writer.
        if (write[0].startsWith("persistFeature")) {
          expect(source).toMatch(/const persistFeature = async/);
          continue;
        }
        expect(blockAfter(source, write.index!), `${relative(root, file)}: ${write[0]}`).toMatch(TELLS);
      }
    });
  }

  it("the settings dialog's single writer tells", () => {
    const source = readFileSync(join(root, "components/SettingsModal.tsx"), "utf8");
    const body = /const persistFeature = async[^\n]*\n([\s\S]*?)\n {2}\};/.exec(source)?.[1] ?? "";
    expect(body).toMatch(/\.set\(storeKey/);
    expect(body).toMatch(TELLS);
  });

  it("the phone: every function that writes a vault's settings says so", () => {
    // `m-settings-changed` is what the phone's index follows (`vaultService.ts`).
    const source = readFileSync(resolve(__dirname, "../../mobile/src/services/mobileSettings.ts"), "utf8");
    const writers = source
      .split(/\n(?=(?:export )?(?:async )?function )/)
      .filter((chunk) => /\.set\(\s*vaultKey\(/.test(chunk))
      // Seeds the records once in `initMobileSettings`, before any vault is open.
      .filter((chunk) => !chunk.startsWith("async function migrateToPerVault("));
    expect(writers.length).toBeGreaterThanOrEqual(2);
    for (const chunk of writers) expect(chunk, chunk.split("\n")[0]).toMatch(/dispatchEvent\(new CustomEvent\("m-settings-changed"\)\)/);
  });

  it("the settings profile, which writes them from its table, tells", () => {
    const source = readFileSync(join(root, "services/settingsProfile.ts"), "utf8");
    for (const key of KEYS.split("|")) expect(source, key).toMatch(new RegExp(`\\b${key}\\b`));
    expect(source).toMatch(TELLS);
  });
});
