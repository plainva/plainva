import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const flush = vi.fn(async (_path?: string) => {
  calls.push("flush");
});
const shareFile = vi.fn(async () => {
  calls.push("share");
});
const read = vi.fn(async () => {
  calls.push("read");
  return saved;
});
let saved = "# Note\n";

const info = vi.fn();
const warn = vi.fn();

vi.mock("./services/shareFile", () => ({ shareVaultFile: () => shareFile() }));
vi.mock("./services/vaultService", () => ({
  noteSaver: { flush: (p: string) => flush(p) },
  vaultOps: { read: () => read() },
}));
vi.mock("@plainva/ui", async (importOriginal) => ({
  // referencesRelativeAttachments is the REAL text check — mocking it would
  // test the mock, and it is the whole point of the warning.
  ...(await importOriginal<typeof import("@plainva/ui")>()),
  toast: { info: (m: string) => info(m), warning: (m: string) => warn(m) },
}));

import { exportNoteAsMarkdown } from "./services/exportNote";
import type { MobileVault } from "./services/vaultService";

/**
 * Exporting a note as a file from the phone (parity gap markdown-export-file).
 */

const t = ((k: string) => k) as never;
const vault = {} as MobileVault;

describe("exporting a note as Markdown on the phone", () => {
  beforeEach(() => {
    calls.length = 0;
    saved = "# Note\n";
    for (const m of [flush, shareFile, read, info, warn]) m.mockClear();
  });

  it("flushes the pending save BEFORE handing the file out", async () => {
    // The bug this pins: the export reads the note from disk, and the autosave
    // is on a ~1 s debounce with no blur when a sheet opens — so exporting
    // right after typing used to hand out the previous save.
    expect(await exportNoteAsMarkdown(vault, "Notes/A.md", t)).toBe(true);
    // Assert the ORDER, not two indexOf results: with the flush missing both
    // sides would be -1 and 0, and -1 < 0 held — the first version of this
    // check passed against a build that never flushed (found by its own red
    // counter-check, 2026-08-20).
    expect(calls).toEqual(["flush", "share", "read"]);
  });

  it("says that linked attachments do not travel with the file", async () => {
    saved = "# Note\n\n![[Diagram.png]]\n";
    await exportNoteAsMarkdown(vault, "Notes/A.md", t);
    expect(info).toHaveBeenCalledWith("editor.exportAttachmentsHint");
  });

  it("stays quiet for a note that links nothing local", async () => {
    saved = "# Note\n\n![remote](https://example.com/a.png)\n";
    await exportNoteAsMarkdown(vault, "Notes/A.md", t);
    expect(info).not.toHaveBeenCalled();
  });

  it("reports a failed export instead of pretending it worked", async () => {
    shareFile.mockRejectedValueOnce(new Error("no share target"));
    expect(await exportNoteAsMarkdown(vault, "Notes/A.md", t)).toBe(false);
    expect(warn).toHaveBeenCalledWith("editor.exportFailed");
  });

  it("still counts as exported when re-reading the note afterwards fails", async () => {
    // The file already left the app at that point; turning a finished export
    // into an error message would be a lie.
    read.mockRejectedValueOnce(new Error("gone"));
    expect(await exportNoteAsMarkdown(vault, "Notes/A.md", t)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
