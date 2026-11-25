import i18n from "i18next";
import { toast } from "../services/toastStore";
import { sameSyncTarget, type SyncStateBinding } from "./syncStateBinding";

/**
 * Closing, switching or removing a vault waits for what is still under way —
 * a note being saved, a sync step, a vault still opening — but not for ever,
 * in both shells: after `CLOSE_NOTICE_AFTER_MS` a notice says what it waits
 * for, and after `CLOSE_GIVE_UP_AFTER_MS` it goes on and says so — that
 * nothing is lost. The caller then calls the vault's runtime off
 * (`createVaultCallOff`) before the next one starts: a note's text lies in
 * the draft journal and comes back at the next open, and the next sync takes
 * over what a step left half done.
 *
 * Quitting the app is not this: there the desktop's own hold applies
 * (`leave.rs`, `leaveFlush.ts`), with its deadline.
 */
export const CLOSE_NOTICE_AFTER_MS = 5_000;
export const CLOSE_GIVE_UP_AFTER_MS = 30_000;

/** What closing waits for, as the notice names it. */
export type CloseWaitStep =
  | { kind: "saving"; names: readonly string[] }
  | { kind: "sync"; vault: string }
  | { kind: "opening"; vault: string }
  // The index finishing its last step: the close has called the scan off, so this is short; nothing to say.
  | { kind: "index" };

/** The notice while it waits (texts 1–3); null where there is nothing the person would need to hear. */
export function closeWaitText(step: CloseWaitStep): string | null {
  if (step.kind === "index") return null;
  if (step.kind === "saving") {
    return step.names.length === 1 ? i18n.t("closing.savingWait", { name: step.names[0] }) : i18n.t("closing.savingWaitMany", { count: step.names.length });
  }
  if (step.kind === "sync") return i18n.t("closing.syncWait", { vault: step.vault });
  return i18n.t("closing.openingWait", { vault: step.vault });
}

/** What it says when it goes on without the step (texts 4–6); null where nothing is said. */
export function closeGaveUpText(step: CloseWaitStep): string | null {
  if (step.kind === "index") return null;
  if (step.kind === "saving") {
    return step.names.length === 1 ? i18n.t("closing.savingGaveUp", { name: step.names[0] }) : i18n.t("closing.savingGaveUpMany", { count: step.names.length });
  }
  if (step.kind === "sync") return i18n.t("closing.syncGaveUp", { vault: step.vault });
  return i18n.t("closing.openingGaveUp", { vault: step.vault });
}

/** A note's name as the notice says it: the file name without `.md`. */
export function closeWaitNoteName(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.replace(/\.md$/i, "");
}

export interface CloseDeadlineOptions {
  noticeAfterMs?: number;
  giveUpAfterMs?: number;
}

/**
 * Waits for `work`, with the notice and the deadline above. "done": it ended
 * (a failure of `work` is passed on, as before). "gave-up": the deadline came
 * first — `work` goes on by itself, and the caller goes on without it. `step`
 * is asked when the notice is due, so it names what is still pending then.
 */
export async function waitWithDeadline(work: Promise<unknown>, step: () => CloseWaitStep, options: CloseDeadlineOptions = {}): Promise<"done" | "gave-up"> {
  const noticeAfter = options.noticeAfterMs ?? CLOSE_NOTICE_AFTER_MS;
  const giveUpAfter = options.giveUpAfterMs ?? CLOSE_GIVE_UP_AFTER_MS;
  let notice: number | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"gave-up">((resolve) => {
    noticeTimer = setTimeout(() => {
      const text = closeWaitText(step());
      if (text !== null) notice = toast.progress(text);
    }, noticeAfter);
    giveUpTimer = setTimeout(() => resolve("gave-up"), giveUpAfter);
  });
  try {
    const outcome = await Promise.race([work.then(() => "done" as const), deadline]);
    if (outcome === "gave-up") {
      const said = closeGaveUpText(step());
      if (notice !== null) toast.dismiss(notice);
      notice = null;
      if (said !== null) toast.warning(said);
      // What it gave up on goes on by itself; a failure of it later is no failure of the close.
      work.catch(() => undefined);
    }
    return outcome;
  } finally {
    clearTimeout(noticeTimer);
    clearTimeout(giveUpTimer);
    if (notice !== null) toast.dismiss(notice);
  }
}

