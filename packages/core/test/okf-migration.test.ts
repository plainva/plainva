import { describe, expect, it } from "vitest";
import {
  bumpRootOkfDeclaration,
  migrateOkfFile,
  okfMigrationPending,
  readRootOkfDeclaration,
  scanOkfVersionState,
  stripNoteOkfVersion,
} from "../src/okf-migration.ts";
import { OKF_VERSION } from "../src/metadata.ts";
import { classifyOkfFile } from "../src/okf-conversion.ts";
import { isPlainvaManagedIndex, PLAINVA_INDEX_MARKER } from "../src/okf-index.ts";

// OKF v0.2 plan, P2 — the bundle migration is pure and idempotent.
describe("readRootOkfDeclaration", () => {
  it("reads the quoted, single-quoted, bare and commented forms", () => {
    expect(readRootOkfDeclaration('---\nokf_version: "0.1"\n---\n# V\n')).toBe("0.1");
    expect(readRootOkfDeclaration("---\nokf_version: '0.1'\n---\n")).toBe("0.1");
    expect(readRootOkfDeclaration("---\nokf_version: 0.1\n---\n")).toBe("0.1");
    expect(readRootOkfDeclaration('---\nokf_version:   "0.1"   # bundle\n---\n')).toBe("0.1");
  });

  it("reports null for a root without frontmatter or without the key", () => {
    expect(readRootOkfDeclaration("# Vault\n\n* [a](a.md)\n")).toBeNull();
    expect(readRootOkfDeclaration("---\ntitle: x\n---\n")).toBeNull();
    expect(readRootOkfDeclaration('---\nokf_version: ""\n---\n')).toBeNull();
  });
});

describe("bumpRootOkfDeclaration", () => {
  it("rewrites only the value and keeps indentation, comment, marker and body byte for byte", () => {
    const before = `---\nokf_version: "0.1"   # bundle\n---\n# Vault\n\n* [a](a.md) - first\n\n${PLAINVA_INDEX_MARKER}\n`;
    const r = bumpRootOkfDeclaration(before);
    expect(r.changed).toBe(true);
    expect(r.from).toBe("0.1");
    expect(r.content).toBe(`---\nokf_version: "${OKF_VERSION}" # bundle\n---\n# Vault\n\n* [a](a.md) - first\n\n${PLAINVA_INDEX_MARKER}\n`);
    // Still a valid managed root listing afterwards (P2 check point).
    expect(isPlainvaManagedIndex(r.content)).toBe(true);
    expect(classifyOkfFile("index.md", r.content)).toBeNull();
  });

  it("quotes a bare scalar and preserves CRLF", () => {
    const r = bumpRootOkfDeclaration("---\r\nokf_version: 0.1\r\n---\r\n# V\r\n");
    expect(r.content).toBe(`---\r\nokf_version: "${OKF_VERSION}"\r\n---\r\n# V\r\n`);
  });

  it("is idempotent and leaves a root without declaration alone", () => {
    const once = bumpRootOkfDeclaration('---\nokf_version: "0.1"\n---\n# V\n').content;
    const twice = bumpRootOkfDeclaration(once);
    expect(twice.changed).toBe(false);
    expect(twice.content).toBe(once);
    expect(twice.from).toBe(OKF_VERSION);
    const plain = bumpRootOkfDeclaration("# Vault\n");
    expect(plain).toEqual({ content: "# Vault\n", changed: false, from: null });
  });
});

describe("stripNoteOkfVersion", () => {
  it("removes exactly the legacy key and keeps the other keys and the body", () => {
    const before = '---\ntype: Note\nokf_version: "1.0"\ntags:\n  - a\n---\n\n# Title\n\nBody text.\n';
    const r = stripNoteOkfVersion(before);
    expect(r.changed).toBe(true);
    expect(r.value).toBe("1.0");
    expect(r.content).toBe("---\ntype: Note\ntags:\n  - a\n---\n\n# Title\n\nBody text.\n");
    expect(classifyOkfFile("a.md", r.content)).toBeNull();
  });

  it("is a no-op for notes without the key (the second run)", () => {
    const clean = "---\ntype: Note\n---\n\nBody\n";
    expect(stripNoteOkfVersion(clean)).toEqual({ content: clean, changed: false, value: null });
    expect(stripNoteOkfVersion("no frontmatter\n").changed).toBe(false);
  });

  it("reports a number as the string it was written as", () => {
    expect(stripNoteOkfVersion("---\ntype: Note\nokf_version: 0.1\n---\n").value).toBe("0.1");
  });

  it("leaves frontmatter that is not a mapping alone (it cannot carry the key)", () => {
    const odd = "---\n- not\n- a map\n---\n";
    expect(stripNoteOkfVersion(odd)).toEqual({ content: odd, changed: false, value: null });
  });

  it("leaves unparseable frontmatter untouched rather than guessing at it", () => {
    // The surgical layer reports "no key" for YAML it cannot parse, so the
    // migration never rewrites such a note; the conformance scan names it as
    // unparseable separately.
    const broken = '---\ntype: Note\nokf_version: "0.1"\nbroken: [\n---\n';
    expect(stripNoteOkfVersion(broken)).toEqual({ content: broken, changed: false, value: null });
  });
});

