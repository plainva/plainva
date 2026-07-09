import { describe, expect, it } from "vitest";
import { countAffectedFiles, isLargeDeletion } from "./deleteConfirm";

describe("isLargeDeletion (E2: >10 files OR >20% of the vault)", () => {
  it("triggers above 10 affected files regardless of vault size", () => {
    expect(isLargeDeletion(11, 1000)).toBe(true);
    expect(isLargeDeletion(10, 1000)).toBe(false);
  });

  it("triggers above 20% of the vault", () => {
    expect(isLargeDeletion(5, 20)).toBe(true); // 25%
    expect(isLargeDeletion(4, 20)).toBe(false); // exactly 20% is not "more than"
  });

  it("never triggers for a single file, even in a tiny vault", () => {
    expect(isLargeDeletion(1, 3)).toBe(false);
  });

  it("does not divide by zero when the vault count is unknown", () => {
    expect(isLargeDeletion(2, 0)).toBe(false);
    expect(isLargeDeletion(11, 0)).toBe(true);
  });
});

describe("countAffectedFiles", () => {
  const files = [
    { path: "a.md", isDir: false },
    { path: "proj", isDir: true },
    { path: "proj/x.md", isDir: false },
    { path: "proj/sub", isDir: true },
    { path: "proj/sub/y.md", isDir: false },
    { path: "project-notes.md", isDir: false },
  ];

  it("counts the root file itself", () => {
    expect(countAffectedFiles(files, ["a.md"])).toBe(1);
  });

  it("counts files under a folder root, not folders and not name-prefix siblings", () => {
    // "project-notes.md" starts with "proj" but is NOT inside the folder.
    expect(countAffectedFiles(files, ["proj"])).toBe(2);
  });

  it("sums multiple roots without double counting", () => {
    expect(countAffectedFiles(files, ["proj", "a.md"])).toBe(3);
  });
});
