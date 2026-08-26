import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const flush = vi.fn(async (_path?: string) => {
  calls.push("flush");
});
const shareFile = vi.fn(async (text?: string) => {
  calls.push("share");
  shared = text ?? "";
});
const askMode = vi.fn(async (): Promise<string | null> => {
  calls.push("ask");
  return "appendix";
});
let shared = "";
let comments: WorkspaceCommentRecord[] = [];
const read = vi.fn(async () => {
  calls.push("read");
  return saved;
});
let saved = "# Note\n";

const info = vi.fn();
const warn = vi.fn();

vi.mock("./services/shareFile", () => ({
  shareVaultText: (_name: string, text: string) => shareFile(text),
}));
// No workspace in most of these cases: the export must stay a one-step action
// for a note nobody has annotated.
vi.mock("./services/mobileComments", () => ({
  listMobileComments: async () => comments,
  listMobileCommentAuthors: async () => new Map([["m1", "Ada"]]),
}));
vi.mock("./services/mobileDialogs", () => ({ mSelect: () => askMode() }));
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
import type { WorkspaceCommentRecord } from "@plainva/core";

/**
 * Exporting a note as a file from the phone (parity gap markdown-export-file).
 */

const t = ((k: string) => k) as never;
const vault = {} as MobileVault;

/** An open remark on the note as a whole - enough to make the question appear. */
function comment(body: string): WorkspaceCommentRecord {
  return {
    commentId: "c1",
    targetObjectId: "o1",
    targetRevisionId: "r1",
    parentCommentId: null,
    authorMemberId: "m1",
    authorDeviceId: "d1",
    operationHash: "h",
    payloadHash: "p",
    body,
    anchor: null,
    createdAt: "2026-08-26T09:00:00.000Z",
    suggestion: null,
    resolvedCommentId: null,
    resolvedAt: null,
  };
}

describe("exporting a note as Markdown on the phone", () => {
  beforeEach(() => {
    calls.length = 0;
    saved = "# Note\n";
    shared = "";
    comments = [];
    for (const m of [flush, shareFile, read, info, warn, askMode]) m.mockClear();
  });

  it("flushes the pending save BEFORE reading the note", async () => {
    // The bug this pins: the export reads the note from disk, and the autosave
    // is on a ~1 s debounce with no blur when a sheet opens — so exporting
    // right after typing used to hand out the previous save.
    expect(await exportNoteAsMarkdown(vault, "Notes/A.md", t)).toBe(true);
    // Assert the ORDER, not two indexOf results: with the flush missing both
    // sides would be -1 and 0, and -1 < 0 held — the first version of this
    // check passed against a build that never flushed (found by its own red
    // counter-check, 2026-08-20). The read now stands BEFORE the share because
    // D10 assembles the file rather than copying it off disk.
    expect(calls).toEqual(["flush", "read", "share"]);
  });

  it("does not ask how annotations should travel when there are none", async () => {
    await exportNoteAsMarkdown(vault, "Notes/A.md", t);
    expect(askMode).not.toHaveBeenCalled();
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

  it("asks how annotations should travel, and the answer reaches the file", async () => {
    comments = [comment("Please check this.")];
    expect(await exportNoteAsMarkdown(vault, "Notes/A.md", t)).toBe(true);
    expect(askMode).toHaveBeenCalled();
    // The rendering itself is the shared renderer's business; what this pins is
    // that the phone hands out the RENDERED text rather than the file on disk.
    expect(shared).toContain("Please check this.");
    expect(shared).toContain("Ada");
  });

  it("exports nothing when the format question is dismissed", async () => {
    // Dismissing a question is not a failure - no file, no error message.
    comments = [comment("Please check this.")];
    askMode.mockResolvedValueOnce(null);
    expect(await exportNoteAsMarkdown(vault, "Notes/A.md", t)).toBe(false);
    expect(shareFile).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports a note it cannot read as a failed export", async () => {
    // Before D10 the read happened AFTER the share, and a failure there was
    // deliberately swallowed: the file had already left the app, so calling it
    // an error would have been a lie. Now the read feeds what gets handed out —
    // nothing was exported, and saying so is the honest answer.
    read.mockRejectedValueOnce(new Error("gone"));
    expect(await exportNoteAsMarkdown(vault, "Notes/A.md", t)).toBe(false);
    expect(warn).toHaveBeenCalledWith("editor.exportFailed");
    expect(shareFile).not.toHaveBeenCalled();
  });
});
