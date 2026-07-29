import { describe, it, expect, vi } from "vitest";
import {
  APP_LANGUAGES,
  getVaultTemplates,
  parseBaseConfig,
  resolveTaskCompletionModel,
  scaffoldVaultTemplate,
  serializeBaseConfig,
} from "@plainva/ui";
import type { VaultTemplateDefinition } from "@plainva/ui";

/**
 * The showcase template's own guarantees (plan "Vorlagen-Überarbeitung +
 * Plainva-Tour", step P2.4).
 *
 * The generic template suites already prove the tour is OKF-conform, obeys the
 * Obsidian rules and keeps its relations intact. What they cannot see is whether
 * the tour actually SHOWS what it promises: a pinboard whose pinned cards exist,
 * cards that really carry a colour, templates wired to databases that are really
 * shipped, and a task database the app's own task model reads the way its
 * one-click setup would. Those are checked here, in every language — the eight
 * machine-translated bundles share the structure, so a broken assumption breaks
 * all ten at once.
 */

vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} }));
  return { Store: { load }, load };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true), open: vi.fn(), confirm: vi.fn(async () => true) }));

class FakeAdapter {
  files = new Map<string, string>();
  dirs = new Set<string>();
  async exists(path: string) { return this.files.has(path) || this.dirs.has(path); }
  async createDir(path: string) { this.dirs.add(path); }
  async writeTextFile(path: string, content: string) { this.files.set(path, content); }
}

const NOW = new Date(2026, 6, 29); // 2026-07-29 local
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const ISO_DAILY = /^\d{4}-\d{2}-\d{2}\.md$/;

/** In-memory config as it lands on disk and is read back. */
const roundTrip = (config: unknown) => parseBaseConfig(serializeBaseConfig(config));

const plainvaOf = (note: { properties?: Record<string, unknown> }): Record<string, unknown> =>
  (note.properties?.plainva as Record<string, unknown> | undefined) ?? {};

async function scaffold(def: VaultTemplateDefinition) {
  const adapter = new FakeAdapter();
  await scaffoldVaultTemplate({ adapter, template: def, vaultName: "Tour", subfoldersHeading: "Unterordner", now: NOW });
  return adapter;
}

