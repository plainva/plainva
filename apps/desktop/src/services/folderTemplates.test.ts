import { describe, it, expect } from "vitest";
import {
  normalizeFolderPath,
  parseFolderTemplateRules,
  parseTypeTemplateRules,
  resolveFolderTemplate,
  resolveTypeTemplate,
  resolveTemplateForNewNote,
} from "@plainva/ui";

describe("normalizeFolderPath", () => {
  it("brings every spelling of the same folder to one shape", () => {
    for (const raw of ["Projekte", "/Projekte", "Projekte/", "./Projekte", "\\Projekte\\", " Projekte "]) {
      expect(normalizeFolderPath(raw)).toBe("Projekte");
    }
  });

  it("treats '.', '/' and the empty string as the vault root", () => {
    expect(normalizeFolderPath(".")).toBe("");
    expect(normalizeFolderPath("/")).toBe("");
    expect(normalizeFolderPath("")).toBe("");
  });
});

describe("parseFolderTemplateRules", () => {
  it("survives whatever the settings store hands over", () => {
    expect(parseFolderTemplateRules(null)).toEqual([]);
    expect(parseFolderTemplateRules("nope")).toEqual([]);
    expect(parseFolderTemplateRules([null, 42, { folder: 1, template: "x" }, { folder: "a" }])).toEqual([]);
  });

  it("normalizes as it reads, so stored spellings never leak into matching", () => {
    expect(parseFolderTemplateRules([{ folder: "/Projekte/", template: " Projekt.md " }])).toEqual([
      { folder: "Projekte", template: "Projekt.md" },
    ]);
  });
});

describe("resolveFolderTemplate", () => {
  const rules = parseFolderTemplateRules([
    { folder: "Projekte", template: "Projekt.md" },
    { folder: "Projekte/Kunden", template: "Kundenprojekt.md" },
    { folder: "Meetings", template: "Besprechung.md" },
  ]);

  it("applies to the folder itself and everything below it", () => {
    expect(resolveFolderTemplate(rules, "Projekte")).toBe("Projekt.md");
    expect(resolveFolderTemplate(rules, "Projekte/2026")).toBe("Projekt.md");
  });

  it("lets the LONGEST matching path win — the deeper rule is the special case", () => {
    expect(resolveFolderTemplate(rules, "Projekte/Kunden")).toBe("Kundenprojekt.md");
    expect(resolveFolderTemplate(rules, "Projekte/Kunden/ACME")).toBe("Kundenprojekt.md");
  });

  it("does not mistake a sibling for a child", () => {
    // "Projekte-Archiv" starts with "Projekte" as a STRING but is a different
    // folder — the separator is what makes it a child.
    expect(resolveFolderTemplate(rules, "Projekte-Archiv")).toBeNull();
  });

  it("ignores case, because a typed folder rarely matches a picked one letter for letter", () => {
    expect(resolveFolderTemplate(rules, "projekte/kunden")).toBe("Kundenprojekt.md");
  });

  it("returns nothing for an unmapped folder", () => {
    expect(resolveFolderTemplate(rules, "Inbox")).toBeNull();
    expect(resolveFolderTemplate(rules, "")).toBeNull();
  });

  it("lets a root rule cover the whole vault, still beaten by anything deeper", () => {
    const withRoot = parseFolderTemplateRules([
      { folder: "", template: "Standard.md" },
      { folder: "Meetings", template: "Besprechung.md" },
    ]);
    expect(resolveFolderTemplate(withRoot, "")).toBe("Standard.md");
    expect(resolveFolderTemplate(withRoot, "Irgendwo/Tief")).toBe("Standard.md");
    expect(resolveFolderTemplate(withRoot, "Meetings/2026")).toBe("Besprechung.md");
  });

  it("keeps a half-filled rule out of the way", () => {
    // Adding a row creates an empty rule; it is stored so it can be finished
    // later, but it must never claim a folder.
    const half = parseFolderTemplateRules([
      { folder: "Projekte", template: "" },
      { folder: "", template: "" },
    ]);
    expect(resolveFolderTemplate(half, "Projekte")).toBeNull();
  });
});

describe("resolveTypeTemplate", () => {
  const rules = parseTypeTemplateRules([
    { type: "Meeting", template: "Besprechung.md" },
    { type: "Person", template: "" },
  ]);

  it("matches a type regardless of case", () => {
    expect(resolveTypeTemplate(rules, "meeting")).toBe("Besprechung.md");
  });

  it("ignores an unfinished rule and an unknown type", () => {
    expect(resolveTypeTemplate(rules, "Person")).toBeNull();
    expect(resolveTypeTemplate(rules, "Note")).toBeNull();
    expect(resolveTypeTemplate(rules, "")).toBeNull();
  });
});

describe("resolveTemplateForNewNote", () => {
  const folders = parseFolderTemplateRules([{ folder: "Meetings", template: "Besprechung.md" }]);
  const types = parseTypeTemplateRules([{ type: "Meeting", template: "Typ-Besprechung.md" }]);

  it("lets the folder beat the type", () => {
    expect(resolveTemplateForNewNote(folders, types, "Meetings", "Meeting")).toBe("Besprechung.md");
  });

  it("falls back to the type where no folder rule reaches", () => {
    expect(resolveTemplateForNewNote(folders, types, "Inbox", "Meeting")).toBe("Typ-Besprechung.md");
  });

  it("returns nothing when neither has an opinion", () => {
    expect(resolveTemplateForNewNote(folders, types, "Inbox", "Note")).toBeNull();
  });
});
