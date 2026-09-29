import type { TextPart } from "../conversation.js";
import { CONTEXT_NOTE_LIMIT, contextStamp, withholdDeniedLinks, type ContextPolicyHost } from "../chat.js";
import { gateDecision, isCloudRecipient, type EgressRecipient, type GateDecision, type GateExclusion } from "../egressGate.js";
import { fenceUntrusted, payload } from "../trust.js";
import { mergeCandidates, rankCandidates, urgencySignal, type Candidate, type CandidateSignal, type RankedCandidate } from "./ranking.js";
import { firstLineWith, noteBody, outlineOf, sectionAt } from "./sections.js";
import { withholdPlaces, withoutSensitiveProperties } from "./sensitive.js";
import { questionTerms } from "./terms.js";

/**
 * The context package v1 (plan §9.2): what goes with a message besides the
 * user's words. Built in one pass through the hard gate:
 *
 * - tier 0, the situation: time and the app's "today", the open note or
 *   database, the selection and the section around the cursor, the note's
 *   core properties, open tabs, today's daily note, due tasks, the next
 *   appointments;
 * - tier 3 evidence: a few sections of the best candidates, never a whole
 *   note unless the user pinned it (the open note gets a strong bonus, but is
 *   not sent in full automatically, §7);
 * - tier 1 cards: title, path and why, with the search excerpt;
 * - tier 2 work map: handles of further candidates, for `read_note`.
 *
 * Everything the vault wrote is fenced as data. A note the policy keeps from
 * the recipient is decided on BEFORE ranking and contributes nothing — no
 * title, no path, no excerpt, no link anchor in a neighbour (§8.2).
 */

export type DataClass = "situation" | "notes" | "selection" | "tasks" | "calendar";

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
}

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
  /** Stamps (`path#hash`) the conversation already carries: those sections are named, not repeated. */
  alreadySent?: ReadonlySet<string>;
  /** Notes the user left out in the send overview: not denied, just not wanted for this message. */
  leaveOut?: ReadonlySet<string>;
  budget?: Partial<ContextBudget>;
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
}

export interface ContextPackage {
  /** The part before the user's words; its `context` carries the evidence stamps. */
  part: TextPart;
  refs: PackageRef[];
  /** Kept back by the gate: paths only, shown locally, never sent. */
  excluded: GateExclusion[];
  redactions: { withheldLinks: number; places: number; moodProperties: number };
  dataClasses: DataClass[];
  estimatedTokens: number;
}

const HEADER =
  "Context Plainva adds to this message: the user's situation and notes that may matter. " +
  "When an answer rests on a note, cite it as [[Title]]. read_note gives more of any note listed; nothing here is complete unless it says so.";

const REASON_WORDS: Record<CandidateSignal, string> = {
  active: "open now",
  pinned: "pinned",
  lexical: "matches the question",
  graph: "linked with the open note",
  urgency: "has something due",
  edited: "changed recently",
  opened: "opened recently",
  daily: "today's daily note",
  tab: "open in a tab",
};

