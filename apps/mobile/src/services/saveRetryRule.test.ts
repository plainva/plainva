import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConflictError, VaultFileNotFoundError, VaultUnreachableError } from "@plainva/core";
import { createSaveCoordinator } from "../../../../packages/ui/src/lib/saveCoordinator";
import { KeepBesideFailedError } from "../../../../packages/ui/src/lib/editorSave";
import { SAVE_RETRY_LIMIT, createSaveFailureTeller, isSaveFailureFinal, isVanishedFileFailure, saveRetryAfter, saveRetryDelay } from "../../../../packages/ui/src/lib/saveRetry";

/**
 * The one rule both shells retry a failed note save by (saveRetry.ts): the
 * phone's saver takes it by default, the desktop's editor through its timer.
 * Only what is surely final ends the retrying at once; everything else is
 * tried again for about five minutes, then the saver rests until the person's
 * next step (review 2026-11-17: an error text cannot tell a file another
 * program holds from a missing right).
 */

const last = <T,>(items: T[]): T | undefined => items[items.length - 1];
const coded = (code: string, message = code) => Object.assign(new Error(message), { code });

const FINAL: Array<[string, unknown]> = [
  ["a conflict", new ConflictError("conflict", "Note.CONFLICT.md")],
  ["a conflict, said over the window bus", new Error("Cannot automatically merge Note.md: conflicting changes. Saved locally as Note.CONFLICT.md.")],
  ["a file that is gone", new VaultFileNotFoundError("Note.md")],
  ["a file gone, said over the window bus", new Error("File or directory not found: Note.md")],
  ["a file that is no text", coded("NOT_TEXT_FILE", "The file is not text")],
  ["no copy beside a file that is no text", new KeepBesideFailedError(coded("NOT_TEXT_FILE"), new Error("disk full"))],
  ["no copy beside, said over the window bus", new Error("The unsaved text could not be kept beside the file that is no text: disk full")],
];

const PASSING: Array<[string, unknown]> = [
  ["a vault folder that cannot be reached", new VaultUnreachableError("Note.md")],
  ["a network drive that is gone for a moment", new Error("The network path was not found. (os error 53)")],
  ["a file another program holds (Windows)", new Error("Access is denied. (os error 5)")],
  ["a file another program holds, said so", new Error("The process cannot access the file because it is being used by another process. (os error 32)")],
  ["no right to write (Linux, macOS)", new Error("Permission denied (os error 13)")],
  ["no right to write (Node code)", coded("EACCES")],
  ["an operation not permitted", coded("EPERM")],
  ["a read-only drive", new Error("Read-only file system (os error 30)")],
  ["Android's storage access framework", new Error("write failed: Permission Denial: writing com.android.externalstorage requires that you obtain access")],
  ["iOS", new Error("You don’t have permission to save the file “Note.md” in the folder “Vault”.")],
  ["a full disk", new Error("No space left on device (os error 28)")],
  ["a path that is too long", new Error("The system cannot find the path specified. (os error 3)")],
  ["a timeout", new Error("window RPC \"write\" timed out after 15000ms")],
];

describe("which failed saves are tried again", () => {
  it.each(FINAL)("never by itself after %s", (_what, error) => {
    expect(isSaveFailureFinal(error)).toBe(true);
    expect(saveRetryAfter(error, 1)).toBeNull();
  });

  it.each(PASSING)("again after %s", (_what, error) => {
    expect(isSaveFailureFinal(error)).toBe(false);
    expect(saveRetryAfter(error, 1)).toBe(1_000);
  });

  it("waits one second, then twice as long each time, at most 30 seconds", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 14].map((attempt) => saveRetryDelay(attempt))).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });

  it("rests after about five minutes of retries", () => {
    const error = new Error("Access is denied. (os error 5)");
    const waits = Array.from({ length: SAVE_RETRY_LIMIT }, (_, i) => saveRetryAfter(error, i + 1)!);
    const total = waits.reduce((sum, wait) => sum + wait, 0);
    expect(total).toBeGreaterThanOrEqual(4.5 * 60_000);
    expect(total).toBeLessThanOrEqual(5.5 * 60_000);
    expect(saveRetryAfter(error, SAVE_RETRY_LIMIT + 1)).toBeNull();
  });
});

