import { describe, expect, it } from "vitest";
import { utf8Encode } from "../../workspace/encoding.js";
import { readSkillImport, type ImportedFile } from "./importSkill.js";
import { SKILL_MAX_FILES } from "./sources.js";

/** A skill from outside, checked before anything is written (plan KI-Harness P3-5, §14.3). */

const SKILL = (name = "meeting-minutes", extra = "") => `---\nname: ${name}\ndescription: Writes minutes from meeting notes.\nlicense: MIT\n${extra}---\n\nRead the notes, write the minutes.\n`;
const files = (entries: Record<string, string>): ImportedFile[] => Object.entries(entries).map(([path, text]) => ({ path, bytes: utf8Encode(text) }));

describe("importing a skill", () => {
  it("reads one skill from an archive's root, with what the dialog should name", () => {
    const imported = readSkillImport(
      files({
        "SKILL.md": SKILL("meeting-minutes", "allowed-tools: read_note Bash(git:*)\n"),
        "references/template.md": "# Minutes",
        "scripts/export.py": "print('x')",
        "assets/logo.png": "png",
        ".DS_Store": "junk",
        "__MACOSX/._SKILL.md": "resource fork",
      }),
    );
    expect(imported.blocked).toBeNull();
    expect(imported.name).toBe("meeting-minutes");
    expect(imported.files.map((f) => f.path)).toEqual(["SKILL.md", "assets/logo.png", "references/template.md", "scripts/export.py"]);
    expect(imported.files[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(imported.notes).toEqual({ scripts: ["scripts/export.py"], unknownTools: ["Bash(git:*)"], binaries: ["assets/logo.png"], license: "MIT" });
    expect(imported.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("finds the skill however deep the archive put it, and keeps its bytes", () => {
    const deep = readSkillImport(files({ "repo-main/skills/meeting-minutes/SKILL.md": SKILL(), "repo-main/skills/meeting-minutes/references/a.md": "a", "repo-main/README.md": "other" }));
    const flat = readSkillImport(files({ "meeting-minutes/SKILL.md": SKILL(), "meeting-minutes/references/a.md": "a" }));
    expect(deep.blocked).toBeNull();
    expect(deep.files.map((f) => f.path)).toEqual(["SKILL.md", "references/a.md"]);
    // The same files are the same content, whatever was packed around them.
    expect(deep.contentHash).toBe(flat.contentHash);
    // A lowercase skill.md lands as SKILL.md, its bytes unchanged.
    const lower = readSkillImport(files({ "meeting-minutes/skill.md": SKILL() }));
    expect(lower.files.map((f) => [f.path, f.sha256])).toEqual([["SKILL.md", flat.files[0]!.sha256]]);
  });

  it("leaves hidden entries inside the skill out, wherever the archive kept the skill", () => {
    const plain = readSkillImport(files({ "meeting-minutes/SKILL.md": SKILL(), "meeting-minutes/references/a.md": "a" }));
    // A repository's zip: its own bookkeeping lies beside and inside the skill.
    const repo = readSkillImport(
      files({
        "repo-main/.gitignore": "node_modules",
        "repo-main/skills/meeting-minutes/SKILL.md": SKILL(),
        "repo-main/skills/meeting-minutes/references/a.md": "a",
        "repo-main/skills/meeting-minutes/.gitignore": "*.log",
        "repo-main/skills/meeting-minutes/.github/workflows/check.yml": "on: push",
        "repo-main/skills/meeting-minutes/references/.keep": "",
      }),
    );
    expect(repo.blocked).toBeNull();
    // What is written is what the scan finds afterwards — on the phone too, whose listing shows no dot-names.
    expect(repo.files.map((f) => f.path)).toEqual(["SKILL.md", "references/a.md"]);
    expect(repo.contentHash).toBe(plain.contentHash);
    // A vault's own skills folder, zipped: the hidden folders lead to the skill and are not it.
    const vault = readSkillImport(files({ ".agent/skills/meeting-minutes/SKILL.md": SKILL(), ".agent/skills/meeting-minutes/references/a.md": "a" }));
    expect(vault.blocked).toBeNull();
    expect(vault.contentHash).toBe(plain.contentHash);
  });

  it("refuses what is no single, safe, small skill", () => {
    expect(readSkillImport(files({ "README.md": "no skill" })).blocked).toBe("no-skill");
    expect(readSkillImport(files({ "a/SKILL.md": SKILL("a"), "b/SKILL.md": SKILL("b") })).blocked).toBe("several-skills");
    expect(readSkillImport(files({ "SKILL.md": SKILL(), "../evil.md": "x" })).blocked).toBe("unsafe-path");
    expect(readSkillImport(files({ "SKILL.md": SKILL(), "/etc/passwd": "x" })).blocked).toBe("unsafe-path");
    expect(readSkillImport(files({ "SKILL.md": SKILL(), "C:/x.md": "x" })).blocked).toBe("unsafe-path");
    const many: Record<string, string> = { "SKILL.md": SKILL() };
    for (let i = 0; i <= SKILL_MAX_FILES; i++) many[`assets/${i}.txt`] = "x";
    expect(readSkillImport(files(many)).blocked).toBe("too-large");
  });

  it("refuses a SKILL.md that breaks the format, naming the problems", () => {
    const bad = readSkillImport(files({ "Meeting/SKILL.md": "---\nname: Meeting\n---\n\nx" }));
    expect(bad.blocked).toBe("invalid");
    expect(bad.problems.map((p) => p.code)).toEqual(expect.arrayContaining(["name-uppercase", "description-missing"]));
    // At the archive's root the name must still be a valid folder name.
    expect(readSkillImport(files({ "SKILL.md": "---\nname: Bad Name\ndescription: x\n---\n\nx" })).blocked).toBe("invalid");
  });
});
