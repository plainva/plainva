import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isLargeDeletion } from "@plainva/ui";

/**
 * Every mobile deletion asks the same second question (S4).
 *
 * Mobile had re-implemented the E2 threshold by hand — `count > 10 || count /
 * total > 0.2` — and the copy had lost the clause that a SINGLE file never
 * needs a second prompt. In a three-note vault, deleting one note asked twice.
 * The cascade sheet asked no second question at all, and the bulk path
 * measured its share against the current FOLDER rather than the vault, so
 * three notes out of ten in a folder tripped it while the vault held five
 * hundred.
 *
 * The rule itself is tested for real below; the wiring is read from source,
 * because these three call sites live in screens that pull in Capacitor, the
 * dialog host and the sync service.
 */

const read = (...p: string[]) => readFileSync(join(__dirname, ...p), "utf8");

describe("the shared threshold", () => {
  it("keeps a single file out of the second prompt, however small the vault", () => {
    expect(isLargeDeletion(1, 3)).toBe(false); // 33% — but it is one file
    expect(isLargeDeletion(2, 3)).toBe(true);
  });
  it("asks above ten files regardless of the vault size", () => {
    expect(isLargeDeletion(11, 100_000)).toBe(true);
    expect(isLargeDeletion(10, 100_000)).toBe(false);
  });
  it("treats an unknown total as no share at all", () => {
    // countVaultFiles returns 0 without an index; that must not make every
    // deletion "large".
    expect(isLargeDeletion(5, 0)).toBe(false);
  });
});

describe("all three mobile deletion paths use it", () => {
  const browse = read("..", "screens", "BrowseScreen.tsx");
  const deleteFile = read("deleteFile.ts");

  it("the folder delete counts, warns and asks again", () => {
    expect(browse).toContain("countFolderFiles(entries)");
    expect(browse).toContain('t("mobile.deleteFolderWarn")');
    expect(browse).toContain('t("mobile.deleteFilesAction", { count })');
    expect(browse).toMatch(/isLargeDeletion\(count, total\)/);
  });

  it("the bulk delete measures against the vault, not the open folder", () => {
    expect(browse).toContain("countVaultFiles(vault.queryService)");
    // The hand-written copy that had drifted must not come back.
    expect(browse).not.toMatch(/count\s*\/\s*total\s*>\s*0\.2/);
  });

  it("the cascade asks the second question too", () => {
    expect(deleteFile).toContain("selectedPaths(plan, sel).length");
    expect(deleteFile).toContain("isLargeDeletion(count, total)");
  });
});
