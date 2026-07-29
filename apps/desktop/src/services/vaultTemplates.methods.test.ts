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
 * What the GTD and Zettelkasten samples are supposed to DEMONSTRATE (plan
 * "Vorlagen-Überarbeitung + Plainva-Tour" § 3, step P3.2). PARA's own
 * guarantees live next door in `vaultTemplates.para.test.ts`.
 *
 * Each method has one thing a single example note cannot show:
 *
 * - GTD sorts by state AND by place. Its two boards are only an argument for the
 *   method if every column holds a card — otherwise the vault teaches "here are
 *   four empty lanes".
 * - A Zettelkasten is a web. Its slips have to link EACH OTHER in their own text,
 *   not merely sit in a folder together. Those links are plain `[[…]]` in the
 *   body: a typo yields a note that reads fine and a graph edge that never forms.
 *
 * The describe names avoid the phrase the cross-language parity suite uses, so a
 * run filtered to one language there does not drag these in.
 */

vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} }));
  return { Store: { load }, load };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true), open: vi.fn(), confirm: vi.fn(async () => true) }));

const NOW = new Date(2026, 6, 29);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const roundTrip = (config: unknown) => parseBaseConfig(serializeBaseConfig(config));
const optionValues = (col: unknown): string[] =>
  ((col as { options?: unknown[] }).options ?? []).map((o) => (typeof o === "string" ? o : String((o as { value: unknown }).value)));
