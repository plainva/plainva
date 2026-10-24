// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sayLineEndsConverted, toast, toastStore } from "@plainva/ui";
import { sourceFile, sourceMap } from "./test-sourceTree";

/**
 * The notice for a change nobody asked for (maintainer, 2026-10-12): a
 * carriage return of its own is a line end the app reads and does not keep, so
 * the first write that changes such a file turns every line end of it. Both
 * shells hand `sayLineEndsConverted` to the top of their adapter chain
 * (`sharedShellWiring.test.ts` holds that).
 */
describe("the notice that a file's line ends were turned", () => {
  beforeEach(() => { vi.useFakeTimers(); toast.clearAll(); });
  // A burst a test left open is said before the next test begins.
  afterEach(() => { vi.runOnlyPendingTimers(); toast.clearAll(); vi.useRealTimers(); });

  it("names the file and the line end it has now", () => {
    sayLineEndsConverted("Archive/Old Mac.txt", "\n");
    // Not at once: a gesture that writes many files is gathered into one notice.
    expect(toastStore.get()).toEqual([]);
    vi.advanceTimersByTime(600);
    expect(toastStore.get()).toHaveLength(1);
    const [notice] = toastStore.get();
    expect(notice.kind).toBe("info");
    expect(notice.message).toContain("Old Mac.txt");
    expect(notice.message).not.toContain("Archive/");
    expect(notice.message).toContain("LF");
    expect(notice.message).not.toContain("CRLF");
  });

  it("says CRLF for a file that came back with it", () => {
    // Twice-converted line ends from Windows: the file's other line ends decide.
    sayLineEndsConverted("Twice.md", "\r\n");
    vi.advanceTimersByTime(600);
    expect(toastStore.get()[0].message).toContain("CRLF");
    expect(toastStore.get()[0].message).toContain("Twice.md");
  });

  it("says a burst of writes in one notice, and a later write in one of its own", () => {
    for (const path of ["Notes/a.md", "Notes/b.md", "Notes/c.md"]) sayLineEndsConverted(path, "\n");
    vi.advanceTimersByTime(600);
    expect(toastStore.get()).toHaveLength(1);
    expect(toastStore.get()[0].message).toContain("3");
    expect(toastStore.get()[0].message).not.toContain("a.md");

    sayLineEndsConverted("Notes/d.md", "\n");
    vi.advanceTimersByTime(600);
    expect(toastStore.get()).toHaveLength(2);
    expect(toastStore.get()[1].message).toContain("d.md");
  });

  it("waits for the next file of a gesture that takes a while, and not longer than a few seconds", () => {
    // A rename through a folder of old notes: one file every 400 ms.
    sayLineEndsConverted("Old/1.md", "\n");
    vi.advanceTimersByTime(400);
    sayLineEndsConverted("Old/2.md", "\n");
    vi.advanceTimersByTime(400);
    sayLineEndsConverted("Old/3.md", "\n");
    vi.advanceTimersByTime(500);
    expect(toastStore.get()).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(toastStore.get()).toHaveLength(1);
    expect(toastStore.get()[0].message).toContain("3");

    // A gesture that never pauses is said after three seconds at the latest.
    for (let i = 0; i < 10; i++) {
      sayLineEndsConverted(`Long/${i}.md`, "\n");
      vi.advanceTimersByTime(400);
    }
    expect(toastStore.get().length).toBeGreaterThanOrEqual(2);
  });

  it("has both sentences in every language, with what they are handed", () => {
    const locales = sourceMap(["packages/ui/src/locales"], "json");
    expect(locales.size).toBe(10);
    for (const [rel, text] of locales) {
      const editor = (JSON.parse(text) as { editor: Record<string, string> }).editor;
      expect(editor.lineEndsConverted, rel).toContain("{{name}}");
      expect(editor.lineEndsConverted, rel).toContain("{{eol}}");
      expect(editor.lineEndsConvertedSeveral, rel).toContain("{{files}}");
      // The several-files sentence names no single file and no single line end.
      expect(editor.lineEndsConvertedSeveral, rel).not.toContain("{{name}}");
      expect(editor.lineEndsConvertedSeveral, rel).toContain("CRLF");
    }
  });

  it("is said in an auxiliary window too: the central window hands it on over the window bus", () => {
    // The chain of the desktop lives in the central window; a save from an
    // auxiliary window goes through it, and its notice would stay there.
    const vault = sourceFile("apps/desktop/src/contexts/VaultContext.tsx");
    expect(vault).toMatch(/sayLineEndsConverted\(convertedPath, lineEnd\);\s*void getWindowBus\(\)\s*\.then\(\(bus\) => bus\.broadcast\("line-ends-converted", \{ path: convertedPath, eol: lineEnd \}, path\)\)/);
    expect(vault).toMatch(/onBroadcast\("line-ends-converted", \(\{ path, eol \}\) => sayLineEndsConverted\(path, eol\)\)/);
  });
});
