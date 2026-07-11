import { describe, it, expect, vi } from "vitest";
import * as yaml from "yaml";
import { getVaultTemplates } from "./vaultTemplates";
import { parseBaseConfig, serializeBaseConfig } from "@plainva/ui";
import { resolveNewItemTarget, sourceFolderOfConfig } from "@plainva/ui";
import { APP_LANGUAGES } from "@plainva/ui";

// CredentialManager (transitively imported via VaultContext) calls store.load()
// at module scope; without a mock that hits `window` in the node environment.
vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({
    get: async () => undefined,
    set: async () => {},
    save: async () => {},
  }));
  return { Store: { load }, load };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(), open: vi.fn(), confirm: vi.fn() }));

// Cross-language integrity of the `.base` databases shipped with the vault
// templates (Gesamtplan DB-Vorlagen 2026-07-04). The structure is built once by
// baseBuilders.defineBase; each language only translates strings. These tests
// catch translation drift the parity test in vaultTemplates.test.ts cannot:
// broken relation wiring, example values outside their column options, links to
// missing notes, and templates that would copy a stale description.

const LANGS = APP_LANGUAGES.map((l) => l.code);

// Templates that must ship databases, and their expected base count.
const EXPECTED_BASES: Record<string, number> = { para: 3, zettelkasten: 2, gtd: 2, journal: 1 };
// Templates that must stay database-free (link-/folder-based on purpose).
const NO_BASE_IDS = new Set(["ace", "jd"]);

/** Vault-relative folder of a note path ("A/B/c.md" -> "A/B", "c.md" -> ""). */
function folderOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

/** Basename of a note path without the .md extension. */
function stemOf(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/i, "");
}

/** Wiki-link target ("[[Note#a|Alias]]" -> "Note"), or null for non-links. */
function wikiTarget(v: unknown): string | null {
  const m = String(v).trim().match(/^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/);
  return m ? m[1].trim() : null;
}

/** Flattens a scalar-or-list property value into individual entries. */
function asList(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [v];
}

