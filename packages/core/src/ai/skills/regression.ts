import { utf8Encode } from "../../crypto/cryptoPrimitives.js";
import type { RunLimits } from "../orchestrator.js";
import { judgeSkillRun, type SkillCheck, type SkillRunTrace, type SkillScenario } from "./harness.js";
import { instructionFileHash } from "./sources.js";

/**
 * The regression run of the skill test harness against a real model (plan
 * KI-Harness P3-8, § 11.7).
 *
 * Started by hand in the skills workshop: every scenario of a skill is one
 * ordinary run of that skill — the same gate, the same send overview, the
 * same tools — judged by `judgeSkillRun`. What a run found is kept on this
 * device, bound to the model that produced it and to the skill's files as
 * they were: a result says nothing about another model or another version,
 * and the workshop says so instead of showing a green mark that has gone
 * stale. The run has a ceiling; it ends between two scenarios once the
 * ceiling is reached, and what did not run is recorded as not run.
 */

/** One scenario of a run, as it is kept: structure only, none of the answer. */
export interface SkillScenarioResult {
  id: string;
  passed: boolean;
  checks: SkillCheck[];
  /** For a scenario that does not apply here: the notes and paths it names that this vault does not have. */
  skipped?: string[];
  /** How the run ended (`RunStop.kind`) — or `not-run` (the ceiling ended the test before it), `not-applicable` (written for another vault). */
  stop: string;
  /** Input and output tokens the scenario used. */
  tokens: number;
  costUsd?: number;
  /** The conversation the run left in the history. */
  conversationId?: string;
}

export const SKILL_TEST_NOT_RUN = "not-run";
export const SKILL_TEST_NOT_APPLICABLE = "not-applicable";

export interface SkillTestRecord {
  /** The instruction source: `plainva:<name>` or the skill's folder. */
  id: string;
  /** The skill's files and scenarios as they were (see `skillTestVersion`). */
  version: string;
  providerId: string;
  model: string;
  /** When (ISO 8601). */
  at: string;
  scenarios: SkillScenarioResult[];
}

export interface SkillTestRecords {
  records: SkillTestRecord[];
}

export const EMPTY_SKILL_TESTS: SkillTestRecords = { records: [] };

/** A scenario is a few steps and a short answer; the skill's own budget narrows this further. */
export const SKILL_TEST_RUN_LIMITS: RunLimits = { maxSteps: 8, maxToolCalls: 12, maxOutputTokens: 6_000 };
/** The ceiling the dialog proposes for a model with a known price. */
export const SKILL_TEST_DEFAULT_COST_USD = 0.5;
/** The ceiling in tokens — the only one for a model without a known price, and a second one for the others. */
export const SKILL_TEST_MAX_TOKENS = 400_000;

const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const CHECK_IDS = ["answered", "required", "forbidden", "cites", "never"] as const;
const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isText).map((s) => s.slice(0, 200)).slice(0, 32) : []);

function readScenarioResult(raw: unknown): SkillScenarioResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isText(r.id) || !isText(r.stop)) return null;
  const checks: SkillCheck[] = [];
  for (const item of Array.isArray(r.checks) ? r.checks : []) {
    const c = (item ?? {}) as Record<string, unknown>;
    const id = CHECK_IDS.find((known) => known === c.id);
    if (!id) continue;
    const missing = names(c.missing);
    checks.push({ id, ok: c.ok === true, ...(missing.length ? { missing } : {}) });
  }
  const skipped = names(r.skipped);
  return {
    id: r.id,
    // A result counts as passed only when it says so and every check it carries agrees.
    passed: r.passed === true && checks.length > 0 && checks.every((c) => c.ok),
    checks,
    ...(skipped.length ? { skipped } : {}),
    stop: r.stop,
    tokens: count(r.tokens),
    ...(typeof r.costUsd === "number" && Number.isFinite(r.costUsd) && r.costUsd >= 0 ? { costUsd: r.costUsd } : {}),
    ...(isText(r.conversationId) ? { conversationId: r.conversationId } : {}),
  };
}

/** The stored results, field by field; what does not read is no result. */
export function readSkillTests(raw: string | null): SkillTestRecords {
  if (raw === null) return EMPTY_SKILL_TESTS;
  let value: { version?: unknown; records?: unknown };
  try {
    value = JSON.parse(raw) as typeof value;
  } catch {
    return EMPTY_SKILL_TESTS;
  }
  if (!value || value.version !== 1 || !Array.isArray(value.records)) return EMPTY_SKILL_TESTS;
  const records: SkillTestRecord[] = [];
  const seen = new Set<string>();
  for (const item of value.records) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (!isText(r.id) || seen.has(r.id) || !isText(r.version) || !isText(r.providerId) || !isText(r.model) || !isText(r.at)) continue;
    const scenarios = (Array.isArray(r.scenarios) ? r.scenarios : []).flatMap((s) => readScenarioResult(s) ?? []);
    if (!scenarios.length) continue;
    seen.add(r.id);
    records.push({ id: r.id, version: r.version, providerId: r.providerId, model: r.model, at: r.at, scenarios });
  }
  return { records };
}

export function serializeSkillTests(tests: SkillTestRecords): string {
  return JSON.stringify({ version: 1, records: tests.records }, null, 2);
}

