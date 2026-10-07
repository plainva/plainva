import {
  machineAuthorKind,
  parseWriteDraftOutcomes,
  parseWriteDrafts,
  serializeWriteDrafts,
  upsertFrontmatterKeys,
  type AiPolicyDimension,
  type WorkspaceCommentRecord,
  type WriteDraft,
  type WriteDraftOutcome,
} from "@plainva/core";
import { parseBaseConfig } from "../base/baseFormat";
import { resolveNewItemTarget } from "../base/baseRelations";
import { migrateFiltersToPerView } from "../base/filterExpr";
import { buildNewItemContent } from "../lib/newItemContent";
import { buildNewNoteContent } from "../lib/newNoteContent";
import { generatedStamp } from "../lib/okfProvenance";
import { capturedFolder, withInheritedRules } from "./aiCapture";
import type { AiFileStore } from "./aiStores";

/**
 * Drafts on this device (plan KI-Harness P5): what an assistant wants to
 * exist, kept until the user creates it or throws it away.
 *
 * They live beside the vault's other AI data in the app's own storage — one
 * file per vault, never in the vault. A draft the user creates is made by the
 * app's own way of making that kind of thing (`DraftCreator`): a note through
 * the vault's adapters, a task through the task database, a line through the
 * journal. So it is indexed, backed up and synced like one the user made, and
 * a note says who wrote it (`generated`, ADR 0023).
 */

export interface WriteDraftState {
  drafts: WriteDraft[];
  /** What became of earlier drafts — so the conversation that laid one down can still say so. */
  done: WriteDraftOutcome[];
}

export const EMPTY_WRITE_DRAFTS: WriteDraftState = { drafts: [], done: [] };

export interface WriteDraftStore {
  load(): Promise<WriteDraftState>;
  save(state: WriteDraftState): Promise<void>;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function createWriteDraftStore(files: AiFileStore, vaultKey: string): WriteDraftStore {
  if (!SAFE_ID.test(vaultKey)) throw new Error("invalid vault key");
  const path = `${vaultKey}/drafts.json`;
  // One lane: two drafts laid down in one run never write over each other.
  let lane: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = lane.catch(() => undefined).then(work);
    lane = run;
    return run;
  };
  return {
    load: () =>
      serial(async () => {
        const raw = await files.read(path);
        if (raw === null) return EMPTY_WRITE_DRAFTS;
        try {
          const value = JSON.parse(raw) as unknown;
          return { drafts: parseWriteDrafts(value), done: parseWriteDraftOutcomes(value) };
        } catch {
          // A file that cannot be read loses proposals; it never makes one.
          return EMPTY_WRITE_DRAFTS;
        }
      }),
    save: (state) => serial(() => files.write(path, JSON.stringify(serializeWriteDrafts(state.drafts, state.done)))),
  };
}

/**
 * How a shell makes what a draft describes, through its own ways. Each
 * resolves with the path of what was written — the new note, the task's note,
 * the daily note —, or rejects; nothing is half-made.
 */
export interface DraftCreator {
  /** A note in `folder` (the vault's inbox where null) under a free name made from `stem`. Never overwrites. */
  note(input: { folder: string | null; stem: string; content: string }): Promise<string>;
  /**
   * A task from the words it was asked for in, read with `day` as "today".
   * `atProvider`: also at the provider list the task database names — the
   * user's choice on the card, as on the capture field's chip. Nothing is sent
   * to a provider without it.
   */
  task(input: { text: string; day: string; atProvider: boolean }): Promise<string>;
  /**
   * The name of the provider list a new task can also be created in, as the
   * user knows it; null where the task database names none. Absent where the
   * shell has no such lists.
   */
  taskList?(): Promise<string | null>;
  /** A line in the journal of `day` under `time`. Idempotent: a second try finds its own line. */
  journal(input: { text: string; day: string; time: string; task: boolean }): Promise<string>;
  /** The rules of the place a new note would land in, for what it still has to carry itself. */
  placeDenies?(folder: string | null, stem: string): Promise<readonly AiPolicyDimension[]>;
  /**
   * Where a new entry of the database at `base` goes, and what it has to
   * carry to be one of its entries (plan P5-4): the folder the database keeps
   * its entries in, the vault's note type, and the tags its source asks for.
   * Null where the database has no folder for new entries yet. Absent where
   * the shell has no databases to write to. The entry itself is a note and is
   * written with `note`.
   */
  entryPlace?(base: string): Promise<EntryPlace | null>;
}

/** What a shell knows about where an entry of a database is made. */
export interface EntryPlace {
  folder: string;
  noteType: string;
  tags: readonly string[];
}

/**
 * Where a new entry of the database whose file reads `raw` goes, decided as
 * the database's own "New entry" decides it (`resolveNewItemTarget`): the
 * folder it keeps its entries in, and the tags its source asks for. Null where
 * the file is no database that can be read, or where the database has no
 * folder for new entries yet — several sources, or none: the user answers
 * that with its first entry, and an assistant never answers it for them.
 */