/**
 * Opening a vault again while its previous runtime is still ending (text 7):
 * waits for `ended` — never two runtimes at one vault — and from
 * `noticeAfterMs` on says so, until it has ended. No deadline: the wait is
 * bounded by the requests' own time limits.
 */
export async function waitForClosingVault(ended: Promise<unknown>, vault: string, options: Pick<CloseDeadlineOptions, "noticeAfterMs"> & { signal?: AbortSignal } = {}): Promise<void> {
  let notice: number | null = null;
  const { signal } = options;
  if (signal?.aborted) return;
  const timer = setTimeout(() => {
    notice = toast.progress(i18n.t("closing.stillClosing", { vault }));
  }, options.noticeAfterMs ?? CLOSE_NOTICE_AFTER_MS);
  let onAbort = () => {};
  try {
    // The notice lives as long as the open that shows it: an open called off meanwhile stops waiting, and its notice goes.
    await Promise.race([ended, new Promise<void>((resolve) => {
      onAbort = () => resolve();
      signal?.addEventListener("abort", onAbort, { once: true });
    })]);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    clearTimeout(timer);
    if (notice !== null) toast.dismiss(notice);
  }
}

/**
 * Never two runtimes at one place — and a place is also the sync folder at
 * the provider. Two vaults can sync with the same folder (two entries made
 * for it, two local folders bound to it). While one of them closes, its
 * runtime may still have a request open at the provider; the other one's
 * sync must not start beside it: a late upload of the old runtime would land
 * over what the new one just sent, and at a provider that does not check
 * conditions (Google Drive) the newer text would be gone everywhere.
 *
 * A closing runtime parks its end under the folder its sync used
 * (`parkClosingSyncPlace`); a sync start waits for every runtime parked at
 * the same folder (`waitForClosingSyncPlace`), with the notice of text 8.
 * "The same folder" is the rule the sync state is bound by
 * (`sameSyncTarget`): where one side does not know enough to tell them
 * apart, they are taken as one, and the start waits.
 */
interface ParkedSyncPlace {
  place: SyncStateBinding;
  vault: string;
  ended: Promise<void>;
}

const parkedSyncPlaces = new Set<ParkedSyncPlace>();

/** A closing runtime's end, under the folder its sync used (nothing without one). */
export function parkClosingSyncPlace(place: SyncStateBinding | null | undefined, vault: string, ended: Promise<unknown>): void {
  if (!place) return;
  const entry: ParkedSyncPlace = { place, vault, ended: ended.then(() => undefined, () => undefined) };
  parkedSyncPlaces.add(entry);
  void entry.ended.then(() => {
    parkedSyncPlaces.delete(entry);
  });
}

/** The runtimes still closing at this folder. */
export function closingAtSyncPlace(place: SyncStateBinding): ReadonlyArray<{ vault: string; ended: Promise<void> }> {
  return [...parkedSyncPlaces].filter((parked) => sameSyncTarget(parked.place, place));
}

/**
 * Before a sync starts at `place`: waits until no runtime that closes is
 * parked at the same folder, and from `noticeAfterMs` on says which one it
 * waits for (text 8). No deadline: the old runtime's requests end by their
 * own time limits.
 */
export async function waitForClosingSyncPlace(place: SyncStateBinding, options: Pick<CloseDeadlineOptions, "noticeAfterMs"> & { signal?: AbortSignal } = {}): Promise<void> {
  const { signal } = options;
  let waiting = closingAtSyncPlace(place);
  if (waiting.length === 0 || signal?.aborted) return;
  let notice: number | null = null;
  const timer = setTimeout(() => {
    const now = closingAtSyncPlace(place);
    if (now.length > 0) notice = toast.progress(i18n.t("closing.stillClosingSameFolder", { vault: now[0].vault }));
  }, options.noticeAfterMs ?? CLOSE_NOTICE_AFTER_MS);
  // The notice lives as long as the start that shows it: one called off meanwhile stops waiting, and its notice goes.
  let onAbort = () => {};
  const calledOff = new Promise<void>((resolve) => {
    onAbort = () => resolve();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    // One that parks here meanwhile is waited for too.
    while (waiting.length > 0 && !signal?.aborted) {
      await Promise.race([Promise.all(waiting.map((parked) => parked.ended)), calledOff]);
      waiting = closingAtSyncPlace(place);
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    clearTimeout(timer);
    if (notice !== null) toast.dismiss(notice);
  }
}

/** Tests only. */
export function resetClosingSyncPlacesForTests(): void {
  parkedSyncPlaces.clear();
}
