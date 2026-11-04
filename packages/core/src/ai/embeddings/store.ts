/**
 * Where a vault's vectors live (plan KI-Harness §10.6): feature-owned tables in
 * the vault's index database, beside the index they are derived from, so
 * removing a vault removes them and the index's own migrations never touch
 * them. Vectors are derived data and never leave the device (§13.4): not
 * synced, not exported, rebuilt from the notes whenever needed.
 *
 * One vector space per engine (`embeddingEngineId`): a new model or model
 * revision starts empty and never mixes with the old one.
 */
import type { BatchStatement, IDatabaseAdapter } from "../../db/IDatabaseAdapter.js";
import { runStatementsAtomic } from "../../db/batch.js";
import { decodeInt8, dequantizeInt8, encodeInt8, quantizeInt8, type QuantizedVector } from "./vectors.js";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ai_embedding_engine (
     engine TEXT PRIMARY KEY,
     dim INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS ai_embedding_note (
     engine TEXT NOT NULL,
     path TEXT NOT NULL,
     sha256 TEXT NOT NULL,
     chunks INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (engine, path)
   )`,
  `CREATE TABLE IF NOT EXISTS ai_embedding (
     engine TEXT NOT NULL,
     path TEXT NOT NULL,
     ordinal INTEGER NOT NULL,
     hash TEXT NOT NULL,
     scale REAL NOT NULL,
     vec TEXT NOT NULL,
     PRIMARY KEY (engine, path, ordinal)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_ai_embedding_hash ON ai_embedding (engine, hash)`,
  // The fingerprint of an own provider's model (plan P2a-5): the vector of the probe text.
  `CREATE TABLE IF NOT EXISTS ai_embedding_probe (
     engine TEXT PRIMARY KEY,
     scale REAL NOT NULL,
     vec TEXT NOT NULL
   )`,
];

/** Rows per multi-row INSERT and paths per IN list: far below any SQLite variable limit. */
const ROWS_PER_INSERT = 50;
const PATHS_PER_DELETE = 200;
const HASHES_PER_QUERY = 200;
/** Rows per page when an engine is loaded: bounded bridge messages on large vaults. */
const LOAD_PAGE = 2000;

export interface StoredChunkVector {
  ordinal: number;
  hash: string;
  vector: QuantizedVector;
}

export interface StoredNoteVectors {
  path: string;
  /** The `files.sha256` of the note text the chunks were cut from. */
  sha256: string;
  chunks: StoredChunkVector[];
}

export interface EmbeddingSpaceSummary {
  engine: string;
  dim: number;
  notes: number;
  chunks: number;
}

let prepared: WeakSet<object> = new WeakSet();
/** Connections that cannot create tables (an auxiliary window's read-only index): reads only. */
let readOnly: WeakSet<object> = new WeakSet();

/** Forgets which databases are prepared (vault switch, tests). */
export function resetEmbeddingStores(): void {
  prepared = new WeakSet();
  readOnly = new WeakSet();
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const marks = (count: number) => Array.from({ length: count }, () => "?").join(", ");

export class EmbeddingStore {
  constructor(private readonly db: IDatabaseAdapter) {}

  /** Whether this connection can write vectors; false on a read-only one, where reads still work. */
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

  private async requireWritable(): Promise<void> {
    if (!(await this.writable())) throw new Error("embedding store: this connection is read-only");
  }

  /** Reads that find no tables (never written, read-only connection) read as empty. */
  private async read<T>(sql: string, params: unknown[]): Promise<T[]> {
    await this.writable();
    try {
      return await this.db.query<T>(sql, params);
    } catch (error) {
      if (/no such table/i.test(String((error as Error)?.message ?? error))) return [];
      throw error;
    }
  }

  /**
   * Records an engine's dimension on first use. A stored space of another
   * dimension under the same id is a broken promise of the id and is refused.
   */
  async registerEngine(engine: string, dim: number): Promise<void> {
    await this.requireWritable();
    const row = await this.db.queryOne<{ dim: number }>(`SELECT dim FROM ai_embedding_engine WHERE engine = ?`, [engine]);
    if (row && Number(row.dim) !== dim) {
      throw new Error(`embedding store: ${engine} holds ${row.dim}-dimensional vectors, not ${dim}`);
    }
    if (!row) await this.db.execute(`INSERT INTO ai_embedding_engine (engine, dim, created_at) VALUES (?, ?, ?)`, [engine, dim, Date.now()]);
  }

  /** The vector spaces of this vault, with how much each holds. */
  async spaces(): Promise<EmbeddingSpaceSummary[]> {
    const rows = await this.read<{ engine: string; dim: number; notes: number; chunks: number }>(
      `SELECT e.engine AS engine, e.dim AS dim,
              (SELECT COUNT(*) FROM ai_embedding_note n WHERE n.engine = e.engine) AS notes,
              (SELECT COUNT(*) FROM ai_embedding c WHERE c.engine = e.engine) AS chunks
         FROM ai_embedding_engine e
        ORDER BY e.engine`,
      [],
    );
    return rows.map((row) => ({ engine: row.engine, dim: Number(row.dim), notes: Number(row.notes), chunks: Number(row.chunks) }));
  }

  /** Which notes an engine has vectors for, and from which note text. */
  async noteStates(engine: string): Promise<Map<string, { sha256: string; chunks: number }>> {
    const rows = await this.read<{ path: string; sha256: string; chunks: number }>(
      `SELECT path, sha256, chunks FROM ai_embedding_note WHERE engine = ?`,
      [engine],
    );
    return new Map(rows.map((row) => [row.path, { sha256: row.sha256, chunks: Number(row.chunks) }]));
  }

  /** Stored vectors by chunk hash: an edited note re-embeds only the chunks whose text changed. */
  async vectorsByHash(engine: string, dim: number, hashes: readonly string[]): Promise<Map<string, QuantizedVector>> {
    const out = new Map<string, QuantizedVector>();
    for (const group of chunked([...new Set(hashes)], HASHES_PER_QUERY)) {
      const rows = await this.read<{ hash: string; scale: number; vec: string }>(
        `SELECT hash, scale, vec FROM ai_embedding WHERE engine = ? AND hash IN (${marks(group.length)})`,
        [engine, ...group],
      );
      for (const row of rows) {
        const values = decodeInt8(row.vec, dim);
        if (values && !out.has(row.hash)) out.set(row.hash, { scale: Number(row.scale), values });
      }
    }
    return out;
  }

  /** Replaces a note's vectors in one transaction: the old ones and the new ones never mix. */
  async writeNote(engine: string, path: string, sha256: string, chunks: readonly StoredChunkVector[]): Promise<void> {
    await this.requireWritable();
    const statements: BatchStatement[] = [
      { sql: `DELETE FROM ai_embedding WHERE engine = ? AND path = ?`, params: [engine, path] },
    ];
    for (const group of chunked(chunks, ROWS_PER_INSERT)) {
      statements.push({
        sql: `INSERT INTO ai_embedding (engine, path, ordinal, hash, scale, vec) VALUES ${group.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}`,
        params: group.flatMap((chunk) => [engine, path, chunk.ordinal, chunk.hash, chunk.vector.scale, encodeInt8(chunk.vector.values)]),
      });
    }
    statements.push({
      sql: `INSERT OR REPLACE INTO ai_embedding_note (engine, path, sha256, chunks, updated_at) VALUES (?, ?, ?, ?, ?)`,
      params: [engine, path, sha256, chunks.length, Date.now()],
    });
    await runStatementsAtomic(this.db, statements);
  }

  /**
   * Drops the vectors of notes — of one engine, or of all when none is named.
   * The pipeline calls it the moment a note changes or goes, before anything
   * is re-embedded: a search never answers from a note's old text.
   */
  async forgetNotes(paths: readonly string[], engine?: string): Promise<void> {
    if (!paths.length || !(await this.writable())) return;
    const statements: BatchStatement[] = [];
    for (const group of chunked([...new Set(paths)], PATHS_PER_DELETE)) {
      const where = `${engine === undefined ? "" : "engine = ? AND "}path IN (${marks(group.length)})`;
      const params = engine === undefined ? group : [engine, ...group];
      statements.push({ sql: `DELETE FROM ai_embedding WHERE ${where}`, params });
      statements.push({ sql: `DELETE FROM ai_embedding_note WHERE ${where}`, params });
    }
    await runStatementsAtomic(this.db, statements);
  }

  /** Removes a whole vector space (its model was removed, or the space is rebuilt). */
  async dropEngine(engine: string): Promise<void> {
    if (!(await this.writable())) return;
    await runStatementsAtomic(this.db, [
      { sql: `DELETE FROM ai_embedding WHERE engine = ?`, params: [engine] },
      { sql: `DELETE FROM ai_embedding_note WHERE engine = ?`, params: [engine] },
      { sql: `DELETE FROM ai_embedding_engine WHERE engine = ?`, params: [engine] },
      { sql: `DELETE FROM ai_embedding_probe WHERE engine = ?`, params: [engine] },
    ]);
  }

  /** The fingerprint kept for an engine (a provider's probe vector); null when there is none of `dim` components. */
  async probeOf(engine: string, dim: number): Promise<Float32Array | null> {
    const [row] = await this.read<{ scale: number; vec: string }>(`SELECT scale, vec FROM ai_embedding_probe WHERE engine = ?`, [engine]);
    const values = row ? decodeInt8(row.vec, dim) : null;
    return row && values ? dequantizeInt8({ scale: Number(row.scale), values }) : null;
  }

  async setProbe(engine: string, vector: Float32Array): Promise<void> {
    await this.requireWritable();
    const { scale, values } = quantizeInt8(vector);
    await this.db.execute(`INSERT OR REPLACE INTO ai_embedding_probe (engine, scale, vec) VALUES (?, ?, ?)`, [engine, scale, encodeInt8(values)]);
  }

  /**
   * Every note's vectors of an engine, page by page. A note with a vector that
   * does not decode to `dim` components counts as missing and is embedded
   * again.
   */
  async loadEngine(engine: string, dim: number): Promise<StoredNoteVectors[]> {
    const notes = new Map<string, StoredNoteVectors>();
    const counts = new Map<string, number>();
    let after: { path: string; ordinal: number } | null = null;
    for (;;) {
      const rows: { path: string; ordinal: number; hash: string; scale: number; vec: string; sha256: string; count: number }[] = await this.read(
        `SELECT c.path AS path, c.ordinal AS ordinal, c.hash AS hash, c.scale AS scale, c.vec AS vec, n.sha256 AS sha256, n.chunks AS count
           FROM ai_embedding c
           JOIN ai_embedding_note n ON n.engine = c.engine AND n.path = c.path
          WHERE c.engine = ?${after ? " AND (c.path > ? OR (c.path = ? AND c.ordinal > ?))" : ""}
          ORDER BY c.path, c.ordinal
          LIMIT ?`,
        after ? [engine, after.path, after.path, after.ordinal, LOAD_PAGE] : [engine, LOAD_PAGE],
      );
      for (const row of rows) {
        const values = decodeInt8(row.vec, dim);
        let note = notes.get(row.path);
        if (!note) {
          note = { path: row.path, sha256: row.sha256, chunks: [] };
          notes.set(row.path, note);
          counts.set(row.path, Number(row.count));
        }
        if (values) note.chunks.push({ ordinal: Number(row.ordinal), hash: row.hash, vector: { scale: Number(row.scale), values } });
        else note.sha256 = "";
      }
      if (rows.length < LOAD_PAGE) break;
      const last = rows[rows.length - 1]!;
      after = { path: last.path, ordinal: Number(last.ordinal) };
    }
    // A note missing any of its chunks (a write that was not atomic) counts as missing too.
    return [...notes.values()].filter((note) => note.sha256 !== "" && note.chunks.length === counts.get(note.path));
  }
}
