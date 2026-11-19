import i18n from "i18next";
import { toast } from "../services/toastStore";

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
  | { kind: "opening"; vault: string };

/** The notice while it waits (texts 1–3). */
export function closeWaitText(step: CloseWaitStep): string {
  if (step.kind === "saving") {
    return step.names.length === 1 ? i18n.t("closing.savingWait", { name: step.names[0] }) : i18n.t("closing.savingWaitMany", { count: step.names.length });
  }
  if (step.kind === "sync") return i18n.t("closing.syncWait", { vault: step.vault });
  return i18n.t("closing.openingWait", { vault: step.vault });
}

/** What it says when it goes on without the step (texts 4–6). */
export function closeGaveUpText(step: CloseWaitStep): string {
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
      notice = toast.progress(closeWaitText(step()));
    }, noticeAfter);
    giveUpTimer = setTimeout(() => resolve("gave-up"), giveUpAfter);
  });
  try {
    const outcome = await Promise.race([work.then(() => "done" as const), deadline]);
    if (outcome === "gave-up") {
      const said = step();
      if (notice !== null) toast.dismiss(notice);
      notice = null;
      toast.warning(closeGaveUpText(said));
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
export async function waitForClosingVault(ended: Promise<unknown>, vault: string, options: Pick<CloseDeadlineOptions, "noticeAfterMs"> = {}): Promise<void> {
  let notice: number | null = null;
  const timer = setTimeout(() => {
    notice = toast.progress(i18n.t("closing.stillClosing", { vault }));
  }, options.noticeAfterMs ?? CLOSE_NOTICE_AFTER_MS);
  try {
    await ended;
  } finally {
    clearTimeout(timer);
    if (notice !== null) toast.dismiss(notice);
  }
}
