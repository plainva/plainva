import type { TextPart } from "../conversation.js";
import { CONTEXT_NOTE_LIMIT, contextStamp, withholdDeniedLinks, type ContextPolicyHost } from "../chat.js";
import { gateDecision, isCloudRecipient, type EgressRecipient, type GateDecision, type GateExclusion } from "../egressGate.js";
import { fenceUntrusted, payload } from "../trust.js";
import { isAiHiddenPath } from "../hiddenPaths.js";
import { chunkNote } from "../embeddings/chunks.js";
import { noteHash } from "../runSnapshot.js";
import { mergeCandidates, rankCandidates, urgencySignal, type Candidate, type CandidateSignal, type RankedCandidate } from "./ranking.js";
import { cardText, contextCard } from "./cards.js";
import { checkGist, gistKey } from "./gists.js";
import { areaOf } from "./gistWriter.js";
import { atxHeading, firstLineWith, noteBody, outlineOf, sectionAt } from "./sections.js";
import { withholdPlaces, withoutSensitiveProperties } from "./sensitive.js";
import { goingKinds, redactSensitive, SENSITIVE_KINDS, sensitiveFindings, sensitiveKinds, SITUATION_SOURCE, type SensitiveKind } from "./sensitiveHints.js";
import { questionTerms } from "./terms.js";

/**
 * The context package v1 (plan §9.2): what goes with a message besides the
 * user's words. Built in one pass through the hard gate:
 *
 * - tier 0, the situation: time and the app's "today", the open note or
 *   database, the selection and the section around the cursor, the note's
 *   core properties, open tabs, today's daily note, due tasks, the next
 *   appointments;
 * - tier 3 evidence: a few sections of the best candidates — a whole note
 *   only where the user pinned it, where the open note is short, or where the
 *   section found is all the note says (the open note gets a strong bonus,
 *   but a long one is not sent in full automatically, §7);
 * - tier 1 cards: title, path, section and why, with the section's context
 *   card — its first sentence and every sentence that carries a number, a
 *   date, a task, a negation or a link, verbatim (P2b-2, `cards.ts`);
 * - tier 2 work map: handles of further candidates, for `read_note`.
 *
 * Everything the vault wrote is fenced as data. A note the policy keeps from
 * the recipient is decided on BEFORE ranking and contributes nothing — no
 * title, no path, no excerpt, no link anchor in a neighbour (§8.2).
 */

/**
 * `audio`: a recording, sent to be transcribed (plan P1.5, E28) — never part of a chat's context.
 * `comments`: the remarks of a comment thread the assistant was addressed in (plan P3-6) — other
 * people's words about a note, which the notes themselves never carry.
 * `images`: a picture of the vault the user asked about ("Explain image", plan P4-5) — never
 * picked by the context package, only ever sent at the user's own request.
 * `memory`: entries of the vault's memory for assistants (plan P6, ADR 0032) — what the user kept
 * about themselves and their work. They go with a conversation's system prompt, not with the
 * package; the overview names them because they are vault text all the same.
 * `style`: the user's writing style (plan P9-3, ADR 0035) — lines the app wrote from what it
 * measured in the user's examples, in a conversation where the user chose it. No word of a note,
 * but measured from notes all the same: the overview names it, and a rule of an example holds.
 */
export type DataClass = "situation" | "notes" | "selection" | "tasks" | "calendar" | "audio" | "searches" | "comments" | "images" | "memory" | "style";

export interface SituationTask {
  title: string;
  /** The note the task lives in, when it lives in one. */
  path?: string | null;
  due?: string | null;
}

export interface SituationEvent {
  title: string;
  /** Local start, as the shell formats it ("10:00" or "2026-09-29 10:00"). */
  start: string;
  end?: string | null;
  allDay?: boolean;
  calendar?: string | null;
}

export interface SituationInput {
  /** Local wall-clock time as the shell formats it ("2026-09-28 16:40"). */
  now: string;
  /** English weekday name. */
  weekday: string;
  /** The day for appointments and due dates (`YYYY-MM-DD`). */
  calendarDay: string;
  /** The day of the journal and the daily note (`YYYY-MM-DD`, "The day ends at"). */
  journalDay: string;
  active: {
    path: string;
    title: string;
    kind: "note" | "base";
    selection?: string | null;
    /** The heading chain around the cursor ("Costs > 2026"). */
    heading?: string | null;
    properties?: Readonly<Record<string, unknown>>;
  } | null;
  /** The vault's mood property, left out with the other sensitive ones. */
  moodKey?: string | null;
  tabs: readonly { path: string; title: string }[];
  tasks: readonly SituationTask[];
  events: readonly SituationEvent[];
  dailyNote: { path: string; title: string } | null;
}

export interface ContextBuildHost extends ContextPolicyHost {
  /** The note's current text: the open note as the editor holds it, any other as saved. */
  readNote(path: string): Promise<{ title: string; text: string } | null>;
  /**
   * The size of notes as the index knows it, in bytes of UTF-8, for what a
   * naive request would have sent (plan P2b-5) — set against the bytes of
   * what went, never against characters (P9-6); absent, the comparison is
   * left out.
   */
  noteSizes?(paths: readonly string[]): Promise<Map<string, number>>;
  /**
   * Checked gists of the model of the profile "Local" on this computer (plan
   * P2b-3), never a stale one; absent while no such model writes them.
   */
  gists?: PackageGists;
}

export interface PackageGists {
  /** The gist of a section's exact text (`gistKey`). */
  section(key: string): Promise<string | null>;
  note(path: string): Promise<string | null>;
  area(area: string): Promise<string | null>;
  vault(): Promise<string | null>;
}

/** Map handles that may carry their note's gist, and areas that may be named with theirs. */
const MAP_GISTS = 4;
const AREA_GISTS = 3;