describe("Plainva Tour", () => {
  for (const { code: lang } of APP_LANGUAGES) {
    describe(`language ${lang}`, () => {
      const def = getVaultTemplates(lang).find((d) => d.id === "plainva")!;
      const notePaths = new Set(def.notes.map((n) => n.path));
      const basePaths = new Set((def.bases ?? []).map((b) => b.path));

      it("ships the seven databases the welcome note links", () => {
        expect(def.bases).toHaveLength(7);
        const welcome = def.notes[0].body;
        for (const path of basePaths) {
          expect(welcome, `${path} missing from the welcome note`).toContain(`(${encodeURI(path)})`);
        }
      });

      it("pinboard: degrades to a table on disk and pins notes that exist", () => {
        const pinboards = (def.bases ?? [])
          .map((b) => ({ path: b.path, view: roundTrip(b.config).views[0] }))
          .filter((x) => x.view.type === "pinboard");
        expect(pinboards, "the tour must ship a pinboard").toHaveLength(1);

        const { view } = pinboards[0];
        const yaml = serializeBaseConfig((def.bases ?? []).find((b) => b.path === pinboards[0].path)!.config);
        expect(yaml).toContain("type: table");
        expect(yaml).toContain("render: pinboard");

        expect(view.pinboardPinned?.length, "cards should start pinned").toBeGreaterThan(0);
        for (const path of view.pinboardPinned as string[]) {
          expect(notePaths.has(path), `pinned card ${path} does not exist`).toBe(true);
        }
        // "tags" is the default label source and must stay unwritten.
        expect(yaml).not.toContain("pinboardFilterBy");
      });

      it("card colours are hex values the pinboard can read", () => {
        const colored = def.notes.filter((n) => plainvaOf(n).header_color !== undefined);
        expect(colored.length, "some cards should be tinted").toBeGreaterThan(0);
        for (const note of colored) {
          expect(String(plainvaOf(note).header_color), note.path).toMatch(HEX);
        }
      });

      it("icons are set on the gallery notes", () => {
        const withIcon = def.notes.filter((n) => plainvaOf(n).icon !== undefined);
        expect(withIcon.length).toBeGreaterThan(0);
        for (const note of withIcon) expect(String(plainvaOf(note).icon).length).toBeGreaterThan(0);
      });

      it("every template assignment points at a database the tour ships", () => {
        const assigned = def.notes.filter((n) => plainvaOf(n).templateFor !== undefined);
        expect(assigned.length, "templates should be wired to their databases").toBeGreaterThan(0);
        for (const note of assigned) {
          for (const entry of plainvaOf(note).templateFor as string[]) {
            const target = /^\[\[([^\]|#]+)/.exec(entry)?.[1];
            expect(target, `${note.path}: '${entry}' is not a wiki link`).toBeTruthy();
            expect(basePaths.has(target!), `${note.path}: ${target} is not shipped`).toBe(true);
          }
        }
        // One template is deliberately unassigned (it demonstrates the
        // "show all templates" group), so not every template may carry one.
        const templates = def.notes.filter((n) => plainvaOf(n).tasks === false);
        expect(templates.length).toBeGreaterThan(assigned.length);
      });

      it("the task database matches the standard convention and is wired as the vault's", () => {
        const taskDbPath = def.settings?.taskDatabase;
        expect(taskDbPath, "the tour should wire its task database").toBeTruthy();
        expect(basePaths.has(taskDbPath!), `${taskDbPath} is not shipped`).toBe(true);

        const config = roundTrip((def.bases ?? []).find((b) => b.path === taskDbPath)!.config);
        // The app's own resolver has to read it — anything else and the Tasks
        // view would disagree with the database about what "done" means.
        const model = resolveTaskCompletionModel(config);
        expect(model, "no completion model").toBeTruthy();
        expect(model!.kind, "completion must come from the checkbox column").toBe("checkbox");
        const status = model!.kind === "checkbox" ? model!.status : null;
        expect(status, "the checkbox must be paired with a status column").toBeTruthy();
        expect(status!.options.length).toBe(3);
        expect(status!.open).toBe(status!.options[0]);
        expect(status!.done).toBe(status!.options[status!.options.length - 1]);
        // A due date is what makes tasks show up on the Tasks view's date lines.
        const hasDate = Object.values(config.columns).some((c: any) => c?.input === "date");
        expect(hasDate, "the task database needs a due-date column").toBe(true);
      });

      it("finished sample tasks agree in checkbox and status", () => {
        const taskDb = (def.bases ?? []).find((b) => b.path === def.settings!.taskDatabase)!;
        const config = roundTrip(taskDb.config);
        const model = resolveTaskCompletionModel(config)!;
        const checkboxKey = model.kind === "checkbox" ? model.key : "";
        const status = model.kind === "checkbox" ? model.status! : null!;
        const folder = String(config.filters.and[0]).match(/"([^"]+)"/)![1];

        const tasks = def.notes.filter((n) => n.path.startsWith(`${folder}/`));
        // Every sample has to carry a state the resolved column actually offers.
        // Together with the two checks below this also pins the column ORDER:
        // the resolver takes the first column that carries options, and the task
        // database has two (status and priority) — declare them the other way
        // round and the app reads priorities as task states, which these
        // assertions catch (red-checked by swapping them).
        for (const note of tasks) {
          expect(status.options, `${note.path}: not a state of the resolved status column`).toContain(
            note.properties?.[status.key]
          );
        }

        const finished = tasks.filter((n) => n.properties?.[checkboxKey] === true);
        expect(finished.length, "some sample tasks should be finished").toBeGreaterThan(0);
        for (const note of finished) {
          expect(note.properties?.[status.key], `${note.path}: ticked but not "done"`).toBe(status.done);
        }
        // And the open ones must not claim the done status.
        for (const note of tasks.filter((n) => n.properties?.[checkboxKey] === false)) {
          expect(note.properties?.[status.key], `${note.path}: unticked but "done"`).not.toBe(status.done);
        }
      });

      it("gallery covers point at attachments the tour ships", () => {
        const rawPaths = new Set((def.rawFiles ?? []).map((r) => r.path));
        const covers = def.notes
          .flatMap((n) => Object.entries(n.properties ?? {}).map(([k, v]) => ({ note: n.path, k, v })))
          .filter((x) => x.k === "cover" && typeof x.v === "string");
        expect(covers.length, "some notes should carry a cover").toBeGreaterThan(0);
        for (const c of covers) {
          expect(rawPaths.has(String(c.v)), `${c.note}: cover ${c.v} is not shipped`).toBe(true);
        }
      });

      it("scaffolds deterministically: dates resolved, tokens of the note engine kept", async () => {
        const adapter = await scaffold(def);

        for (const [path, content] of adapter.files) {
          expect(path, "an unresolved date token reached a file name").not.toContain("{{today");
          if (path.endsWith(".md")) {
            expect(content, `${path} still contains a scaffold date token`).not.toContain("{{today");
          }
        }

        // The journal notes are named in the daily-note format, so the calendar
        // and the daily-note setting find them.
        const journalFolder = def.settings!.dailyNotesFolder!;
        const journal = [...adapter.files.keys()].filter(
          (p) => p.startsWith(`${journalFolder}/`) && !p.endsWith("index.md")
        );
        expect(journal.length).toBe(2);
        for (const path of journal) expect(path.slice(journalFolder.length + 1)).toMatch(ISO_DAILY);
        expect(adapter.files.has(`${journalFolder}/2026-07-29.md`)).toBe(true);
        expect(adapter.files.has(`${journalFolder}/2026-07-28.md`)).toBe(true);

        // Note templates must keep their tokens: they are resolved when a note
        // is created FROM the template, not while scaffolding.
        const templateFolder = def.settings!.templateFolder!;
        const templates = [...adapter.files.entries()].filter(
          ([p]) => p.startsWith(`${templateFolder}/`) && !p.endsWith("index.md")
        );
        expect(templates.length).toBe(7);
        expect(templates.some(([, c]) => c.includes("{{title}}"))).toBe(true);
        // The meeting template's questions and the daily note's neighbour links
        // have to reach the file untouched: they are answered and resolved when
        // a note is created FROM the template, not while the vault is built.
        expect(templates.some(([, c]) => c.includes("{{select:"))).toBe(true);
        expect(templates.some(([, c]) => c.includes("{{date_prompt:"))).toBe(true);
        expect(templates.some(([, c]) => c.includes("{{daily-1}}"))).toBe(true);
      });

      it("folder rules point at folders and templates the tour ships", () => {
        const rules = def.settings?.folderTemplates ?? [];
        expect(rules.length, "the tour should wire its folders to templates").toBeGreaterThan(0);
        const folders = new Set(def.folders);
        const templateFolder = def.settings!.templateFolder!;
        for (const rule of rules) {
          expect(folders.has(rule.folder), `${rule.folder} is not a folder of the tour`).toBe(true);
          // The rules name the bare file; the app resolves it against the
          // vault's template folder, which the tour sets in the same breath.
          expect(rule.template).not.toContain("/");
          expect(notePaths.has(`${templateFolder}/${rule.template}`), `${rule.template} is not shipped`).toBe(true);
        }
        // Two folders deliberately have none: the journal is covered by
        // dailyNoteTemplate, and notes are MOVED into the archive, not written
        // there. Rules for them would be wrong, not missing.
        const ruled = new Set(rules.map((r) => r.folder));
        expect(ruled.has(def.settings!.dailyNotesFolder!)).toBe(false);
      });

      it("writes both attachments verbatim and keeps them out of the listings", async () => {
        const adapter = await scaffold(def);
        expect(def.rawFiles).toHaveLength(2);
        for (const file of def.rawFiles!) {
          expect(adapter.files.get(file.path), file.path).toBe(file.content);
          expect(file.content.startsWith("<svg"), `${file.path} should be an SVG`).toBe(true);
        }
        const folder = def.rawFiles![0].path.split("/")[0];
        const listing = adapter.files.get(`${folder}/index.md`)!;
        for (const file of def.rawFiles!) {
          expect(listing, "attachments must not be listed").not.toContain(file.path.split("/").pop()!);
        }
      });

      it("the cheat sheet exercises the editor's features", () => {
        const sheet = def.notes.find((n) => n.body.includes("```mermaid"));
        expect(sheet, "the tour should ship a Markdown cheat sheet").toBeTruthy();
        const body = sheet!.body;
        expect(body, "callout").toMatch(/^> \[!/m);
        expect(body, "table").toContain("| --- |");
        expect(body, "block formula").toContain("$$");
        expect(body, "footnote").toMatch(/\[\^1\]/);
        expect(body, "highlight").toContain("==");
        expect(body, "task").toMatch(/^- \[[ x]\]/m);
        expect(body, "image embed").toMatch(/!\[\[[^\]]+\.svg\]\]/);
        expect(body, "wiki link").toMatch(/(?<!!)\[\[[^\]]+\]\]/);
      });
    });
  }
});