export function entryPlaceOf(raw: string | null, noteType: string): EntryPlace | null {
  if (raw === null) return null;
  try {
    const target = resolveNewItemTarget(migrateFiltersToPerView(parseBaseConfig(raw)));
    if (target.folder === null) return null;
    return { folder: capturedFolder(target.folder), noteType, tags: target.inheritTags };
  } catch {
    return null;
  }
}

/**
 * The note a drafted note becomes, as it is written: a title, the stamp that
 * says who wrote it and what it rests on (once, at this moment — ADR 0023 §3),
 * the rules it takes over from its sources, and the draft's text.
 */
export function draftedNoteContent(draft: WriteDraft, now: Date, rules: readonly AiPolicyDimension[]): string {
  if (draft.body.kind !== "note") throw new Error("not a note draft");
  let content = buildNewNoteContent("Note", draft.title);
  content = upsertFrontmatterKeys(content, {
    generated: generatedStamp(draft.author.id, now),
    ...(draft.sources.length ? { sources: draft.sources } : {}),
  });
  content = withInheritedRules(content, rules);
  const body = draft.body.content.trim();
  return body ? `${content.trimEnd()}\n\n${body}\n` : content;
}

/**
 * The note a drafted entry of a database becomes (plan P5-4): a new entry as
 * the database's own "New entry" makes one without a template — a heading,
 * the vault's note type, the tags the database's source asks for —, with the
 * properties the draft names, the stamp that says who wrote it and what it
 * rests on, the rules it takes over, and the draft's text.
 */
export function draftedEntryContent(draft: WriteDraft, now: Date, rules: readonly AiPolicyDimension[], place: Pick<EntryPlace, "noteType" | "tags">): string {
  if (draft.body.kind !== "entry") throw new Error("not an entry draft");
  // The tags the database's source asks for make the note its entry; tags the draft names join them, they never replace them.
  const { tags: named, ...prefills } = draft.body.properties;
  const tags = [...place.tags];
  for (const tag of named === undefined ? [] : Array.isArray(named) ? named.map(String) : [String(named)]) if (tag.trim() && !tags.includes(tag)) tags.push(tag);
  let content = buildNewItemContent({ templateText: null, noteType: place.noteType, title: draft.title, inheritTags: tags, prefills });
  content = upsertFrontmatterKeys(content, {
    generated: generatedStamp(draft.author.id, now),
    ...(draft.sources.length ? { sources: draft.sources } : {}),
  });
  content = withInheritedRules(content, rules);
  const body = draft.body.content.trim();
  return body ? `${content.trimEnd()}\n\n${body}\n` : content;
}

/** A note that carries open suggestions of one writer that is no person. */
export interface OpenProposal {
  path: string;
  /** The writer's author id: `plainva-ai/<model>`, `mcp:<client>`, `acp:<agent>`. */
  authorId: string;
  /** The name the user knows the writer by, where the shell can tell. */
  authorLabel?: string;
  changes: number;
  /** When the newest of them was laid down. */
  at: string;
}

/**
 * The notes of a vault that carry open suggestions of a machine — an
 * assistant, a program behind the MCP server, an agent —, newest first.
 * Read from the vault's comments, where a suggestion lives: so the list is
 * the same on every device, whichever of them the suggestion was made on.
 * A person's own suggestions are not here; the comments overview has them.
 */
export function machineProposals(byPath: ReadonlyMap<string, readonly WorkspaceCommentRecord[]>, names?: ReadonlyMap<string, string>): OpenProposal[] {
  const out: OpenProposal[] = [];
  for (const [path, records] of byPath) {
    const writers = new Map<string, { changes: number; at: string }>();
    for (const record of records) {
      const suggestion = record.suggestion;
      if (!suggestion || suggestion.appliedAt || suggestion.declinedAt || record.resolvedAt) continue;
      if (machineAuthorKind(record.authorMemberId) === null) continue;
      const writer = writers.get(record.authorMemberId) ?? { changes: 0, at: "" };
      writer.changes += 1;
      if (record.createdAt > writer.at) writer.at = record.createdAt;
      writers.set(record.authorMemberId, writer);
    }
    // The name the writer signed with, as the vault's comments keep it: an app's id is a row of random letters.
    for (const [authorId, writer] of writers) {
      const label = names?.get(authorId)?.trim();
      out.push({ path, authorId, ...(label ? { authorLabel: label } : {}), ...writer });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.path.localeCompare(b.path) || a.authorId.localeCompare(b.authorId));
}

/** What a draft says of itself in one line, for a list: its kind's own detail. */
export function draftDetail(draft: WriteDraft): { folder: string | null; lines: number } | { day: string; time?: string } | { base: string } {
  const body = draft.body;
  if (body.kind === "note") return { folder: body.path ? body.path.slice(0, Math.max(0, body.path.lastIndexOf("/"))) : body.folder, lines: body.content.split("\n").filter((line) => line.trim()).length };
  if (body.kind === "entry") return { base: body.base };
  return body.kind === "journal" ? { day: body.day, time: body.time } : { day: body.day };
}
