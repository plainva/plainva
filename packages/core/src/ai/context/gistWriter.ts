/**
 * Writing gists (plan KI-Harness §9.3/§9.6, P2b-3): one pass over the vault,
 * the most recently changed notes first — the long sections of each note,
 * then the note from its sections, then each area (top-level folder) from
 * its notes, then the vault from its areas. Every step asks the model of the
 * profile "Local" on this computer once, checks the answer (`checkGist`) and
 * keeps it, or a mark that it failed. What is written stays until its source
 * changes; a pass only writes what is missing or stale, so it can stop at any
 * time and go on later.
 *
 * Only notes a cloud may see go into an area's or the vault's gist: those
 * gists mix many notes and may travel with any message, while a note's own
 * gist only ever travels where the note itself may go.
 */
import type { IDatabaseAdapter } from "../../db/IDatabaseAdapter.js";
import { aiVisibleSql } from "../hiddenPaths.js";
import { checkGist, gistInstruction, gistOfGists, gistSections, GIST_MIN_SOURCE, type GistLevel } from "./gists.js";
import { GistStore, type StoredGist } from "./gistStore.js";

export interface GistModel {
  /** `provider/model`: whose gists these are. */
  id: string;
  complete(instruction: string, text: string, signal?: AbortSignal): Promise<string>;
}

export interface GistWriterHost {
  db: IDatabaseAdapter;
  readText(path: string): Promise<string | null>;
  /** Whether a cloud may see the note: only such notes go into an area's or the vault's gist. */
  cloudAllowed(path: string, text: string): Promise<boolean>;
  /** Resolves when the device may take the next step (desktop: an idle moment; phone: in the foreground). */
  ready?(signal: AbortSignal): Promise<void>;
  now?(): number;
}

export interface GistPass {
  /** Model answers this pass kept, and those it rejected. */
  written: number;
  rejected: number;
  /** Long sections of the vault, and how many have a checked gist now. */
  sections: number;
  covered: number;
}

/** Notes per area that make its gist: the most recent ones. */
const AREA_NOTES = 40;
/** An area or the vault needs at least this many parts to be worth a gist of its own. */
const MIN_PARTS = 2;

export const noteGistKey = (path: string) => `note:${path}`;
export const areaGistKey = (area: string) => `folder:${area}`;
export const VAULT_GIST_KEY = "vault";

/** The area of a note: its top-level folder, or null at the vault's root. */
export function areaOf(path: string): string | null {
  const slash = path.indexOf("/");
  return slash > 0 ? path.slice(0, slash) : null;
}

export class GistWriter {
  private readonly store: GistStore;

  constructor(
    private readonly host: GistWriterHost,
    private readonly model: GistModel,
  ) {
    this.store = new GistStore(host.db);
  }

  private now(): number {
    return this.host.now?.() ?? Date.now();
  }

  /** Asks once, checks, keeps the gist or the mark. */
  private async write(level: GistLevel, key: string, source: string, text: string, signal: AbortSignal, pass: GistPass): Promise<StoredGist> {
    await this.host.ready?.(signal);
    signal.throwIfAborted();
    const answer = (await this.model.complete(gistInstruction(level), text, signal)).trim();
    const ok = checkGist(level, text, answer).ok;
    const gist: StoredGist = { key, level, source, text: ok ? answer : "", ok, createdAt: this.now() };
    await this.store.put(gist, this.model.id);
    if (ok) pass.written++;
    else pass.rejected++;
    return gist;
  }