const wikiTargets = (raw: unknown): string[] => {
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((v) => /^\[\[([^\]|#]+)/.exec(String(v ?? ""))?.[1])
    .filter((v): v is string => Boolean(v));
};
const stem = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/, "");
const sourceFolderOf = (config: { filters: { and: unknown[] } }) =>
  String(config.filters.and[0]).match(/"([^"]+)"/)![1];

async function scaffold(def: VaultTemplateDefinition) {
  const files = new Map<string, string>();
  const adapter = {
    exists: async (p: string) => files.has(p),
    createDir: async () => {},
    writeTextFile: async (p: string, c: string) => { files.set(p, c); },
  };
  await scaffoldVaultTemplate({
    adapter: adapter as never,
    template: def,
    vaultName: "T",
    subfoldersHeading: "Sub",
    now: NOW,
  });
  return files;
}

/** Assertions both templates share. */
function sharedChecks(get: () => VaultTemplateDefinition, expectedTemplates: number) {
  it("templates stay out of the Tasks view and point at a shipped database", () => {
    const def = get();
    const basePaths = new Set((def.bases ?? []).map((b) => b.path));
    const templates = def.notes.filter((n) => (n.properties?.plainva as { tasks?: unknown })?.tasks === false);
    expect(templates).toHaveLength(expectedTemplates);
    for (const tpl of templates) {
      const assigned = (tpl.properties!.plainva as { templateFor: string[] }).templateFor;
      expect(assigned).toHaveLength(1);
      expect(basePaths.has(wikiTargets(assigned)[0]), `${tpl.path}: not a shipped database`).toBe(true);
      expect(tpl.body, `${tpl.path} lost its title placeholder`).toContain("{{title}}");
    }
  });

  it("folder rules name folders and templates the template ships", () => {
    const def = get();
    const rules = def.settings?.folderTemplates ?? [];
    expect(rules).toHaveLength(2);
    const folders = new Set(def.folders);
    const templateFolder = def.settings!.templateFolder!;
    for (const rule of rules) {
      expect(folders.has(rule.folder), `${rule.folder} is not a folder`).toBe(true);
      expect(def.notes.some((n) => n.path === `${templateFolder}/${rule.template}`), `${rule.template} is not shipped`).toBe(true);
    }
  });

  it("option columns carry colours", () => {
    const def = get();
    for (const base of def.bases ?? []) {
      const yaml = serializeBaseConfig(base.config);
      if (!yaml.includes("options:")) continue;
      expect(yaml, `${base.path} has options without colours`).toContain("color:");
    }
  });

  it("scaffolding resolves the sample dates and keeps the template tokens", async () => {
    const def = get();
    const files = await scaffold(def);
    for (const [path, content] of files) {
      expect(path).not.toContain("{{today");
      expect(content, `${path} kept a scaffold date token`).not.toContain("{{today");
    }
    const tplFolder = def.settings!.templateFolder!;
    const tpls = [...files.entries()].filter(([p]) => p.startsWith(`${tplFolder}/`) && !p.endsWith("index.md"));
    expect(tpls).toHaveLength(expectedTemplates);
    for (const [, content] of tpls) expect(content).toContain("{{title}}");
  });
}

describe("GTD template", () => {
  for (const { code: lang } of APP_LANGUAGES) {
    describe(lang, () => {
      const get = () => getVaultTemplates(lang).find((d) => d.id === "gtd")!;

      it("ships six folders, two databases and sixteen notes", () => {
        const def = get();
        expect(def.folders).toHaveLength(6);
        expect(def.bases).toHaveLength(2);
        expect(def.notes).toHaveLength(16);
      });

      it("fills BOTH task boards and the project board", () => {
        const def = get();
        const tasksBase = roundTrip(def.bases!.find((b) => b.path === def.settings!.taskDatabase)!.config);
        const projectsBase = roundTrip(def.bases!.find((b) => b.path !== def.settings!.taskDatabase)!.config);
        const tasks = def.notes.filter((n) => n.path.startsWith(`${sourceFolderOf(tasksBase)}/`));
        const projects = def.notes.filter((n) => n.path.startsWith(`${sourceFolderOf(projectsBase)}/`));

        // Status and context are the two boards GTD is built around; the third
        // board groups the projects.
        for (const [key, col] of Object.entries(tasksBase.columns)) {
          const values = optionValues(col);
          if (values.length === 0) continue;
          for (const value of values) {
            expect(
              tasks.some((n) => n.properties?.[key] === value),
              `no task is "${value}" — that board column would be empty`
            ).toBe(true);
          }
        }
        for (const [key, col] of Object.entries(projectsBase.columns)) {
          const values = optionValues(col);
          if (values.length === 0) continue;
          for (const value of values) {
            expect(projects.some((n) => n.properties?.[key] === value), `no project is "${value}"`).toBe(true);
          }
        }
      });

      it("every task that names a project names one that exists", () => {
        const def = get();
        const tasksBase = roundTrip(def.bases!.find((b) => b.path === def.settings!.taskDatabase)!.config);
        const projectsBase = roundTrip(def.bases!.find((b) => b.path !== def.settings!.taskDatabase)!.config);
        const projectKey = Object.entries(tasksBase.columns).find(
          ([, c]) => (c as { relationBase?: string }).relationBase
        )![0];
        const projectTitles = new Set(
          def.notes.filter((n) => n.path.startsWith(`${sourceFolderOf(projectsBase)}/`)).map((n) => stem(n.path))
        );

        const tasks = def.notes.filter((n) => n.path.startsWith(`${sourceFolderOf(tasksBase)}/`));
        const linked = tasks.filter((n) => n.properties?.[projectKey] !== undefined);
        // One task deliberately has none: it is the freshly captured one that
        // has not been processed yet. Everything else belongs somewhere.
        expect(linked.length).toBe(tasks.length - 1);
        for (const note of linked) {
          const target = wikiTargets(note.properties![projectKey])[0];
          expect(projectTitles.has(target), `${note.path}: project "${target}" does not exist`).toBe(true);
        }
      });

      it("the task database is readable by the app's own task model", () => {
        const def = get();
        const config = roundTrip(def.bases!.find((b) => b.path === def.settings!.taskDatabase)!.config);
        const model = resolveTaskCompletionModel(config);
        expect(model, "no completion model").toBeTruthy();
        const status = model!.kind === "status" ? model!.status : model!.status!;
        expect(status.options).toHaveLength(5);
        expect(status.open).toBe(status.options[0]);
        expect(status.done).toBe(status.options[status.options.length - 1]);
      });

      it("the due dates of the samples become real dates", async () => {
        const def = get();
        const files = await scaffold(def);
        const tasksBase = roundTrip(def.bases!.find((b) => b.path === def.settings!.taskDatabase)!.config);
        const dueKey = Object.entries(tasksBase.columns).find(([, c]) => (c as { input?: string }).input === "date")![0];
        // Only the task NOTES: a .base file mentions the key too, as a column.
        const folder = sourceFolderOf(tasksBase);
        const dated = [...files.entries()].filter(
          ([p, c]) => p.startsWith(`${folder}/`) && p.endsWith(".md") && c.split("\n").some((l) => l.startsWith(`${dueKey}:`))
        );
        expect(dated.length, "no sample carries a due date").toBeGreaterThan(0);
        for (const [path, content] of dated) {
          const line = content.split("\n").find((l) => l.startsWith(`${dueKey}:`))!;
          expect(line.split(": ")[1].trim(), path).toMatch(ISO_DATE);
        }
      });

      sharedChecks(get, 2);
    });
  }
});

describe("Zettelkasten template", () => {
  for (const { code: lang } of APP_LANGUAGES) {
    describe(lang, () => {
      const get = () => getVaultTemplates(lang).find((d) => d.id === "zettelkasten")!;
      const parts = () => {
        const def = get();
        // The slip database is the one with a single column (the source
        // relation); literature carries author, year, kind, status and the rest.
        const columnCount = (b: { config: { columns: Record<string, unknown> } }) => Object.keys(b.config.columns).length;
        const bases = def.bases! as unknown as { config: { columns: Record<string, unknown> } }[];
        const slips = roundTrip(bases.find((b) => columnCount(b) === 1)!.config);
        const literature = roundTrip(bases.find((b) => columnCount(b) > 1)!.config);
        return { def, slips, literature };
      };

      it("ships four folders, two databases and eleven notes", () => {
        const def = get();
        expect(def.folders).toHaveLength(4);
        expect(def.bases).toHaveLength(2);
        expect(def.notes).toHaveLength(11);
      });

      it("the slips link EACH OTHER in their own text", () => {
        const { def, slips } = parts();
        const folder = sourceFolderOf(slips);
        const permanent = def.notes.filter((n) => n.path.startsWith(`${folder}/`));
        expect(permanent.length).toBe(4);
        const titles = new Set(permanent.map((n) => stem(n.path)));

        let edges = 0;
        for (const note of permanent) {
          for (const target of wikiTargets(note.body.match(/\[\[[^\]]+\]\]/g) ?? [])) {
            expect(titles.has(target), `${note.path}: "${target}" is not one of the slips`).toBe(true);
            edges++;
          }
        }
        // A web, not a list: without cross-links this template shows nothing
        // that a plain folder could not.
        expect(edges, "the slips do not reference each other").toBeGreaterThanOrEqual(4);
        const linked = permanent.filter((n) => (n.body.match(/\[\[[^\]]+\]\]/g) ?? []).length > 0);
        expect(linked.length, "some slips are dead ends").toBeGreaterThanOrEqual(3);
      });

      it("every slip that names a source names a literature note that exists", () => {
        const { def, slips, literature } = parts();
        const sourceKey = Object.keys(slips.columns)[0];
        const litTitles = new Set(
          def.notes.filter((n) => n.path.startsWith(`${sourceFolderOf(literature)}/`)).map((n) => stem(n.path))
        );
        const permanent = def.notes.filter((n) => n.path.startsWith(`${sourceFolderOf(slips)}/`));
        const withSource = permanent.filter((n) => n.properties?.[sourceKey] !== undefined);
        // One slip deliberately has none — an entry point written from the
        // vault itself, not from something read.
        expect(withSource.length).toBe(permanent.length - 1);
        for (const note of withSource) {
          for (const target of wikiTargets(note.properties![sourceKey])) {
            expect(litTitles.has(target), `${note.path}: source "${target}" does not exist`).toBe(true);
          }
        }
      });

      it("the reading board holds a card in every column", () => {
        const { def, literature } = parts();
        const notes = def.notes.filter((n) => n.path.startsWith(`${sourceFolderOf(literature)}/`));
        expect(notes.length).toBe(3);
        const statusKey = Object.entries(literature.columns).find(
          ([, c]) => (c as { input?: string }).input === "status"
        )![0];
        for (const value of optionValues(literature.columns[statusKey])) {
          expect(notes.some((n) => n.properties?.[statusKey] === value), `no source is "${value}"`).toBe(true);
        }
      });

      sharedChecks(get, 2);
    });
  }
});
