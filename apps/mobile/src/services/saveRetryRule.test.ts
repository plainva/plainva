import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, VaultFileNotFoundError } from "@plainva/core";
import { createSaveCoordinator } from "../../../../packages/ui/src/lib/saveCoordinator";
import { KeepBesideFailedError } from "../../../../packages/ui/src/lib/editorSave";
import { isSaveFailureFinal, saveRetryDelay } from "../../../../packages/ui/src/lib/saveRetry";

/**
 * The one rule both shells retry a failed note save by (saveRetry.ts): the
 * phone's saver takes it by default, the desktop's editor through its timer.
 */

const coded = (code: string, message = code) => Object.assign(new Error(message), { code });

const FINAL: Array<[string, unknown]> = [
  ["a conflict", new ConflictError("conflict", "Note.CONFLICT.md")],
  ["a conflict, said over the window bus", new Error("Cannot automatically merge Note.md: conflicting changes. Saved locally as Note.CONFLICT.md.")],
  ["a file that is gone", new VaultFileNotFoundError("Note.md")],
  ["a file gone, said over the window bus", new Error("File or directory not found: Note.md")],
  ["a file that is no text", coded("NOT_TEXT_FILE", "The file is not text")],
  ["no copy beside a file that is no text", new KeepBesideFailedError(coded("NOT_TEXT_FILE"), new Error("disk full"))],
  ["no right to write (Linux, macOS)", new Error("Permission denied (os error 13)")],
  ["no right to write (Windows)", new Error("Access is denied. (os error 5)")],
  ["no right to write (Node code)", coded("EACCES")],
  ["an operation not permitted", coded("EPERM")],
  ["a read-only drive", new Error("Read-only file system (os error 30)")],
];

const PASSING: Array<[string, unknown]> = [
  ["a network drive that is gone for a moment", new Error("The network path was not found. (os error 53)")],
  ["a file another program holds", new Error("The process cannot access the file because it is being used by another process. (os error 32)")],
  ["a full disk", new Error("No space left on device (os error 28)")],
  ["a timeout", new Error("window RPC \"write\" timed out after 15000ms")],
];

describe("which failed saves are tried again", () => {
  it.each(FINAL)("never %s", (_what, error) => {
    expect(isSaveFailureFinal(error)).toBe(true);
  });

  it.each(PASSING)("again after %s", (_what, error) => {
    expect(isSaveFailureFinal(error)).toBe(false);
  });

  it("waits one second, then twice as long each time, at most 30 seconds", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map((attempt) => saveRetryDelay(attempt))).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });
});

describe("the phone's saver keeps to the rule", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(FINAL)("does not try again after %s", async (_what, error) => {
    let writes = 0;
    const saver = createSaveCoordinator<string>({
      contextKey: (vault) => vault,
      debounceMs: 10,
      write: async () => {
        writes += 1;
        throw error;
      },
    });
    saver.schedule("v", "Note.md", "text");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writes).toBe(1);
  });

  it("tries again after a passing failure, and stops once the save went through", async () => {
    let writes = 0;
    const saved: string[] = [];
    const saver = createSaveCoordinator<string>({
      contextKey: (vault) => vault,
      debounceMs: 10,
      write: async (_vault, _path, text) => {
        writes += 1;
        if (writes < 3) throw new Error("The network path was not found. (os error 53)");
        saved.push(text);
      },
    });
    saver.schedule("v", "Note.md", "text");
    await vi.advanceTimersByTimeAsync(10);
    expect(writes).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(writes).toBe(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(saved).toEqual(["text"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writes).toBe(3);
    expect(saver.hasPending()).toBe(false);
  });
});
