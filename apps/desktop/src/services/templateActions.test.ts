import { beforeEach, describe, expect, it, vi } from "vitest";

// templateActions reads the template folder + configured note type from the
// settings store — stub both services to keep the test on the fs rules.
vi.mock("./newItemFlow", () => ({ getTemplateFolder: vi.fn(async () => "Templates") }));
vi.mock("./newNote", () => ({
  getConfiguredNoteType: vi.fn(async () => "Note"),
  buildNewNoteContent: vi.fn((type: string, title: string) => `---\ntype: ${type}\n---\n\n# ${title}\n`),
}));

import { createNewTemplate, saveNoteAsTemplate } from "./templateActions";

type Files = Map<string, string>;

function fakeAdapter(files: Files, opts: { failCreateDir?: boolean } = {}) {
  const dirs = new Set<string>();
  return {
    dirs,
    exists: async (p: string) => files.has(p) || dirs.has(p),
    createDir: async (p: string) => {
      if (opts.failCreateDir) throw new Error("mkdir denied");
      dirs.add(p);
    },
    writeTextFile: async (p: string, c: string) => {
      files.set(p, c);
    },
    readTextFile: async (p: string) => {
      const c = files.get(p);
      if (c === undefined) throw new Error(`missing ${p}`);
      return c;
    },
  };
}

describe("templateActions", () => {
  let files: Files;
  beforeEach(() => {
    files = new Map();
  });

  it("creates the template folder when missing and seeds # {{title}}", async () => {
    const adapter = fakeAdapter(files);
    const path = await createNewTemplate(adapter, "/vault", "Neue Vorlage");
    expect(path).toBe("Templates/Neue Vorlage.md");
    expect(files.get(path!)).toContain("# {{title}}");
    expect(adapter.dirs.has("Templates")).toBe(true);
  });

  it("numbers name collisions instead of overwriting", async () => {
    files.set("Templates/Neue Vorlage.md", "existing");
    files.set("Templates/Neue Vorlage 2.md", "existing");
    const path = await createNewTemplate(fakeAdapter(files), "/vault", "Neue Vorlage");
    expect(path).toBe("Templates/Neue Vorlage 3.md");
    expect(files.get("Templates/Neue Vorlage.md")).toBe("existing");
  });

  it("returns null when the folder cannot be created (and writes nothing)", async () => {
    const path = await createNewTemplate(fakeAdapter(files, { failCreateDir: true }), "/vault", "Neue Vorlage");
    expect(path).toBeNull();
    expect(files.size).toBe(0);
  });

  it("copies a note verbatim into the template folder, source untouched", async () => {
    files.set("Projekte/Plan.md", "---\ntype: Note\n---\n\n# Plan\n\nBody with [[Link]] and ![[img.png]]\n");
    const path = await saveNoteAsTemplate(fakeAdapter(files), "/vault", "Projekte/Plan.md");
    expect(path).toBe("Templates/Plan.md");
    expect(files.get("Templates/Plan.md")).toBe(files.get("Projekte/Plan.md"));
  });

  it("numbers template copies on collision", async () => {
    files.set("Notes/A.md", "body");
    files.set("Templates/A.md", "old");
    const path = await saveNoteAsTemplate(fakeAdapter(files), "/vault", "Notes/A.md");
    expect(path).toBe("Templates/A 2.md");
    expect(files.get("Templates/A.md")).toBe("old");
  });
});