describe("migrateOkfFile", () => {
  it("routes the root to the bump, notes to the strip and other reserved files to nothing", () => {
    const root = migrateOkfFile("index.md", '---\nokf_version: "0.1"\n---\n# V\n', { stripNoteVersion: true });
    expect(root.kind).toBe("root");
    expect(root.changed).toBe(true);
    const note = migrateOkfFile("a.md", '---\ntype: Note\nokf_version: "0.1"\n---\n\nBody\n', { stripNoteVersion: true });
    expect(note.kind).toBe("note");
    expect(note.content).toBe("---\ntype: Note\n---\n\nBody\n");
    // A subfolder index.md never carries the bundle declaration and is never touched.
    const sub = migrateOkfFile("Sub/index.md", '---\nokf_version: "0.1"\n---\n# S\n', { stripNoteVersion: true });
    expect(sub).toEqual({ content: '---\nokf_version: "0.1"\n---\n# S\n', changed: false, kind: "none" });
    // Stripping is opt-in (D2 default on, but the caller decides).
    const keep = migrateOkfFile("a.md", '---\ntype: Note\nokf_version: "0.1"\n---\n', { stripNoteVersion: false });
    expect(keep.changed).toBe(false);
    expect(keep.kind).toBe("none");
  });
});

describe("scanOkfVersionState", () => {
  const files: Record<string, string> = {
    "index.md": '---\nokf_version: "0.1"\n---\n# V\n',
    "a.md": '---\ntype: Note\nokf_version: "0.1"\n---\n',
    "b.md": '---\ntype: Note\nokf_version: "1.0"\n---\n',
    "c.md": '---\ntype: Note\nokf_version: "0.1"\n---\n',
    "d.md": "---\ntype: Note\n---\n",
    "Sub/index.md": '---\nokf_version: "0.1"\n---\n',
    ".plainva/backups/x.md": '---\nokf_version: "0.1"\n---\n',
  };
  const read = async (p: string) => {
    if (!(p in files)) throw new Error(`missing ${p}`);
    return files[p];
  };

  it("reports the root declaration and the per-note values grouped", async () => {
    const state = await scanOkfVersionState({ paths: Object.keys(files), readTextFile: read });
    expect(state.rootIndex).toEqual({ exists: true, declared: "0.1", current: false });
    expect(state.targetVersion).toBe(OKF_VERSION);
    expect(state.notesWithVersion.map((n) => n.path)).toEqual(["a.md", "b.md", "c.md"]);
    expect(state.byValue).toEqual({ "0.1": 2, "1.0": 1 });
    // Reserved names and dot folders are not notes.
    expect(state.scanned).toBe(4);
    expect(okfMigrationPending(state, true)).toBe(true);
    expect(okfMigrationPending(state, false)).toBe(true);
  });

  it("treats a missing root as nothing to declare and a current root as done", async () => {
    const noRoot = await scanOkfVersionState({
      paths: ["d.md"],
      readTextFile: async (p) => {
        if (p === "index.md") throw new Error("ENOENT");
        return read(p);
      },
    });
    expect(noRoot.rootIndex).toEqual({ exists: false, declared: null, current: false });
    expect(okfMigrationPending(noRoot, true)).toBe(false);

    const current = await scanOkfVersionState({
      paths: ["a.md"],
      readTextFile: async (p) => (p === "index.md" ? `---\nokf_version: "${OKF_VERSION}"\n---\n` : files[p]),
    });
    expect(current.rootIndex.current).toBe(true);
    expect(okfMigrationPending(current, false)).toBe(false);
    expect(okfMigrationPending(current, true)).toBe(true); // a.md still carries the key
  });
});