describe("the phone's saver keeps to the rule", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A saver whose writes fail with `error` until `healAt` ms; what onError heard. */
  function saver(error: unknown, healAt = Infinity) {
    const heard: Array<{ attempt: number; retryIn: number | null }> = [];
    const saved: number[] = [];
    let writes = 0;
    const started = Date.now();
    const made = createSaveCoordinator<string>({
      contextKey: (vault) => vault,
      debounceMs: 10,
      write: async () => {
        writes += 1;
        if (Date.now() - started < healAt) throw error;
        saved.push(Date.now() - started);
      },
      onError: (_path, _error, attempt, _vault, _revision, retryIn) => heard.push({ attempt, retryIn }),
    });
    return { made, heard, saved, writes: () => writes };
  }

  it.each(FINAL)("does not try again after %s, and says no try is planned", async (_what, error) => {
    const s = saver(error);
    s.made.schedule("v", "Note.md", "text");
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(s.writes()).toBe(1);
    expect(s.heard).toEqual([{ attempt: 1, retryIn: null }]);
  });

  it("saves by itself once a right that was denied comes back (the file was held for 20 seconds)", async () => {
    const s = saver(Object.assign(new Error("open failed: EACCES (Permission denied)"), { code: "EACCES" }), 20_000);
    s.made.schedule("v", "Note.md", "text");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.saved).toHaveLength(1);
    expect(s.saved[0]).toBeGreaterThanOrEqual(20_000);
    expect(s.made.hasPending()).toBe(false);
  });

  it("rests after its last retry, says so, keeps the text, and tries again when woken", async () => {
    const error = new Error("Access is denied. (os error 5)");
    const s = saver(error, 20 * 60_000);
    s.made.schedule("v", "Note.md", "text");
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(s.writes()).toBe(SAVE_RETRY_LIMIT + 1);
    expect(s.heard[s.heard.length - 2]?.retryIn).toBe(30_000);
    expect(last(s.heard)).toEqual({ attempt: SAVE_RETRY_LIMIT + 1, retryIn: null });
    expect(s.made.hasPending("Note.md", "v")).toBe(true);
    // Nothing more by itself, however long: no try, no report (the journal
    // entry is the schedule's, the console line onError's).
    const reported = s.heard.length;
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(s.writes()).toBe(SAVE_RETRY_LIMIT + 1);
    expect(s.heard).toHaveLength(reported);
    // The app comes back: one second from the start again, and it goes through.
    s.made.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.saved).toHaveLength(1);
    expect(s.made.hasPending()).toBe(false);
  });

  it("starts at one second again when the person edits", async () => {
    const s = saver(new Error("Access is denied. (os error 5)"));
    s.made.schedule("v", "Note.md", "one");
    await vi.advanceTimersByTimeAsync(10 + 1_000 + 2_000 + 4_000);
    expect(last(s.heard)).toEqual({ attempt: 4, retryIn: 8_000 });
    s.made.schedule("v", "Note.md", "two");
    await vi.advanceTimersByTimeAsync(10);
    expect(last(s.heard)).toEqual({ attempt: 1, retryIn: 1_000 });
  });

  it("writes nothing when woken with nothing unsaved, nor after a save that went through", async () => {
    const s = saver(new Error("Access is denied. (os error 5)"), 0);
    s.made.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.writes()).toBe(0);
    s.made.schedule("v", "Note.md", "text");
    await vi.advanceTimersByTimeAsync(10);
    expect(s.saved).toHaveLength(1);
    s.made.wake();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.writes()).toBe(1);
  });

  it("wakes only a saver that rests, not one with a try planned", async () => {
    const s = saver(new Error("Access is denied. (os error 5)"));
    s.made.schedule("v", "Note.md", "text");
    await vi.advanceTimersByTimeAsync(10);
    s.made.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.writes()).toBe(1);
  });
});

