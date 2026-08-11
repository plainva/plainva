/**
 * Putting a message aside until later (S22, plan P12).
 *
 * There is no snooze in IMAP and none in Microsoft Graph. What every client
 * calls "snooze" is a client-side marker, and the honest consequence is that it
 * lives where Plainva's other per-vault preferences live: in the profile, so a
 * message put aside on the phone also rests on the desktop. A marker in local
 * storage would let the same message come back on one device and stay hidden on
 * the other — two truths about one mail.
 *
 * The marker is deliberately NOT a flag on the server. Writing an IMAP keyword
 * would mean touching the message, and a snooze is a statement about the
 * READER, not about the mail: "not now" is not a property the sender or another
 * client should see.
 *
 * Everything here is pure. Which surface hides a row and which one shows the
 * "back" toast is a shell decision; when a message is due again is not.
 */

/** A message put aside, keyed by account and message id. */
export interface SnoozeEntry {
  /** Account the message belongs to — ids are only unique within one. */
  account: string;
  /** The message id as the transport knows it (IMAP uid as string, Graph id). */
  id: string;
  /** Folder the message was in when it was put aside; where it returns to. */
  folder: string;
  /** When it becomes visible again, epoch milliseconds. */
  until: number;
}

/** The stored shape: a flat list, because the profile carries `json`. */
export type SnoozeState = readonly SnoozeEntry[];

/** Identity of an entry — the pair the list is keyed on. */
export function snoozeKey(account: string, id: string): string {
  // The separator is written as an ESCAPE, never as a raw byte: a literal NUL in
  // a source file makes git treat it as binary, which is the finding the
  // encoding guard exists for.
  return `${account}\u0000${id}`;
}

/**
 * The offered presets, in the order a menu should show them.
 *
 * They are RELATIVE rules rather than fixed hours, because "tomorrow morning"
 * has to mean tomorrow morning wherever the reader is — a stored hour would
 * drift with the time zone and be wrong exactly once per journey.
 */
export type SnoozePreset = "laterToday" | "tomorrow" | "thisWeekend" | "nextWeek";

export const SNOOZE_PRESETS: readonly SnoozePreset[] = [
  "laterToday",
  "tomorrow",
  "thisWeekend",
  "nextWeek",
];

export interface SnoozeClock {
  /** Hour of the morning "tomorrow" and "next week" wake up at. */
  morningHour: number;
  /** Hours "later today" adds. */
  laterHours: number;
}

export const DEFAULT_SNOOZE_CLOCK: SnoozeClock = { morningHour: 8, laterHours: 3 };

/**
 * When a preset falls due, measured from `now`.
 *
 * Two rules that keep a preset from producing a time in the past:
 *
 *  - "Later today" that would cross midnight becomes the next morning instead —
 *    three hours added at 23:00 is 02:00, which is not "later today".
 *  - "This weekend" on a Saturday or Sunday means the NEXT weekend, not this
 *    morning, which has already happened.
 */
export function snoozeUntil(preset: SnoozePreset, now: Date, clock: SnoozeClock = DEFAULT_SNOOZE_CLOCK): number {
  const morning = (d: Date, addDays: number): Date => {
    const out = new Date(d);
    out.setDate(out.getDate() + addDays);
    out.setHours(clock.morningHour, 0, 0, 0);
    return out;
  };

  if (preset === "laterToday") {
    const later = new Date(now.getTime() + clock.laterHours * 3600_000);
    // The cap is MIDNIGHT, not the morning hour: three hours added at 23:00
    // lands at 02:00, which is a different day and therefore not "later
    // today" — however much of the night is still ahead.
    return later.getDate() === now.getDate() ? later.getTime() : morning(now, 1).getTime();
  }
  if (preset === "tomorrow") return morning(now, 1).getTime();
  if (preset === "nextWeek") {
    // The coming Monday; on a Monday that means the one after this.
    const day = now.getDay(); // 0 = Sunday
    const ahead = ((8 - day) % 7) || 7;
    return morning(now, ahead).getTime();
  }
  // thisWeekend: the coming Saturday; on Sat/Sun the next one.
  const day = now.getDay();
  const ahead = ((6 - day) % 7) || 7;
  return morning(now, ahead).getTime();
}

/** Adds or replaces an entry. Snoozing an already-snoozed message re-times it. */
export function addSnooze(state: SnoozeState, entry: SnoozeEntry): SnoozeEntry[] {
  const key = snoozeKey(entry.account, entry.id);
  return [...state.filter((e) => snoozeKey(e.account, e.id) !== key), entry];
}

/** Removes an entry — "bring it back now". */
export function removeSnooze(state: SnoozeState, account: string, id: string): SnoozeEntry[] {
  const key = snoozeKey(account, id);
  return state.filter((e) => snoozeKey(e.account, e.id) !== key);
}

/**
 * The entries that are due at `now` — the ones a shell should stop hiding.
 *
 * Due entries are NOT dropped here. Removing them is a write, and a read that
 * writes would fire on every render; the shell drops them once, when it acts.
 */
export function dueSnoozes(state: SnoozeState, now: number): SnoozeEntry[] {
  return state.filter((e) => e.until <= now);
}

/** Whether a message is currently put aside. */
export function isSnoozed(state: SnoozeState, account: string, id: string, now: number): boolean {
  const key = snoozeKey(account, id);
  const hit = state.find((e) => snoozeKey(e.account, e.id) === key);
  return !!hit && hit.until > now;
}

/**
 * Hides the snoozed rows of ONE folder.
 *
 * Scoped to the folder the entry was taken from: a message put aside in the
 * inbox should still be findable in "all mail" or in a search, because a
 * snooze says "not in my way", not "gone".
 */
export function filterSnoozed<T>(
  rows: readonly T[],
  opts: {
    state: SnoozeState;
    now: number;
    folder: string;
    accountOf: (row: T) => string;
    idOf: (row: T) => string;
  }
): T[] {
  if (opts.state.length === 0) return [...rows];
  const hidden = new Set(
    opts.state
      .filter((e) => e.until > opts.now && e.folder === opts.folder)
      .map((e) => snoozeKey(e.account, e.id))
  );
  if (hidden.size === 0) return [...rows];
  return rows.filter((r) => !hidden.has(snoozeKey(opts.accountOf(r), opts.idOf(r))));
}

/**
 * Drops entries that are long past due, so the profile does not grow forever.
 *
 * A week of grace, because a device that was off for a few days must still see
 * that its messages came back rather than find them silently un-snoozed.
 */
export function pruneSnoozes(state: SnoozeState, now: number, graceMs = 7 * 24 * 3600_000): SnoozeEntry[] {
  return state.filter((e) => e.until > now - graceMs);
}

/** Parses whatever the profile stored, discarding anything malformed. */
export function parseSnoozeState(raw: unknown): SnoozeEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: SnoozeEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const account = typeof e.account === "string" ? e.account : "";
    const id = typeof e.id === "string" ? e.id : "";
    const folder = typeof e.folder === "string" ? e.folder : "";
    const until = typeof e.until === "number" && Number.isFinite(e.until) ? e.until : 0;
    // A malformed entry is skipped rather than repaired: an entry with no id
    // would hide nothing, and one with no time would hide forever.
    if (!account || !id || !until) continue;
    out.push({ account, id, folder, until });
  }
  return out;
}