export interface ContextBudget {
  /** Notes that may send a section. */
  evidence: number;
  /** Characters of vault text across all evidence. */
  evidenceChars: number;
  /** Characters of the open note, when it has no selection. */
  activeChars: number;
  /** Characters of one found section. */
  sectionChars: number;
  cards: number;
  map: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = { evidence: 3, evidenceChars: 12_000, activeChars: 6_000, sectionChars: 3_000, cards: 6, map: 12 };

export interface ContextBuildInput {
  question: string;
  recipient: EgressRecipient;
  situation: SituationInput;
  /** Candidate lists of the vault's sources (search, links, recency); merged here. */
  candidates: readonly (readonly Candidate[])[];
  /** Notes pinned to the conversation. */
  pins: readonly string[];
  /**
   * Stamps (`path#hash`) of parts of notes the conversation carries, where
   * every view of the note's text the runs record since has the version the
   * part went in and the same choice to send it redacted, and no later turn
   * carried the part otherwise (`sentStamps`): those parts are named, not
   * repeated.
   */
  alreadySent?: ReadonlySet<string>;
  /** Notes the user left out in the send overview: not denied, just not wanted for this message. */
  leaveOut?: ReadonlySet<string>;
  /** Sources the reader wants as the original, not as a gist ("View context", P2b-3). */
  originals?: ReadonlySet<string>;
  /**
   * Sources whose numbers and secrets this conversation sends redacted
   * ("View context", P2b-6): note paths, and `SITUATION_SOURCE` for the due
   * tasks, the appointments and the open note's details.
   */
  redact?: ReadonlySet<string>;
  budget?: Partial<ContextBudget>;
  /**
   * The conversation carries tools that reach the internet (plan KI-Harness
   * P4): a note whose rules say `web: deny` does not go along, whoever the
   * recipient is — and links to notes that stay back are withheld even for a
   * model on this device, which could otherwise carry a name out in a search.
   */
  webTools?: boolean;
}

export type PackageTier = "evidence" | "card" | "map";

export interface PackageRef {
  path: string;
  title: string;
  tier: PackageTier;
  reasons: CandidateSignal[];
  score: number;
  /** Characters of vault text this source contributed (0 for a handle or an unchanged section). */
  chars: number;
  /** The section that went, when it was not the whole note ("" = the text before the first heading). */
  section?: string;
  /** Sent earlier in the conversation and unchanged: named, not repeated. */
  unchanged?: boolean;
  /** Characters of the whole note this source stands for (evidence and cards; plan P2b-5). */
  noteChars?: number;
  /** A gist by the model on this computer went instead of the verbatim card (plan P2b-3). */
  gist?: boolean;
  /** What the local patterns saw in the text it sends to a cloud (plan P2b-6): a hint, never a block. */
  sensitive?: SensitiveKind[];
  /** Spans of it sent redacted, at the reader's choice. */
  redacted?: number;
  /**
   * The version of the note this source was taken from (plan KI-Harness
   * P9-2): the SHA-256 of its text as the package read it, never the text.
   * Absent for a handle of the map, which reads no note.
   */
  hash?: string;
  /**
   * What of the note this context left out (plan KI-Harness P9-6), in
   * characters: the rest of a note of which only a section or its key
   * sentences went — verbatim or as a gist —, up to the most Plainva sends of
   * one note. The list of sections an open note's text begins with counts as
   * part of what went: it is a cost of the shortening. Absent for a note that
   * went whole, whatever a redaction did to its length, for one named again
   * unchanged, for a card with no sentence or a section with no text beyond
   * its heading, for a section that holds all the note says whose whole did
   * not fit, and for a handle in the map.
   */
  left?: number;
}

/** What the patterns saw in a source's text, and how much of it went redacted (plan P2b-6). */
export interface SourceHint {
  sensitive: SensitiveKind[];
  redacted?: number;
}

/**
 * What a package saves for "View context" (plan P2b-5, P9-6): the characters
 * it sends of its sources and the whole of those notes; and — when the host
 * knows the sizes of notes — the bytes of every note the sources proposed
 * that passed the gate, set against the bytes of what went: what sending
 * without a selection would have cost. Characters are counted against
 * characters and bytes against bytes, a note the package read by its body:
 * a note in a script of several bytes a character, or one with properties,
 * does not look shortened when it went whole. What one run saved is counted
 * per source (`PackageRef.left`).
 */
export interface PackageMaterial {
  sentChars: number;
  sourceChars: number;
  sentBytes: number;
  candidateBytes: number | null;
}

const utf8 = new TextEncoder();

/** The bytes a text takes in UTF-8, as a file on the disk and the index count it. */
export function utf8Length(text: string): number {
  return utf8.encode(text).length;
}

export interface ContextPackage {
  /** The part before the user's words; its `context` carries the evidence stamps. */
  part: TextPart;
  refs: PackageRef[];
  /** Kept back by the gate: paths only, shown locally, never sent. */
  excluded: GateExclusion[];
  /** `sensitive`: numbers and secrets sent redacted at the reader's choice (P2b-6). */
  redactions: { withheldLinks: number; places: number; moodProperties: number; sensitive: number };
  /** What the patterns saw in the situation's own text — due tasks, appointments, the open note's details — that no listed note carries (P2b-6). */
  situationHint?: SourceHint;
  /** The kinds in what goes unredacted (P2b-6): the overview's reason to come back. */
  sensitive?: SensitiveKind[];
  dataClasses: DataClass[];
  estimatedTokens: number;
  material: PackageMaterial;
}

/** A text after the patterns looked at it: what goes, what they saw, how much went redacted. */
interface Screened {
  text: string;
  sensitive?: SensitiveKind[];
  redacted?: number;
}

/** The hint a screened text leaves on its source. */
function hintOf(screened: Screened): { sensitive?: SensitiveKind[]; redacted?: number } {
  return { ...(screened.sensitive ? { sensitive: screened.sensitive } : {}), ...(screened.redacted ? { redacted: screened.redacted } : {}) };
}

/** A second text of the same source: its kinds join the source's hint. */
function joinHint(into: { sensitive?: SensitiveKind[]; redacted?: number }, add: Screened): void {
  if (!add.sensitive) return;
  into.sensitive = SENSITIVE_KINDS.filter((kind) => into.sensitive?.includes(kind) || add.sensitive!.includes(kind));
  if (add.redacted) into.redacted = (into.redacted ?? 0) + add.redacted;
}

const HEADER =
  "Context Plainva adds to this message: the user's situation and notes that may matter. " +
  "When an answer rests on a note, cite it as [[Title]]. read_note gives more of any note listed; nothing here is complete unless it says so.";

const REASON_WORDS: Record<CandidateSignal, string> = {
  active: "open now",
  pinned: "pinned",
  lexical: "matches the question",
  semantic: "close in meaning to the question",
  graph: "linked with the open note",
  urgency: "has something due",
  edited: "changed recently",
  opened: "opened recently",
  daily: "today's daily note",
  tab: "open in a tab",
};

/** Rough tokens for a text: about 3.5 characters per token across the app's languages. */
export function estimateTokens(text: string): number {
  return estimateTokensOfChars(text.length);
}

/**
 * Rough tokens for a number of characters, by the rule of `estimateTokens` — the one estimate of the send overview,
 * the context view and what the month saved (plan KI-Harness P9-6).
 */
export function estimateTokensOfChars(chars: number): number {
  return Math.ceil(chars / 3.5);
}

/**
 * What sending every proposed note whole would have cost, set against what
 * goes ("View context", plan P2b-5, P9-6): the share the selection saves —
 * bytes against bytes, as the index knows the notes — and the tokens it would
 * have been, its bytes counted at the characters a byte of what goes stands
 * for. Null without the sizes of notes, when nothing of the notes goes, or
 * when the selection saves nothing.
 */
export function naiveComparison(material: Pick<PackageMaterial, "sentChars" | "sentBytes" | "candidateBytes">): { share: number; tokens: number } | null {
  const { candidateBytes, sentBytes, sentChars } = material;
  if (candidateBytes === null || !(sentBytes > 0) || !(candidateBytes > sentBytes)) return null;
  const share = 1 - sentBytes / candidateBytes;
  // A share that rounds to nothing is no saving to show.
  if (share < 0.005) return null;
  return { share, tokens: estimateTokensOfChars(Math.round((candidateBytes * sentChars) / sentBytes)) };
}

function titleFromPath(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.md$/i, "");
}

