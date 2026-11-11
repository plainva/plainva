import {
  decodeDraftJournal,
  draftSessionOf,
  encodeDraftJournal,
  isDraftOf,
  offeredDraft,
  withDraftEntry,
  withoutSessionDraft,
  type DraftJournalEntry,
  type DraftOwner,
} from "./draftJournalEntries";

/**
 * The draft journal, once for both shells (stability plan R6, finding S4).
 *
 * While a note holds text its file does not have yet, the text is kept here,
 * OUTSIDE the vault (never synced, never in the vault's versions), written as
 * one step so the crash it exists for cannot tear it. A confirmed save clears
 * its own entry up to the revision it wrote; on the next open of the note an
 * entry whose text the file does not hold is offered ("Restore draft?").
 *
 * Until 2026-11-11 each shell had its own journal of about 400 lines with 24
 * in common, and they had drifted: the desktop wrote a snapshot only once the
 * typing PAUSED for 400 ms (continuous typing, then a crash, lost everything
 * since the last pause), the phone wrote at most every 400 ms while typing went
 * on; the phone lifted a draft on offer into a session of its own so a save
 * could not clear it (3.125), the desktop relied on a new session per editor;
 * the phone's clean-up kept a file whose entries were young, the desktop's
 * went by the file's time alone. The rules are one now, each the stronger of
 * the two. What stays per shell is where the files lie — their names are kept
 * as each shell wrote them, so a draft an older version left is still found —
 * and how a file is written (`DraftJournalStorage`).
 *
 * What a file holds and what may be offered is `draftJournalEntries.ts`.
 */

/** A file in a journal folder. */
export interface DraftJournalFile {
  name: string;
  isFile: boolean;
  /** Last change (ms), where the platform says. */
  mtimeMs: number | null;
}

/** Where a shell keeps its journal files, and how it reads and writes them. Paths are the layout's own. */
export interface DraftJournalStorage {
  /** The file's text; `null` where there is no such file. THROWS where it is there but cannot be read: never written over then. */
  read(file: string): Promise<string | null>;
  /** Replaces the file as one step (atomic), creating its folder. */
  write(file: string, text: string): Promise<void>;
  /** Removes the file; nothing where it is not there. */
  remove(file: string): Promise<void>;
  /** The files of a folder; `[]` where there is no such folder. */
  list(dir: string): Promise<DraftJournalFile[]>;
}

/** How a shell names its journal files (kept as each shell wrote them). */
export interface DraftJournalLayout<S> {
  /** The scope's identity — a vault — for what is said once per scope. */
  key(scope: S): string;
  /** The file every new snapshot of the note is written to. */
  file(scope: S, notePath: string): string;
  /** Files of older names that can hold the note's entries: read, cleared and moved, never written with new ones. */
  olderFiles?(scope: S, notePath: string): string[];
  /** The scope's folders, the current one first, and their files' paths. */
  dirs(scope: S): string[];
  fileIn(dir: string, name: string): string;
  /** What an entry must name to be this note's (the desktop also names the vault). */
  owner(scope: S, notePath: string): DraftOwner;
  /** Whether an entry belongs to this scope at all — for a folder that can be shared with another vault. */
  ours?(scope: S, entry: DraftJournalEntry): boolean;
}

/** A draft as it was offered or kept: which entry exactly. */
export interface DraftIdentity {
  savedAt: number;
  revision: number;
  sessionId?: string;
}

export interface DraftJournalOptions<S> {
  storage: DraftJournalStorage;
  layout: DraftJournalLayout<S>;
  /** How long a journal file is kept (default seven days). */
  retentionMs?: number;
  now?: () => number;
  /** When this run of the app began: every draft of this run was journaled after it. */
  runStartedAt?: number;
  /** A new session name for a draft put on offer. */
  offerSession?: () => string;
}

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const isThatDraft = (entry: DraftJournalEntry, owner: DraftOwner, draft: DraftIdentity) =>
  isDraftOf(entry, owner) && entry.savedAt === draft.savedAt && entry.revision === draft.revision &&
  (draft.sessionId === undefined || draftSessionOf(entry) === draft.sessionId);

/** Where `notePath` lives after `move`, or null when the move does not touch it. */
export function relocatedDraftPath(notePath: string, move: { from: string; to: string }): string | null {
  if (notePath === move.from) return move.to;
  if (notePath.startsWith(`${move.from}/`)) return move.to + notePath.slice(move.from.length);
  return null;
}

