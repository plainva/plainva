import { estimateTokens, nameOf, parseSkillFile, sameGrant, serializeSkillFile, SKILL_FILE, type InstructionEntry, type ModelFailure, type SkillTestRecord, type WriteDraft } from "@plainva/core";
import { compareLines, type CompareLine } from "../lib/compareVersions";
import { canRewriteSkill, type LearnOutcome, type LearnPlan, type LearnRefusal } from "./aiLearn";
import type { SkillRestoreOutcome, SkillTestPlan } from "./aiSession";
import { aiFailureText } from "./aiSettingsModel";
import { approvalFacts, grantChangeLines, skillGrantChanges, skillMayLines, skillTestNote } from "./skillsWorkshop";

/**
 * Learning, in words (plan KI-Harness P6-2, mockup chapter 22): one model for
 * both shells — what the dialog says before a review, what it says after
 * one, what a skill's draft would change, what a version under observation
 * shows, and what going back to an earlier version means. The desktop
 * renders these in a `Modal`, the phone in a sheet; neither decides anything
 * of its own.
 */

type Translate = (key: string, vars?: Record<string, unknown>) => string;

const numberOf = (language: string) => new Intl.NumberFormat(language);
const moneyOf = (language: string) => new Intl.NumberFormat(language, { style: "currency", currency: "USD", maximumFractionDigits: 4 });
const dateTime = (language: string, value: number | string) => new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

/** What the dialog shows before a review is asked for. */
export interface LearnPlanFacts {
  /** Where the conversation goes: the provider and the model, or the model on this device. */
  recipient: string;
  /** What goes, one line each — and, last, what does not. */
  goes: string[];
  /** The kinds of proposal that can come back, in words. */
  comes: string[];
  /** Why not every kind: one sentence each. */
  limits: string[];
  estimate: string;
}

export function learnPlanFacts(t: Translate, plan: LearnPlan, language: string): LearnPlanFacts {
  const tokens = numberOf(language).format(plan.tokens);
  return {
    recipient: plan.local ? t("ai.learn.ask.local", { model: plan.model }) : `${plan.provider} · ${plan.model}`,
    goes: [
      t("ai.learn.ask.messages", { count: plan.messages }),
      ...(plan.omitted > 0 ? [t("ai.learn.ask.omitted", { count: plan.omitted })] : []),
      ...(plan.skills.length ? [t("ai.learn.ask.skills", { names: plan.skills.join(", ") })] : []),
      t("ai.learn.ask.notSent"),
    ],
    comes: plan.kinds.map((kind) => t(`ai.learn.kind.${kind}`)),
    limits: plan.limits.map((limit) => t(`ai.learn.limit.${limit}`)),
    estimate: plan.costUsd !== undefined ? t("ai.learn.ask.estimateCost", { tokens, cost: moneyOf(language).format(plan.costUsd) }) : t("ai.learn.ask.estimate", { tokens }),
  };
}

/** Why a review did not happen, in one sentence. */
export function learnRefusalText(t: Translate, refusal: { reason: LearnRefusal; failure?: ModelFailure; provider?: string }): string {
  if (refusal.reason === "failed" && refusal.failure) return aiFailureText(t, refusal.failure, refusal.provider ?? "");
  return t(`ai.learn.refused.${refusal.reason}`);
}

/** What the dialog shows once a review came back. */
export interface LearnResultFacts {
  lead: string;
  /** What did not become a draft, and why the list may be short: one sentence each. */
  notes: string[];
  usage: string;
}

export function learnResultFacts(t: Translate, outcome: Extract<LearnOutcome, { kind: "learned" }>, language: string): LearnResultFacts {
  const number = numberOf(language);
  const used = { sent: number.format(outcome.usage.inputTokens), received: number.format(outcome.usage.outputTokens) };
  return {
    lead: t("ai.learn.result.lead", { model: outcome.model }),
    notes: [
      ...outcome.limits.map((limit) => t(`ai.learn.limit.${limit}`)),
      ...(outcome.known > 0 ? [t("ai.learn.result.known", { count: outcome.known })] : []),
      ...(outcome.dropped > 0 ? [t("ai.learn.result.dropped", { count: outcome.dropped })] : []),
      ...(outcome.full ? [t("ai.learn.result.full")] : []),
    ],
    usage: outcome.costUsd !== undefined ? t("ai.learn.result.usageCost", { ...used, cost: moneyOf(language).format(outcome.costUsd) }) : t("ai.learn.result.usage", used),
  };
}

