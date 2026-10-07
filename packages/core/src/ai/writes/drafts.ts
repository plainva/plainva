import { parseOkfSources, type OkfSource } from "../../okf-trust.js";
import { AI_POLICY_DIMENSIONS, type AiPolicyDimension } from "../policy.js";
import { machineAuthorKind } from "./authors.js";
import type { PropertyValue } from "./properties.js";

/**
 * A draft: something an assistant wants to exist that does not exist yet
 * (plan KI-Harness P5) — a note, a task, an entry of a database, a line in
 * the journal.
 *
 * A change to a note that is there waits on the note, as a suggestion. What
 * is not there has no place to wait on, so it waits here: in the app's data
 * on this device, like the conversations — never in the vault, where a draft
 * nobody asked for would be a file that syncs. The user creates it or throws
 * it away; creating goes through the app's own way of making that kind of
 * thing (the note's writer, the task database's creator, the journal's
 * entry), so a draft that became a note is indexed, backed up and synced like
 * one the user made, and carries who wrote it (ADR 0023).
 *
 * This file is the model and its reading from disk. A draft is read
 * defensively: what does not have the form is not a draft, and a list that
 * cannot be read is an empty one — a broken file can only lose proposals,
 * never produce one.
 */
export type WriteDraftBody =
  /**
   * A note. `path` where the writer named the file (an agent, a program):
   * it is created exactly there, or not at all. Without it the note goes to
   * `folder` — the vault's inbox where that is null — under a free name made
   * from the title. `content` is the whole note as it would be written,
   * before the stamp.
   */
  | { kind: "note"; path: string | null; folder: string | null; content: string }
  /** A task, in the words it was asked for; the app reads them as it reads a captured line, with `day` as "today". */
  | { kind: "task"; text: string; day: string }
  /** A line in the journal of `day`, under the time it was proposed at; `task` gives it an open box. */
  | { kind: "journal"; text: string; day: string; time: string; task: boolean }
  /** A new entry of a database: a note in the database's folder with these properties and this text. */
  | { kind: "entry"; base: string; properties: Record<string, PropertyValue>; content: string };

export type WriteDraftKind = WriteDraftBody["kind"];

export interface WriteDraft {
  id: string;
  /** ISO time it was laid down. */
  createdAt: string;
  /** Who wrote it: a machine's author id and the name the user knows it by. */
  author: { id: string; label: string };
  /** The conversation it came from, where it came from one of Plainva's own. */
  conversationId: string | null;
  /** What the list calls it: the note's title, the task's words. */
  title: string;
  body: WriteDraftBody;
  /** The rules the new note takes over from what its text rests on (plan P4-6): written when it is created. */
  inherited: AiPolicyDimension[];
  /** What the text rests on, for the note's `sources` (ADR 0023). */
  sources: OkfSource[];
  /** How many addresses the writer brought were made inert. */
  defused: number;
}