describe("vault template databases (Gesamtplan DB-Vorlagen 2026-07-04)", () => {
  for (const lang of LANGS) {
    describe(`language ${lang}`, () => {
      const templates = getVaultTemplates(lang);

      it("ships databases exactly where expected", () => {
        for (const def of templates) {
          const count = (def.bases ?? []).length;
          if (def.id in EXPECTED_BASES) expect(count, def.id).toBe(EXPECTED_BASES[def.id]);
          else if (NO_BASE_IDS.has(def.id)) expect(count, def.id).toBe(0);
        }
      });

      for (const def of templates.filter((d) => (d.bases ?? []).length > 0)) {
        describe(`${def.id}`, () => {
          const bases = def.bases!;
          const basePaths = new Set(bases.map((b) => b.path));
          const noteStems = new Set(def.notes.map((n) => stemOf(n.path)));
          // path -> parsed on-disk config, plus its resolved source folder.
          const parsedByPath = new Map<string, any>();
          const folderToPath = new Map<string, string>();
          for (const b of bases) {
            const parsed = parseBaseConfig(serializeBaseConfig(b.config));
            parsedByPath.set(b.path, parsed);
            const folder = sourceFolderOfConfig(parsed);
            expect(folder, `${b.path}: needs exactly one folder source`).toBeTruthy();
            folderToPath.set(folder!, b.path);
          }

          it("serializes to valid, self-stable Obsidian YAML", () => {
            for (const b of bases) {
              const y1 = serializeBaseConfig(b.config);
              expect(() => yaml.parse(y1), b.path).not.toThrow();
              // Idempotent: a first Plainva save must not rewrite the file.
              const y2 = serializeBaseConfig(parseBaseConfig(y1));
              expect(y2, `${b.path} not stable across a save round-trip`).toBe(y1);
            }
          });

          it("obeys Obsidian's hard rules (named views, single-rooted filters, Obsidian-evaluable filter)", () => {
            for (const b of bases) {
              const obj = yaml.parse(serializeBaseConfig(b.config));
              expect(Array.isArray(obj.views), b.path).toBe(true);
              for (const v of obj.views) expect(typeof v.name === "string" && v.name.trim(), `${b.path} view name`).toBeTruthy();
              // Exactly one of and/or/not at the filter root.
              expect(Object.keys(obj.filters), `${b.path} filters root`).toHaveLength(1);
              // The source is a plain folder condition (valid in both Plainva and
              // Obsidian). It must NOT use a Plainva-only global function like
              // `contains(...)` — Obsidian's Bases has no such function and would
              // reject the whole base ("Funktion 'contains' wurde nicht gefunden").
              // index.md is dropped in Plainva's query layer, not via a filter.
              expect(obj.filters.and, `${b.path} folder source`).toContain(`file.folder == "${sourceFolderOfConfig(parsedByPath.get(b.path))}"`);
              const serialized = serializeBaseConfig(b.config);
              expect(serialized, `${b.path} must stay Obsidian-evaluable (no global contains())`).not.toMatch(/\bcontains\(/);
            }
          });

          it("the New button resolves a folder without a dialog", () => {
            for (const b of bases) {
              const parsed = parsedByPath.get(b.path);
              const target = resolveNewItemTarget(parsed);
              expect(target.folder, b.path).toBe(sourceFolderOfConfig(parsed));
              expect(target.pending, b.path).toBeNull();
            }
          });

          it("relation and reverse columns are wired bidirectionally to real bases", () => {
            for (const b of bases) {
              const cols: Record<string, any> = parsedByPath.get(b.path).columns;
              for (const [key, col] of Object.entries(cols)) {
                if (col.relationBase) {
                  expect(basePaths, `${b.path}.${key} -> ${col.relationBase}`).toContain(col.relationBase);
                }
                if (col.relationLimit !== undefined) expect(col.relationLimit).toBe("one");
                if (col.reverseOf) {
                  expect(basePaths, `${b.path}.${key} reverseOf ${col.reverseOf.base}`).toContain(col.reverseOf.base);
                  // The owning base must carry a relation column named after
                  // reverseOf.property that points BACK at this base.
                  const owner: Record<string, any> = parsedByPath.get(col.reverseOf.base).columns;
                  const ownCol = owner[col.reverseOf.property];
                  expect(ownCol, `${col.reverseOf.base}.${col.reverseOf.property} missing`).toBeTruthy();
                  expect(ownCol.relationBase, `${col.reverseOf.base}.${col.reverseOf.property} must point at ${b.path}`).toBe(b.path);
                }
              }
            }
          });

          it("example notes only set known columns, with values inside the column options", () => {
            for (const note of def.notes) {
              const basePath = folderToPath.get(folderOf(note.path));
              if (!basePath || !note.properties) continue; // note not governed by a template DB
              const cols: Record<string, any> = parsedByPath.get(basePath).columns;
              for (const [key, value] of Object.entries(note.properties)) {
                const col = cols[key];
                expect(col, `${note.path}: '${key}' is not a column of ${basePath}`).toBeTruthy();
                if (Array.isArray(col.options)) {
                  const allowed = new Set(col.options.map((o: any) => o.value));
                  for (const entry of asList(value)) {
                    expect(allowed, `${note.path}: '${key}'='${entry}' not an option of ${basePath}`).toContain(entry);
                  }
                }
              }
            }
          });

          it("relation values in example notes link to notes that exist", () => {
            for (const note of def.notes) {
              if (!note.properties) continue;
              for (const value of Object.values(note.properties)) {
                for (const entry of asList(value)) {
                  const target = wikiTarget(entry);
                  if (target) expect(noteStems, `${note.path} -> [[${target}]]`).toContain(target);
                }
              }
            }
          });

          it("newItemTemplate points at a shipped, description-free template note", () => {
            for (const b of bases) {
              const tplPath = (b.config as any).newItemTemplate;
              if (!tplPath) continue;
              const tpl = def.notes.find((n) => n.path === tplPath);
              expect(tpl, `${b.path}: newItemTemplate ${tplPath} not scaffolded`).toBeTruthy();
              // A template's whole frontmatter is copied into every note made
              // from it — a description would leak into all of them.
              expect(tpl!.description, `${tplPath} must be description-free`).toBeUndefined();
              // Its default property values must be valid options too.
              if (tpl!.properties) {
                const cols: Record<string, any> = parsedByPath.get(b.path).columns;
                for (const [key, value] of Object.entries(tpl!.properties)) {
                  const col = cols[key];
                  if (col && Array.isArray(col.options)) {
                    const allowed = new Set(col.options.map((o: any) => o.value));
                    for (const entry of asList(value)) {
                      expect(allowed, `${tplPath}: '${key}'='${entry}' not an option`).toContain(entry);
                    }
                  }
                }
              }
            }
          });
        });
      }

      // Journal: the daily-note template feeds Journal.base via the calendar, so
      // its property keys must line up with the base columns even though it
      // lives in the (DB-less) template folder.
      it("journal daily template lines up with Journal.base columns", () => {
        const journal = templates.find((d) => d.id === "journal");
        if (!journal?.bases?.length || !journal.settings?.dailyNoteTemplate) return;
        const journalBase = journal.bases.find((b) => sourceFolderOfConfig(parseBaseConfig(serializeBaseConfig(b.config))) === journal.settings!.dailyNotesFolder);
        expect(journalBase, "journal base for the daily-notes folder").toBeTruthy();
        const cols: Record<string, any> = parseBaseConfig(serializeBaseConfig(journalBase!.config)).columns;
        const tplPath = `${journal.settings.templateFolder}/${journal.settings.dailyNoteTemplate}`;
        const tpl = journal.notes.find((n) => n.path === tplPath);
        expect(tpl, tplPath).toBeTruthy();
        for (const key of Object.keys(tpl!.properties ?? {})) {
          expect(cols[key], `daily template '${key}' is not a Journal.base column`).toBeTruthy();
        }
      });
    });
  }
});
