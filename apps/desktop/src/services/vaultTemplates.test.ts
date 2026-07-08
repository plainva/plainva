import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyOkfFile, isPlainvaManagedIndex } from "@plainva/core";
import {
  getVaultTemplates,
  templatePreviewFolders,
  scaffoldVaultTemplate,
  applyVaultTemplateSettings,
} from "./vaultTemplates";
import { APP_LANGUAGES, DEFAULT_LANGUAGE } from "./languages";
import { dailyNotesFolderKey, templateFolderKey, dailyNoteTemplateKey } from "../contexts/VaultContext";

// The store mock also provides the bare `load` export, which the transitively
// imported CredentialManager calls at module scope (via VaultContext).
const storeValues: Record<string, unknown> = {};
vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({
    get: async (key: string) => storeValues[key],
    set: async (key: string, value: unknown) => { storeValues[key] = value; },
    save: async () => {},
  }));
  return { Store: { load }, load };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true), open: vi.fn(), confirm: vi.fn(async () => true) }));

/** In-memory ScaffoldAdapter — the scaffolder needs exists/createDir/writeTextFile only. */
class FakeAdapter {
  files = new Map<string, string>();
  dirs = new Set<string>();
  async exists(path: string) { return this.files.has(path) || this.dirs.has(path); }
  async createDir(path: string) { this.dirs.add(path); }
  async writeTextFile(path: string, content: string) { this.files.set(path, content); }
}

const FM_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

// Every registered app language runs the full suite; template sets are
// translations of the same structure, so cross-language drift (folder renamed
// in `folders` but not in the welcome links or journal settings) fails here.
const LANGS = APP_LANGUAGES.map((l) => l.code);

