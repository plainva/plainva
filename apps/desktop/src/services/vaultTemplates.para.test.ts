import { describe, it, expect, vi } from "vitest";
import {
  APP_LANGUAGES,
  getVaultTemplates,
  parseBaseConfig,
  resolveTaskCompletionModel,
  scaffoldVaultTemplate,
  serializeBaseConfig,
} from "@plainva/ui";

/**
 * What the enriched PARA template promises (plan
 * "Vorlagen-Überarbeitung + Plainva-Tour" § 3, step P3.1).
 *
 * The generic suites check OKF conformance, the Obsidian rules and that every
 * welcome link resolves. What they cannot see is whether the examples actually
 * DEMONSTRATE the method: a board with every column filled, tasks that hang off
 * real projects, projects that hang off real areas. Those relations are plain
 * text in the frontmatter — a typo in a wiki link produces a note that looks
 * fine and a database column that stays empty.
 *
 * The describe names deliberately avoid the phrase used by the cross-language
 * parity suite, so a run filtered to one language there does not drag these in.
 */

vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} }));
  return { Store: { load }, load };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true), open: vi.fn(), confirm: vi.fn(async () => true) }));

const NOW = new Date(2026, 6, 29);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const roundTrip = (config: unknown) => parseBaseConfig(serializeBaseConfig(config));
/** Option values, whether the column stores bare strings or {value,color} pairs. */
const optionValues = (col: unknown): string[] =>
  ((col as { options?: unknown[] }).options ?? []).map((o) => (typeof o === "string" ? o : String((o as { value: unknown }).value)));
