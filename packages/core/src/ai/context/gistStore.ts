/**
 * Where a vault's gists live (plan KI-Harness §9.6, P2b-3): a feature-owned
 * table in the vault's index database, beside the vectors — derived data,
 * never synced, never exported, rebuilt whenever needed. A row is the gist
 * of one source by one model: a section under the key of its text, a note,
 * a folder and the vault under a name (`note:<path>`, `folder:<name>`,
 * `vault`) with the key of what they were written from in `source` — a gist
 * whose source no longer matches is not used and is written again. A
 * rejected answer is kept as a mark, so the same text is not asked again of
 * the same model.
 */
import type { IDatabaseAdapter } from "../../db/IDatabaseAdapter.js";
import type { GistLevel } from "./gists.js";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ai_gist (
     key TEXT NOT NULL,
     model TEXT NOT NULL,
     level TEXT NOT NULL,
     source TEXT NOT NULL,
     text TEXT NOT NULL,
     ok INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (key, model)
   )`,
];

/** Keys per IN list: far below any SQLite variable limit. */
const KEYS_PER_QUERY = 200;

export interface StoredGist {
  key: string;
  level: GistLevel;
  /** The key of what it was written from: the key itself for a section. */
  source: string;
  text: string;
  /** False: the model's answer failed the check; the original goes. */
  ok: boolean;
  createdAt: number;
}

let prepared: WeakSet<object> = new WeakSet();
let readOnly: WeakSet<object> = new WeakSet();

/** Forgets which databases are prepared (vault switch, tests). */
export function resetGistStores(): void {
  prepared = new WeakSet();
  readOnly = new WeakSet();
}

export class GistStore {
  constructor(private readonly db: IDatabaseAdapter) {}

  /** Whether this connection can write gists; false on a read-only one, where reads still work. */
  async writable(): Promise<boolean> {
    const key = this.db as object;
    if (prepared.has(key)) return true;
    if (readOnly.has(key)) return false;
    try {
      for (const statement of SCHEMA) await this.db.execute(statement);
    } catch {
      readOnly.add(key);
      return false;
    }
    prepared.add(key);
    return true;
  }

  private async read<T>(sql: string, params: unknown[]): Promise<T[]> {
    await this.writable();
    try {
      return await this.db.query<T>(sql, params);
    } catch (error) {
      if (/no such table/i.test(String((error as Error)?.message ?? error))) return [];
      throw error;
    }
  }

  /** The gists of these keys by this model, checked or rejected. */
  async getMany(keys: readonly string[], model: string): Promise<Map<string, StoredGist>> {
    const out = new Map<string, StoredGist>();
    for (let i = 0; i < keys.length; i += KEYS_PER_QUERY) {
      const group = keys.slice(i, i + KEYS_PER_QUERY);
      const rows = await this.read<{ key: string; level: GistLevel; source: string; text: string; ok: number; created_at: number }>(
        `SELECT key, level, source, text, ok, created_at FROM ai_gist WHERE model = ? AND key IN (${group.map(() => "?").join(", ")})`,
        [model, ...group],
      );
      for (const row of rows) {
        out.set(row.key, { key: row.key, level: row.level, source: row.source, text: row.text, ok: Number(row.ok) === 1, createdAt: Number(row.created_at) });
      }
    }
    return out;
  }

  async get(key: string, model: string): Promise<StoredGist | null> {
    return (await this.getMany([key], model)).get(key) ?? null;
  }

  async put(gist: StoredGist, model: string): Promise<void> {
    if (!(await this.writable())) throw new Error("gist store: this connection is read-only");
    await this.db.execute(`INSERT OR REPLACE INTO ai_gist (key, model, level, source, text, ok, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      gist.key,
      model,
      gist.level,
      gist.source,
      gist.text,
      gist.ok ? 1 : 0,
      gist.createdAt,
    ]);
  }

  /** Checked gists and rejected answers of this model, per level. */
  async counts(model: string): Promise<Record<GistLevel, { ok: number; rejected: number }>> {
    const out: Record<GistLevel, { ok: number; rejected: number }> = {
      section: { ok: 0, rejected: 0 },
      note: { ok: 0, rejected: 0 },
      folder: { ok: 0, rejected: 0 },
      vault: { ok: 0, rejected: 0 },
    };
    const rows = await this.read<{ level: GistLevel; ok: number; n: number }>(`SELECT level, ok, COUNT(*) AS n FROM ai_gist WHERE model = ? GROUP BY level, ok`, [model]);
    for (const row of rows) if (out[row.level]) out[row.level][Number(row.ok) === 1 ? "ok" : "rejected"] += Number(row.n);
    return out;
  }

  /** Removes what other models wrote: a new model writes its own, and old gists are never mixed in. */
  async dropOthers(model: string): Promise<void> {
    if (!(await this.writable())) return;
    await this.db.execute(`DELETE FROM ai_gist WHERE model != ?`, [model]);
  }

  /** Removes every gist of this vault (the setting switched off and the reader asked to clear). */
  async dropAll(): Promise<void> {
    if (!(await this.writable())) return;
    await this.db.execute(`DELETE FROM ai_gist`);
  }

  /** Keeps only the gists of these keys for this model: a source that changed or went leaves its gist behind. */
  async keepOnly(model: string, live: ReadonlySet<string>): Promise<number> {
    if (!(await this.writable())) return 0;
    const rows = await this.read<{ key: string }>(`SELECT key FROM ai_gist WHERE model = ?`, [model]);
    const dead = rows.map((row) => row.key).filter((key) => !live.has(key));
    for (let i = 0; i < dead.length; i += KEYS_PER_QUERY) {
      const group = dead.slice(i, i + KEYS_PER_QUERY);
      await this.db.execute(`DELETE FROM ai_gist WHERE model = ? AND key IN (${group.map(() => "?").join(", ")})`, [model, ...group]);
    }
    return dead.length;
  }
}
