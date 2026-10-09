import { parseOkfSources, type OkfSource } from "../../okf-trust.js";
import { MEMORY_LIMITS, memoryTextProblem, type MemoryPlace } from "../memory/memoryFile.js";
import { AI_POLICY_DIMENSIONS, type AiPolicyDimension } from "../policy.js";
import { SKILL_DESCRIPTION_MAX, skillNameProblems } from "../skills/skillFile.js";
import { SKILLS_FOLDER } from "../skills/sources.js";
import { machineAuthorKind } from "./authors.js";
import { parseMissingLinks } from "./links.js";
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
 * Two kinds are never made at all (plan P5-6): an e-mail and an appointment
 * reach other people, so their draft is only ever OPENED — in the app's own
 * composer or event editor, with everything filled in —, and sending or
 * saving there is the user's own step. The draft waits on until that step
 * was taken; an editor closed without it leaves the draft where it was.
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
  | { kind: "entry"; base: string; properties: Record<string, PropertyValue>; content: string }
  /**
   * An e-mail (plan P5-6). Nothing sends it: "open" hands it to the app's own
   * composer, and sending there is the user's. `unnamed` are the recipients
   * the user did not write in the conversation themselves — the card says so.
   */
  | { kind: "mail"; to: string[]; cc: string[]; bcc: string[]; subject: string; body: string; unnamed: string[] }
  /**
   * An appointment (plan P5-6). Nothing saves it: "open" hands it to the app's
   * own event editor. `day` is its civil day; a timed one runs from `start` to
   * `end` (HH:MM, local) on that day, an all-day one through `endDay`
   * inclusive. `unnamed` as for a mail: an invitee is somebody a provider
   * writes to.
   */
  | { kind: "event"; title: string; allDay: boolean; day: string; endDay: string; start: string; end: string; location: string; description: string; attendees: string[]; unnamed: string[] }
  /**
   * An entry for the vault's memory (plan P6, ADR 0027): one sentence an
   * assistant should know. `place`: where the writer would put it — the user
   * can choose the other on the card. `replaces`: the text of the entry it
   * stands in for, where it rewords one. Created, it is a line in one of the
   * two memory files, with the rules the draft inherited.
   */
  | { kind: "memory"; text: string; place: MemoryPlace; replaces: string | null }
  /** Taking an entry out of the memory, named by its text. Created, the line is gone from its file. */
  | { kind: "forget"; entry: string }
  /**
   * A rule for assistants (plan P6): one line for the vault's standing
   * instructions. A rule is no memory — it says what to do —, so it becomes
   * a line of `AGENTS.md`, which each device approves for itself.
   */
  | { kind: "rule"; text: string }
  /**
   * A skill, or other instructions for one the vault has (plan P6, ADR 0020):
   * what a review of a conversation proposes. `change` names the vault's own
   * skill it would rewrite — its id, and the SHA-256 of its main file as the
   * proposal read it, so a skill that changed since is not overwritten —;
   * null for a new skill, which is then called `name` and is for
   * `description`. For a change both only say which skill is meant; neither
   * is written. A draft carries nothing else of a skill: its tools, folders,
   * limits and tests are no model's to set. Created, a new skill is written
   * with the app's defaults, and a changed one keeps its frontmatter byte for
   * byte.
   */
  | { kind: "skill"; change: { id: string; base: string } | null; name: string; description: string; body: string };

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
  /**
   * The notes its text links to that were not in the vault when it was laid down (the source check, plan P5-7):
   * by the name each link gives. Absent where every link led somewhere — and in a draft from before the check.
   */
  missing?: string[];
  /**
   * The notes its text links to that are in the vault and that the rules kept from the writer (the same check).
   * For the user, on this device: these are names of notes the rules keep back, and no model is ever shown them.
   */
  withheld?: string[];
  /**
   * What the proposal rests on, in its writer's words (plan P6): the one sentence of evidence a review of a
   * conversation gives for each thing it proposes. Shown under the draft, written nowhere.
   */
  why?: string;
}

export const WRITE_DRAFT_LIMITS = { drafts: 100, title: 200, content: 200_000, text: 2_000, properties: 40, sources: 50, recipients: 50, subject: 300, place: 300, description: 20_000, skillBody: 20_000, why: 400 } as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[A-Za-z0-9_-]{6,64}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * An e-mail address as a draft may carry it: one address, nothing around it.
 * No display name, no angle brackets, no list in one string and nothing a
 * header could be continued with — the app's composer splits recipients on
 * commas, semicolons and line breaks, so none of those may be inside one.
 */