export type DraftJournal<S> = ReturnType<typeof createDraftJournal<S>>;

export function createDraftJournal<S>(options: DraftJournalOptions<S>) {
  const { storage, layout } = options;
  const retentionMs = options.retentionMs ?? RETENTION_MS;
  const now = options.now ?? Date.now;
  const runStartedAt = options.runStartedAt ?? now();
  const offerSession = options.offerSession ?? (() => `offer-${now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`);
  const lanes = new Map<string, Promise<void>>();
  const handedOver = new Set<string>();

  /** Every operation on a file takes its turn in that file's lane: a late clear never lands after a newer snapshot. */
  function serial<T>(file: string, work: () => Promise<T>): Promise<T> {
    const run = (lanes.get(file) ?? Promise.resolve()).catch(() => {}).then(work);
    const settled = run.then(() => {}, () => {});
    lanes.set(file, settled);
    void settled.then(() => { if (lanes.get(file) === settled) lanes.delete(file); });
    return run;
  }

  /** A file's entries: missing → []; unreadable → throws (and nothing is written over it). */
  async function entriesIn(file: string): Promise<DraftJournalEntry[]> {
    const raw = await storage.read(file);
    return raw === null ? [] : decodeDraftJournal(raw);
  }

  /** Writes the entries, or removes the file when none are left. */
  async function store(file: string, entries: readonly DraftJournalEntry[]): Promise<void> {
    if (entries.length === 0) await storage.remove(file);
    else await storage.write(file, encodeDraftJournal(entries));
  }

  const filesOf = (scope: S, notePath: string) => [layout.file(scope, notePath), ...(layout.olderFiles?.(scope, notePath) ?? [])];

  /** The note's entries in every file that can hold them; an unreadable file is skipped. */
  async function entriesOf(scope: S, notePath: string): Promise<DraftJournalEntry[]> {
    const owner = layout.owner(scope, notePath);
    const out: DraftJournalEntry[] = [];
    for (const file of filesOf(scope, notePath)) {
      try {
        out.push(...(await entriesIn(file)).filter((entry) => isDraftOf(entry, owner)));
      } catch {
        /* an unreadable journal is left alone; another file may still hold the note's drafts */
      }
    }
    return out;
  }

  /**
   * The snapshot into the session's entry — inside the file's lane, the
   * caller's. A late snapshot does not undo a later one of the session (latest
   * revision wins) — except where the caller says its text IS the session's
   * latest (`latest`, the throttled writer's buffer): its revision may count
   * from 1 again where the session's counter did.
   */
  async function recordInLane(scope: S, notePath: string, text: string, revision: number, sessionId: string, latest = false): Promise<void> {
    const file = layout.file(scope, notePath);
    const owner = layout.owner(scope, notePath);
    const entry = { ...owner, text, revision, sessionId, savedAt: now() };
    const entries = await entriesIn(file);
    const next = latest ? [...withoutSessionDraft(entries, owner, sessionId, Infinity), entry] : withDraftEntry(entries, entry);
    if (next) await store(file, next);
  }

  const leftoverKey = (scope: S, notePath: string, entry: DraftJournalEntry) =>
    JSON.stringify([layout.key(scope), notePath, draftSessionOf(entry), entry.savedAt, entry.revision]);

  return {
    serial,
    recordInLane,

    /** The session's snapshot of the note. Rejects where the file is there and unreadable: an older draft is never written over. */
    record(scope: S, notePath: string, text: string, revision: number, sessionId: string): Promise<void> {
      return serial(layout.file(scope, notePath), () => recordInLane(scope, notePath, text, revision, sessionId));
    },

    /**
     * Clears the session's entry for the note, as far as `upToRevision` covers
     * it (`Infinity` forces), in every file that can hold it. Best-effort: a
     * stale entry is offered once more, a wrongly deleted one is gone.
     */
    async clear(scope: S, notePath: string, upToRevision: number, sessionId: string): Promise<void> {
      const owner = layout.owner(scope, notePath);
      for (const file of filesOf(scope, notePath)) {
        await serial(file, async () => {
          try {
            const entries = await entriesIn(file);
            const remaining = withoutSessionDraft(entries, owner, sessionId, upToRevision);
            if (remaining.length !== entries.length) await store(file, remaining);
          } catch {
            /* keeping a recoverable draft is safer than guessing */
          }
        });
      }
    },

    /** Clears exactly that entry, while it still is that one — a draft kept beside its file, an offer the reader discards. */
    async clearIf(scope: S, notePath: string, draft: DraftIdentity): Promise<void> {
      const owner = layout.owner(scope, notePath);
      for (const file of filesOf(scope, notePath)) {
        await serial(file, async () => {
          try {
            const entries = await entriesIn(file);
            const remaining = entries.filter((entry) => !isThatDraft(entry, owner, draft));
            if (remaining.length !== entries.length) await store(file, remaining);
          } catch {
            /* a draft left there is offered again; one deleted is gone */
          }
        });
      }
    },

    /** The draft that would be offered for the note — the newest of ITS entries that is not `diskText` —, or null. */
    async read(scope: S, notePath: string, diskText?: string): Promise<DraftJournalEntry | null> {
      return offeredDraft(await entriesOf(scope, notePath), layout.owner(scope, notePath), diskText);
    },

    /**
     * The draft to offer, held for the offer (3.125): one of `ownSession` is
     * lifted into a session of its own first, so typing on and the next
     * confirmed save cannot replace or clear it; it stays until `adopt` or
     * `clearIf`. Null where there is none or the journal cannot be read.
     */
    async offer(scope: S, notePath: string, diskText: string, ownSession: string): Promise<DraftJournalEntry | null> {
      const owner = layout.owner(scope, notePath);
      let offer: DraftJournalEntry | null = null;
      for (const file of filesOf(scope, notePath)) {
        await serial(file, async () => {
          try {
            const entries = await entriesIn(file);
            const found = offeredDraft(entries, owner, diskText);
            if (!found || (offer && offer.savedAt >= found.savedAt)) return;
            if (draftSessionOf(found) !== ownSession) { offer = found; return; }
            const held: DraftJournalEntry = { ...found, sessionId: offerSession() };
            await store(file, entries.map((entry) => (entry === found ? held : entry)));
            offer = held;
          } catch {
            /* nothing offered from a file that cannot be read */
          }
        });
      }
      return offer;
    },

    /**
     * The reader restored the offered draft: once `ownSession` holds an entry
     * of the note — `beforeCheck` writes the snapshot of the restored text
     * first, in the same lane —, the offer's own entry goes. Without such an
     * entry the offer stays: a later open offers it again, never a lost text.
     */
    async adopt(scope: S, notePath: string, draft: DraftIdentity, ownSession: string, beforeCheck?: () => Promise<void>): Promise<void> {
      const owner = layout.owner(scope, notePath);
      const file = layout.file(scope, notePath);
      await serial(file, async () => {
        await beforeCheck?.();
        try {
          const own = (await entriesIn(file)).some((entry) => isDraftOf(entry, owner) && draftSessionOf(entry) === ownSession);
          if (!own) return;
        } catch {
          return;
        }
        for (const older of filesOf(scope, notePath)) {
          const work = async () => {
            try {
              const entries = await entriesIn(older);
              const remaining = entries.filter((entry) => !isThatDraft(entry, owner, draft));
              if (remaining.length !== entries.length) await store(older, remaining);
            } catch { /* the offer stays; nothing is lost by keeping it */ }
          };
          if (older === file) await work(); else await serial(older, work);
        }
      });
    },

    /**
     * The drafts of the note from before this run of the app — of editors that
     * held changes when the app went —, each handed out once per run (finding
     * 2026-10-11). A draft of this run belongs to an editor that is still open.
     */
    async takeLeftovers(scope: S, notePath: string): Promise<DraftJournalEntry[]> {
      return (await entriesOf(scope, notePath)).filter((entry) => {
        const key = leftoverKey(scope, notePath, entry);
        if (entry.savedAt >= runStartedAt || handedOver.has(key)) return false;
        handedOver.add(key);
        return true;
      });
    },

    /** Leftovers that could not be kept: handed out again on the next ask. */
    releaseLeftovers(scope: S, notePath: string, drafts: readonly DraftJournalEntry[]): void {
      for (const entry of drafts) handedOver.delete(leftoverKey(scope, notePath, entry));
    },

    /**
     * Entries follow a move or rename made in the app (issue 113, V3): an
     * entry left under the old path is one no editor ever asks for again.
     * Entry by entry — a file can hold several notes' entries (3.124); of the
     * same session the newer revision wins; the destination is written before
     * the entries leave their old file. Best-effort.
     */
    async relocate(scope: S, moves: ReadonlyArray<{ from: string; to: string }>): Promise<void> {
      if (moves.length === 0) return;
      const target = (entry: DraftJournalEntry) => {
        if (layout.ours && !layout.ours(scope, entry)) return null;
        return moves.map((m) => relocatedDraftPath(entry.notePath, m)).find((p): p is string => p !== null) ?? null;
      };
      for (const dir of layout.dirs(scope)) {
        let files: DraftJournalFile[];
        try { files = await storage.list(dir); } catch { continue; }
        for (const listed of files) {
          if (!listed.isFile || !listed.name.endsWith(".json")) continue;
          const oldFile = layout.fileIn(dir, listed.name);
          let entries: DraftJournalEntry[];
          try { entries = await entriesIn(oldFile); } catch { continue; /* unreadable: left exactly where it is */ }
          const destinations = [...new Set(entries.map(target).filter((to): to is string => to !== null))];
          for (const to of destinations) {
            const newFile = layout.file(scope, to);
            if (newFile === oldFile) continue;
            try {
              await serial(newFile, () => serial(oldFile, async () => {
                // Read again inside the lanes: a snapshot may have landed meanwhile.
                const current = await entriesIn(oldFile);
                const moving = current.filter((entry) => target(entry) === to);
                if (moving.length === 0) return;
                let merged = await entriesIn(newFile);
                for (const entry of moving) merged = withDraftEntry(merged, { ...entry, ...layout.owner(scope, to) }) ?? merged;
                await store(newFile, merged);
                await store(oldFile, current.filter((entry) => !moving.includes(entry)));
              }));
            } catch {
              /* this one stays where it was; the next move or open finds it there */
            }
          }
        }
      }
    },

    /**
     * Files older than the retention go (on vault open) — not one that holds a
     * young entry (the folder's listing can predate a fresh write), not one a
     * caller still has a snapshot pending for, never an unreadable one.
     */
    async prune(scope: S, pending: (file: string) => boolean = () => false): Promise<void> {
      const cutoff = now() - retentionMs;
      for (const dir of layout.dirs(scope)) {
        let files: DraftJournalFile[];
        try { files = await storage.list(dir); } catch { continue; }
        for (const listed of files) {
          if (!listed.isFile || listed.mtimeMs === null || listed.mtimeMs >= cutoff) continue;
          const file = layout.fileIn(dir, listed.name);
          await serial(file, async () => {
            if (pending(file)) return;
            try {
              const entries = await entriesIn(file);
              if (pending(file) || entries.some((entry) => entry.savedAt >= cutoff)) return;
              await storage.remove(file);
            } catch { /* retain what cannot be read */ }
          });
        }
      }
    },
  };
}