describe("vault templates (Gesamtplan 2026-07-04, P4; alle Sprachen seit Plan Sprachen 2026-07-04)", () => {
  beforeEach(() => {
    for (const k of Object.keys(storeValues)) delete storeValues[k];
  });

  const referenceSet = getVaultTemplates(DEFAULT_LANGUAGE);

  it("unknown languages fall back to the English set", () => {
    expect(getVaultTemplates("xx-YY")).toEqual(referenceSet);
  });

  for (const lang of LANGS) {
    describe(`language ${lang}`, () => {
      const templates = getVaultTemplates(lang);

      it("offers the agreed set (Masterplan §5.6 + Journal)", () => {
        expect(templates.map((d) => d.id)).toEqual(["para", "zettelkasten", "ace", "jd", "gtd", "journal"]);
      });

      it("mirrors the reference structure (same folder/note/base counts per template)", () => {
        for (const def of templates) {
          const ref = referenceSet.find((r) => r.id === def.id)!;
          expect({
            id: def.id,
            folders: def.folders.length,
            notes: def.notes.length,
            bases: (def.bases ?? []).length,
            settings: !!def.settings,
          }).toEqual({
            id: def.id,
            folders: ref.folders.length,
            notes: ref.notes.length,
            bases: (ref.bases ?? []).length,
            settings: !!ref.settings,
          });
        }
      });

      it("note paths only use scaffolded folders; first note is the root welcome note", () => {
        for (const def of templates) {
          expect(def.notes[0].path.includes("/"), `${def.id}: notes[0] must be the root welcome note`).toBe(false);
          for (const note of def.notes) {
            const dir = note.path.includes("/") ? note.path.slice(0, note.path.lastIndexOf("/")) : null;
            if (dir) expect(def.folders, `${def.id}: ${note.path}`).toContain(dir);
          }
        }
      });

      for (const def of getVaultTemplates(lang)) {
        it(`${def.id}: scaffold is fully OKF-conform incl. managed index.md files`, async () => {
          const adapter = new FakeAdapter();
          await scaffoldVaultTemplate({ adapter, template: def, vaultName: "Mein Vault", subfoldersHeading: "Unterordner" });

          // Every folder exists and carries a managed, frontmatter-FREE index.md
          // (frontmatter on a non-root index.md is an OKF reserved-name violation).
          for (const folder of def.folders) {
            expect(adapter.dirs.has(folder), folder).toBe(true);
            const idx = adapter.files.get(`${folder}/index.md`);
            expect(idx, `${folder}/index.md`).toBeDefined();
            expect(isPlainvaManagedIndex(idx!)).toBe(true);
            expect(FM_RE.test(idx!)).toBe(false);
          }

          // Bundle root: managed marker + okf_version + the vault name heading.
          const rootIdx = adapter.files.get("index.md")!;
          expect(isPlainvaManagedIndex(rootIdx)).toBe(true);
          expect(rootIdx).toContain('okf_version: "0.1"');
          expect(rootIdx).toContain("# Mein Vault");

          // Every scaffolded markdown file passes the OKF linter. `.base` files
          // carry no frontmatter and are never OKF-scanned (scanOkfConformance
          // skips non-.md), so they are excluded here too.
          for (const [path, content] of adapter.files) {
            if (!path.toLowerCase().endsWith(".md")) continue;
            expect(classifyOkfFile(path, content), path).toBeNull();
          }

          // The welcome note's folder links resolve to files that really exist
          // (URL-encoding must match the generator, umlauts/spaces/CJK included).
          const welcome = adapter.files.get(def.notes[0].path);
          expect(welcome, def.notes[0].path).toBeDefined();
          const urls = [...welcome!.matchAll(/\]\(([^)]+)\)/g)].map((m) => decodeURI(m[1]));
          expect(urls.length).toBeGreaterThan(0);
          for (const url of urls) {
            expect(adapter.files.has(url), url).toBe(true);
          }
        });
      }

      it("empty vault: only the bundle-root index.md is written", async () => {
        const adapter = new FakeAdapter();
        await scaffoldVaultTemplate({ adapter, template: null, vaultName: "Leer", subfoldersHeading: "Unterordner" });
        expect([...adapter.files.keys()]).toEqual(["index.md"]);
        expect(adapter.dirs.size).toBe(0);
        expect(adapter.files.get("index.md")).toContain('okf_version: "0.1"');
      });

      it("never overwrites existing files (fills the gaps only)", async () => {
        const adapter = new FakeAdapter();
        const para = templates.find((d) => d.id === "para")!;
        const welcomeName = para.notes[0].path;
        adapter.files.set("index.md", "user content");
        adapter.files.set(welcomeName, "mine");
        await scaffoldVaultTemplate({ adapter, template: para, vaultName: "V", subfoldersHeading: "Sub" });
        expect(adapter.files.get("index.md")).toBe("user content");
        expect(adapter.files.get(welcomeName)).toBe("mine");
        // The rest was still scaffolded around the existing files.
        expect(adapter.files.has(`${para.folders[0]}/index.md`)).toBe(true);
      });

      it("journal template wires the vault's daily-notes settings consistently", async () => {
        const journal = templates.find((d) => d.id === "journal")!;
        const settings = journal.settings!;
        // The wired names must reference the scaffolded structure — this is the
        // guard against translation drift between folders, notes and settings.
        expect(journal.folders).toContain(settings.dailyNotesFolder);
        expect(journal.folders).toContain(settings.templateFolder);
        expect(journal.notes.map((n) => n.path)).toContain(`${settings.templateFolder}/${settings.dailyNoteTemplate}`);

        await applyVaultTemplateSettings("/vault", journal);
        expect(storeValues[dailyNotesFolderKey("/vault")]).toBe(settings.dailyNotesFolder);
        expect(storeValues[templateFolderKey("/vault")]).toBe(settings.templateFolder);
        expect(storeValues[dailyNoteTemplateKey("/vault")]).toBe(settings.dailyNoteTemplate);
      });

      it("card preview lists the top-level folders", () => {
        const para = templates.find((d) => d.id === "para")!;
        const preview = templatePreviewFolders(para);
        expect(preview.length).toBeGreaterThan(0);
        for (const name of preview) expect(para.folders).toContain(name);
      });
    });
  }

  it("templates without settings apply nothing (ACE has no databases/settings)", async () => {
    const ace = getVaultTemplates("de").find((d) => d.id === "ace")!;
    expect(ace.settings).toBeUndefined();
    await applyVaultTemplateSettings("/vault", ace);
    expect(Object.keys(storeValues)).toHaveLength(0);
  });

  it("database templates wire only the template folder (no daily-notes keys)", async () => {
    const para = getVaultTemplates("de").find((d) => d.id === "para")!;
    await applyVaultTemplateSettings("/vault", para);
    expect(storeValues[templateFolderKey("/vault")]).toBe("Vorlagen");
    expect(storeValues[dailyNotesFolderKey("/vault")]).toBeUndefined();
    expect(storeValues[dailyNoteTemplateKey("/vault")]).toBeUndefined();
  });

  it("empty vault applies no settings", async () => {
    await applyVaultTemplateSettings("/vault", null);
    expect(Object.keys(storeValues)).toHaveLength(0);
  });
});