export function isDraftAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 320 || value !== value.trim()) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 32 || code === 127 || code === 0x2028 || code === 0x2029) return false;
  }
  return /^[^@,;<>()[\]"\\:]+@[^@,;<>()[\]"\\:]+\.[^@,;<>()[\]"\\:.]+$/.test(value);
}

/** A civil day that exists: 2026-02-30 is none. */
export function isCivilDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** A wall-clock time, HH:MM in 24 hours. */
export function isClockTime(value: unknown): value is string {
  return typeof value === "string" && TIME.test(value);
}

function addressList(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > WRITE_DRAFT_LIMITS.recipients || !value.every(isDraftAddress)) return null;
  return [...new Set(value as string[])];
}

/** The addresses of `unnamed` that are recipients at all: a list that names somebody else is no warning about this mail. */
function unnamedOf(value: unknown, recipients: readonly string[]): string[] {
  return Array.isArray(value) ? recipients.filter((address) => (value as unknown[]).includes(address)) : [];
}

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
    case "mail": {
      const to = addressList(raw.to);
      const cc = addressList(raw.cc);
      const bcc = addressList(raw.bcc);
      if (!to || !cc || !bcc || !text(raw.subject, WRITE_DRAFT_LIMITS.subject) || !text(raw.body, WRITE_DRAFT_LIMITS.content)) return null;
      // A mail is something to say or somebody to say it to; a draft of neither is none.
      if (!raw.subject.trim() && !raw.body.trim() && to.length + cc.length + bcc.length === 0) return null;
      return { kind: "mail", to, cc, bcc, subject: raw.subject, body: raw.body, unnamed: unnamedOf(raw.unnamed, [...to, ...cc, ...bcc]) };
    }
    case "event": {
      const attendees = addressList(raw.attendees);
      if (!attendees || !filled(raw.title, WRITE_DRAFT_LIMITS.title) || !isCivilDay(raw.day)) return null;
      if (!text(raw.location, WRITE_DRAFT_LIMITS.place) || !text(raw.description, WRITE_DRAFT_LIMITS.description)) return null;
      const allDay = raw.allDay === true;
      if (allDay) {
        // An all-day appointment ends on its own day or later, never before it.
        const endDay = isCivilDay(raw.endDay) && raw.endDay >= raw.day ? raw.endDay : raw.day;
        return { kind: "event", title: raw.title, allDay, day: raw.day, endDay, start: "", end: "", location: raw.location, description: raw.description, attendees, unnamed: unnamedOf(raw.unnamed, attendees) };
      }
      if (!isClockTime(raw.start) || !isClockTime(raw.end) || raw.end <= raw.start) return null;
      return { kind: "event", title: raw.title, allDay, day: raw.day, endDay: raw.day, start: raw.start, end: raw.end, location: raw.location, description: raw.description, attendees, unnamed: unnamedOf(raw.unnamed, attendees) };
    }
    case "memory": {
      // What can be written as an entry, and nothing else: one line of what a reader sees, within the bound.
      if (typeof raw.text !== "string" || memoryTextProblem(raw.text) !== null) return null;
      const replaces = raw.replaces ?? null;
      if (replaces !== null && !filled(replaces, MEMORY_LIMITS.entryChars * 2)) return null;
      return { kind: "memory", text: raw.text, place: raw.place === "long" ? "long" : "active", replaces: replaces as string | null };
    }
    case "forget":
      return filled(raw.entry, MEMORY_LIMITS.entryChars * 2) ? { kind: "forget", entry: raw.entry } : null;
    case "rule":
      return typeof raw.text === "string" && memoryTextProblem(raw.text) === null ? { kind: "rule", text: raw.text } : null;
    case "skill": {
      if (!filled(raw.body, WRITE_DRAFT_LIMITS.skillBody) || !text(raw.name, WRITE_DRAFT_LIMITS.title) || !text(raw.description, SKILL_DESCRIPTION_MAX)) return null;
      const change = raw.change ?? null;
      if (change !== null) {
        // Only a skill of the vault's own, named by its folder: nothing that comes with the app, no script, no other file.
        if (!isRecord(change) || !skillDraftTarget(change.id) || !text(change.base, 64) || !HEX64.test(change.base)) return null;
        return { kind: "skill", change: { id: change.id, base: change.base }, name: raw.name, description: raw.description, body: raw.body };
      }
      // A new skill is written from these two: a name the format takes, and one line that says what it is for.
      if (skillNameProblems(raw.name).length > 0 || raw.name !== raw.name.trim().normalize("NFKC") || !skillDraftDescription(raw.description)) return null;
      return { kind: "skill", change: null, name: raw.name, description: raw.description, body: raw.body };
    }
    default:
      return null;
  }
}