/**
 * Where the writer's snapshots go: the journal itself, or — in a window that
 * does not own the disk (the desktop's auxiliary windows) — a stand-in that
 * hands each one to the window that does.
 */
export type DraftSink<S> = Pick<DraftJournal<S>, "serial" | "recordInLane" | "clear" | "adopt">;

/** A snapshot waiting for its turn in the throttled writer. */
interface PendingSnapshot<S> {
  scope: S;
  notePath: string;
  file: string;
  text: () => string;
  revision: number;
  sessionId: string;
}

/**
 * Snapshots while typing goes on (both shells): at most one write per note and
 * session every `throttleMs`, the newest text always buffered, so a crash
 * loses at most that window — also while the typing never pauses. A failed
 * write keeps its buffer and tries again; a save that covered the buffered
 * revision takes it out of the buffer (`clear`), so a snapshot of a text the
 * file already has is never written after the save. Buffered per session: two
 * editors on one note (a split on the desktop) never take each other's place.
 */
export function createDraftWriter<S>(journal: DraftSink<S>, layout: Pick<DraftJournalLayout<S>, "file">, options: { throttleMs?: number; retryMs?: number; now?: () => number } = {}) {
  const throttleMs = options.throttleMs ?? 400;
  const retryMs = options.retryMs ?? 2000;
  const now = options.now ?? Date.now;
  const pending = new Map<string, PendingSnapshot<S>>();
  const generations = new Map<string, number>();
  const lastWrite = new Map<string, number>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const keyOf = (file: string, sessionId: string) => `${file}\u0000${sessionId}`;

  const cancelTimer = (key: string) => {
    const timer = timers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(key);
  };
  const schedule = (key: string, file: string, delay: number) => {
    if (timers.has(key)) return;
    timers.set(key, setTimeout(() => { timers.delete(key); void persist(key, file); }, delay));
  };

  /** The buffered snapshot into the session's entry — inside the file's lane. */
  async function persistInLane(key: string): Promise<void> {
    const snapshot = pending.get(key);
    if (!snapshot) return;
    lastWrite.set(key, now());
    try {
      // The buffer always holds the session's newest text: it replaces the session's entry whatever revision that holds.
      await journal.recordInLane(snapshot.scope, snapshot.notePath, snapshot.text(), snapshot.revision, snapshot.sessionId, true);
      // The write covers THIS snapshot, not keystrokes that arrived meanwhile.
      if (pending.get(key) === snapshot) pending.delete(key);
    } catch {
      schedule(key, snapshot.file, retryMs);
    }
  }
  const persist = (key: string, file: string) => journal.serial(file, () => persistInLane(key));

  return {
    /** Buffers the session's newest text of the note; `text` is read when the snapshot is written. */
    write(scope: S, notePath: string, text: string | (() => string), revision: number, sessionId: string): void {
      const file = layout.file(scope, notePath);
      const key = keyOf(file, sessionId);
      generations.set(key, (generations.get(key) ?? 0) + 1);
      pending.set(key, { scope, notePath, file, text: typeof text === "string" ? () => text : text, revision, sessionId });
      if (now() - (lastWrite.get(key) ?? 0) >= throttleMs) {
        cancelTimer(key);
        void persist(key, file);
      } else {
        schedule(key, file, throttleMs);
      }
    },

    /** Writes every buffered snapshot now (before the system suspends the app, before a window closes). */
    async flush(filter: (scope: S) => boolean = () => true): Promise<void> {
      const selected = [...pending].filter(([, snapshot]) => filter(snapshot.scope));
      await Promise.all(selected.map(([key, snapshot]) => { cancelTimer(key); return persist(key, snapshot.file); }));
    },

    /** Whether a snapshot of this file is still buffered (pruning leaves such a file alone). */
    isPending(file: string): boolean {
      return [...pending.values()].some((snapshot) => snapshot.file === file);
    },

    /**
     * Clears the session's entry up to the revision a save confirmed, in the
     * file's lane. Only while what is buffered is still covered: the same
     * generation as at the call, of a revision the save wrote. Typing that came
     * meanwhile keeps the entry on disk until its own, newer snapshot replaces
     * it — a crash in between must not find neither. `Infinity` (a discard)
     * covers what was there at the call, never later input.
     */
    clear(scope: S, notePath: string, upToRevision: number, sessionId: string): Promise<void> {
      const file = layout.file(scope, notePath);
      const key = keyOf(file, sessionId);
      const generation = generations.get(key) ?? 0;
      const covered = () => {
        const snapshot = pending.get(key);
        return (generations.get(key) ?? 0) === generation && (!snapshot || snapshot.revision <= upToRevision);
      };
      return journal.serial(file, async () => {
        if (!covered()) return false;
        cancelTimer(key);
        pending.delete(key);
        return true;
      }).then((go) => (go ? journal.clear(scope, notePath, upToRevision, sessionId) : undefined));
    },

    /** The offered draft was restored: the restored text's snapshot is written first, then the offer goes. */
    adopt(scope: S, notePath: string, draft: DraftIdentity, sessionId: string): Promise<void> {
      const key = keyOf(layout.file(scope, notePath), sessionId);
      cancelTimer(key);
      return journal.adopt(scope, notePath, draft, sessionId, () => persistInLane(key));
    },

    /** Forgets what the session has buffered for the note without writing it. */
    drop(scope: S, notePath: string, sessionId: string): void {
      const key = keyOf(layout.file(scope, notePath), sessionId);
      cancelTimer(key);
      pending.delete(key);
    },
  };
}

export type DraftWriter<S> = ReturnType<typeof createDraftWriter<S>>;
