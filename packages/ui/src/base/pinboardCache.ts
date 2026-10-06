import type { NoteCardData } from "@plainva/core";
import { parseNoteCard } from "../lib/noteCardModel";

export type CardSource = { getCardData(paths: string[]): Promise<Record<string, NoteCardData>> };
export type CardRow = Record<string, any>;
export interface PinboardSession {
  bodySearch?: { query: string; revision: string; matches: string[] };
  labels: string[];
  search: string;
  heights: Map<string, number>;
  scrollTop: number;
  anchor: { path: string; offset: number } | null;
  width: number;
}
const caches = new WeakMap<object, PinboardCache>();
const parsed = new WeakMap<NoteCardData, ReturnType<typeof parseNoteCard>>();
export function parsedPinboardCard(data: NoteCardData) {
  let value = parsed.get(data);
  if (!value) { value = parseNoteCard(data.content, { dropLeadingH1: true }); parsed.set(data, value); }
  return value;
}
export const cardRevision = (row: CardRow) => String(row["file.revision"] ?? `${row["file.mtime"]}:${row["file.size"]}`);

/** In-memory navigation state, owned by a vault runtime, never by its name. */
export class PinboardCache {
  private cards = new Map<string, { revision: string; data: NoteCardData; bytes: number }>();
  private pending = new Map<string, { revision: string; promise: Promise<void> }>();
  private sessions = new Map<string, PinboardSession>();
  private bases = new Map<string, { value: unknown; bytes: number }>();
  private baseBytes = 0;
  private bytes = 0;
  private generation = 0;
  /** Paths of the cards a board shows right now; the budget never takes these. */
  private kept = new Set<string>();
  constructor(private maxCards = 384, private maxBytes = 8 * 1024 * 1024) {}
  get(row: CardRow): NoteCardData | undefined {
    const entry = this.cards.get(String(row["file.path"]));
    return entry?.revision === cardRevision(row) ? entry.data : undefined;
  }
  session(key: string): PinboardSession {
    let value = this.sessions.get(key);
    if (!value) {
      value = { labels: [], search: "", heights: new Map(), scrollTop: 0, anchor: null, width: 0 };
      this.sessions.set(key, value);
      while (this.sessions.size > 20) this.sessions.delete(this.sessions.keys().next().value!);
    }
    return value;
  }
  /**
   * Says which cards are on screen. The two budgets (count and bytes) exist to
   * bound what is remembered of cards that scrolled AWAY; applied to the cards
   * being shown they turn a full screen back into placeholders - a board of
   * long notes loaded its last cards and dropped its first, which were the
   * ones on screen (TestFlight 2026-10-04).
   */
  keep(paths: Iterable<string>) { this.kept = new Set(paths); }
  /** Drops the oldest cards that are not on screen until both budgets hold. */
  private trim() {
    if (this.cards.size <= this.maxCards && this.bytes <= this.maxBytes) return;
    for (const [path, entry] of this.cards) {
      if (this.kept.has(path)) continue;
      this.bytes -= entry.bytes; this.cards.delete(path);
      if (this.cards.size <= this.maxCards && this.bytes <= this.maxBytes) return;
    }
  }
  updateSession(key: string, patch: Partial<PinboardSession>) { Object.assign(this.session(key), patch); }
  base<T>(key: string): T | undefined { return this.bases.get(key)?.value as T | undefined; }
  rememberBase(key: string, value: unknown) {
    const old = this.bases.get(key);
    if (old) this.baseBytes -= old.bytes;
    this.bases.delete(key);
    let bytes: number;
    try { const encoded = JSON.stringify(value); if (!encoded) return; bytes = encoded.length * 2; } catch { return; }
    if (bytes > 8 * 1024 * 1024) return;
    this.bases.set(key, { value, bytes }); this.baseBytes += bytes;
    while (this.bases.size > 8 || this.baseBytes > 8 * 1024 * 1024) {
      const oldest = this.bases.keys().next().value!;
      this.baseBytes -= this.bases.get(oldest)!.bytes; this.bases.delete(oldest);
    }
  }
  async load(source: CardSource, rows: CardRow[]): Promise<void> {
    const missing = rows.filter((row) => !this.get(row));
    const waiting: Promise<void>[] = [];
    const fresh = missing.filter((row) => {
      const pending = this.pending.get(String(row["file.path"]));
      if (pending?.revision !== cardRevision(row)) return true;
      waiting.push(pending.promise); return false;
    });
    const generation = this.generation;
    for (let i = 0; i < fresh.length; i += 64) {
      const batch = fresh.slice(i, i + 64);
      const promise = source.getCardData(batch.map((row) => String(row["file.path"]))).then((data) => {
        if (generation !== this.generation) return;
        for (const row of batch) {
          const path = String(row["file.path"]);
          const revision = cardRevision(row);
          if (this.pending.get(path)?.revision !== revision) continue;
          const incoming = data[path];
          const card = incoming && incoming.content.length > 200000 ? { ...incoming, content: incoming.content.slice(0, 200000) } : incoming;
          // Missing FTS rows are not empty notes and must remain retryable.
          if (!card || card.indexStatus === "missing") continue;
          const old = this.cards.get(path);
          if (old) this.bytes -= old.bytes;
          const bytes = card.content.length * 2 + JSON.stringify(card.tags).length * 2 + 128;
          this.cards.delete(path);
          this.cards.set(path, { revision, data: card, bytes }); this.bytes += bytes;
          this.trim();
        }
      }).finally(() => {
        for (const row of batch) {
          const path = String(row["file.path"]);
          if (this.pending.get(path)?.promise === promise) this.pending.delete(path);
        }
      });
      for (const row of batch) this.pending.set(String(row["file.path"]), { revision: cardRevision(row), promise });
      waiting.push(promise);
    }
    await Promise.all(waiting);
  }
  clear() { this.generation++; this.kept.clear(); this.cards.clear(); this.pending.clear(); this.sessions.clear(); this.bases.clear(); this.baseBytes = 0; this.bytes = 0; }
}
export function pinboardCache(owner: object): PinboardCache {
  let cache = caches.get(owner);
  if (!cache) { cache = new PinboardCache(); caches.set(owner, cache); }
  return cache;
}
export function clearPinboardCache(owner: object | null | undefined) { if (owner) { caches.get(owner)?.clear(); caches.delete(owner); } }