/** Rough tokens for a text: about 3.5 characters per token across the app's languages. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
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

export async function buildContextPackage(input: ContextBuildInput, host: ContextBuildHost): Promise<ContextPackage> {
  const budget: ContextBudget = { ...DEFAULT_CONTEXT_BUDGET, ...input.budget };
  const run = { recipient: input.recipient, webTools: false };
  const cloud = isCloudRecipient(input.recipient);
  const situation = input.situation;
  const terms = questionTerms(input.question);
  const redactions = { withheldLinks: 0, places: 0, moodProperties: 0 };
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
  /** What any vault text passes before it goes: place stamps withheld; for a cloud, links to denied notes too. */
  const clean = async (text: string, fromPath: string): Promise<string> => {
    const places = withholdPlaces(text);
    redactions.places += places.withheld;
    if (!cloud) return places.text;
    const links = await withholdDeniedLinks(places.text, fromPath, host.resolveLink, (path) => allowed(path));
    redactions.withheldLinks += links.redacted;
    return links.text;
  };

  // ------------------------------------------------------------ candidates
  const own: Candidate[] = [];
  if (situation.active?.kind === "note") own.push({ path: situation.active.path, title: situation.active.title, signals: { active: 1 } });
  for (const path of input.pins) own.push({ path, title: titleFromPath(path), signals: { pinned: 1 } });
  for (const tab of situation.tabs) own.push({ path: tab.path, title: tab.title, signals: { tab: 1 } });
  if (situation.dailyNote) own.push({ path: situation.dailyNote.path, title: situation.dailyNote.title, signals: { daily: 1 } });
  for (const task of situation.tasks) {
    const urgency = urgencySignal(task.due, situation.calendarDay);
    if (task.path && urgency > 0) own.push({ path: task.path, title: titleFromPath(task.path), signals: { urgency } });
  }
  const merged = mergeCandidates([own, ...input.candidates]).filter((candidate) => !input.leaveOut?.has(candidate.path));

  // The hard gate BEFORE scoring: a denied candidate does not exist for anything below.
  const verdicts = await Promise.all(merged.map((candidate) => allowed(candidate.path)));
  const ranked = rankCandidates(merged.filter((_, i) => verdicts[i]));

  // -------------------------------------------------------------- evidence
  const refs: PackageRef[] = [];
  const blocks: string[] = [];
  const stamps: string[] = [];
  let evidenceChars = 0;
  const missing = new Set<string>();
  const strong = (c: RankedCandidate) => (c.signals.active ?? 0) > 0 || (c.signals.pinned ?? 0) > 0 || (c.signals.lexical ?? 0) >= 0.3;
  for (const candidate of ranked) {
    if (refs.filter((r) => r.tier === "evidence").length >= budget.evidence || evidenceChars >= budget.evidenceChars) break;
    if (!strong(candidate)) continue;
    const read = await host.readNote(candidate.path);
    if (!read) {
      missing.add(candidate.path);
      continue;
    }
    if (!(await allowedText(candidate.path, read.text))) continue;
    const body = noteBody(read.text);
    const room = budget.evidenceChars - evidenceChars;
    let text: string;
    let section: string | undefined;
    let whole = false;
    if ((candidate.signals.pinned ?? 0) > 0) {
      const clipped = clip(body, Math.min(CONTEXT_NOTE_LIMIT, Math.max(room, 4_000)));
      text = clipped.text;
      whole = !clipped.clipped;
    } else if ((candidate.signals.active ?? 0) > 0) {
      const line = firstLineWith(body, terms);
      const outline = outlineOf(body).map((h) => `${"  ".repeat(h.level - 1)}- ${h.text}`);
      if (line >= 0 && body.length > budget.activeChars) {
        const found = sectionAt(body, line);
        section = found.chain;
        text = `${outline.length ? `Sections:\n${outline.join("\n")}\n\n` : ""}${clip(found.text, Math.min(budget.activeChars, room)).text}`;
      } else {
        const clipped = clip(body, Math.min(budget.activeChars, room));
        text = clipped.text;
        whole = !clipped.clipped;
        if (clipped.clipped && outline.length) text = `Sections:\n${outline.join("\n")}\n\n${text}`;
      }
    } else {
      const line = firstLineWith(body, terms);
      const found = sectionAt(body, Math.max(line, 0));
      section = found.chain;
      text = clip(found.text, Math.min(budget.sectionChars, room)).text;
    }
    text = await clean(text, candidate.path);
    const stamp = `${candidate.path}#${contextStamp(text)}`;
    const title = read.title || candidate.title;
    if (input.alreadySent?.has(stamp)) {
      refs.push({ path: candidate.path, title, tier: "evidence", reasons: candidate.reasons, score: candidate.score, chars: 0, section, unchanged: true });
      blocks.push(`[[${title}]] (${candidate.path}): unchanged since it was sent earlier in this conversation.`);
      stamps.push(stamp);
      continue;
    }
    const label = whole ? "the whole note" : section ? `section "${section}"` : "the beginning";
    blocks.push(
      fenceUntrusted(payload(`${title} (${candidate.path}), ${label}:\n\n${text}${whole ? "" : "\n\n[…read_note gives the rest]"}`, { kind: "vault", path: candidate.path, ...(section ? { section } : {}) })),
    );
    stamps.push(stamp);
    evidenceChars += text.length;
    refs.push({ path: candidate.path, title, tier: "evidence", reasons: candidate.reasons, score: candidate.score, chars: text.length, ...(whole ? {} : { section: section ?? "" }) });
  }

  // ---------------------------------------------------------- cards + map
  const inEvidence = new Set(refs.map((r) => r.path));
  // Not what the text check denied, and not what the index still lists but the vault no longer has.
  const rest = ranked.filter((c) => !inEvidence.has(c.path) && !missing.has(c.path) && decisions.get(c.path)?.allowed !== false);
  const cards: string[] = [];
  for (const candidate of rest.slice(0, budget.cards)) {
    const why = candidate.reasons.slice(0, 2).map((r) => REASON_WORDS[r]).join(", ");
    const snippet = candidate.snippet ? (await clean(candidate.snippet, candidate.path)).replace(/\s+/g, " ").trim() : "";
    cards.push(`- [[${candidate.title}]] (${candidate.path}) — ${why}${snippet ? `: ${snippet}` : ""}`);
    refs.push({ path: candidate.path, title: candidate.title, tier: "card", reasons: candidate.reasons, score: candidate.score, chars: snippet.length });
  }
  const map: string[] = [];
  for (const candidate of rest.slice(budget.cards, budget.cards + budget.map)) {
    map.push(`- [[${candidate.title}]] (${candidate.path})`);
    refs.push({ path: candidate.path, title: candidate.title, tier: "map", reasons: candidate.reasons, score: candidate.score, chars: 0 });
  }

  // ------------------------------------------------------------ situation
  const dataClasses = new Set<DataClass>(["situation"]);
  const lines: string[] = [`Now: ${situation.weekday}, ${situation.now}. Today for appointments and due dates: ${situation.calendarDay}; the journal's day: ${situation.journalDay}.`];
  const active = situation.active && !input.leaveOut?.has(situation.active.path) ? situation.active : null;
  if (active && (await allowed(active.path))) {
    lines.push(active.kind === "base" ? `Open: the database [[${active.title}]] (${active.path}) — query_base reads it.` : `Open: [[${active.title}]] (${active.path}).`);
    if (active.heading) lines.push(`The cursor is in the section "${active.heading}".`);
    if (active.selection && active.selection.trim()) {
      const read = await host.readNote(active.path);
      if (!read || (await allowedText(active.path, read.text))) {
        const selection = clip(await clean(active.selection.trim(), active.path), 4_000).text;
        lines.push(`Selected text:\n«${selection}»`);
        dataClasses.add("selection");
      }
    }
    if (active.properties && Object.keys(active.properties).length) {
      const { properties, withheld } = withoutSensitiveProperties(active.properties, situation.moodKey);
      redactions.moodProperties += withheld;
      const shown = Object.entries(properties).slice(0, 12).map(([k, v]) => propertyLine(k, v));
      if (shown.length) lines.push(`Properties of the open note:\n${await clean(shown.join("\n"), active.path)}`);
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
    tasks.push(`- [ ] ${task.title}${due}${task.path ? ` — in [[${titleFromPath(task.path)}]]` : ""}`);
  }
  if (tasks.length) {
    lines.push(`Tasks that are due:\n${await clean(tasks.join("\n"), active?.path ?? "")}`);
    dataClasses.add("tasks");
  }
  const events = situation.events.slice(0, 8).map((e) => `- ${e.allDay ? "all day" : `${e.start}${e.end ? `–${e.end}` : ""}`} ${e.title}${e.calendar ? ` (${e.calendar})` : ""}`);
  if (events.length) {
    lines.push(`Appointments:\n${withholdPlaces(events.join("\n")).text}`);
    dataClasses.add("calendar");
  }
  if (refs.length) dataClasses.add("notes");

  const parts = [HEADER, fenceUntrusted(payload(lines.join("\n\n"), { kind: "app" }))];
  if (blocks.length) parts.push(`Notes:\n\n${blocks.join("\n\n")}`);
  if (cards.length) parts.push(fenceUntrusted(payload(`Also relevant:\n${cards.join("\n")}`, { kind: "app" })));
  if (map.length) parts.push(fenceUntrusted(payload(`Further notes that may matter:\n${map.join("\n")}`, { kind: "app" })));
  const text = parts.join("\n\n");
  return {
    part: { type: "text", text, context: stamps },
    refs,
    excluded,
    redactions,
    dataClasses: [...dataClasses],
    estimatedTokens: estimateTokens(text),
  };
}

/** The evidence stamps a conversation already carries, from every earlier context part. */
export function sentStamps(turns: readonly { role: string; parts: readonly { type: string; context?: readonly string[] }[] }[]): Set<string> {
  const out = new Set<string>();
  for (const turn of turns) {
    if (turn.role !== "user") continue;
    for (const part of turn.parts) if (part.type === "text" && part.context) for (const stamp of part.context) out.add(stamp);
  }
  return out;
}
