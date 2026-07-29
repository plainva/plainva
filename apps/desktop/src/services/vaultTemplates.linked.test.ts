import { describe, it, expect, vi } from "vitest";
import {
  APP_LANGUAGES,
  getVaultTemplates,
  parseBaseConfig,
  scaffoldVaultTemplate,
  serializeBaseConfig,
} from "@plainva/ui";
import type { VaultTemplateDefinition } from "@plainva/ui";

/**
 * What the three link-driven templates are supposed to DEMONSTRATE (plan
 * "Vorlagen-Überarbeitung + Plainva-Tour" § 3, step P3.3). PARA lives in
 * `vaultTemplates.para.test.ts`, GTD and Zettelkasten in
 * `vaultTemplates.methods.test.ts`.
 *
 * - **ACE** claims a map beats a hierarchy. That claim is only visible when Home
 *   links maps, a map links a note, and at least one map points OUT of the Atlas.
 *   A vault of unlinked notes in three folders teaches the opposite.
 * - **Johnny.Decimal** IS its numbering, plus one rule: if a number is not in the
 *   index, it does not exist. So the IDs have to sit in the categories they name
 *   and the index has to list every one of them.
 * - **Journal** shipped a table and a calendar with nothing in them. Both views
 *   have to be populated on day one, which means real entries named in the
 *   daily-note format, carrying a mood the column actually offers.
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

const stem = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/, "");
const folderOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
/** Every `[[target]]` of a note body, anchors and aliases removed. */
const linksIn = (body: string) => [...body.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim());
const optionValues = (col: unknown): string[] =>
  ((col as { options?: unknown[] }).options ?? []).map((o) => (typeof o === "string" ? o : String((o as { value: unknown }).value)));

async function scaffold(def: VaultTemplateDefinition) {
  const files = new Map<string, string>();
  const adapter = {
    exists: async (p: string) => files.has(p),
    createDir: async () => {},
    writeTextFile: async (p: string, c: string) => { files.set(p, c); },
  };
  await scaffoldVaultTemplate({ adapter: adapter as never, template: def, vaultName: "T", subfoldersHeading: "Sub", now: NOW });
  return files;
}

/** Assertions all three share. */
function sharedChecks(get: () => VaultTemplateDefinition) {
  it("every wiki link points at a note the template ships", () => {
    const def = get();
    const titles = new Set(def.notes.map((n) => stem(n.path)));
    for (const note of def.notes) {
      for (const target of linksIn(note.body)) {
        expect(titles.has(target), `${note.path}: dead link [[${target}]]`).toBe(true);
      }
    }
  });

  it("every note lands in a folder the template creates", () => {
    const def = get();
    const folders = new Set(def.folders ?? []);
    for (const note of def.notes) {
      const folder = folderOf(note.path);
      if (!folder) continue;
      expect(folders.has(folder), `${note.path}: ${folder} is not created`).toBe(true);
    }
  });

  it("the welcome note carries link sections that resolve", async () => {
    const def = get();
    const files = await scaffold(def);
    const welcome = [...files.entries()].find(([p]) => !p.includes("/") && p !== "index.md")!;
    expect(welcome, "no welcome note at the vault root").toBeTruthy();
    const targets = [...welcome[1].matchAll(/^\* \[[^\]]+\]\(([^)]+)\)$/gm)].map((m) => decodeURIComponent(m[1]));
    expect(targets.length, "the welcome note links nothing").toBeGreaterThan(0);
    for (const target of targets) {
      expect(files.has(target), `welcome links a missing file: ${target}`).toBe(true);
    }
  });

  it("scaffolding resolves the date tokens", async () => {
    const def = get();
    const files = await scaffold(def);
    for (const [path, content] of files) {
      expect(path, `${path} kept a scaffold date token`).not.toContain("{{today");
      expect(content, `${path} kept a scaffold date token`).not.toContain("{{today");
    }
  });
}