function clip(text: string, max: number): { text: string; clipped: boolean } {
  if (text.length <= max) return { text, clipped: false };
  const cut = text.lastIndexOf("\n", max);
  return { text: text.slice(0, cut > max * 0.6 ? cut : max), clipped: true };
}

function propertyLine(key: string, value: unknown): string {
  const text = Array.isArray(value) ? value.map((v) => String(v)).join(", ") : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
  return `${key}: ${text.length > 200 ? `${text.slice(0, 200)}…` : text}`;
}

/** The section a card is cut from: where the question's words are, else where its meaning was, else the note's start. */
function cardSource(text: string, title: string, candidate: RankedCandidate, terms: readonly string[]): { chain: string; text: string } {
  const body = noteBody(text);
  const line = firstLineWith(body, terms);
  if (line >= 0) return sectionAt(body, line);
  if (candidate.chunk) {
    const chunk = chunkNote(title, text).find((c) => c.ordinal === candidate.chunk!.ordinal);
    if (chunk && chunk.to > chunk.from) return { chain: chunk.chain, text: text.slice(chunk.from, chunk.to) };
  }
  return openingSection(body);
}

/** A note's opening: the text before its first heading — or, where that is blank, its first heading's section. */
function openingSection(body: string): { chain: string; text: string } {
  const first = sectionAt(body, 0);
  if (first.text.trim()) return first;
  const heading = outlineOf(body)[0];
  return heading ? sectionAt(body, heading.line) : first;
}

/**
 * Where a part found in a note holds all the note says (P9-6): the note's
 * whole text where it fits — the same text however the part was found, by a
 * word or by meaning, and as a pinned or open note goes whole —, "" where it
 * does not fit (its headings and blank lines take the room), null where the
 * rest of the note says something.
 */
function wholeOf(body: string, part: string, limit: number): string | null {
  if (saysSomething(body.replace(part, ""))) return null;
  const all = clip(body, limit);
  return all.clipped ? "" : all.text;
}

/** Whether a text of a note says something beyond its headings: a line that is neither blank nor a heading as the outline reads one. */
function saysSomething(text: string): boolean {
  return text.split("\n").some((line) => line.trim() !== "" && !atxHeading(line));
}

/**
 * The situation without anything below a hidden root (`.agent/`, ADR 0020):
 * an open skill file or a task written in one is not the user's work the
 * model should see — approved instructions reach it as instructions.
 */
function visibleSituation(situation: SituationInput): SituationInput {
  const visible = (path: string | null | undefined) => !path || !isAiHiddenPath(path);
  return {
    ...situation,
    active: situation.active && visible(situation.active.path) ? situation.active : null,
    tabs: situation.tabs.filter((tab) => visible(tab.path)),
    tasks: situation.tasks.filter((task) => visible(task.path)),
    dailyNote: situation.dailyNote && visible(situation.dailyNote.path) ? situation.dailyNote : null,
  };
}

