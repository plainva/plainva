import { afterEach, describe, expect, it, vi } from "vitest";
import { SAVE_RETRY_LIMIT } from "@plainva/ui";
import { EditorSaveLifetime } from "./editorSaveLifetime";
import { settlePendingWrites } from "./pendingWrites";
import { adoptLeftNoteSave, endLeftNoteSaves, hasLeftNoteSave, releaseLeftNoteSave, resetLeftNoteSavesForTests, wakeLeftNoteSaves } from "./leftNoteSaves";

/**
 * A failed save of a note the editor left is tried again by itself, as the
 * phone's saver does: the pane's own retry ends with the pane, its last try
 * failed, and the text used to wait in the draft journal until the note was
 * opened again.
 */

afterEach(() => {
  resetLeftNoteSavesForTests();
  vi.useRealTimers();
});

const held = Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
const gone = Object.assign(new Error("File or directory not found: a.md"), { name: "VaultFileNotFoundError" });

function left(over: { fails?: number; due?: () => boolean; vaultPath?: string; path?: string } = {}) {
  let failures = over.fails ?? 0;
  const retry = vi.fn(async () => {
    if (failures > 0) {
      failures -= 1;
      throw held;
    }
  });
  return { vaultPath: over.vaultPath ?? "/v", path: over.path ?? "a.md", retry, stillDue: over.due ?? (() => true) };
}

describe("saves of notes the editor left", () => {
  it("are tried again at growing intervals until one goes through", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    const save = left({ fails: 2 });
    adoptLeftNoteSave(save, held);
    expect(hasLeftNoteSave("/v", "a.md")).toBe(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(save.retry).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save.retry).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(save.retry).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(save.retry).toHaveBeenCalledTimes(3);
    expect(hasLeftNoteSave("/v", "a.md")).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save.retry).toHaveBeenCalledTimes(3);
  });

  it("are never tried again after a failure that is final", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    const save = left();
    adoptLeftNoteSave(save, gone);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save.retry).not.toHaveBeenCalled();
    expect(hasLeftNoteSave("/v", "a.md")).toBe(false);
  });

  it("stop once the note is open again, or the vault closes, and nothing is written after", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    let open = false;
    const reopened = left({ fails: 99, due: () => !open });
    const other = left({ fails: 99, path: "b.md" });
    const otherVault = left({ fails: 99, vaultPath: "/w" });
    for (const save of [reopened, other, otherVault]) adoptLeftNoteSave(save, held);
    open = true;
    releaseLeftNoteSave("/v", "a.md");
    endLeftNoteSaves("/v");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reopened.retry).not.toHaveBeenCalled();
    expect(other.retry).not.toHaveBeenCalled();
    // Another vault's left save goes on.
    expect(otherVault.retry.mock.calls.length).toBeGreaterThan(2);
  });

  it("ask whether they are still due before each try", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    let due = true;
    const save = left({ fails: 99, due: () => due });
    adoptLeftNoteSave(save, held);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(save.retry).toHaveBeenCalledTimes(1);
    due = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save.retry).toHaveBeenCalledTimes(1);
    expect(hasLeftNoteSave("/v", "a.md")).toBe(false);
  });

  it("rest after about five minutes, and go again when the window is in front", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    const save = left({ fails: 99 });
    adoptLeftNoteSave(save, held);
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    const tried = save.retry.mock.calls.length;
    // The rule both shells keep: this many tries again, then the saver rests.
    expect(tried).toBe(SAVE_RETRY_LIMIT);
    // Resting: the text waits, nothing more comes by itself.
    expect(hasLeftNoteSave("/v", "a.md")).toBe(true);
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(save.retry).toHaveBeenCalledTimes(tried);
    wakeLeftNoteSaves();
    await vi.advanceTimersByTimeAsync(0);
    expect(save.retry).toHaveBeenCalledTimes(tried + 1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(save.retry).toHaveBeenCalledTimes(tried + 2);
  });

  it("hold the newer text when the same note is handed over again", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    const older = left({ fails: 99 });
    const newer = left({ fails: 0 });
    adoptLeftNoteSave(older, held);
    adoptLeftNoteSave(newer, held);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(older.retry).not.toHaveBeenCalled();
    expect(newer.retry).toHaveBeenCalledTimes(1);
  });

  it("stop when an editor opens the note again, and when its vault closes — through the paths the app takes", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    const a = left({ fails: 99 });
    const b = left({ fails: 99, path: "b.md" });
    adoptLeftNoteSave(a, held);
    adoptLeftNoteSave(b, held);
    // A pane shows a.md again.
    const lifetime = new EditorSaveLifetime("/v", "a.md", null);
    lifetime.activate();
    expect(EditorSaveLifetime.holds("/v", "a.md")).toBe(true);
    expect(hasLeftNoteSave("/v", "a.md")).toBe(false);
    expect(hasLeftNoteSave("/v", "b.md")).toBe(true);
    lifetime.deactivate();
    expect(EditorSaveLifetime.holds("/v", "a.md")).toBe(false);
    // The vault closes: closing waits for its writes, and ends its left saves.
    await settlePendingWrites("/v");
    expect(hasLeftNoteSave("/v", "b.md")).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(a.retry).not.toHaveBeenCalled();
    expect(b.retry).not.toHaveBeenCalled();
  });
});