describe("ACE template", () => {
  for (const lang of APP_LANGUAGES) {
    describe(lang.code, () => {
      const get = () => getVaultTemplates(lang.code).find((t) => t.id === "ace")!;

      it("ships three folders and seven notes, no database", () => {
        const def = get();
        expect(def.folders).toHaveLength(3);
        expect(def.notes).toHaveLength(7);
        expect(def.bases ?? [], "ACE navigates by links, not by rows").toHaveLength(0);
      });

      it("Home reaches every content note through links", () => {
        const def = get();
        const byTitle = new Map(def.notes.map((n) => [stem(n.path), n]));
        // The welcome note is the entry point INTO Home; everything else has to
        // hang off Home, or the vault teaches "unlinked notes in folders".
        const welcome = def.notes.find((n) => !n.path.includes("/"))!;
        const home = linksIn(welcome.body).length
          ? byTitle.get(linksIn(welcome.body)[0])
          : undefined;
        const start = home ?? def.notes.find((n) => n.path.includes("/"))!;
        const seen = new Set<string>([stem(start.path)]);
        const queue = [start];
        while (queue.length) {
          for (const target of linksIn(queue.shift()!.body)) {
            if (seen.has(target)) continue;
            seen.add(target);
            const next = byTitle.get(target);
            if (next) queue.push(next);
          }
        }
        // The Calendar is navigated by DATE, not by map — a link from Home to a
        // dated note would point at yesterday tomorrow. Its reachability is
        // covered by the daily-note test below instead.
        const calendar = def.folders![1];
        const unreachable = def.notes.filter(
          (n) => n !== welcome && !n.path.startsWith(`${calendar}/`) && !seen.has(stem(n.path))
        );
        expect(unreachable.map((n) => n.path), "notes no link path reaches").toEqual([]);
      });

      it("a map points out of the Atlas", () => {
        const def = get();
        const [atlas, , efforts] = def.folders!;
        const effortTitles = new Set(def.notes.filter((n) => n.path.startsWith(`${efforts}/`)).map((n) => stem(n.path)));
        const crossing = def.notes.filter(
          (n) => n.path.startsWith(`${atlas}/`) && linksIn(n.body).some((t) => effortTitles.has(t))
        );
        expect(crossing.length, "no Atlas note links an effort — the crosswise claim is unproven").toBeGreaterThan(0);
      });

      it("the calendar note is the vault's daily note for today", async () => {
        const def = get();
        const calendar = def.folders![1];
        expect(def.settings?.dailyNotesFolder, "daily notes must land in the Calendar folder").toBe(calendar);
        const note = def.notes.find((n) => n.path.startsWith(`${calendar}/`))!;
        expect(stem(note.path), "the calendar sample must be named by date").toBe("{{today}}");
        expect(note.type, "a calendar entry is a daily note").toBe("Daily Note");
        const files = await scaffold(def);
        const written = [...files.keys()].filter((p) => p.startsWith(`${calendar}/`) && p.endsWith(".md") && !p.endsWith("index.md"));
        expect(written).toHaveLength(1);
        expect(stem(written[0])).toMatch(ISO_DATE);
      });

      sharedChecks(get);
    });
  }
});

describe("Johnny.Decimal template", () => {
  for (const lang of APP_LANGUAGES) {
    describe(lang.code, () => {
      const get = () => getVaultTemplates(lang.code).find((t) => t.id === "jd")!;

      it("ships eight folders and five notes, no database", () => {
        const def = get();
        expect(def.folders).toHaveLength(8);
        expect(def.notes).toHaveLength(5);
        expect(def.bases ?? [], "the method is the numbering, not a table").toHaveLength(0);
      });

      it("areas, categories and IDs are numbered the way the method requires", () => {
        const def = get();
        const areas = def.folders!.filter((f) => !f.includes("/"));
        for (const area of areas) expect(area, `${area} is not an area number`).toMatch(/^\d\d-\d\d /);
        const categories = def.folders!.filter((f) => f.includes("/"));
        for (const cat of categories) {
          expect(cat.slice(cat.lastIndexOf("/") + 1), `${cat} is not a category number`).toMatch(/^\d\d /);
        }
        for (const note of def.notes) {
          if (!note.path.includes("/")) continue; // the welcome note carries no ID
          expect(stem(note.path), `${note.path} has no Johnny.Decimal ID`).toMatch(/^\d\d\.\d\d /);
        }
      });

      it("an ID sits in the category it names", () => {
        const def = get();
        for (const note of def.notes) {
          if (!note.path.includes("/")) continue;
          const id = stem(note.path).slice(0, 5);
          const category = folderOf(note.path);
          const number = category.slice(category.lastIndexOf("/") + 1).slice(0, 2);
          expect(id.slice(0, 2), `${note.path}: ID ${id} does not belong to category ${number}`).toBe(number);
        }
      });

      it("the index lists every number that exists", () => {
        const def = get();
        const index = def.notes.find((n) => stem(n.path).startsWith("00.00"))!;
        expect(index, "no 00.00 index note").toBeTruthy();
        const listed = new Set(linksIn(index.body));
        const numbered = def.notes.filter((n) => n !== index && n.path.includes("/")).map((n) => stem(n.path));
        expect(numbered.length, "nothing to index").toBeGreaterThan(0);
        for (const title of numbered) {
          expect(listed.has(title), `${title} is not in the index — by the method it does not exist`).toBe(true);
        }
        // Every category folder is named in the index too, so the empty one is
        // visibly reserved rather than forgotten.
        for (const folder of def.folders!.filter((f) => f.includes("/"))) {
          const name = folder.slice(folder.lastIndexOf("/") + 1);
          if (name.startsWith("00 ")) continue; // the index's own home
          expect(index.body, `category ${name} is missing from the index`).toContain(name);
        }
      });

      sharedChecks(get);
    });
  }
});

