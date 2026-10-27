import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import i18n from "@plainva/ui/i18n";
import { LEFT_OUT_NAMES_SHOWN, createIndexNotices, indexLeftOutText, indexScanFailedText, indexUnavailableText } from "@plainva/ui";
import { REPO } from "../test-sourceTree";

// Issue #125: one link in an iCloud vault, to a folder that exists only on the
// reporter's Mac, stopped every full scan on the iPhone — and nothing on
// screen said so. The search said "This view needs the search index", tags and
// databases stayed empty, and the calendar failed with "pim runtime not
// started". The scan now leaves such an entry out; both shells say what it
// left out, and why a scan failed, through these functions.
describe("what both shells say about the search index", () => {
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("says nothing when nothing was left out", () => {
    expect(indexLeftOutText([])).toBeNull();
  });

  it("names one entry in the singular", async () => {
    await i18n.changeLanguage("en");
    const text = indexLeftOutText([{ path: "Projects/Zenn/articles", reason: "unreadable" }])!;
    expect(text).toContain("“Projects/Zenn/articles” could not be read and is left out of the search index");
    expect(text).not.toMatch(/\b1 files/);
  });

  it("counts and names several, and stops after a few names", async () => {
    await i18n.changeLanguage("de");
    const skipped = ["a", "b/c", "d", "e", "f"].map((path) => ({ path, reason: "unreadable" as const }));
    const text = indexLeftOutText(skipped)!;
    expect(text).toMatch(/^5 Dateien oder Ordner ließen sich nicht lesen/);
    expect(text).toContain("a, b/c, d, …");
    expect(text).not.toContain(", e");
    expect(LEFT_OUT_NAMES_SHOWN).toBe(3);
  });

  it("gives the reason a scan failed, and that the database did not open", async () => {
    await i18n.changeLanguage("en");
    expect(indexScanFailedText(new Error("database disk image is malformed"))).toBe(
      "The search index could not be updated: database disk image is malformed. Search, tags and databases may be incomplete until the vault is read again."
    );
    expect(indexUnavailableText(new Error("no such plugin"))).toContain("could not be opened on this device: no such plugin");
  });

  it("says each set of entries once — again when it changes, and again after a scan without one", () => {
    const said: string[] = [];
    const notices = createIndexNotices({ warning: (m) => void said.push(m), error: (m) => void said.push(`error: ${m}`) });
    const link = { path: "Projects/Zenn/articles", reason: "unreadable" as const };
    const locked = { path: "Shared", reason: "unreadable" as const };
    notices.scanned({ skipped: [link] });
    notices.scanned({ skipped: [link] });
    expect(said).toHaveLength(1);
    notices.scanned({ skipped: [locked, link] });
    expect(said).toHaveLength(2);
    notices.scanned({ skipped: [link, locked] });
    expect(said).toHaveLength(2);
    notices.scanned({ skipped: [] });
    notices.scanned({ skipped: [link] });
    expect(said).toHaveLength(3);
  });

  it("is no news for a link that leads back into a folder the walk is in: what lies there is indexed", () => {
    const said: string[] = [];
    const notices = createIndexNotices({ warning: (m) => void said.push(m), error: (m) => void said.push(`error: ${m}`) });
    const link = { path: "Projects/Zenn/articles", reason: "unreadable" as const };
    const loop = { path: "Archive/self", reason: "cycle" as const };
    notices.scanned({ skipped: [loop] });
    expect(said).toEqual([]);
    notices.scanned({ skipped: [link, loop] });
    expect(said).toHaveLength(1);
    expect(said[0]).not.toContain("Archive/self");
  });

  it("says a failure once — again when it is another, and again after a scan that went through", () => {
    const said: string[] = [];
    const notices = createIndexNotices({ warning: (m) => void said.push(m), error: (m) => void said.push(`error: ${m}`) });
    notices.failed({ trigger: "open", error: new Error("disk I/O error") });
    notices.failed({ trigger: "return to the app", error: new Error("disk I/O error") });
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^error: .*disk I\/O error/);
    notices.failed({ trigger: "refresh", error: new Error("database is locked") });
    expect(said).toHaveLength(2);
    notices.scanned({ skipped: [] });
    notices.failed({ trigger: "refresh", error: new Error("database is locked") });
    expect(said).toHaveLength(3);
  });

  it("is said by both shells through the shared notices, and a failed first scan keeps the vault", () => {
    const desktop = readFileSync(join(REPO, "apps/desktop/src/contexts/VaultContext.tsx"), "utf8");
    const mobile = readFileSync(join(REPO, "apps/mobile/src/services/vaultService.ts"), "utf8");
    for (const source of [desktop, mobile]) {
      expect(source).toContain("const indexNotices = createIndexNotices(toast);");
      expect(source).toContain("indexNotices.scanned(info);");
      expect(source).toContain("indexNotices.failed(info);");
      expect(source).not.toContain('"refresh.leftOut"');
    }
    // The desktop opens the vault — unless the load was called off — and the phone keeps its database.
    expect(desktop).toMatch(/indexer\.indexVaultFull\("open, empty index"\)\)\s*\.catch\(\(error: unknown\) => \{\s*\/\/[^\n]*\n\s*if \(currentAbortSignal\.aborted\) throw error;/);
    // Owed a full scan from the start; a warm index only counts as whole once a scan went through on it.
    expect(desktop).toContain("let coldIndexOwed = true;");
    expect(desktop).toMatch(/if \(await indexer\.indexComplete\(\)\.catch\(\(\) => false\)\) \{\s*coldIndexOwed = false;\s*deferInitialEnqueue = false;\s*\}/);
    // A container's first scan before the vault opens, a picked folder's behind it (issue 143) — both keep what they got.
    expect(mobile).toContain('await indexer.indexVaultFull("open, empty index").catch(() => {})');
    expect(mobile).toMatch(/indexWhole = indexer\s*\.indexVaultFull\("open, empty index"\)[\s\S]{0,240}\.catch\(\(\) => \{\}\)/);
    expect(mobile).toContain("toast.error(indexUnavailableText(err))");
    // Until a full scan has gone through, the task reconciler creates no notes:
    // the anchors it looks for come from the index.
    expect(desktop).toContain("mayCreateNotes: firstSyncSettled && !coldIndexOwed,");
    expect(mobile).not.toMatch(/catch\(\(\) => \{\}\);\s*indexPassSettled = true;/);
    // A warm scan that got through after the vault began to close settles nothing (both shells).
    expect(mobile).toMatch(/\.indexVaultFull\("open"\)\s*\.then\(\(\) => \{\s*(?:\/\/[^\n]*\n\s*)*if \(indexAbort\.signal\.aborted\) return;\s*indexPassSettled = true;/);
    expect(desktop).toMatch(/\.indexVaultFull\("open"\)\s*\.then\(\(report\) => \{\s*if \(currentAbortSignal\.aborted\) return;/);
    // The scan that goes through lifts the gate and the deferral first — a
    // line or a notice that fails must not keep them up — and on the desktop
    // it sends up what the first sync's sweep could not see yet.
    expect(mobile).toMatch(/onFullScan: \(info\) => \{\s*(?:\/\/[^\n]*\n\s*)*indexPassSettled = true;\s*logDiagnostic\("index", formatFullScan\(info\)\);\s*indexNotices\.scanned\(info\);/);
    expect(desktop).toMatch(/onFullScan: \(info\) => \{\s*(?:\/\/[^\n]*\n\s*)*if \(coldIndexOwed\) \{\s*coldIndexOwed = false;\s*deferInitialEnqueue = false;\s*(?:\/\/[^\n]*\n\s*)*if \(localOnlySwept\) \{\s*syncQueue\.enqueueLocalOnlyFiles\(\)/);
    const scanned = desktop.indexOf("onFullScan: (info) => {");
    expect(desktop.indexOf("if (coldIndexOwed) {", scanned)).toBeLessThan(desktop.indexOf('logDiagnostic("index", formatFullScan(info));', scanned));
    expect(desktop).toMatch(/syncWorker\.onFirstCycleComplete = \(skipped\) => \{[^}]*?syncQueue\.enqueueLocalOnlyFiles\(skipped\)[\s\S]{0,400}?localOnlySwept = true;\s*\};/);
  });
});
