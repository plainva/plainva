import { UPKEEP, type InstructionEntry, type MemoryEntry, type UpkeepHint } from "@plainva/core";
import { compareLines, type CompareLine } from "../lib/compareVersions";
import type { AiMemoryState } from "./aiMemory";
import { skillView } from "./aiSkills";
import { skillMayLines, workshopTitle } from "./skillsWorkshop";

/**
 * Upkeep hints as both shells show them (plan KI-Harness P6-3, mockup
 * chapter 22, step 7): each hint as a sentence, why it counts, and the one
 * step it offers. One model, so the desktop's card and the phone's rows
 * cannot drift apart. The hints themselves are the core's arithmetic
 * (`skillUpkeep`, `memoryUpkeep`); nothing here asks a model.
 */

type Translate = (key: string, vars?: Record<string, unknown>) => string;

/** The one step a hint offers. The shells carry it out: each is something the user could do by hand as well. */
export type UpkeepStep =
  | { do: "compare-skills"; a: string; b: string }
  | { do: "switch-off"; id: string; name: string }
  | { do: "open-skill"; id: string }
  | { do: "test"; id: string }
  | { do: "learn"; conversationId: string }
  | { do: "compare-entries"; a: string; b: string }
  | { do: "edit-entry"; id: string };

export interface UpkeepRow {
  key: string;
  kind: UpkeepHint["kind"];
  /** The matter, as a sentence. */
  label: string;
  /** Why it counts, and what the step would do. */
  desc: string;
  step: { label: string; what: UpkeepStep } | null;
}

export interface UpkeepContext {
  entries: readonly InstructionEntry[];
  memory: Pick<AiMemoryState, "active" | "long">;
  language: string;
}

