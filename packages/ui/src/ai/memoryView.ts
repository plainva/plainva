import { MEMORY_LIMITS, type AiPolicyDimension, type MemoryEntry, type MemoryPlace } from "@plainva/core";
import type { AiMemoryState } from "./aiMemory";

/**
 * The memory as both shells show it (plan KI-Harness P6, mockup chapter 22):
 * which rows stand in which group and what each says of itself. One model,
 * so the desktop's cards and the phone's rows cannot drift apart.
 */

type Translate = (key: string, vars?: Record<string, unknown>) => string;

export interface MemoryRow {
  id: string;
  place: MemoryPlace;
  /** The entry's text, as a model gets it. */
  text: string;
  /** Who added it and when, and what it rests on — one line. */
  description: string;
  /** What a reader has to know about where it goes: a rule it carries, or why it goes nowhere. */
  marks: { kind: "rule" | "problem"; text: string }[];
  /** It reaches no model as it stands. */
  blocked: boolean;
}

export interface MemoryGroups {
  active: MemoryRow[];
  long: MemoryRow[];
  /** "620 of 2,000 characters". */
  budget: string;
  /** How full "always included" is, 0–1. */
  fill: number;
  /** Characters still free for an entry of "always included". */
  left: number;
}

/** A civil day in the reader's language; the raw text where it is none. */
function dayText(day: string | null, language: string): string | null {
  if (!day) return null;
  const date = new Date(`${day}T12:00:00`);
  return Number.isNaN(date.getTime()) ? day : new Intl.DateTimeFormat(language, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

/** Who added an entry and when, and what it rests on. */
export function memoryDescription(t: Translate, entry: MemoryEntry, language: string): string {
  const day = dayText(entry.added, language);
  const who =
    entry.by === "assistant"
      ? day
        ? t("ai.memory.by.assistantOn", { day })
        : t("ai.memory.by.assistant")
      : entry.by === "user"
        ? day
          ? t("ai.memory.by.userOn", { day })
          : t("ai.memory.by.user")
        : day
          ? t("ai.memory.by.fileOn", { day })
          : t("ai.memory.by.file");
  return entry.source ? `${who} · ${t("ai.memory.by.source", { source: entry.source })}` : who;
}

function rowOf(t: Translate, entry: MemoryEntry, language: string, over: ReadonlySet<string>): MemoryRow {
  const marks: MemoryRow["marks"] = [];
  if (entry.unreadable) marks.push({ kind: "problem", text: t("ai.memory.mark.unreadable") });
  // The rule in words: `ai.memory.mark.cloud`, `ai.memory.mark.web` (the locale guard reads the keys from this template).
  else for (const rule of entry.deny as readonly AiPolicyDimension[]) marks.push({ kind: "rule", text: t(`ai.memory.mark.${rule}`) });
  if (entry.tooLong) marks.push({ kind: "problem", text: t("ai.memory.mark.tooLong", { limit: MEMORY_LIMITS.entryChars }) });
  else if (over.has(entry.id)) marks.push({ kind: "problem", text: t("ai.memory.mark.over") });
  if (entry.hidden > 0) marks.push({ kind: "problem", text: t("ai.memory.mark.hidden", { count: entry.hidden }) });
  return { id: entry.id, place: entry.place, text: entry.text, description: memoryDescription(t, entry, language), marks, blocked: entry.unreadable || entry.tooLong || over.has(entry.id) };
}

export function memoryGroups(t: Translate, state: Pick<AiMemoryState, "active" | "long" | "budget">, language: string): MemoryGroups {
  const number = new Intl.NumberFormat(language);
  const over = new Set(state.budget.over);
  return {
    active: state.active.map((entry) => rowOf(t, entry, language, over)),
    long: state.long.map((entry) => rowOf(t, entry, language, new Set())),
    budget: t("ai.memory.budget", { used: number.format(state.budget.used), limit: number.format(state.budget.limit) }),
    fill: state.budget.limit > 0 ? Math.min(1, state.budget.used / state.budget.limit) : 0,
    left: Math.max(0, state.budget.limit - state.budget.used),
  };
}

/** The rows of "on demand" that hold every word of what was typed, in the file's order; all of them for nothing typed. */
export function filterMemoryRows(rows: readonly MemoryRow[], query: string): MemoryRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...rows];
  return rows.filter((row) => {
    const hay = `${row.text} ${row.description}`.toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

/** More rows of "on demand" than this bring a search field. */
export const MEMORY_SEARCH_FROM = 8;

export type MemoryProblem = "no-vault" | "unavailable" | "empty" | "too-long" | "lines" | "duplicate" | "gone" | "write-failed";

/** Why an entry was not written, in the reader's words. */
export function memoryProblemText(t: Translate, problem: MemoryProblem): string {
  switch (problem) {
    case "empty":
      return t("ai.memory.problem.empty");
    case "too-long":
      return t("ai.memory.problem.tooLong", { limit: MEMORY_LIMITS.entryChars });
    case "lines":
      return t("ai.memory.problem.lines");
    case "duplicate":
      return t("ai.memory.problem.duplicate");
    case "gone":
      return t("ai.memory.problem.gone");
    case "no-vault":
    case "unavailable":
    case "write-failed":
      return t("ai.memory.problem.failed");
  }
}

/** The one line the vault's settings say about the memory. */
export function memorySummary(t: Translate, state: Pick<AiMemoryState, "active" | "long" | "on" | "available">): string {
  if (!state.available) return t("ai.memory.unavailable");
  if (!state.on) return t("ai.memory.offShort");
  if (state.active.length + state.long.length === 0) return t("ai.memory.none");
  return t("ai.memory.summary", { active: state.active.length, long: state.long.length });
}
