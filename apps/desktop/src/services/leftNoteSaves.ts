import { createSaveRetryTimer, type SaveRetryTimer } from "./saveRetryTimer";

/**
 * The saves of notes the editor has left, tried again by themselves — what
 * the phone's saver does (`saveCoordinator.ts` in @plainva/ui).
 *
 * A failed save is tried again by the editor pane while the note is open
 * (`saveRetryTimer.ts`). When the pane shows another note or closes, it makes
 * one last try with the final text; when that failed too, the text used to
 * wait in the draft journal until the note was opened again. Now the failed
 * save is handed here and tried again by the same rule (`saveRetry.ts`): at
 * growing intervals, never after a failure that is surely final, resting
 * after about five minutes until the window is in front again (`wake`).
 *
 * The text stays in the draft journal all along. A retry stops for good once
 * it is not due any more: the note is open in an editor again (that editor
 * owns it now and offers the journal's text), its save went through, or its
 * vault is closed (`endLeftNoteSaves`, called where closing waits for the
 * vault's writes).
 */
export interface LeftNoteSave {
  vaultPath: string;
  path: string;
  /** Tries the save once more; rejects with its error when it failed. */
  retry: () => Promise<void>;
  /** Whether the text is still owed to this note (left, unsaved, not opened again). */
  stillDue: () => boolean;
}

interface Entry {
  save: LeftNoteSave;
  timer: SaveRetryTimer;
  ended: boolean;
}

const entries = new Map<string, Entry>();
const keyOf = (vaultPath: string, path: string) => vaultPath + "\u0000" + path;
let listening = false;

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("focus", () => wakeLeftNoteSaves());
}

function end(key: string, entry: Entry): void {
  entry.ended = true;
  entry.timer.cancel();
  if (entries.get(key) === entry) entries.delete(key);
}

function attempt(key: string, entry: Entry): void {
  if (entry.ended) return;
  if (!entry.save.stillDue()) {
    end(key, entry);
    return;
  }
  entry.save.retry().then(
    () => end(key, entry),
    (error: unknown) => {
      if (entry.ended) return;
      if (!entry.save.stillDue()) {
        end(key, entry);
        return;
      }
      // Final, or tried again at its time; used up, it rests until `wake`.
      if (!entry.timer.failed(error, () => !entry.ended, () => attempt(key, entry)) && !entry.timer.resting) end(key, entry);
    },
  );
}

/**
 * The save of a note the editor left failed with `error`: it is tried again
 * here, unless the failure is final. A save of the same note handed over
 * before gives way to this one, which holds the newer text.
 */
export function adoptLeftNoteSave(save: LeftNoteSave, error: unknown): void {
  const key = keyOf(save.vaultPath, save.path);
  const before = entries.get(key);
  if (before) end(key, before);
  const entry: Entry = { save, timer: createSaveRetryTimer(), ended: false };
  // Whether it is still due is asked when the try comes (`attempt`), which ends what is not.
  if (!entry.timer.failed(error, () => !entry.ended, () => attempt(key, entry))) return;
  entries.set(key, entry);
  listen();
}

/** The note is open in an editor again: that editor owns its text now. */
export function releaseLeftNoteSave(vaultPath: string, path: string): void {
  const key = keyOf(vaultPath, path);
  const entry = entries.get(key);
  if (entry) end(key, entry);
}

/** The vault closes: none of its left saves is tried again. */
export function endLeftNoteSaves(vaultPath: string): void {
  const prefix = vaultPath + "\u0000";
  for (const [key, entry] of [...entries]) if (key.startsWith(prefix)) end(key, entry);
}

/** The person is back (the window is in front): every left save that rests is tried again, from one second on. */
export function wakeLeftNoteSaves(): void {
  for (const [key, entry] of [...entries]) {
    if (!entry.timer.resting) continue;
    entry.timer.reset();
    attempt(key, entry);
  }
}

/** Whether a left save of this note waits to be tried again. */
export function hasLeftNoteSave(vaultPath: string, path: string): boolean {
  return entries.has(keyOf(vaultPath, path));
}

/** Tests only. */
export function resetLeftNoteSavesForTests(): void {
  for (const [key, entry] of [...entries]) end(key, entry);
}
