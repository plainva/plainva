import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import i18n from "@plainva/ui/i18n";
import { KEPT_DELETIONS_NAMES_SHOWN, keptDeletionsDiagnostic, keptDeletionsText } from "@plainva/ui";
import { REPO } from "../test-sourceTree";

// Finding 2026-10-19: "1 in der Cloud gelöschte Dateien wurden behalten, weil
// sie hier ungesicherte Änderungen tragen." — the notice named no file, said
// nothing of what happens next, put "1" before a plural, and (in the worker)
// came back with every cycle. Both shells say it through this one function.
describe("the notice about files kept although the cloud deleted them", () => {
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("says nothing when nothing was kept", () => {
    expect(keptDeletionsText([])).toBeNull();
  });

  it("names one file in the singular, without its note extension", async () => {
    await i18n.changeLanguage("de");
    const text = keptDeletionsText(["Efforts/Traumimmobilie/02_Finanzierung.md"])!;
    expect(text).toContain("„02_Finanzierung“");
    expect(text).toContain("die Datei behalten und lädt sie wieder hoch");
    expect(text).not.toMatch(/\b1 .*Dateien/);
  });

  it("counts and names several, and stops after a few names", async () => {
    await i18n.changeLanguage("en");
    const paths = ["a/One.md", "b/Two.md", "Three.canvas", "c/Four.md", "Five.md"];
    const text = keptDeletionsText(paths)!;
    expect(text).toMatch(/^5 files were deleted in the cloud/);
    expect(text).toContain("One, Two, Three.canvas, …");
    expect(text).not.toContain("Four");
    expect(KEPT_DELETIONS_NAMES_SHOWN).toBe(3);
  });

  it("keeps the vault-relative paths in the diagnostics line", () => {
    expect(keptDeletionsDiagnostic(["a/One.md", "b/Two.md"])).toBe(
      "kept 2 file(s) deleted on the remote because they carried unsynced edits; uploading them again: a/One.md, b/Two.md"
    );
  });

  it("is said through the shared function in both shells, with a count for the plural", () => {
    const desktop = readFileSync(join(REPO, "apps/desktop/src/contexts/VaultContext.tsx"), "utf8");
    const mobile = readFileSync(join(REPO, "apps/mobile/src/services/syncService.ts"), "utf8");
    for (const source of [desktop, mobile]) {
      expect(source).toContain("keptDeletionsText(report.keptLocalEdits)");
      expect(source).toContain('i18n.t("sync.pullGuardKept", { count: kept })');
      expect(source).not.toContain('"sync.deletionsKeptLocalEdits"');
    }
  });
});
