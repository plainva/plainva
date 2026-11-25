import { afterEach, describe, expect, it, vi } from "vitest";
import { SAVE_RETRY_LIMIT } from "@plainva/ui";
import { EditorSaveLifetime } from "./editorSaveLifetime";
import { settlePendingWrites, withPendingWrite } from "./pendingWrites";
import { adoptLeftNoteSave, endLeftNoteSaves, hasLeftNoteSave, leftNoteSaveEpoch, releaseLeftNoteSave, resetLeftNoteSavesForTests, STILL_DUE_LIMIT_MS, wakeLeftNoteSaves, type LeftNoteSave } from "./leftNoteSaves";

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
  return { vaultPath: over.vaultPath ?? "/v", path: over.path ?? "a.md", epoch: 0, retry, stillDue: over.due ?? (() => true) };
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

/**
 * The editor's own save, as `Editor.tsx` wires it: it runs inside
 * `withPendingWrite`, and its `catch` hands itself over again whenever the
 * pane no longer holds the note — also when the try was the saver's own.
 */
function editorLike(vaultPath: string, path: string, write: () => Promise<void>, epoch = leftNoteSaveEpoch(vaultPath)) {
  let tries = 0;
  const persistText = (): Promise<void> => withPendingWrite(vaultPath, path, async () => {
    tries += 1;
    try {
      await write();
    } catch (error) {
      const save: LeftNoteSave = { vaultPath, path, epoch, retry: () => persistText(), stillDue: () => true };
      adoptLeftNoteSave(save, error);
      throw error;
    }
  });
  return { persistText, tries: () => tries };
}

describe("a left save handed over again from its own failure", () => {
  it("keeps its count and its interval, and rests after about five minutes", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    const e = editorLike("/v", "a.md", async () => { throw held; });
    await e.persistText().catch(() => {});
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    // The pane's last try, then the rule's tries again: 1, 2, 4, 8, 16 s, then every 30 s.
    expect(e.tries()).toBe(1 + SAVE_RETRY_LIMIT);
    expect(hasLeftNoteSave("/v", "a.md")).toBe(true);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(e.tries()).toBe(1 + SAVE_RETRY_LIMIT);
  });

  it("is refused when its vault closed while its last try was still under way, and nothing is tried through that runtime", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    let fail!: () => void;
    const e = editorLike("/w", "b.md", () => new Promise<void>((_, reject) => { fail = () => reject(held); }));
    const lastTry = e.persistText().catch(() => {});
    // The vault closes while the editor's last try is under way: closing waits for it.
    const settling = settlePendingWrites("/w");
    await vi.advanceTimersByTimeAsync(0);
    fail();
    await lastTry;
    await settling;
    expect(hasLeftNoteSave("/w", "b.md")).toBe(false);
    // The vault is open again, with a new runtime: the old editor's save stays refused.
    const reopened = editorLike("/w", "b.md", async () => { throw held; });
    adoptLeftNoteSave({ vaultPath: "/w", path: "b.md", epoch: 0, retry: () => e.persistText(), stillDue: () => true }, held);
    expect(hasLeftNoteSave("/w", "b.md")).toBe(false);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(e.tries()).toBe(1);
    // An editor of the new runtime is tried again as ever.
    await reopened.persistText().catch(() => {});
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reopened.tries()).toBe(2);
  });

  it("ends when it is not due any more, asked before the try — also when the answer takes a while", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    let due = true;
    const save = { ...left({ fails: 99 }), stillDue: async () => { await new Promise((r) => setTimeout(r, 10)); return due; } };
    adoptLeftNoteSave(save, held);
    await vi.advanceTimersByTimeAsync(1_010);
    expect(save.retry).toHaveBeenCalledTimes(1);
    due = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save.retry).toHaveBeenCalledTimes(1);
    expect(hasLeftNoteSave("/v", "a.md")).toBe(false);
  });

  it("counts a question that never answers as a failed try: the entry lives on, is tried again by the rule, and wakes", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    let hangs = true;
    let asks = 0;
    const save = { ...left({ fails: 0 }), stillDue: () => { asks += 1; return hangs ? new Promise<boolean>(() => {}) : true; } };
    adoptLeftNoteSave(save, held);
    await vi.advanceTimersByTimeAsync(1_000 + STILL_DUE_LIMIT_MS);
    expect(asks).toBe(1);
    expect(save.retry).not.toHaveBeenCalled();
    expect(hasLeftNoteSave("/v", "a.md")).toBe(true);
    // The next try comes by the rule (two seconds after the first failure), and the drive is back.
    hangs = false;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(asks).toBe(2);
    expect(save.retry).toHaveBeenCalledTimes(1);
    expect(hasLeftNoteSave("/v", "a.md")).toBe(false);
  });

  it("counts a question that fails as a failed try, not as the end", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    let throws = true;
    const save = { ...left({ fails: 0 }), stillDue: async () => { if (throws) throw new Error("the journal could not be read"); return true; } };
    adoptLeftNoteSave(save, held);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(hasLeftNoteSave("/v", "a.md")).toBe(true);
    throws = false;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(save.retry).toHaveBeenCalledTimes(1);
    expect(hasLeftNoteSave("/v", "a.md")).toBe(false);
  });
});