/** The newest result of a skill replaces the one before it. */
export function recordSkillTest(tests: SkillTestRecords, record: SkillTestRecord): SkillTestRecords {
  return { records: [...tests.records.filter((r) => r.id !== record.id), record] };
}

/** Results of skills that are gone are forgotten. */
export function pruneSkillTests(tests: SkillTestRecords, existing: ReadonlySet<string>): SkillTestRecords {
  const records = tests.records.filter((r) => existing.has(r.id));
  return records.length === tests.records.length ? tests : { records };
}

/**
 * What a result is bound to: every file of the skill with its hash, and the
 * scenario file's text. Changing either makes an older result one about
 * something else.
 */
export function skillTestVersion(files: readonly { path: string; sha256: string }[], scenarios: string): string {
  const listed = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((f) => `${f.path}\n${f.sha256}`);
  return instructionFileHash(utf8Encode([...listed, scenarios].join("\n\n")));
}

/**
 * What of a scenario this vault lacks. A scenario is written against a vault:
 * the ones the app's skills bring ask about notes of the test vault. Where a
 * note the scenario cites or a path its message must reach does not exist,
 * the question itself makes no sense — the scenario is not run there, and it
 * counts neither as passed nor as failed. Empty: the scenario applies.
 */
export function scenarioGaps(scenario: SkillScenario, vault: { hasNote(title: string): boolean; hasPath(path: string): boolean }): string[] {
  return [...(scenario.cites ?? []).filter((title) => !vault.hasNote(title)), ...(scenario.reaches ?? []).filter((path) => !vault.hasPath(path))];
}

/** One scenario's result from what its run did. */
export function scenarioResult(scenario: SkillScenario, trace: SkillRunTrace, run: { tokens: number; costUsd?: number; conversationId?: string }): SkillScenarioResult {
  const verdict = judgeSkillRun(scenario, trace);
  return {
    id: scenario.id,
    passed: verdict.passed,
    checks: verdict.checks,
    stop: trace.stop,
    tokens: run.tokens,
    ...(run.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
    ...(run.conversationId ? { conversationId: run.conversationId } : {}),
  };
}

/** A scenario the ceiling ended the test before. */
export function scenarioNotRun(scenario: SkillScenario): SkillScenarioResult {
  return { id: scenario.id, passed: false, checks: [], stop: SKILL_TEST_NOT_RUN, tokens: 0 };
}

/** A scenario written for another vault: `gaps` names what this one lacks. */
export function scenarioNotApplicable(scenario: SkillScenario, gaps: readonly string[]): SkillScenarioResult {
  return { id: scenario.id, passed: false, checks: [], skipped: [...gaps], stop: SKILL_TEST_NOT_APPLICABLE, tokens: 0 };
}

export interface SkillTestBudget {
  /** Null for a model without a known price: only the token ceiling applies. */
  maxCostUsd: number | null;
  maxTokens: number;
}

/** May another scenario start? The ceiling is checked between scenarios; one scenario is bounded by its run limits. */
export function skillTestBudgetLeft(spent: { tokens: number; costUsd: number }, budget: SkillTestBudget): boolean {
  if (spent.tokens >= budget.maxTokens) return false;
  return budget.maxCostUsd === null || spent.costUsd < budget.maxCostUsd;
}

export type SkillTestState =
  /** Never tested on this device, or its result did not read. */
  | "untested"
  /** Tested as it is now, with the model chosen now. */
  | "current"
  /** Tested with another model: the result says nothing about this one. */
  | "model-changed"
  /** The skill or its scenarios changed since. */
  | "skill-changed";

/** What a stored result still says, given the skill and the model as they are now. */
export function skillTestState(record: SkillTestRecord | undefined, now: { version: string; providerId: string; model: string }): SkillTestState {
  if (!record) return "untested";
  if (record.version !== now.version) return "skill-changed";
  return record.providerId === now.providerId && record.model === now.model ? "current" : "model-changed";
}

export interface SkillTestSummary {
  total: number;
  passed: number;
  failed: number;
  /** The ceiling ended the test before these. */
  notRun: number;
  /** Written for another vault. */
  notApplicable: number;
  tokens: number;
  /** Present when at least one scenario knew its cost. */
  costUsd?: number;
}

export function skillTestSummary(scenarios: readonly SkillScenarioResult[]): SkillTestSummary {
  const notRun = scenarios.filter((s) => s.stop === SKILL_TEST_NOT_RUN).length;
  const notApplicable = scenarios.filter((s) => s.stop === SKILL_TEST_NOT_APPLICABLE).length;
  const ran = scenarios.filter((s) => s.stop !== SKILL_TEST_NOT_RUN && s.stop !== SKILL_TEST_NOT_APPLICABLE);
  const priced = ran.filter((s) => s.costUsd !== undefined);
  return {
    total: scenarios.length,
    passed: ran.filter((s) => s.passed).length,
    failed: ran.filter((s) => !s.passed).length,
    notRun,
    notApplicable,
    tokens: ran.reduce((sum, s) => sum + s.tokens, 0),
    ...(priced.length ? { costUsd: priced.reduce((sum, s) => sum + (s.costUsd ?? 0), 0) } : {}),
  };
}
