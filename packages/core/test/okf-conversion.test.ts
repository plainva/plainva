import { describe, it, expect } from "vitest";
import {
  classifyOkfFile,
  scanOkfConformance,
  convertFileToOkf,
  isExcludedFromOkfScan,
  FrontmatterSurgicalError,
} from "../src/index.js";

describe("classifyOkfFile", () => {
  it("flags the three hard conformance rules", () => {
    expect(classifyOkfFile("a.md", "# no frontmatter\n")).toBe("missing-frontmatter");
    expect(classifyOkfFile("a.md", "---\n[broken\n---\n")).toBe("unparseable-frontmatter");
    expect(classifyOkfFile("a.md", "---\ntitle: x\n---\n")).toBe("missing-type");
    expect(classifyOkfFile("a.md", "---\ntype: ''\n---\n")).toBe("empty-type");
    expect(classifyOkfFile("a.md", "---\ntype:\n  - list\n---\n")).toBe("non-string-type");
    expect(classifyOkfFile("a.md", "---\ntype: Note\n---\n")).toBeNull();
  });

  it("treats reserved names as violations only when they carry concept frontmatter", () => {
    expect(classifyOkfFile("sub/index.md", "# Listing\n\n* [A](a.md)\n")).toBeNull();
    expect(classifyOkfFile("sub/index.md", "---\ntype: Note\n---\n# Not a listing\n")).toBe(
      "reserved-name-concept"
    );
    expect(classifyOkfFile("log.md", "---\ntitle: x\n---\n")).toBe("reserved-name-concept");
    // Bundle-root index.md may declare exactly okf_version (SPEC §11).
    expect(classifyOkfFile("index.md", '---\nokf_version: "0.1"\n---\n# Listing\n')).toBeNull();
    expect(classifyOkfFile("index.md", '---\nokf_version: "0.1"\ntitle: x\n---\n')).toBe(
      "reserved-name-concept"
    );
  });
});

describe("isExcludedFromOkfScan", () => {
  it("skips dot-folders, .trash and configured folders", () => {
    expect(isExcludedFromOkfScan(".obsidian/config.md")).toBe(true);
    expect(isExcludedFromOkfScan(".plainva/x.md")).toBe(true);
    expect(isExcludedFromOkfScan(".trash/old.md")).toBe(true);
    expect(isExcludedFromOkfScan("Templates/daily.md", ["Templates"])).toBe(true);
    expect(isExcludedFromOkfScan("TemplatesX/daily.md", ["Templates"])).toBe(false);
    expect(isExcludedFromOkfScan("Notes/a.md", ["Templates"])).toBe(false);
  });
});

describe("scanOkfConformance", () => {
  it("scans, classifies and buckets files", async () => {
    const files: Record<string, string> = {
      "ok.md": "---\ntype: Report\n---\nBody\n",
      "missing.md": "# nothing\n",
      "reserved/index.md": "---\ntype: Note\n---\n",
      "Templates/tpl.md": "# excluded\n",
      "note.txt": "not markdown",
    };
    const result = await scanOkfConformance({
      paths: Object.keys(files),
      readTextFile: async (p) => files[p],
      excludeFolders: ["Templates"],
    });

    expect(result.scanned).toBe(3);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        { path: "missing.md", kind: "missing-frontmatter" },
        { path: "reserved/index.md", kind: "reserved-name-concept" },
      ])
    );
    expect(result.violations.length).toBe(2);
    // Reserved files are never part of the conversion sweep.
    expect(result.convertiblePaths.sort()).toEqual(["missing.md", "ok.md"]);
    expect(result.typedPaths).toEqual(["ok.md"]);
  });
});

describe("convertFileToOkf", () => {
  it("adds type + okf_version to a bare document", () => {
    const result = convertFileToOkf("# Heading\n", { defaultType: "Note" });
    expect(result.changed).toBe(true);
    expect(result.content).toContain("type: Note");
    expect(result.content).toContain('okf_version: "0.1"');
    expect(result.content.endsWith("# Heading\n")).toBe(true);
  });

  it("keeps an existing valid type by default and only adds okf_version", () => {
    const result = convertFileToOkf("---\ntype: Report\n---\nBody\n", { defaultType: "Note" });
    expect(result.setType).toBe(false);
    expect(result.renamedType).toBe(false);
    expect(result.content).toContain("type: Report");
    expect(result.content).toContain('okf_version: "0.1"');
  });

  it("renames a valid type when the rename strategy is chosen", () => {
    const result = convertFileToOkf("---\ntype: Projektakte\n---\nBody\n", {
      defaultType: "Note",
      existingTypeStrategy: "rename",
      renameTo: "type_original",
    });
    expect(result.renamedType).toBe(true);
    expect(result.content).toContain("type_original: Projektakte");
    expect(result.content).toContain("type: Note");
  });

  it("always moves a non-string type aside", () => {
    const result = convertFileToOkf("---\ntype:\n  - projekt\n---\nBody\n", { defaultType: "Note" });
    expect(result.renamedType).toBe(true);
    expect(result.content).toContain("type_original:");
    expect(result.content).toContain("type: Note");
  });

  it("reports unchanged for already complete documents", () => {
    const content = '---\ntype: Note\nokf_version: "0.1"\n---\nBody\n';
    const result = convertFileToOkf(content, { defaultType: "Ignored" });
    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
  });

  it("preserves comments and untouched keys", () => {
    const content = "---\n# wichtiger Kommentar\ntitle: X\n---\nBody\n";
    const result = convertFileToOkf(content, { defaultType: "Note" });
    expect(result.content).toContain("# wichtiger Kommentar");
    expect(result.content).toContain("title: X");
  });

  it("throws on unparseable frontmatter instead of writing", () => {
    expect(() => convertFileToOkf("---\n[broken\n---\n", { defaultType: "Note" })).toThrow(
      FrontmatterSurgicalError
    );
  });
});