const wikiTarget = (raw: unknown): string | null => {
  const m = /^\[\[([^\]|#]+)/.exec(String(raw ?? ""));
  return m ? m[1] : null;
};

describe("PARA template", () => {
  for (const { code: lang } of APP_LANGUAGES) {
    describe(lang, () => {
      const def = getVaultTemplates(lang).find((d) => d.id === "para")!;
      const notes = def.notes;
      const stem = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/, "");
      const titles = new Set(notes.map((n) => stem(n.path)));
      const basePaths = new Set((def.bases ?? []).map((b) => b.path));
      const inFolder = (folder: string) => notes.filter((n) => n.path.startsWith(`${folder}/`));

      // The three databases and the folders they read. Resolved inside the
      // tests, not while collecting them: a describe body that throws takes the
      // whole file down and reports "no tests" instead of a failing assertion.
      const sourceOf = (config: { filters: { and: unknown[] } }) =>
        String(config.filters.and[0]).match(/"([^"]+)"/)![1];
      const dbs = () => {
        const bases = (def.bases ?? []).map((b) => ({ path: b.path, config: roundTrip(b.config) }));
        const tasksBase = bases.find((b) => b.path === def.settings?.taskDatabase)!;
        expect(tasksBase, "the task database is not one of the shipped bases").toBeTruthy();
        const projectsBase = bases.find(
          (b) => b.path !== tasksBase.path && Object.values(b.config.columns).some((c: any) => c?.input === "date")
        )!;
        const areasBase = bases.find((b) => b.path !== tasksBase.path && b.path !== projectsBase?.path)!;
        return { tasksBase, projectsBase, areasBase };
      };

      it("ships six folders, three databases and nineteen notes", () => {
        expect(def.folders).toHaveLength(6);
        expect(def.bases).toHaveLength(3);
        expect(notes).toHaveLength(19);
      });

      it("fills every board column: one project per status, tasks across all three", () => {
        const { tasksBase, projectsBase } = dbs();
        const pStatus = (Object.values(projectsBase.config.columns) as any[]).find((c) => Array.isArray(c?.options))!;
        const projects = inFolder(sourceOf(projectsBase.config));
        expect(projects).toHaveLength(4);
        for (const option of optionValues(pStatus)) {
          expect(
            projects.some((n) => n.properties?.[pStatusKey(projectsBase.config)] === option),
            `no project is "${option}" — that board column would be empty`
          ).toBe(true);
        }

        const tStatus = (Object.values(tasksBase.config.columns) as any[]).find((c) => Array.isArray(c?.options))!;
        const tasks = inFolder(sourceOf(tasksBase.config));
        expect(tasks).toHaveLength(6);
        for (const option of optionValues(tStatus)) {
          expect(
            tasks.some((n) => n.properties?.[pStatusKey(tasksBase.config)] === option),
            `no task is "${option}"`
          ).toBe(true);
        }
      });

      it("every relation points at a note that exists", () => {
        const { tasksBase, projectsBase, areasBase } = dbs();
        const areaKey = relationKeyOf(projectsBase.config, areasBase.path);
        const projectKey = relationKeyOf(tasksBase.config, projectsBase.path);
        const areaTitles = new Set(inFolder(sourceOf(areasBase.config)).map((n) => stem(n.path)));
        const projectTitles = new Set(inFolder(sourceOf(projectsBase.config)).map((n) => stem(n.path)));

        for (const note of inFolder(sourceOf(projectsBase.config))) {
          const target = wikiTarget(note.properties?.[areaKey]);
          expect(target, `${note.path} has no area`).toBeTruthy();
          expect(areaTitles.has(target!), `${note.path}: area "${target}" does not exist`).toBe(true);
        }
        for (const note of inFolder(sourceOf(tasksBase.config))) {
          const target = wikiTarget(note.properties?.[projectKey]);
          expect(target, `${note.path} has no project`).toBeTruthy();
          expect(projectTitles.has(target!), `${note.path}: project "${target}" does not exist`).toBe(true);
        }
      });

      it("both status columns carry option colours", () => {
        const { tasksBase, projectsBase } = dbs();
        for (const base of [projectsBase, tasksBase]) {
          const yaml = serializeBaseConfig((def.bases ?? []).find((b) => b.path === base.path)!.config);
          expect(yaml, `${base.path} has no option colours`).toContain("color:");
        }
      });

      it("the task database is readable by the app's own task model", () => {
        const { tasksBase } = dbs();
        expect(basePaths.has(def.settings!.taskDatabase!)).toBe(true);
        const model = resolveTaskCompletionModel(tasksBase.config);
        expect(model, "no completion model").toBeTruthy();
        // PARA tracks completion through the status column alone — no checkbox.
        // Both shapes are supported; what matters is that the model resolves.
        const status = model!.kind === "status" ? model!.status : model!.status!;
        expect(status.options).toHaveLength(3);
        expect(status.open).toBe(status.options[0]);
        expect(status.done).toBe(status.options[status.options.length - 1]);
      });

      it("templates stay out of the Tasks view and point at a shipped database", () => {
        const templates = notes.filter((n) => (n.properties?.plainva as any)?.tasks === false);
        expect(templates).toHaveLength(2);
        for (const tpl of templates) {
          const assigned = (tpl.properties!.plainva as any).templateFor as string[];
          expect(assigned).toHaveLength(1);
          const target = wikiTarget(assigned[0]);
          expect(basePaths.has(target!), `${tpl.path}: ${target} is not shipped`).toBe(true);
          expect(tpl.body, `${tpl.path} lost its title placeholder`).toContain("{{title}}");
        }
      });

      it("folder rules name folders and templates the template ships", () => {
        const rules = def.settings?.folderTemplates ?? [];
        expect(rules).toHaveLength(2);
        const folders = new Set(def.folders);
        const templateFolder = def.settings!.templateFolder!;
        for (const rule of rules) {
          expect(folders.has(rule.folder), `${rule.folder} is not a folder`).toBe(true);
          expect(titles.has(rule.template.replace(/\.md$/, "")), `${rule.template} is not shipped`).toBe(true);
          expect(notes.some((n) => n.path === `${templateFolder}/${rule.template}`)).toBe(true);
        }
      });

      it("scaffolding resolves the sample dates and keeps the template tokens", async () => {
        const { tasksBase } = dbs();
        const files = new Map<string, string>();
        const adapter = {
          exists: async (p: string) => files.has(p),
          createDir: async () => {},
          writeTextFile: async (p: string, c: string) => { files.set(p, c); },
        };
        await scaffoldVaultTemplate({
          adapter: adapter as never,
          template: def,
          vaultName: "PARA",
          subfoldersHeading: "Sub",
          now: NOW,
        });

        for (const [path, content] of files) {
          expect(path).not.toContain("{{today");
          expect(content, `${path} kept a scaffold date token`).not.toContain("{{today");
        }
        // Every due date became a real date, so the board and the table sort.
        const dueKey = dateKeyOf(tasksBase.config);
        for (const note of inFolder(sourceOf(tasksBase.config))) {
          const written = files.get(note.path)!;
          const line = written.split("\n").find((l) => l.startsWith(`${dueKey}:`))!;
          expect(line.split(": ")[1].trim(), note.path).toMatch(ISO_DATE);
        }
        // A template's own placeholder is resolved when a NOTE is created from
        // it, so it has to survive scaffolding untouched.
        const tplFolder = def.settings!.templateFolder!;
        const tpls = [...files.entries()].filter(([p]) => p.startsWith(`${tplFolder}/`) && !p.endsWith("index.md"));
        expect(tpls).toHaveLength(2);
        for (const [, content] of tpls) expect(content).toContain("{{title}}");
      });
    });
  }
});

/** Key of the column that carries the status options. */
function pStatusKey(config: { columns: Record<string, unknown> }): string {
  return Object.entries(config.columns).find(([, c]) => Array.isArray((c as any)?.options))![0];
}

/** Key of the relation column that points at `basePath`. */
function relationKeyOf(config: { columns: Record<string, unknown> }, basePath: string): string {
  const hit = Object.entries(config.columns).find(([, c]) => (c as any)?.relationBase === basePath);
  if (!hit) throw new Error(`no relation column pointing at ${basePath}`);
  return hit[0];
}

/** Key of the first date column. */
function dateKeyOf(config: { columns: Record<string, unknown> }): string {
  return Object.entries(config.columns).find(([, c]) => (c as any)?.input === "date")![0];
}