const day = (language: string, value: string): string => {
  // A civil day stands for itself; an instant is shown as the reader's day.
  const date = new Date(/^\d{4}-\d\d-\d\d$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(date);
};
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** A hint as a row; null where what it speaks of is gone in the meantime. */
function rowOf(t: Translate, hint: UpkeepHint, context: UpkeepContext): UpkeepRow | null {
  const entry = (id: string) => context.entries.find((candidate) => candidate.source.id === id) ?? null;
  const memory = (id: string): MemoryEntry | null => [...context.memory.active, ...context.memory.long].find((candidate) => candidate.id === id) ?? null;
  const row = (label: string, desc: string, step: UpkeepRow["step"]): UpkeepRow => ({ key: hint.key, kind: hint.kind, label, desc, step });
  switch (hint.kind) {
    case "skills-alike": {
      const a = entry(hint.a);
      const b = entry(hint.b);
      if (!a || !b) return null;
      return row(t("ai.upkeep.skillsAlike.label", { a: workshopTitle(t, a), b: workshopTitle(t, b) }), t("ai.upkeep.skillsAlike.desc"), {
        label: t("ai.upkeep.skillsAlike.step"),
        what: { do: "compare-skills", a: hint.a, b: hint.b },
      });
    }
    case "skill-unused": {
      const skill = entry(hint.id);
      if (!skill) return null;
      const name = workshopTitle(t, skill);
      const label = hint.last ? t("ai.upkeep.skillUnused.label", { name, date: day(context.language, hint.last) }) : t("ai.upkeep.skillUnused.labelNever", { name, date: day(context.language, hint.approved) });
      return row(label, t("ai.upkeep.skillUnused.desc", { days: UPKEEP.unusedDays }), { label: t("ai.upkeep.skillUnused.step"), what: { do: "switch-off", id: hint.id, name } });
    }
    case "skill-unknown-tool": {
      const skill = entry(hint.id);
      if (!skill) return null;
      return row(t("ai.upkeep.skillUnknownTool.label", { name: workshopTitle(t, skill) }), t("ai.upkeep.skillUnknownTool.desc", { tools: hint.tools.join(" · ") }), {
        label: t("ai.upkeep.skillUnknownTool.step"),
        what: { do: "open-skill", id: hint.id },
      });
    }
    case "skill-test-failing": {
      const skill = entry(hint.id);
      if (!skill) return null;
      return row(t("ai.upkeep.skillTestFailing.label", { name: workshopTitle(t, skill), failed: hint.failed, ran: hint.ran }), t("ai.upkeep.skillTestFailing.desc", { model: hint.model }), {
        label: t("ai.upkeep.skillTestFailing.step"),
        what: { do: "test", id: hint.id },
      });
    }
    case "skill-failing": {
      const skill = entry(hint.id);
      if (!skill) return null;
      const label = t("ai.upkeep.skillFailing.label", { name: workshopTitle(t, skill), failed: hint.failed, runs: hint.runs });
      // A review needs a conversation it may learn a skill from; without one, the step is the user's own look at the file.
      return hint.conversationId
        ? row(label, t("ai.upkeep.skillFailing.descLearn"), { label: t("ai.upkeep.skillFailing.stepLearn"), what: { do: "learn", conversationId: hint.conversationId } })
        : row(label, t("ai.upkeep.skillFailing.desc"), { label: t("ai.upkeep.skillFailing.step"), what: { do: "open-skill", id: hint.id } });
    }
    case "steps-repeated": {
      // The tools in the reader's words: `ai.tool.<name>` (the locale guard reads the keys from this template).
      const tools = hint.tools.map((name) => t(`ai.tool.${name}`, { defaultValue: name })).join(" → ");
      return row(t("ai.upkeep.stepsRepeated.label", { times: hint.times }), t("ai.upkeep.stepsRepeated.desc", { tools }), {
        label: t("ai.upkeep.stepsRepeated.step"),
        what: { do: "learn", conversationId: hint.conversationId },
      });
    }
    case "entries-alike": {
      const a = memory(hint.a);
      const b = memory(hint.b);
      if (!a || !b) return null;
      return row(t("ai.upkeep.entriesAlike.label"), t("ai.upkeep.entriesAlike.desc", { a: clip(a.text, 90), b: clip(b.text, 90) }), {
        label: t("ai.upkeep.entriesAlike.step"),
        what: { do: "compare-entries", a: hint.a, b: hint.b },
      });
    }
    case "entry-old": {
      const found = memory(hint.id);
      if (!found) return null;
      return row(t("ai.upkeep.entryOld.label", { text: clip(found.text, 120) }), t("ai.upkeep.entryOld.desc", { date: day(context.language, hint.added) }), {
        label: t("ai.upkeep.entryOld.step"),
        what: { do: "edit-entry", id: hint.id },
      });
    }
    case "active-overflow":
      return row(t("ai.upkeep.activeOverflow.label", { place: t("ai.memory.active") }), t("ai.upkeep.activeOverflow.desc", { count: hint.left, other: t("ai.memory.long") }), null);
  }
}

/** The hints of one view, as rows, in the order the core gives them. */
export function upkeepRows(t: Translate, hints: readonly UpkeepHint[], context: UpkeepContext): UpkeepRow[] {
  return hints.map((hint) => rowOf(t, hint, context)).filter((row): row is UpkeepRow => row !== null);
}

/** A card's or a group's name with how many hints it holds — "Tidy up · 3"; the name alone while it holds none. */
export function upkeepTitle(t: Translate, count: number): string {
  return count > 0 ? `${t("ai.upkeep.title")} · ${count}` : t("ai.upkeep.title");
}

/** One of the two skills a comparison shows. */
export interface SkillCompareSide {
  id: string;
  title: string;
  /** What it is for: the sentence the AI picks it by. */
  description: string;
  /** What it may do, in words. */
  may: string[];
}

export interface SkillCompareFacts {
  title: string;
  sides: [SkillCompareSide, SkillCompareSide];
  /** The second skill's instructions against the first's; null where they are the same or cannot be compared line by line. */
  lines: CompareLine[] | null;
  same: boolean;
  /** The second skill's instructions whole: what is shown where no comparison can be drawn. */
  fallback: string;
}

/**
 * Two skills that say almost the same, side by side (plan P6-3): what each
 * is for, what each may do, and their instructions line against line. Null
 * once the two are no longer both in force — then there is nothing to choose.
 */
export function skillCompareFacts(t: Translate, a: InstructionEntry | null, b: InstructionEntry | null, language: string): SkillCompareFacts | null {
  if (!a?.source.skill || !b?.source.skill || a.status !== "active" || b.status !== "active") return null;
  const side = (entry: InstructionEntry): SkillCompareSide => ({
    id: entry.source.id,
    title: workshopTitle(t, entry),
    description: skillView(t, entry).description,
    may: skillMayLines(t, entry.source.skill!, language),
  });
  const first = a.source.skill.body.trim();
  const second = b.source.skill.body.trim();
  const same = first === second;
  return {
    title: t("ai.upkeep.compare.title", { a: workshopTitle(t, a), b: workshopTitle(t, b) }),
    sides: [side(a), side(b)],
    lines: same ? null : compareLines(first, second),
    same,
    fallback: second,
  };
}