describe("Journal template", () => {
  for (const lang of APP_LANGUAGES) {
    describe(lang.code, () => {
      const get = () => getVaultTemplates(lang.code).find((t) => t.id === "journal")!;
      // Parsed configs are flat: the `plainva` namespace is unwrapped into the
      // view itself (baseFormat.ts), so `dateField` sits on the view.
      const base = () => parseBaseConfig(serializeBaseConfig(get().bases![0].config)) as {
        columns: Record<string, { options?: unknown[] }>;
        views: { dateField?: string }[];
      };

      it("ships two folders, one database and four notes", () => {
        const def = get();
        expect(def.folders).toHaveLength(2);
        expect(def.bases ?? []).toHaveLength(1);
        expect(def.notes).toHaveLength(4); // welcome + two days + the template
      });

      it("both views open with rows in them", () => {
        const def = get();
        const [journalFolder] = def.folders!;
        const days = def.notes.filter((n) => n.path.startsWith(`${journalFolder}/`));
        expect(days, "a calendar with no entries demonstrates nothing").toHaveLength(2);
        const cfg = base();
        const dateKey = cfg.views.find((v) => v.dateField)!.dateField!;
        const moodKey = Object.keys(cfg.columns).find((k) => optionValues(cfg.columns[k]).length > 0)!;
        expect(Object.keys(cfg.columns), "the calendar's date field is not a column").toContain(dateKey);
        const moods = optionValues(cfg.columns[moodKey]);
        expect(moods.length, "the mood column has no options").toBeGreaterThan(1);
        for (const day of days) {
          expect(day.type, `${day.path} is not a daily note`).toBe("Daily Note");
          expect(String(day.properties?.[dateKey] ?? ""), `${day.path} has no date`).toContain("{{today");
          expect(moods, `${day.path}: mood is not one the column offers`).toContain(day.properties?.[moodKey]);
        }
      });

      it("the two days are today and yesterday", async () => {
        const def = get();
        const [journalFolder] = def.folders!;
        const files = await scaffold(def);
        const written = [...files.keys()]
          .filter((p) => p.startsWith(`${journalFolder}/`) && p.endsWith(".md") && !p.endsWith("index.md"))
          .map(stem)
          .sort();
        expect(written).toEqual(["2026-07-28", "2026-07-29"]);
      });

      it("the mood column carries colours", () => {
        const yaml = serializeBaseConfig(get().bases![0].config);
        expect(yaml, "options without colours").toContain("color:");
      });

      it("the daily-note template is wired and stays out of the Tasks view", () => {
        const def = get();
        const [, templateFolder] = def.folders!;
        expect(def.settings?.templateFolder).toBe(templateFolder);
        const file = def.settings?.dailyNoteTemplate;
        expect(file, "no daily-note template configured").toBeTruthy();
        const template = def.notes.find((n) => n.path === `${templateFolder}/${file}`);
        expect(template, `${file} is not shipped`).toBeTruthy();
        expect((template!.properties?.plainva as { tasks?: unknown })?.tasks, "the template's empty task line would pollute the Tasks view").toBe(false);
        expect(template!.body, "the template lost its title placeholder").toContain("{{title}}");
      });

      sharedChecks(get);
    });
  }
});