describe("a run of failures speaks once (review 2026-11-18)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("says \"retrying\" once over 30 bursts of typing against a lasting failure (P1)", async () => {
    const teller = createSaveFailureTeller();
    const said: string[] = [];
    const saver = createSaveCoordinator<string>({
      contextKey: (vault) => vault,
      debounceMs: 800,
      write: async () => { throw Object.assign(new Error("open failed: EACCES (Permission denied)"), { code: "EACCES" }); },
      onError: (path, error, _attempt, vault, _revision, retryIn) => {
        const say = teller.failed(JSON.stringify([vault, path]), error, retryIn);
        if (say) said.push(say);
      },
      onSaved: (path, vault) => teller.saved(JSON.stringify([vault, path])),
    });
    for (let burst = 0; burst < 30; burst++) {
      saver.schedule("v", "Note.md", `text ${burst}`);
      await vi.advanceTimersByTimeAsync(2_000);
    }
    expect(said).toEqual(["retrying"]);
  });

  it("speaks again for another reason, once at rest, and after a save that went through", () => {
    const teller = createSaveFailureTeller();
    const full = new Error("No space left on device (os error 28)");
    const held = new Error("Access is denied. (os error 5)");
    expect(teller.failed("n", full, 1_000)).toBe("retrying");
    expect(teller.failed("n", full, 2_000)).toBeNull();
    expect(teller.failed("n", held, 1_000)).toBe("retrying");
    expect(teller.failed("n", held, null)).toBe("resting");
    expect(teller.failed("n", held, 1_000)).toBeNull();
    expect(teller.failed("n", held, null)).toBeNull();
    teller.saved("n");
    expect(teller.failed("n", held, 1_000)).toBe("retrying");
    expect(teller.failed("other", held, 1_000)).toBe("retrying");
  });
});

describe("the one failure that looks for a vanished note", () => {
  it("is a file gone while the vault folder is there, and no other", () => {
    expect(isVanishedFileFailure(new VaultFileNotFoundError("Note.md"))).toBe(true);
    expect(isVanishedFileFailure(new Error("File or directory not found: Note.md"))).toBe(true);
    expect(isVanishedFileFailure(new VaultUnreachableError("Note.md"))).toBe(false);
    expect(isVanishedFileFailure(new Error("Access is denied. (os error 5)"))).toBe(false);
    expect(isVanishedFileFailure(new ConflictError("conflict", "Note.CONFLICT.md"))).toBe(false);
  });
});

describe("the phone's message says what really happens", () => {
  const source = readFileSync(resolve("src/services/vaultService.ts"), "utf8");
  const onError = source.slice(source.indexOf("onError: (path, err, attempt, vault, _revision, retryIn) => {"), source.indexOf("  }));", source.indexOf("onError: (path, err, attempt, vault")));

  it("announces a try only while one is planned, and says why once the saver rests", () => {
    expect(onError).toMatch(/const say = failureTeller\(\)\.failed\(JSON\.stringify\(\[vault\.vaultId, path\]\), err, retryIn\);/);
    expect(onError).toMatch(/if \(say === "resting"\) toast\.error\(i18n\.t\("mobile\.saveFailedWhy", \{ reason: saveFailureReason\(err\) \}\)\);\s*else if \(say === "retrying"\) toast\.warning\(i18n\.t\("mobile\.saveRetry"\)\);/);
    expect(source).toMatch(/clearDraft\(vault, path, revision\);\s*failureTeller\(\)\.saved\(JSON\.stringify\(\[vault\.vaultId, path\]\)\);/);
  });

  it("wakes the resting saver when the app comes back", () => {
    const lifecycle = readFileSync(resolve("src/services/appLifecycle.ts"), "utf8");
    const resume = lifecycle.slice(lifecycle.indexOf("export function onAppForeground"), lifecycle.indexOf("export function onAppBackground"));
    expect(resume).toMatch(/noteSaver\.wake\(\)/);
  });
});