// --- a skill's draft ---------------------------------------------------------

/** What a skill's draft is called on its card and in the review. */
export function skillDraftTitle(t: Translate, draft: WriteDraft): string {
  const body = draft.body;
  if (body.kind !== "skill") return draft.title;
  return t(body.change ? "ai.learn.draft.changed" : "ai.learn.draft.new", { name: body.name });
}

/** What the review of a skill's draft shows (mockup chapter 22, step 5). */
export interface SkillDraftFacts {
  title: string;
  /** Other instructions for a skill that is there; false for a new skill. */
  change: boolean;
  /** The instructions in force, for the comparison with what is proposed or reworked; null for a new skill. */
  current: string | null;
  /** The instructions as proposed: what "Rework" starts from, and what a new skill shows whole. */
  body: string;
  /** A new skill: what it is for. */
  description: string | null;
  /** For other instructions: the one word that says what the skill may do does not change. Null for a new skill. */
  unchanged: string | null;
  /** What it may do, one line each — for a change, what the skill may do now and will after. */
  may: string[];
  /** The sentence under those lines: why a proposal cannot change them. */
  mayNote: string;
  /** What its last check says, and that the new version is unchecked; empty where the skill has no scenarios. */
  tested: string[];
  origin: string[];
  /** The one sentence of evidence the proposal came with. */
  why: string | null;
  hint: string;
  /** Why it cannot be taken over as it stands; null when it can. */
  blocked: string | null;
}

export interface SkillDraftContext {
  entries: readonly InstructionEntry[];
  records: readonly SkillTestRecord[];
  plan: SkillTestPlan | null;
  /** What the conversation it came from is called; null where that is not known any more. */
  conversation: string | null;
  /** Who proposed it, as the user knows them. */
  author: string;
}

export function skillDraftFacts(t: Translate, draft: WriteDraft, context: SkillDraftContext, language: string): SkillDraftFacts | null {
  const body = draft.body;
  if (body.kind !== "skill") return null;
  const when = dateTime(language, draft.createdAt);
  const origin = [context.conversation ? t("ai.learn.review.proposedBy", { author: context.author, when, conversation: context.conversation }) : t("ai.learn.review.proposedByBare", { author: context.author, when })];

  if (body.change === null) {
    // A new skill as it would be written: the app's defaults, and nothing of the proposal beyond its three texts.
    const made = parseSkillFile(serializeSkillFile({ name: body.name, description: body.description, body: body.body, metadata: { "plainva.version": "1" } }), body.name).skill;
    return {
      title: t("ai.learn.review.titleNew", { name: body.name }),
      change: false,
      current: null,
      body: body.body,
      description: body.description,
      unchanged: null,
      may: made ? skillMayLines(t, made, language) : [],
      mayNote: t("ai.learn.review.rightsNew"),
      tested: [],
      origin,
      why: draft.why ?? null,
      hint: t("ai.learn.review.hintNew"),
      blocked: context.entries.some((candidate) => candidate.source.kind === "skill" && nameOf(candidate.source) === body.name) ? t("ai.learn.draftRefused.exists") : null,
    };
  }

  const change = body.change;
  const entry = context.entries.find((candidate) => candidate.source.id === change.id) ?? null;
  const current = entry?.source.skill ?? null;
  const main = entry?.source.files.find((file) => file.path === SKILL_FILE);
  const blocked = !entry || !current ? t("ai.learn.draftRefused.gone") : !canRewriteSkill(entry) || main?.sha256 !== change.base ? t("ai.learn.draftRefused.changed") : null;
  const tested = entry ? skillTestNote(t, context.records.find((record) => record.id === entry.source.id), context.plan) : null;
  const hasScenarios = tested !== null || Boolean(context.plan?.targets.find((target) => target.id === change.id && target.scenarios > 0));
  return {
    title: t("ai.learn.review.titleChange", { name: body.name }),
    change: true,
    current: current?.body ?? null,
    body: body.body,
    description: null,
    unchanged: t("ai.learn.review.rightsSame"),
    may: entry ? approvalFacts(t, entry, language).may : [],
    mayNote: t("ai.learn.review.rightsNote"),
    tested: hasScenarios ? [...(tested ? [t("ai.learn.review.testedNow", { note: tested })] : []), t("ai.learn.review.untested", { check: t("ai.workshop.test.open") })] : [],
    origin,
    why: draft.why ?? null,
    hint: t("ai.learn.review.hintChange", { versions: t("ai.learn.versions.action") }),
    blocked,
  };
}