export async function buildContextPackage(input: ContextBuildInput, host: ContextBuildHost): Promise<ContextPackage> {
  const budget: ContextBudget = { ...DEFAULT_CONTEXT_BUDGET, ...input.budget };
  const run = { recipient: input.recipient, webTools: input.webTools === true };
  const cloud = isCloudRecipient(input.recipient);
  const situation = visibleSituation(input.situation);
  const terms = questionTerms(input.question);
  const redactions = { withheldLinks: 0, places: 0, moodProperties: 0, sensitive: 0 };
  const excluded: GateExclusion[] = [];
  const decisions = new Map<string, GateDecision>();

  const note = (decision: GateDecision, path: string) => {
    if (!decision.allowed && !excluded.some((e) => e.path === path)) excluded.push({ path, reason: decision.reason!, source: decision.source });
  };
  /** The gate, once per path: the policy as the file says it now. */
  const allowed = async (path: string): Promise<boolean> => {
    let decision = decisions.get(path);
    if (!decision) {
      decision = gateDecision(await host.policyOf(path), run);
      decisions.set(path, decision);
      note(decision, path);
    }
    return decision.allowed;
  };
  /** The gate again on the exact text that would go (the editor may hold an unsaved `cloud: deny`). */
  const allowedText = async (path: string, text: string): Promise<boolean> => {
    const decision = gateDecision(await host.policyOf(path, text), run);
    if (!decision.allowed) {
      decisions.set(path, decision);
      note(decision, path);
    }
    return decision.allowed;
  };
  /** What any vault text passes before it goes: place stamps withheld; for a cloud or a run with the internet, links to denied notes too. */
  const clean = async (text: string, fromPath: string): Promise<string> => {
    const places = withholdPlaces(text);
    redactions.places += places.withheld;
    if (!cloud && !run.webTools) return places.text;
    const links = await withholdDeniedLinks(places.text, fromPath, host, (path) => allowed(path));
    redactions.withheldLinks += links.redacted;
    return links.text;
  };
  /**
   * The local patterns on a text that would go to a cloud (P2b-6): what they
   * saw rides on its source as a hint for "View context" and the overview;
   * where the reader chose it for this conversation — for any of the sources
   * the text belongs to —, numbers and secrets go redacted.
   */
  const screen = (text: string, ...sources: string[]): Screened => {
    if (!cloud || !text) return { text };
    const findings = sensitiveFindings(text);
    if (!findings.length) return { text };
    const sensitive = sensitiveKinds(findings);
    if (!sources.some((source) => input.redact?.has(source))) return { text, sensitive };
    const out = redactSensitive(text, findings);
    return { text: out.text, sensitive, ...(out.redacted ? { redacted: out.redacted } : {}) };
  };
  /** A screened text that goes: its redactions counted, its unredacted kinds noted for the overview. */
  const going = new Set<SensitiveKind>();
  const went = (screened: Screened) => {
    redactions.sensitive += screened.redacted ?? 0;
    for (const kind of goingKinds(screened.sensitive ?? [], Boolean(screened.redacted))) going.add(kind);
  };

  // ------------------------------------------------------------ candidates
  const own: Candidate[] = [];
  if (situation.active?.kind === "note") own.push({ path: situation.active.path, title: situation.active.title, signals: { active: 1 } });
  for (const path of input.pins) if (!isAiHiddenPath(path)) own.push({ path, title: titleFromPath(path), signals: { pinned: 1 } });
  for (const tab of situation.tabs) own.push({ path: tab.path, title: tab.title, signals: { tab: 1 } });
  if (situation.dailyNote) own.push({ path: situation.dailyNote.path, title: situation.dailyNote.title, signals: { daily: 1 } });
  for (const task of situation.tasks) {
    const urgency = urgencySignal(task.due, situation.calendarDay);
    if (task.path && urgency > 0) own.push({ path: task.path, title: titleFromPath(task.path), signals: { urgency } });
  }
  const merged = mergeCandidates([own, ...input.candidates]).filter((candidate) => !input.leaveOut?.has(candidate.path) && !isAiHiddenPath(candidate.path));

  // The hard gate BEFORE scoring: a denied candidate does not exist for anything below.
  const verdicts = await Promise.all(merged.map((candidate) => allowed(candidate.path)));
  const ranked = rankCandidates(merged.filter((_, i) => verdicts[i]));

  // -------------------------------------------------------------- evidence
  const refs: PackageRef[] = [];
  const blocks: string[] = [];
  const stamps: string[] = [];
  let evidenceChars = 0;
  /** The bytes of what goes of the notes, in UTF-8 as the index counts the notes (P9-6). */
  let sentBytes = 0;
  /** The bytes of the body of every note the package read: what "whole" means for the naive comparison (P9-6). */
  const bodyBytes = new Map<string, number>();
  /**
   * The most Plainva sends of one note (a pinned one): what a note is counted
   * at for what the context left out of it (P9-6) — the rest beyond it would
   * not have gone anyway.
   */
  const noteCeiling = Math.min(CONTEXT_NOTE_LIMIT, Math.max(budget.evidenceChars, 4_000));
  /** What a note would have gone with whole — cut as Plainva cuts it, at its last line before the ceiling — less what went. */
  const leftOf = (body: string, chars: number): { left?: number } => {
    const left = clip(body, noteCeiling).text.length - chars;
    return left > 0 ? { left } : {};
  };
  const missing = new Set<string>();
  const strong = (c: RankedCandidate) =>
    (c.signals.active ?? 0) > 0 || (c.signals.pinned ?? 0) > 0 || (c.signals.lexical ?? 0) >= 0.3 || (c.signals.semantic ?? 0) >= 0.5;
  /** Texts already chosen as evidence: the same section in two notes (a copy, a template) goes once (plan P2b). */
  const chosenTexts = new Set<string>();
  /** Found notes whose evidence would repeat a chosen text: named in the map, never sent a second time. */
  const duplicates = new Set<string>();
  for (const candidate of ranked) {
    if (refs.filter((r) => r.tier === "evidence").length >= budget.evidence || evidenceChars >= budget.evidenceChars) break;
    if (!strong(candidate)) continue;
    const read = await host.readNote(candidate.path);
    if (!read) {
      missing.add(candidate.path);
      continue;
    }
    if (!(await allowedText(candidate.path, read.text))) continue;
    const hash = noteHash(read.text);
    const body = noteBody(read.text);
    bodyBytes.set(candidate.path, utf8Length(body));
    const room = budget.evidenceChars - evidenceChars;
    let text: string;
    let section: string | undefined;
    let whole = false;
    /**
     * A section that holds all the note says, whose whole did not fit (P9-6): its headings are a rest one can read —
     * a heading can carry what a reader wants —, but nothing the note says was left out, so nothing counts as saved.
     */
    let nothingElse = false;
    /** What of the note was chosen, without the list of sections an open note's text may begin with (P9-6). */
    let fromNote: string;
    if ((candidate.signals.pinned ?? 0) > 0) {
      const clipped = clip(body, Math.min(CONTEXT_NOTE_LIMIT, Math.max(room, 4_000)));
      text = clipped.text;
      fromNote = text;
      whole = !clipped.clipped;
    } else if ((candidate.signals.active ?? 0) > 0) {
      const line = firstLineWith(body, terms);
      const outline = outlineOf(body).map((h) => `${"  ".repeat(h.level - 1)}- ${h.text}`);
      if (line >= 0 && body.length > budget.activeChars) {
        const found = sectionAt(body, line);
        section = found.chain;
        fromNote = clip(found.text, Math.min(budget.activeChars, room)).text;
        text = `${outline.length ? `Sections:\n${outline.join("\n")}\n\n` : ""}${fromNote}`;
      } else {
        const clipped = clip(body, Math.min(budget.activeChars, room));
        text = clipped.text;
        fromNote = text;
        whole = !clipped.clipped;
        if (clipped.clipped && outline.length) text = `Sections:\n${outline.join("\n")}\n\n${text}`;
      }
    } else {
      const line = firstLineWith(body, terms);
      // Found by meaning and not by a word: the section the meaning came from, not the note's beginning.
      const chunk = line < 0 && candidate.chunk ? chunkNote(read.title || candidate.title, read.text).find((c) => c.ordinal === candidate.chunk!.ordinal) : undefined;
      if (chunk && chunk.to > chunk.from) {
        const clipped = clip(read.text.slice(chunk.from, chunk.to).trim(), Math.min(budget.sectionChars, room));
        // As for a section found by a word: a passage that holds all the note says is the whole note (P9-6).
        const all = clipped.clipped ? null : wholeOf(body, clipped.text, Math.min(budget.sectionChars, room));
        if (all) whole = true;
        else {
          section = chunk.chain;
          nothingElse = all === "";
        }
        text = all || clipped.text;
        fromNote = text;
      } else {
        // Where no line holds a word of the question: the note's opening — its first section where the opening is blank.
        const found = line >= 0 ? sectionAt(body, line) : openingSection(body);
        const clipped = clip(found.text, Math.min(budget.sectionChars, room));
        // A section that holds all the note says is the whole note: nothing outside it says anything (P9-6) — and the
        // model is not told that read_note gives a rest there is not.
        const all = clipped.clipped ? null : wholeOf(body, found.text, Math.min(budget.sectionChars, room));
        if (all) whole = true;
        else {
          section = found.chain;
          nothingElse = all === "";
        }
        text = all || clipped.text;
        fromNote = text;
      }
    }
    // What was chosen, before the vault's text is cleaned for its recipient: the measure of what was left out (P9-6) —
    // a place stamp or a link that is withheld is no part of a note that was left out.
    const chosenChars = text.length;
    text = await clean(text, candidate.path);
    // The same words, however the lines end: a copied section is one source.
    const sameText = contextStamp(text.replace(/\s+/g, " ").trim());
    // What the user put there (a pin, the open note) always goes; only what the search found gives way.
    const chosen = (candidate.signals.pinned ?? 0) > 0 || (candidate.signals.active ?? 0) > 0;
    if (!chosen && text.trim() && chosenTexts.has(sameText)) {
      duplicates.add(candidate.path);
      continue;
    }
    chosenTexts.add(sameText);
    // Screened after the duplicate check: a redacted copy must not turn its unredacted twin into a new source.
    const screened = screen(text, candidate.path);
    text = screened.text;
    // "The whole note" says something of all its text: its stamp covers that text too, so a note that went whole and
    // changed since goes again — also where only a section of it goes now, whose own text may be what went before
    // (P9-6). What the part is goes into the hash, so a stamp of the older form, which did not say it, never matches.
    // One hash token: a stamp's path is what stands before its last "#".
    const stamp = `${candidate.path}#${contextStamp(`${whole ? "whole" : "part"}\n${text}`)}${whole ? contextStamp(body) : ""}`;
    const title = read.title || candidate.title;
    const label = whole ? "the whole note" : section ? `section "${section}"` : "the beginning";
    if (input.alreadySent?.has(stamp)) {
      // Nothing of it goes again; the hint stays only where the reader redacts it, so the choice can be taken back.
      refs.push({
        path: candidate.path,
        title,
        tier: "evidence",
        reasons: candidate.reasons,
        score: candidate.score,
        chars: 0,
        // The part as the sent entry names it: the beginning is "", the whole note has none.
        ...(whole ? {} : { section: section ?? "" }),
        unchanged: true,
        noteChars: body.length,
        hash,
        ...(input.redact?.has(candidate.path) ? hintOf(screened) : {}),
      });
      // It names the part it vouches for — not the note, of which another part may have changed —, and as the vault's
      // text: a title and a heading are a stranger's words.
      blocks.push(fenceUntrusted(payload(`${title} (${candidate.path}), ${label}: unchanged since it was sent earlier in this conversation.`, { kind: "vault", path: candidate.path, ...(section ? { section } : {}) })));
      stamps.push(stamp);
      continue;
    }
    blocks.push(
      fenceUntrusted(payload(`${title} (${candidate.path}), ${label}:\n\n${text}${whole ? "" : "\n\n[…read_note gives the rest]"}`, { kind: "vault", path: candidate.path, ...(section ? { section } : {}) })),
    );
    stamps.push(stamp);
    evidenceChars += text.length;
    sentBytes += utf8Length(text);
    went(screened);
    refs.push({
      path: candidate.path,
      title,
      tier: "evidence",
      reasons: candidate.reasons,
      score: candidate.score,
      chars: text.length,
      // A section that says nothing beyond its heading sent nothing of the note: no part of it was left out by a choice.
      ...(whole ? {} : { section: section ?? "", ...(saysSomething(fromNote) && !nothingElse ? leftOf(body, chosenChars) : {}) }),
      noteChars: body.length,
      hash,
      ...hintOf(screened),
    });
  }

  // ---------------------------------------------------------- cards + map
  const inEvidence = new Set(refs.map((r) => r.path));
  // Not what the text check denied, and not what the index still lists but the vault no longer has.
  const rest = ranked.filter((c) => !inEvidence.has(c.path) && !missing.has(c.path) && decisions.get(c.path)?.allowed !== false);
  const cards: string[] = [];
  const carded = new Set<string>();
  /** Card texts already chosen: two copies of a note make one card. */
  const cardTexts = new Set<string>();
  for (const candidate of rest) {
    if (cards.length >= budget.cards) break;
    if (duplicates.has(candidate.path)) continue;
    const read = await host.readNote(candidate.path);
    if (!read) {
      missing.add(candidate.path);
      continue;
    }
    // The gate on the text that would go, as for evidence (the editor may hold an unsaved rule).
    if (!(await allowedText(candidate.path, read.text))) continue;
    const hash = noteHash(read.text);
    const title = read.title || candidate.title;
    const body = noteBody(read.text);
    bodyBytes.set(candidate.path, utf8Length(body));
    const found = cardSource(read.text, title, candidate, terms);
    // Cleaned line by line before it is cut: a place stamp is a line of its own, and a card joins its lines.
    let text = cardText(contextCard(await clean(found.text, candidate.path), found.chain)).replace(/\s+/g, " ").trim();
    // A checked gist of exactly this section goes instead when it is shorter, unless the reader asked for the original (P2b-3).
    let gisted = false;
    if (host.gists && !input.originals?.has(candidate.path)) {
      const raw = await host.gists.section(gistKey(found.text)).catch(() => null);
      if (raw && checkGist("section", found.text, raw).ok) {
        const gist = (await clean(raw, candidate.path)).replace(/\s+/g, " ").trim();
        if (gist && gist.length < text.length) {
          text = gist;
          gisted = true;
        }
      }
    }
    const same = contextStamp(text);
    if (text && cardTexts.has(same)) {
      duplicates.add(candidate.path);
      continue;
    }
    cardTexts.add(same);
    // What the card is, before a redaction the reader chose: the measure of what was left out (P9-6).
    const cardChars = text.length;
    const screened = screen(text, candidate.path);
    text = screened.text;
    went(screened);
    sentBytes += utf8Length(text);
    const why = candidate.reasons.slice(0, 2).map((r) => REASON_WORDS[r]).join(", ");
    cards.push(`- [[${title}]] (${candidate.path})${found.chain ? ` › ${found.chain}` : ""} — ${why}${text ? `: ${gisted ? "(gist) " : ""}${text}` : ""}`);
    refs.push({
      path: candidate.path,
      title,
      tier: "card",
      reasons: candidate.reasons,
      score: candidate.score,
      chars: text.length,
      section: found.chain,
      noteChars: body.length,
      // A card with no sentence named the note and sent nothing of it: no part of it was left out by a choice.
      ...(cardChars > 0 ? leftOf(body, cardChars) : {}),
      hash,
      ...(gisted ? { gist: true } : {}),
      ...hintOf(screened),
    });
    carded.add(candidate.path);
  }
  const map: string[] = [];
  const mapped = rest.filter((c) => !carded.has(c.path) && !missing.has(c.path) && decisions.get(c.path)?.allowed !== false);
  let mapGists = 0;
  for (const candidate of mapped.slice(0, budget.map)) {
    // The first handles may carry their note's gist (P2b-3): a line instead of a bare name, where one exists.
    const raw = host.gists && mapGists < MAP_GISTS && !input.originals?.has(candidate.path) ? await host.gists.note(candidate.path).catch(() => null) : null;
    const screened = screen(raw ? (await clean(raw, candidate.path)).replace(/\s+/g, " ").trim() : "", candidate.path);
    const gist = screened.text;
    if (gist) mapGists++;
    went(screened);
    sentBytes += utf8Length(gist);
    map.push(`- [[${candidate.title}]] (${candidate.path})${gist ? ` — (gist) ${gist}` : ""}`);
    refs.push({ path: candidate.path, title: candidate.title, tier: "map", reasons: candidate.reasons, score: candidate.score, chars: gist.length, ...(gist ? { gist: true } : {}), ...hintOf(screened) });
  }
  // The areas the sources come from, and the vault, as gists (P2b-3): written only from notes a cloud may see.
  // A folder's or the vault's gist stands for many notes, so no one note's choice can govern it:
  // where the patterns see something in it, it stays back (P2b-6).
  const quiet = (gist: string) => !cloud || sensitiveFindings(gist).length === 0;
  const areaLines: string[] = [];
  // They are written from every note a cloud may see — among them notes that must never meet the internet.
  // No one note's rule governs such a gist, so a conversation with the internet goes without them.
  if (host.gists && refs.length && !run.webTools) {
    const counts = new Map<string, number>();
    for (const ref of refs) {
      const area = areaOf(ref.path);
      if (area) counts.set(area, (counts.get(area) ?? 0) + 1);
    }
    for (const [area] of [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, AREA_GISTS)) {
      const gist = await host.gists.area(area).catch(() => null);
      if (gist && quiet(gist)) areaLines.push(`- ${area}/ — ${gist.replace(/\s+/g, " ").trim()}`);
    }
    const vault = await host.gists.vault().catch(() => null);
    if (vault && quiet(vault)) areaLines.unshift(`- The vault — ${vault.replace(/\s+/g, " ").trim()}`);
  }

  // ------------------------------------------------------------ situation
  /**
   * Situation text belongs to the note it came from: its hint joins that
   * note's row, and that note's choice redacts it; what no listed note
   * carries is the situation's own (`SITUATION_SOURCE`).
   */
  const situationHint: { sensitive?: SensitiveKind[]; redacted?: number } = {};
  const situationText = (text: string, path: string | null | undefined): string => {
    const screened = path ? screen(text, path, SITUATION_SOURCE) : screen(text, SITUATION_SOURCE);
    if (!screened.sensitive) return screened.text;
    went(screened);
    joinHint((path ? refs.find((ref) => ref.path === path) : undefined) ?? situationHint, screened);
    return screened.text;
  };
  const dataClasses = new Set<DataClass>(["situation"]);
  const lines: string[] = [`Now: ${situation.weekday}, ${situation.now}. Today for appointments and due dates: ${situation.calendarDay}; the journal's day: ${situation.journalDay}.`];
  const active = situation.active && !input.leaveOut?.has(situation.active.path) ? situation.active : null;
  if (active && (await allowed(active.path))) {
    lines.push(active.kind === "base" ? `Open: the database [[${active.title}]] (${active.path}) — query_base reads it.` : `Open: [[${active.title}]] (${active.path}).`);
    if (active.heading) lines.push(`The cursor is in the section "${active.heading}".`);
    if (active.selection && active.selection.trim()) {
      const read = await host.readNote(active.path);
      if (!read || (await allowedText(active.path, read.text))) {
        const selection = situationText(clip(await clean(active.selection.trim(), active.path), 4_000).text, active.path);
        lines.push(`Selected text:\n«${selection}»`);
        dataClasses.add("selection");
      }
    }
    if (active.properties && Object.keys(active.properties).length) {
      const { properties, withheld } = withoutSensitiveProperties(active.properties, situation.moodKey);
      redactions.moodProperties += withheld;
      const shown = Object.entries(properties).slice(0, 12).map(([k, v]) => propertyLine(k, v));
      if (shown.length) lines.push(`Properties of the open note:\n${situationText(await clean(shown.join("\n"), active.path), active.path)}`);
    }
  }
  const tabs: string[] = [];
  for (const tab of situation.tabs) if (tab.path !== active?.path && (await allowed(tab.path))) tabs.push(`[[${tab.title}]]`);
  if (tabs.length) lines.push(`Open tabs: ${tabs.slice(0, 10).join(", ")}.`);
  if (situation.dailyNote && (await allowed(situation.dailyNote.path))) lines.push(`Today's daily note: [[${situation.dailyNote.title}]] (${situation.dailyNote.path}).`);
  const tasks: string[] = [];
  for (const task of situation.tasks.slice(0, 12)) {
    if (task.path && !(await allowed(task.path))) continue;
    const due = task.due ? ` (due ${task.due}${task.due < situation.calendarDay ? ", overdue" : ""})` : "";
    tasks.push(`- [ ] ${situationText(task.title, task.path)}${due}${task.path ? ` — in [[${titleFromPath(task.path)}]]` : ""}`);
  }
  if (tasks.length) {
    lines.push(`Tasks that are due:\n${await clean(tasks.join("\n"), active?.path ?? "")}`);
    dataClasses.add("tasks");
  }
  const events = situation.events.slice(0, 8).map((e) => `- ${e.allDay ? "all day" : `${e.start}${e.end ? `–${e.end}` : ""}`} ${e.title}${e.calendar ? ` (${e.calendar})` : ""}`);
  if (events.length) {
    lines.push(`Appointments:\n${situationText(withholdPlaces(events.join("\n")).text, null)}`);
    dataClasses.add("calendar");
  }
  if (refs.length) dataClasses.add("notes");

  const parts = [HEADER, fenceUntrusted(payload(lines.join("\n\n"), { kind: "app" }))];
  if (blocks.length) parts.push(`Notes:\n\n${blocks.join("\n\n")}`);
  if (cards.length) {
    const gists = refs.some((r) => r.tier === "card" && r.gist) ? " A card marked (gist) is a checked summary by a model on the user's computer: its numbers, dates and links are verbatim, its other words are not; read_note gives the original." : "";
    parts.push(fenceUntrusted(payload(`Also relevant — each with its first sentence and every sentence carrying numbers, dates, tasks, negations or links, verbatim.${gists}\n${cards.join("\n")}`, { kind: "app" })));
  }
  if (map.length) parts.push(fenceUntrusted(payload(`Further notes that may matter:\n${map.join("\n")}`, { kind: "app" })));
  if (areaLines.length) parts.push(fenceUntrusted(payload(`Where these notes sit (gists by a model on the user's computer):\n${areaLines.join("\n")}`, { kind: "app" })));
  const text = parts.join("\n\n");
  // What it saves: its sources against the whole of them, and the whole of everything proposed (P2b-5) — the last in
  // bytes, as the index knows the notes, against the bytes of what went.
  let candidateBytes: number | null = null;
  if (host.noteSizes) {
    try {
      const sizes = await host.noteSizes(ranked.map((c) => c.path));
      candidateBytes = ranked.reduce((sum, c) => sum + (bodyBytes.get(c.path) ?? sizes.get(c.path) ?? 0), 0);
    } catch {
      candidateBytes = null;
    }
  }
  const material: PackageMaterial = {
    sentChars: refs.reduce((sum, r) => sum + r.chars, 0),
    sourceChars: refs.reduce((sum, r) => sum + (r.unchanged ? 0 : (r.noteChars ?? 0)), 0),
    sentBytes,
    candidateBytes,
  };

  return {
    part: { type: "text", text, context: stamps },
    refs,
    excluded,
    redactions,
    ...(situationHint.sensitive ? { situationHint: { sensitive: situationHint.sensitive, ...(situationHint.redacted ? { redacted: situationHint.redacted } : {}) } } : {}),
    ...(going.size ? { sensitive: SENSITIVE_KINDS.filter((kind) => going.has(kind)) } : {}),
    dataClasses: [...dataClasses],
    estimatedTokens: estimateTokens(text),
    material,
  };
}