export const WRITE_DRAFT_LIMITS = { drafts: 100, title: 200, content: 200_000, text: 2_000, properties: 40, sources: 50 } as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[A-Za-z0-9_-]{6,64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const filled = (value: unknown, max: number): value is string => text(value, max) && value.trim().length > 0;

/** A path of the vault as a draft may name it: relative, forward slashes, nothing that climbs. */
function vaultPath(value: unknown): value is string {
  if (!filled(value, 1024) || value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
  return value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function propertyValue(value: unknown): value is PropertyValue {
  const scalar = (item: unknown) => typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item)) || text(item, WRITE_DRAFT_LIMITS.text);
  return Array.isArray(value) ? value.length <= 50 && value.every(scalar) : scalar(value);
}

function parseBody(raw: unknown): WriteDraftBody | null {
  if (!isRecord(raw)) return null;
  switch (raw.kind) {
    case "note": {
      const path = raw.path ?? null;
      const folder = raw.folder ?? null;
      if (path !== null && !(vaultPath(path) && /\.md$/i.test(path))) return null;
      if (folder !== null && folder !== "" && !vaultPath(folder)) return null;
      if (!text(raw.content, WRITE_DRAFT_LIMITS.content)) return null;
      return { kind: "note", path, folder: folder === "" ? null : (folder as string | null), content: raw.content };
    }
    case "task":
      return filled(raw.text, WRITE_DRAFT_LIMITS.text) && text(raw.day, 10) && DAY.test(raw.day) ? { kind: "task", text: raw.text, day: raw.day } : null;
    case "journal":
      return filled(raw.text, WRITE_DRAFT_LIMITS.text) && text(raw.day, 10) && DAY.test(raw.day) && text(raw.time, 5) && TIME.test(raw.time)
        ? { kind: "journal", text: raw.text, day: raw.day, time: raw.time, task: raw.task === true }
        : null;
    case "entry": {
      if (!(vaultPath(raw.base) && /\.base$/i.test(raw.base)) || !isRecord(raw.properties) || !text(raw.content, WRITE_DRAFT_LIMITS.content)) return null;
      const entries = Object.entries(raw.properties);
      if (entries.length > WRITE_DRAFT_LIMITS.properties || !entries.every(([key, value]) => filled(key, 120) && propertyValue(value))) return null;
      return { kind: "entry", base: raw.base, properties: Object.fromEntries(entries) as Record<string, PropertyValue>, content: raw.content };
    }
    default:
      return null;
  }
}

/** One draft as it was stored, or null where it is none. */
export function parseWriteDraft(raw: unknown): WriteDraft | null {
  if (!isRecord(raw) || !text(raw.id, 64) || !ID.test(raw.id)) return null;
  if (!text(raw.createdAt, 40) || !Number.isFinite(Date.parse(raw.createdAt))) return null;
  const author = raw.author;
  // A draft is a machine's by definition: one signed with a person's id was not written by this code.
  if (!isRecord(author) || !text(author.id, 128) || machineAuthorKind(author.id) === null || !text(author.label, 200)) return null;
  if (!filled(raw.title, WRITE_DRAFT_LIMITS.title)) return null;
  const body = parseBody(raw.body);
  if (!body) return null;
  const conversationId = raw.conversationId ?? null;
  if (conversationId !== null && !text(conversationId, 64)) return null;
  const inherited = Array.isArray(raw.inherited) ? AI_POLICY_DIMENSIONS.filter((dimension) => (raw.inherited as unknown[]).includes(dimension)) : [];
  const sources = (parseOkfSources(raw.sources) ?? []).slice(0, WRITE_DRAFT_LIMITS.sources);
  const defused = typeof raw.defused === "number" && Number.isSafeInteger(raw.defused) && raw.defused > 0 ? raw.defused : 0;
  return { id: raw.id, createdAt: raw.createdAt, author: { id: author.id, label: author.label }, conversationId: conversationId as string | null, title: raw.title, body, inherited, sources, defused };
}

/** The drafts of a vault as they were stored, oldest first; what is no draft is left out, twice the same id counts once. */
export function parseWriteDrafts(raw: unknown): WriteDraft[] {
  const list = isRecord(raw) && raw.version === 1 && Array.isArray(raw.drafts) ? raw.drafts : [];
  const seen = new Set<string>();
  const out: WriteDraft[] = [];
  for (const item of list) {
    const draft = parseWriteDraft(item);
    if (!draft || seen.has(draft.id)) continue;
    seen.add(draft.id);
    out.push(draft);
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).slice(0, WRITE_DRAFT_LIMITS.drafts);
}

export function serializeWriteDrafts(drafts: readonly WriteDraft[], done: readonly WriteDraftOutcome[] = []): { version: 1; drafts: WriteDraft[]; done: WriteDraftOutcome[] } {
  return { version: 1, drafts: [...drafts], done: [...done] };
}

/**
 * What became of a draft: the user created it, or threw it away. Kept beside
 * the waiting drafts so the conversation that laid one down can still say
 * what happened to it — "created: Inbox/Kick-off.md" instead of a card that
 * has silently gone. Unlike a waiting draft this is history: the oldest
 * entries go once there are more than the bound.
 */
export interface WriteDraftOutcome {
  id: string;
  kind: WriteDraftKind;
  title: string;
  outcome: "created" | "discarded";
  /** Where it was created: the note's path. */
  path?: string;
  at: string;
}

export const WRITE_DRAFT_DONE_CAP = 200;

const KINDS: readonly WriteDraftKind[] = ["note", "task", "journal", "entry"];

function parseOutcome(raw: unknown): WriteDraftOutcome | null {
  if (!isRecord(raw) || !text(raw.id, 64) || !ID.test(raw.id)) return null;
  if (!KINDS.includes(raw.kind as WriteDraftKind) || !filled(raw.title, WRITE_DRAFT_LIMITS.title)) return null;
  if (raw.outcome !== "created" && raw.outcome !== "discarded") return null;
  if (!text(raw.at, 40) || !Number.isFinite(Date.parse(raw.at))) return null;
  const path = raw.outcome === "created" && vaultPath(raw.path) ? raw.path : undefined;
  return { id: raw.id, kind: raw.kind as WriteDraftKind, title: raw.title, outcome: raw.outcome, ...(path ? { path } : {}), at: raw.at };
}

/** What became of earlier drafts, as stored: oldest first, the newest `WRITE_DRAFT_DONE_CAP` of them. */
export function parseWriteDraftOutcomes(raw: unknown): WriteDraftOutcome[] {
  const list = isRecord(raw) && raw.version === 1 && Array.isArray(raw.done) ? raw.done : [];
  const seen = new Set<string>();
  const out: WriteDraftOutcome[] = [];
  for (const item of list) {
    const outcome = parseOutcome(item);
    if (!outcome || seen.has(outcome.id)) continue;
    seen.add(outcome.id);
    out.push(outcome);
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)).slice(-WRITE_DRAFT_DONE_CAP);
}

/** The outcomes with one more, the oldest dropped past the bound. */
export function withWriteDraftOutcome(done: readonly WriteDraftOutcome[], outcome: WriteDraftOutcome): WriteDraftOutcome[] {
  return [...done.filter((existing) => existing.id !== outcome.id), outcome].slice(-WRITE_DRAFT_DONE_CAP);
}

/**
 * The list with one more draft — or the reason it does not take it. A draft
 * is never dropped to make room: the oldest one is as unseen as the newest,
 * and a list that forgets on its own would lose what somebody was told is
 * waiting. Past the bound the writer hears that too many wait.
 */
export function withWriteDraft(drafts: readonly WriteDraft[], draft: WriteDraft): { ok: true; drafts: WriteDraft[] } | { ok: false; problem: "full" | "invalid" | "duplicate" } {
  if (parseWriteDraft(draft) === null) return { ok: false, problem: "invalid" };
  if (drafts.some((existing) => existing.id === draft.id)) return { ok: false, problem: "duplicate" };
  if (drafts.length >= WRITE_DRAFT_LIMITS.drafts) return { ok: false, problem: "full" };
  return { ok: true, drafts: [...drafts, draft] };
}

export function withoutWriteDraft(drafts: readonly WriteDraft[], id: string): WriteDraft[] {
  return drafts.filter((draft) => draft.id !== id);
}