/** What changes if the instructions are taken over as they stand in the review — proposed, or reworked there: the lines, and what a run costs more or less. */
export function skillDraftChange(t: Translate, facts: SkillDraftFacts, body: string, language: string): { lines: CompareLine[] | null; cost: string } {
  const number = numberOf(language);
  const tokens = estimateTokens(body);
  if (facts.current === null) return { lines: null, cost: t("ai.learn.review.costNew", { tokens: number.format(tokens) }) };
  const delta = tokens - estimateTokens(facts.current);
  return {
    lines: compareLines(facts.current, body),
    cost: Math.abs(delta) < 5 ? t("ai.learn.review.costSame") : t(delta > 0 ? "ai.learn.review.costMore" : "ai.learn.review.costLess", { tokens: number.format(Math.abs(delta)) }),
  };
}

/** Why "Take over" on a skill's draft did not happen, in one sentence; null for a reason the card's own words cover. */
export function skillDraftRefusalText(t: Translate, reason: string): string | null {
  return reason === "changed" || reason === "invalid" || reason === "gone" || reason === "exists" ? t(`ai.learn.draftRefused.${reason}`) : null;
}

// --- a version under observation ---------------------------------------------

/** The skills whose watched version had a run that failed: what the workshop offers the way back for. */
export function observedFailures(t: Translate, entries: readonly InstructionEntry[]): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  for (const entry of entries) {
    const watch = entry.approval?.observe;
    if (!watch || watch.failed === 0) continue;
    out.push({ id: entry.source.id, text: t("ai.learn.watch.failed", { name: entry.source.skill?.plainva.title || nameOf(entry.source), failed: watch.failed, runs: watch.runs }) });
  }
  return out;
}

/** Why going back did not happen, in one sentence. */
export function skillRestoreRefusalText(t: Translate, outcome: Extract<SkillRestoreOutcome, { ok: false }>): string {
  return t(`ai.learn.restoreRefused.${outcome.reason}`);
}

// --- earlier versions --------------------------------------------------------

/** What the dialog shows about one earlier version, against the skill as it is now (mockup chapter 22, step 8). */
export interface SkillVersionFacts {
  /** The lines that would change by going back; null where there is nothing to compare — `same` says whether that is because both read the same. */
  changes: CompareLine[] | null;
  same: boolean;
  /** What going back would change in what the skill may do, one line each; empty where nothing. */
  rights: string[];
  /** The version may do more than the skill does now. */
  widened: boolean;
  /** Why this version cannot be restored; null when it can. */
  blocked: string | null;
}

export function skillVersionFacts(t: Translate, entry: InstructionEntry, version: string, language: string): SkillVersionFacts {
  const current = entry.source.text ?? "";
  const folder = entry.source.root.slice(entry.source.root.lastIndexOf("/") + 1);
  const parsed = parseSkillFile(version, folder);
  const now = entry.source.skill;
  const changes = parsed.skill && now ? skillGrantChanges(now, parsed.skill) : null;
  // What the session will check again before it writes: a skill of this folder, as the format defines it, with instructions.
  const usable = Boolean(parsed.skill?.body.trim()) && parsed.problems.every((problem) => problem.code === "plainva-value");
  return {
    changes: version === current ? null : compareLines(current, version),
    same: version === current,
    rights: changes && !sameGrant(changes) ? grantChangeLines(t, changes, language) : [],
    widened: Boolean(changes?.widened),
    blocked: usable ? null : t("ai.learn.restoreRefused.invalid"),
  };
}

/** A version's row in the list: when it was kept — to the second, since a version that is accepted and taken back is kept twice within a minute. */
export function skillVersionLabel(t: Translate, at: number, language: string): string {
  return t("ai.learn.versions.at", { when: new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(at)) });
}