/**
 * What the conversation already carries of its notes, for "unchanged" (plan
 * KI-Harness P2b, P9-6): the stamps (`path#hash`) of the parts its turns sent
 * where every view of the note's text the runs record since has the version
 * the part went in — the context's evidence or card, or a note a tool read
 * (`RunMeta.readHashes`) —, the conversation's choice to send the note
 * redacted was the same at each of them (`RunMeta.redact`), and no later turn
 * carried the same part with another text (less room). A note that changed
 * and changed back is not "unchanged" against a part while a view in between
 * showed it otherwise, nor is a part that went plain while a view since went
 * redacted, or the other way round; another section of the same version in
 * between keeps the earlier one. A view whose version is not known keeps
 * nothing earlier of its note: a note's gist in the map, a note a tool read
 * at two versions in one run (`readChanged`), and every note after a run
 * whose reads went past its record (`readUnhashed`). What the record does not
 * know as a view of a note's text is none: a search hit's line, a task's
 * line, the situation's due tasks and selection, a database's values.
 * Without the runs' record of the versions (older conversations), only the
 * latest turn that carried a note counts, and only while nothing was seen of
 * the note after it — on the side of sending, never of a false "unchanged".
 */
export function sentStamps(
  turns: readonly { role: string; parts: readonly { type: string; context?: readonly string[] }[] }[],
  runs: readonly StampRun[] = [],
): Set<string> {
  // Every view of every note the runs record: where in the conversation (a turn's context, then its tools) and of
  // which version — null where it is not known.
  // Each view also says whether the conversation had chosen to send the note redacted when its run ran — the choice a
  // cloud's context and tools both followed.
  const views = new Map<string, { at: number; version: string | null; redacted: boolean }[]>();
  let unknownAt = -1;
  const view = (path: string, at: number, version: string | null, redacted: boolean) => {
    const seen = { at, version, redacted };
    const list = views.get(path);
    if (list) list.push(seen);
    else views.set(path, [seen]);
  };
  const chose = (run: StampRun | undefined, path: string) => run?.redact?.includes(path) === true;
  const byTurn = new Map<number, StampRun>();
  for (const run of runs) {
    byTurn.set(run.userTurn, run);
    const at = run.userTurn * 2;
    for (const source of run.manifest?.sources ?? []) {
      if (source.tier === "map") {
        if (source.gist) view(source.path, at, null, chose(run, source.path));
      } else if (source.hash && (source.chars > 0 || source.unchanged)) view(source.path, at, source.hash, chose(run, source.path));
    }
    for (const read of run.readHashes ?? []) view(read.path, at + 1, read.hash, chose(run, read.path));
    for (const path of run.readChanged ?? []) view(path, at + 1, null, chose(run, path));
    if (run.readUnhashed) unknownAt = Math.max(unknownAt, at + 1);
  }
  // What the turns carried of each note as evidence: which part (a section by its chain; null, the whole note) under
  // which stamp. The same part carried later with another text — a redaction taken back, less room — is a view that
  // says otherwise, whatever the version.
  const parts = new Map<string, { at: number; part: string | null; stamp: string }[]>();
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    if (turn.role !== "user") continue;
    const sources = byTurn.get(i)?.manifest?.sources ?? [];
    for (const part of turn.parts) {
      if (part.type !== "text" || !part.context) continue;
      for (const stamp of part.context) {
        const path = contextStampPath(stamp);
        const source = sources.find((entry) => entry.path === path && entry.tier === "evidence");
        if (!source) continue;
        const list = parts.get(path);
        const carried = { at: i * 2, part: source.section ?? null, stamp };
        if (list) list.push(carried);
        else parts.set(path, [carried]);
      }
    }
  }
  const out = new Set<string>();
  const later = new Set<string>();
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!;
    if (turn.role !== "user") continue;
    const at = i * 2;
    const sources = byTurn.get(i)?.manifest?.sources ?? [];
    const carried = new Set<string>();
    for (const part of turn.parts) {
      if (part.type !== "text" || !part.context) continue;
      for (const stamp of part.context) {
        const path = contextStampPath(stamp);
        carried.add(path);
        if (unknownAt > at) continue;
        const since = (views.get(path) ?? []).filter((seen) => seen.at >= at);
        const source = sources.find((entry) => entry.path === path && entry.tier === "evidence");
        const version = source?.hash;
        // Every view of the note since the part went — its own among them — has its version, and no later turn carried
        // that part otherwise: nothing says otherwise.
        if (version) {
          const part = source.section ?? null;
          const otherwise = (parts.get(path) ?? []).some((carried) => carried.at > at && carried.part === part && carried.stamp !== stamp);
          // A view since under another choice to redact the note — another part of it, a card of it, a tool's read —
          // showed its words otherwise: a redaction taken back, or made, is no "unchanged" against them.
          const redacted = chose(byTurn.get(i), path);
          if (!otherwise && since.every((seen) => seen.version === version && seen.redacted === redacted)) out.add(stamp);
          continue;
        }
        // Without a record of this turn's version: only the latest turn that carried the note, and nothing seen since.
        if (!later.has(path) && since.length === 0) out.add(stamp);
      }
    }
    for (const path of carried) later.add(path);
  }
  return out;
}

/**
 * What a run recorded of the notes it showed the model, by version (plan
 * KI-Harness P9-2, P9-6): its context's sources and the texts its tools gave
 * — `RunMeta` as the record keeps it.
 */
export interface StampRun {
  userTurn: number;
  manifest?: { sources: readonly { path: string; tier: string; chars: number; section?: string; hash?: string; unchanged?: boolean; gist?: boolean }[] };
  /** The sources the conversation chose to send redacted when the run ran (`RunMeta.redact`). */
  redact?: readonly string[];
  readHashes?: readonly { path: string; hash: string }[];
  readChanged?: readonly string[];
  readUnhashed?: boolean;
}

/** The note a stamp (`path#hash`) stands for: what stands before its last "#" — a path may hold one itself. */
export function contextStampPath(stamp: string): string {
  const cut = stamp.lastIndexOf("#");
  return cut > 0 ? stamp.slice(0, cut) : stamp;
}