  async run(signal: AbortSignal, onProgress?: (pass: GistPass) => void): Promise<GistPass> {
    const pass: GistPass = { written: 0, rejected: 0, sections: 0, covered: 0 };
    if (!(await this.store.writable())) return pass;
    const notes = await this.host.db.query<{ path: string; title: string }>(
      `SELECT path, title FROM files
       WHERE mode != 'attachment' AND path LIKE '%.md' AND (is_deleted IS NULL OR is_deleted = 0) AND ${aiVisibleSql("path")}
       ORDER BY mtime_local DESC, path ASC`,
    );
    const live = new Set<string>();
    /** Per area: its cloud-visible notes with a note gist, newest first. */
    const areas = new Map<string, { label: string; key: string; gist: string }[]>();

    for (const note of notes) {
      signal.throwIfAborted();
      const text = await this.host.readText(note.path);
      if (text === null) continue;
      const sections = gistSections(text).filter((section) => section.text.trim().length >= GIST_MIN_SOURCE);
      pass.sections += sections.length;
      const stored = await this.store.getMany(sections.map((s) => s.key), this.model.id);
      const parts: { label: string; key: string; gist: string }[] = [];
      for (const section of sections) {
        live.add(section.key);
        let gist = stored.get(section.key) ?? null;
        if (!gist) {
          const label = [note.title, section.chain].filter(Boolean).join(" › ");
          gist = await this.write("section", section.key, section.key, `${label}\n\n${section.text}`, signal, pass);
          onProgress?.(pass);
        }
        if (gist.ok) {
          pass.covered++;
          parts.push({ label: section.chain || note.title, key: section.key, gist: gist.text });
        }
      }
      if (!parts.length) continue;
      // The note: one part is its own gist; more are written into one.
      const noteKey = noteGistKey(note.path);
      live.add(noteKey);
      const whole = gistOfGists(parts);
      let noteGist = (await this.store.getMany([noteKey], this.model.id)).get(noteKey) ?? null;
      if (!noteGist || noteGist.source !== whole.key) {
        if (parts.length === 1) {
          noteGist = { key: noteKey, level: "note", source: whole.key, text: parts[0]!.gist, ok: true, createdAt: this.now() };
          await this.store.put(noteGist, this.model.id);
        } else {
          noteGist = await this.write("note", noteKey, whole.key, whole.text, signal, pass);
          onProgress?.(pass);
        }
      }
      const area = areaOf(note.path);
      if (!noteGist.ok || area === null || !(await this.host.cloudAllowed(note.path, text))) continue;
      const members = areas.get(area) ?? [];
      if (members.length < AREA_NOTES) members.push({ label: note.title, key: noteGist.source, gist: noteGist.text });
      areas.set(area, members);
    }

    // The areas, then the vault: each from the parts it holds now, written again when they changed.
    const vaultParts: { label: string; key: string; gist: string }[] = [];
    for (const [area, members] of [...areas.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (members.length < MIN_PARTS) continue;
      const key = areaGistKey(area);
      live.add(key);
      const whole = gistOfGists(members);
      let gist = (await this.store.getMany([key], this.model.id)).get(key) ?? null;
      if (!gist || gist.source !== whole.key) {
        gist = await this.write("folder", key, whole.key, whole.text, signal, pass);
        onProgress?.(pass);
      }
      if (gist.ok) vaultParts.push({ label: area, key: gist.source, gist: gist.text });
    }
    if (vaultParts.length >= MIN_PARTS) {
      live.add(VAULT_GIST_KEY);
      const whole = gistOfGists(vaultParts);
      const gist = (await this.store.getMany([VAULT_GIST_KEY], this.model.id)).get(VAULT_GIST_KEY) ?? null;
      if (!gist || gist.source !== whole.key) {
        await this.write("vault", VAULT_GIST_KEY, whole.key, whole.text, signal, pass);
        onProgress?.(pass);
      }
    }
    // What changed or went leaves its gist behind; another model's gists go too.
    await this.store.keepOnly(this.model.id, live);
    await this.store.dropOthers(this.model.id);
    onProgress?.(pass);
    return pass;
  }
}

/** The index stores the file time as the adapter reports it; older rows may be seconds. */
function epochMs(value: unknown): number {
  const n = Number(value) || 0;
  return n > 0 && n < 100_000_000_000 ? n * 1000 : n;
}

/**
 * What the context package reads: checked gists of the current model, never
 * a stale one. A section's gist is bound to its exact text by its key; a
 * note's, an area's and the vault's count only while no note they stand for
 * changed after they were written — until the next pass writes them again,
 * they are left out rather than trusted.
 */
export class GistReader {
  private readonly store: GistStore;

  constructor(
    private readonly db: IDatabaseAdapter,
    private readonly model: string,
  ) {
    this.store = new GistStore(db);
  }

  /** The gist of a section's exact text. */
  async section(key: string): Promise<string | null> {
    const gist = await this.store.get(key, this.model);
    return gist?.ok ? gist.text : null;
  }

  private async newest(where: string, params: unknown[]): Promise<number> {
    const row = await this.db.queryOne<{ newest: number | null }>(
      `SELECT MAX(mtime_local) AS newest FROM files WHERE mode != 'attachment' AND path LIKE '%.md' AND (is_deleted IS NULL OR is_deleted = 0) AND ${aiVisibleSql("path")} AND ${where}`,
      params,
    );
    return epochMs(row?.newest ?? 0);
  }

  private async fresh(key: string, newest: () => Promise<number>): Promise<string | null> {
    const gist = await this.store.get(key, this.model);
    if (!gist?.ok) return null;
    return gist.createdAt >= (await newest()) ? gist.text : null;
  }

  async note(path: string): Promise<string | null> {
    return this.fresh(noteGistKey(path), () => this.newest("path = ?", [path]));
  }

  async area(area: string): Promise<string | null> {
    // An area is a folder name: escaped for LIKE, so "%" or "_" in it match only themselves.
    const prefix = `${area.replace(/[\\%_]/g, "\\$&")}/%`;
    return this.fresh(areaGistKey(area), () => this.newest("path LIKE ? ESCAPE '\\'", [prefix]));
  }

  async vault(): Promise<string | null> {
    return this.fresh(VAULT_GIST_KEY, () => this.newest("1 = 1", []));
  }
}
