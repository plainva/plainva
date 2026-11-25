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
 * One entry per note keeps its count and its interval over all its tries. A
 * try is the editor's own save, and a save that fails hands itself over
 * again from its own `catch`: that hand-over joins the entry, it never
 * starts the count anew.
 *
 * The text stays in the draft journal all along. A retry stops for good once
 * it is not due any more (`stillDue`, asked before every try — one that does
 * not answer within `STILL_DUE_LIMIT_MS`, or fails, counts as a failed try:
 * an editor
 * holds the note again, here or in another window, the journal no longer
 * holds this text as the newest, the file is not what this editor last
 * knew — written elsewhere, moved, deleted), once its save went through, or
 * once its vault closes. Closing (`endLeftNoteSaves`) ends the vault's
 * entries and starts a new epoch: an editor of the closed runtime — whose
 * last try fails only while the closing waits for it — hands over with the
 * old epoch and is refused, so nothing is ever tried again through a runtime
 * that is gone, also when the same vault is open again meanwhile.
 */
export interface LeftNoteSave {
  vaultPath: string;
  path: string;
  /** The vault's epoch when the editor that wrote it began (`leftNoteSaveEpoch`). */
  epoch: number;
  /** Tries the save once more; rejects with its error when it failed. */
  retry: () => Promise<void>;
  /** Whether the text is still owed to this note; asked before every try. */
  stillDue: () => boolean | Promise<boolean>;
}

interface Entry {
  save: LeftNoteSave;
  timer: SaveRetryTimer;
  ended: boolean;
  /** A try is under way: a hand-over from its own failure joins, the try's end plans the next. */
  running: boolean;
}

const entries = new Map<string, Entry>();
const epochs = new Map<string, number>();
const keyOf = (vaultPath: string, path: string) => vaultPath + "\u0000" + path;
let listening = false;

/** The vault's epoch: it grows each time the vault closes. */
export function leftNoteSaveEpoch(vaultPath: string): number {
  return epochs.get(vaultPath) ?? 0;
}

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

const current = (entry: Entry) => !entry.ended && entry.save.epoch === leftNoteSaveEpoch(entry.save.vaultPath);

/** Plans the next try after `error`; ends the entry where none comes (final), keeps it where it rests. */
function plan(key: string, entry: Entry, error: unknown): void {
  if (!entry.timer.failed(error, () => current(entry), () => void attempt(key, entry)) && !entry.timer.resting) end(key, entry);
}

/** How long the question whether a save is still owed may take (it reads the journal and the file). */
export const STILL_DUE_LIMIT_MS = 30_000;

/** The question got no answer: counted as a failed try, by the rule. */
export class StillDueUnanswered extends Error {
  constructor(cause: unknown) {
    super("Whether the note's save is still owed could not be told", { cause });
    this.name = "StillDueUnanswered";
  }
}

/**
 * Whether the save is still owed — or an error when the question does not
 * answer in time (a read that hangs on a dropped drive) or fails: a try that
 * could not be told is a failed try, tried again by the rule, never the end.
 */
function askStillDue(entry: Entry): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StillDueUnanswered(new Error(`no answer within ${STILL_DUE_LIMIT_MS / 1000} s`))), STILL_DUE_LIMIT_MS);
  });
  return Promise.race([Promise.resolve().then(() => entry.save.stillDue()), late])
    .catch((error: unknown) => { throw error instanceof StillDueUnanswered ? error : new StillDueUnanswered(error); })
    .finally(() => clearTimeout(timer));
}

async function attempt(key: string, entry: Entry): Promise<void> {
  if (!current(entry) || entry.running) return;
  entry.running = true;
  try {
    const due = await askStillDue(entry);
    if (!due || !current(entry)) {
      end(key, entry);
      return;
    }
    await entry.save.retry();
    end(key, entry);
  } catch (error) {
    if (!current(entry)) end(key, entry);
    else plan(key, entry, error);
  } finally {
    entry.running = false;
  }
}

/**
 * The save of a note the editor left failed with `error`: it is tried again
 * here, unless the failure is final or the save belongs to a runtime of the
 * vault that closed. A note already here keeps its count: the hand-over
 * joins it (and brings the newer save along), it does not start anew.
 */
export function adoptLeftNoteSave(save: LeftNoteSave, error: unknown): void {
  if (save.epoch !== leftNoteSaveEpoch(save.vaultPath)) return;
  const key = keyOf(save.vaultPath, save.path);
  const known = entries.get(key);
  if (known && !known.ended) {
    known.save = save;
    // Its own try failed: that try's end plans the next one.
    if (!known.running) plan(key, known, error);
    return;
  }
  const entry: Entry = { save, timer: createSaveRetryTimer(), ended: false, running: false };
  entries.set(key, entry);
  plan(key, entry, error);
  if (entries.get(key) === entry) listen();
}

/** The note is open in an editor again: that editor owns its text now. */
export function releaseLeftNoteSave(vaultPath: string, path: string): void {
  const key = keyOf(vaultPath, path);
  const entry = entries.get(key);
  if (entry) end(key, entry);
}

/**
 * The vault closes: none of its left saves is tried again, and none handed
 * over by an editor of this runtime is taken any more (a new epoch).
 */
export function endLeftNoteSaves(vaultPath: string): void {
  epochs.set(vaultPath, leftNoteSaveEpoch(vaultPath) + 1);
  const prefix = vaultPath + "\u0000";
  for (const [key, entry] of [...entries]) if (key.startsWith(prefix)) end(key, entry);
}

/** The person is back (the window is in front): every left save that rests is tried again, from one second on. */
export function wakeLeftNoteSaves(): void {
  for (const [key, entry] of [...entries]) {
    if (!entry.timer.resting) continue;
    entry.timer.reset();
    void attempt(key, entry);
  }
}

/** Whether a left save of this note waits to be tried again. */
export function hasLeftNoteSave(vaultPath: string, path: string): boolean {
  return entries.has(keyOf(vaultPath, path));
}

/** Tests only. */
export function resetLeftNoteSavesForTests(): void {
  for (const [key, entry] of [...entries]) end(key, entry);
  epochs.clear();
}
