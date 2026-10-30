/**
 * The one rule both draft journals follow (open-items plan 3.124 and 3.125).
 *
 * Each shell keeps a journal of unsaved editor text outside the vault — the
 * desktop under its app data, the phone under `Directory.Data` — and stores it
 * differently. What a journal file HOLDS and what a reader may OFFER is the
 * same in both, and lives here:
 *
 * - **One entry per writer.** An entry belongs to a session: the desktop names
 *   one per editor lifetime, the phone one per run of the app and a separate
 *   one for a draft it has put on offer. A save clears only its own session's
 *   entry, up to the revision it wrote, so a draft on offer survives typing
 *   that goes on in the same note until it is restored or discarded. The phone
 *   used to hold one text per note, and the first save after the offer
 *   overwrote it (3.125).
 * - **Every reader asks whose entry it is.** An entry names its note (and on
 *   the desktop its vault); a reader takes only the entries that name exactly
 *   the note it asks for. The desktop's journal file names were built with a
 *   hash that lost digits, so notes whose paths differ near the end shared a
 *   file and a draft could be offered at the wrong note (3.124). The new names
 *   no longer collide, and files under the old names are still read — through
 *   this filter.
 */

export interface DraftJournalEntry {
  /** The note, vault-relative. */
  notePath: string;
  /** The vault; the desktop records it, the phone's journal folder already is per vault. */
  vaultPath?: string;
  text: string;
  /** The writer's revision; older phone journals had none and read as 0. */
  revision: number;
  /** When the entry was written (ms). */
  savedAt: number;
  /** Whose entry it is; entries from before sessions existed are `"legacy"`. */
  sessionId?: string;
}

/** The session an entry from before sessions belongs to. */
export const LEGACY_DRAFT_SESSION = "legacy";

export const draftSessionOf = (entry: Pick<DraftJournalEntry, "sessionId">): string => entry.sessionId ?? LEGACY_DRAFT_SESSION;

/** Which note an entry must name; `vaultPath` only where the journal records it. */
export interface DraftOwner {
  notePath: string;
  vaultPath?: string;
}

function invalid(): never {
  throw new Error("Invalid draft journal");
}

/**
 * Reads a journal file in every shape either shell ever wrote: the current
 * list (`{ version: 2, entries }`), the desktop's first single entry
 * (`{ vaultPath, notePath, text, revision, savedAt }`) and the phone's first
 * single entry (`{ path, text, ts, revision? }`). Throws on anything else, so
 * a caller can tell "nothing there" from "something it cannot read" and never
 * writes over the latter.
 */
export function decodeDraftJournal(raw: string): DraftJournalEntry[] {
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object") invalid();
  const record = value as Record<string, unknown>;
  const list = "entries" in record ? (record.version === 2 && Array.isArray(record.entries) ? record.entries : invalid()) : [record];
  return list.map((item) => {
    if (!item || typeof item !== "object") invalid();
    const e = item as Record<string, unknown>;
    const notePath = typeof e.notePath === "string" ? e.notePath : typeof e.path === "string" ? e.path : invalid();
    const savedAt = typeof e.savedAt === "number" ? e.savedAt : typeof e.ts === "number" ? e.ts : invalid();
    if (typeof e.text !== "string") invalid();
    if (e.revision !== undefined && typeof e.revision !== "number") invalid();
    const entry: DraftJournalEntry = { notePath, text: e.text, revision: (e.revision as number | undefined) ?? 0, savedAt };
    if (typeof e.vaultPath === "string") entry.vaultPath = e.vaultPath;
    if (typeof e.sessionId === "string") entry.sessionId = e.sessionId;
    return entry;
  });
}

export function encodeDraftJournal(entries: readonly DraftJournalEntry[]): string {
  return JSON.stringify({ version: 2, entries });
}

/** Does this entry belong to that note? A journal that records the vault must name the same one. */
export function isDraftOf(entry: DraftJournalEntry, owner: DraftOwner): boolean {
  if (entry.notePath !== owner.notePath) return false;
  return owner.vaultPath === undefined || entry.vaultPath === owner.vaultPath;
}

/**
 * The entries with `entry` in its session's place. `null` when the session
 * already holds a NEWER revision of this note: a late snapshot must not undo
 * a later one (latest wins).
 */
export function withDraftEntry(entries: readonly DraftJournalEntry[], entry: DraftJournalEntry): DraftJournalEntry[] | null {
  const owner: DraftOwner = { notePath: entry.notePath, vaultPath: entry.vaultPath };
  const mine = (e: DraftJournalEntry) => isDraftOf(e, owner) && draftSessionOf(e) === draftSessionOf(entry);
  const previous = entries.find(mine);
  if (previous && previous.revision > entry.revision) return null;
  return [...entries.filter((e) => !mine(e)), entry];
}

/**
 * The entries without the session's entry for this note, as far as `upToRevision`
 * covers it (`Infinity` forces). Every other entry stays — another session's
 * draft, a draft on offer, another note's entry in a shared file.
 */
export function withoutSessionDraft(
  entries: readonly DraftJournalEntry[],
  owner: DraftOwner,
  sessionId: string,
  upToRevision: number,
): DraftJournalEntry[] {
  return entries.filter((e) => !(isDraftOf(e, owner) && draftSessionOf(e) === sessionId && e.revision <= upToRevision));
}

/**
 * The draft to offer for a note: the newest of ITS entries whose text is not
 * what the file holds. Never another note's, never one the disk already has.
 */
export function offeredDraft<E extends DraftJournalEntry>(entries: readonly E[], owner: DraftOwner, diskText?: string): E | null {
  return entries
    .filter((e) => isDraftOf(e, owner) && (diskText === undefined || e.text !== diskText))
    .sort((a, b) => b.savedAt - a.savedAt || draftSessionOf(a).localeCompare(draftSessionOf(b)))[0] ?? null;
}