/** The id of a skill a draft may rewrite: a folder directly under the vault's skills, by a name the format takes. */
export function skillDraftTarget(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith(`${SKILLS_FOLDER}/`)) return false;
  const folder = value.slice(SKILLS_FOLDER.length + 1);
  return folder.length > 0 && !folder.includes("/") && skillNameProblems(folder).length === 0 && folder === folder.trim().normalize("NFKC");
}

/**
 * What a new skill is for, as a draft may say it: one line within the
 * format's bound. No line break and no `---`: the file's frontmatter ends at
 * the next `---`, and a description that held one would cut it short.
 */
export function skillDraftDescription(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > SKILL_DESCRIPTION_MAX || value.includes("---")) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127 || code === 0x2028 || code === 0x2029) return false;
  }
  return true;
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
  const missing = parseMissingLinks(raw.missing);
  const withheld = parseMissingLinks(raw.withheld);
  // One line of evidence, as it was laid down: cut to its bound, never a reason to lose the draft.
  const why = typeof raw.why === "string" ? raw.why.replace(/\s+/g, " ").trim().slice(0, WRITE_DRAFT_LIMITS.why) : "";
  return {
    id: raw.id, createdAt: raw.createdAt, author: { id: author.id, label: author.label }, conversationId: conversationId as string | null, title: raw.title, body, inherited, sources, defused,
    ...(missing.length ? { missing } : {}),
    ...(withheld.length ? { withheld } : {}),
    ...(why ? { why } : {}),
  };
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
 * What became of a draft: the user created it, or threw it away. A mail and
 * an appointment are never created here — the user opens them in the app's
 * own composer or event editor, and the draft waits on until something
 * happened there: the mail was `sent` or `saved` as a draft at its account,
 * the appointment was `saved` to a calendar, or the composer moved to a
 * window of its own, out of this list's sight (`opened`). An editor that is
 * closed without any of these leaves the draft where it was. Kept beside the
 * waiting drafts so the conversation that laid one down can still say what
 * happened to it — "created: Inbox/Kick-off.md" instead of a card that has
 * silently gone. Unlike a waiting draft this is history: the oldest entries
 * go once there are more than the bound.
 */
export type WriteDraftEnd = "created" | "discarded" | "sent" | "saved" | "opened";

export interface WriteDraftOutcome {
  id: string;
  kind: WriteDraftKind;
  title: string;
  outcome: WriteDraftEnd;
  /** Where it was created: the note's path. */
  path?: string;
  at: string;
}

export const WRITE_DRAFT_DONE_CAP = 200;

const KINDS: readonly WriteDraftKind[] = ["note", "task", "journal", "entry", "mail", "event", "memory", "forget", "rule", "skill"];
/** The kinds that end in the vault's memory or its standing instructions (plan P6): made by the app, and no note to open. */
export const MEMORY_DRAFT_KINDS: readonly WriteDraftKind[] = ["memory", "forget", "rule"];
/** The kinds that are handed to an editor of the app's instead of being made: they are opened, never created. */
export const OPENED_DRAFT_KINDS: readonly WriteDraftKind[] = ["mail", "event"];

/** How a draft of this kind can end: what is made is created, a mail is sent or saved, an appointment saved. */
export function draftEndsOf(kind: WriteDraftKind): readonly WriteDraftEnd[] {
  if (kind === "mail") return ["discarded", "sent", "saved", "opened"];
  if (kind === "event") return ["discarded", "saved"];
  return ["discarded", "created"];
}

function parseOutcome(raw: unknown): WriteDraftOutcome | null {
  if (!isRecord(raw) || !text(raw.id, 64) || !ID.test(raw.id)) return null;
  if (!KINDS.includes(raw.kind as WriteDraftKind) || !filled(raw.title, WRITE_DRAFT_LIMITS.title)) return null;
  // Only an end this kind of draft can have: a mail is never "created", a note never "sent".
  if (!draftEndsOf(raw.kind as WriteDraftKind).includes(raw.outcome as WriteDraftEnd)) return null;
  if (!text(raw.at, 40) || !Number.isFinite(Date.parse(raw.at))) return null;
  const path = raw.outcome === "created" && vaultPath(raw.path) ? raw.path : undefined;
  return { id: raw.id, kind: raw.kind as WriteDraftKind, title: raw.title, outcome: raw.outcome as WriteDraftEnd, ...(path ? { path } : {}), at: raw.at };
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
