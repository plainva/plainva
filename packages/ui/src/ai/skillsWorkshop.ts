import {
  blockingProblems,
  nameOf,
  SKILL_TEST_MAX_TOKENS,
  SKILL_TEST_NOT_APPLICABLE,
  SKILL_TEST_NOT_RUN,
  skillGrant,
  skillTestState,
  skillTestSummary,
  toolByName,
  type InstructionEntry,
  type InstructionStatus,
  type SkillCheck,
  type SkillImport,
  type SkillProblem,
  type SkillScenarioResult,
  type SkillTestRecord,
} from "@plainva/core";
import { compareLines, type CompareLine } from "../lib/compareVersions";
import { appSkillOf } from "./appSkills";
import type { SkillTestOutcome, SkillTestPlan } from "./aiSession";
import { aiFailureText } from "./aiSettingsModel";
import { skillView } from "./aiSkills";
import { CHAT_TOOL_NAMES } from "./vaultTools";

/**
 * The skills workshop (plan KI-Harness P3-5, mockup chapter 12): one model
 * for both shells — which list a source stands in, and what the approval
 * dialog says about it, in words. The desktop renders it in the AI tab and a
 * `Modal`, the phone in the AI screen and a sheet; neither decides anything
 * of its own.
 */

type Translate = (key: string, vars?: Record<string, unknown>) => string;

export interface WorkshopSections {
  /** From the vault, waiting on this device: arrived or changed, or not runnable at all (invalid, too large). */
  waiting: InstructionEntry[];
  /** The vault's own skills, approved here — on or switched off. */
  own: InstructionEntry[];
  /** The skills that come with the app. */
  app: InstructionEntry[];
  /** The vault's AGENTS.md once approved here (waiting, it stands in `waiting`). */
  agents: InstructionEntry | null;
}

const WAITING: ReadonlySet<InstructionStatus> = new Set(["new", "changed", "invalid", "too-large"]);

export function workshopSections(entries: readonly InstructionEntry[]): WorkshopSections {
  const vault = entries.filter((e) => e.source.origin === "vault");
  return {
    waiting: vault.filter((e) => WAITING.has(e.status)),
    own: vault.filter((e) => e.source.kind === "skill" && !WAITING.has(e.status)),
    app: entries.filter((e) => e.source.origin === "plainva"),
    agents: vault.find((e) => e.source.kind === "agents" && !WAITING.has(e.status)) ?? null,
  };
}

/** The count a settings row or a badge shows: what waits for the user. */
export const waitingCount = (entries: readonly InstructionEntry[]): number => entries.filter((e) => e.source.origin === "vault" && (e.status === "new" || e.status === "changed")).length;

export interface ApprovalFacts {
  title: string;
  status: InstructionStatus;
  /** What it may do, in words — one line each. */
  may: string[];
  /** A changed source: its lines since the approved version; null when there is nothing to compare. */
  changes: CompareLine[] | null;
  /** Its instructions as they are now, for a new one (and on request). */
  text: string | null;
  files: { path: string; size: string }[];
  /** Where it lies and what this device knows about it. */
  origin: string[];
  /** What the user should know before approving; empty when nothing. */
  warnings: string[];
  /** The format's problems, in words; a source with any cannot be approved. */
  problems: string[];
  canApprove: boolean;
  /** Path → SHA-256 of every file shown: exactly what an approval binds. */
  seen: Record<string, string>;
}


function size(bytes: number, language: string): string {
  const unit = bytes >= 1024 ? "KB" : "B";
  const value = bytes >= 1024 ? bytes / 1024 : bytes;
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value)} ${unit}`;
}

export function problemText(t: Translate, problem: SkillProblem): string {
  return t(`ai.workshop.problem.${problem.code}`, { detail: problem.detail ?? "" });
}

export function approvalFacts(t: Translate, entry: InstructionEntry, language: string): ApprovalFacts {
  const { source, approval } = entry;
  const app = appSkillOf(source.id);
  const skill = source.skill;
  const title = app ? t(`ai.skills.${app.key}.title`) : source.kind === "agents" ? "AGENTS.md" : skill?.plainva.title || nameOf(source);

  const may: string[] = [];
  if (source.kind === "agents") {
    may.push(t("ai.workshop.mayAgents"));
  } else if (skill) {
    // The tools a conversation carries are the upper bound; the skill can only narrow them.
    const grant = skillGrant(skill, CHAT_TOOL_NAMES);
    may.push(grant.tools.length ? t("ai.workshop.mayTools", { tools: grant.tools.map((name) => t(`ai.tool.${name}`, { defaultValue: name })).join(" · ") }) : t("ai.workshop.mayNoTools"));
    may.push(grant.folders ? t("ai.workshop.mayFolders", { folders: grant.folders.join(", ") || "—" }) : t("ai.workshop.mayWholeVault"));
    if (grant.maxOutputTokens !== null) may.push(t("ai.workshop.mayBudget", { tokens: new Intl.NumberFormat(language).format(grant.maxOutputTokens) }));
    // Every tool before P5 reads or shows: nothing a skill could do changes the vault or reaches outside.
    if (grant.tools.every((name) => toolByName(name)?.risk === "read" || toolByName(name)?.risk === "ui")) may.push(t("ai.workshop.mayReadOnly"));
  }

  const changes = entry.status === "changed" && approval?.text !== undefined && source.text !== null ? compareLines(approval.text, source.text) : null;

  const origin: string[] = [];
  if (app) origin.push(t("ai.workshop.originApp"));
  else {
    origin.push(t("ai.workshop.originPath", { path: source.root || source.id }));
    if (approval) {
      const when = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(approval.at));
      origin.push(t(`ai.workshop.approvedHow.${approval.how}`, { when }));
      if (approval.from) origin.push(t("ai.workshop.importedFrom", { label: approval.from.label }));
    } else {
      origin.push(t("ai.workshop.neverApproved"));
    }
  }

  const warnings: string[] = [];
  if (source.tooLarge) warnings.push(t("ai.workshop.tooLarge"));
  if (source.invisible) warnings.push(t("ai.workshop.invisible", { count: source.invisible }));
  const unknown = (skill?.allowedTools ?? []).filter((name) => !toolByName(name));
  if (unknown.length) warnings.push(t("ai.workshop.unknownTools", { tools: unknown.join(", ") }));
  const scripts = source.files.filter((f) => f.path.startsWith("scripts/")).map((f) => f.path);
  if (scripts.length) warnings.push(t("ai.workshop.scripts", { count: scripts.length }));

  const problems = blockingProblems(source.problems).map((p) => problemText(t, p));
  return {
    title,
    status: entry.status,
    may,
    changes,
    text: source.text,
    files: source.files.map((f) => ({ path: f.path, size: size(f.bytes, language) })),
    origin,
    warnings,
    problems,
    canApprove: source.origin === "vault" && !source.tooLarge && problems.length === 0 && (entry.status === "new" || entry.status === "changed"),
    seen: Object.fromEntries(source.files.map((f) => [f.path, f.sha256])),
  };
}

// --- the regression run (plan KI-Harness P3-8, mockup chapter 12) ---------------------------

/** What the dialog says before a regression run starts. */
export interface SkillTestFacts {
  /** "Provider · model": what the scenarios run against. */
  model: string;
  /** How many scenarios of how many skills would run — or why none would. */
  scope: string;
  /** Scenarios written for another vault, in a sentence; null when all apply here. */
  elsewhere: string | null;
  /** The ceiling in words where the user sets no amount (no known price, or a model on this device); null otherwise. */
  ceiling: string | null;
  canRun: boolean;
}

/**
 * The plan for some of the skills — what the dialog shows when it was opened
 * from one skill's row. `ids` null means all of them. Derived from the plan
 * the workshop already holds, so the dialog opens with its facts in place
 * instead of reading them a second time.
 */
export function skillTestPlanFor(plan: SkillTestPlan | null, ids: readonly string[] | null): SkillTestPlan | null {
  if (!plan || !ids) return plan;
  const targets = plan.targets.filter((target) => ids.includes(target.id));
  return { ...plan, targets, total: targets.reduce((sum, target) => sum + target.scenarios, 0) };
}

export function skillTestFacts(t: Translate, plan: SkillTestPlan, language: string): SkillTestFacts {
  const skills = plan.targets.filter((target) => target.scenarios > 0).length;
  const elsewhere = plan.targets.reduce((sum, target) => sum + target.notApplicable, 0);
  return {
    model: `${plan.providerLabel} · ${plan.choice.model}`,
    scope:
      plan.total > 0
        ? t("ai.workshop.test.scope", { scenarios: t("ai.workshop.test.scenarios", { count: plan.total }), skills: t("ai.workshop.test.skillsCount", { count: skills }) })
        : t("ai.workshop.test.nothing"),
    elsewhere: elsewhere > 0 ? t("ai.workshop.test.elsewhere", { count: elsewhere }) : null,
    ceiling: plan.local ? t("ai.workshop.test.ceilingLocal") : plan.priced ? null : t("ai.workshop.test.ceilingTokens", { tokens: new Intl.NumberFormat(language).format(SKILL_TEST_MAX_TOKENS) }),
    canRun: plan.total > 0,
  };
}

/**
 * What a skill's row says about its last regression run: how it went while
 * the result still says something, and otherwise why it no longer does — a
 * result is about one model and one version of the skill. Null when the
 * skill was never tested on this device, or while the plan is not read yet.
 */
export function skillTestNote(t: Translate, record: SkillTestRecord | undefined, plan: SkillTestPlan | null): string | null {
  const target = plan?.targets.find((candidate) => candidate.id === record?.id);
  if (!record || !plan || !target) return null;
  const state = skillTestState(record, { version: target.version, providerId: plan.choice.providerId, model: plan.choice.model });
  if (state === "skill-changed") return t("ai.workshop.test.row.skill-changed");
  if (state === "model-changed") return t("ai.workshop.test.row.model-changed", { model: record.model });
  const summary = skillTestSummary(record.scenarios);
  return t("ai.workshop.test.row.current", { passed: summary.passed, total: summary.passed + summary.failed });
}

/**
 * A row's second line in the workshop: its state where it is not simply
 * active, what its last regression run found, then what it is for. In that
 * order — the phone's row shows one line and cuts off its end, and what the
 * skill is for is the part a reader already knows.
 */
export function skillRowDescription(t: Translate, entry: InstructionEntry, records: readonly SkillTestRecord[], plan: SkillTestPlan | null): string {
  const about = entry.source.kind === "agents" ? t("ai.workshop.mayAgents") : skillView(t, entry).description;
  const status = entry.status === "active" ? null : t(`ai.workshop.status.${entry.status}`);
  const tested = skillTestNote(t, records.find((record) => record.id === entry.source.id), plan);
  return [status, tested, about].filter(Boolean).join(" · ");
}

/** The workshop's line about the regression runs, and the hint once another model is chosen. */
export function skillTestOverview(t: Translate, records: readonly SkillTestRecord[], plan: SkillTestPlan | null, language: string): { summary: string; hint: string | null } {
  if (!records.length) return { summary: t("ai.workshop.test.never"), hint: null };
  const newest = records.reduce((a, b) => (a.at >= b.at ? a : b));
  const all = skillTestSummary(records.flatMap((record) => record.scenarios));
  const when = new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(newest.at));
  const other = plan ? records.filter((record) => record.providerId !== plan.choice.providerId || record.model !== plan.choice.model).length : 0;
  return {
    summary: t("ai.workshop.test.last", { when, passed: all.passed, total: all.passed + all.failed }),
    hint: plan && other > 0 ? t("ai.workshop.test.modelChanged", { model: plan.choice.model, count: other }) : null,
  };
}

export interface SkillTestLine {
  id: string;
  mark: "pass" | "fail" | "skip";
  /** The scenario and, where it did not pass, why — in words. */
  text: string;
}

export interface SkillTestGroup {
  id: string;
  title: string;
  /** When, with which model, and what it used. */
  note: string;
  lines: SkillTestLine[];
}

function checkText(t: Translate, check: SkillCheck): string {
  const tools = (check.missing ?? []).map((name) => t(`ai.tool.${name}`, { defaultValue: name })).join(", ");
  switch (check.id) {
    case "answered":
      return t("ai.workshop.test.check.answered");
    case "required":
      return t("ai.workshop.test.check.required", { names: tools });
    case "forbidden":
      return t("ai.workshop.test.check.forbidden", { names: tools });
    case "cites":
      return t("ai.workshop.test.check.cites", { names: (check.missing ?? []).map((title) => `[[${title}]]`).join(", ") });
    case "never":
      // Counted, never repeated: what must not appear is not shown a second time.
      return t("ai.workshop.test.check.never", { count: check.missing?.length ?? 1 });
  }
}

function scenarioLine(t: Translate, result: SkillScenarioResult): SkillTestLine {
  if (result.stop === SKILL_TEST_NOT_RUN) return { id: result.id, mark: "skip", text: t("ai.workshop.test.notRun") };
  if (result.stop === SKILL_TEST_NOT_APPLICABLE) return { id: result.id, mark: "skip", text: t("ai.workshop.test.notApplicable", { names: (result.skipped ?? []).join(", ") }) };
  if (result.passed) return { id: result.id, mark: "pass", text: t("ai.workshop.test.pass") };
  return { id: result.id, mark: "fail", text: result.checks.filter((check) => !check.ok).map((check) => checkText(t, check)).join(" · ") };
}

/** The results the dialog lists: per skill, in the order of the lists, each scenario with its verdict in words. */
export function skillTestGroups(t: Translate, entries: readonly InstructionEntry[], records: readonly SkillTestRecord[], ids: readonly string[] | null, language: string): SkillTestGroup[] {
  const number = new Intl.NumberFormat(language);
  const money = new Intl.NumberFormat(language, { style: "currency", currency: "USD", maximumFractionDigits: 4 });
  const groups: SkillTestGroup[] = [];
  for (const entry of entries) {
    const record = records.find((candidate) => candidate.id === entry.source.id);
    if (!record || (ids && !ids.includes(record.id))) continue;
    const app = appSkillOf(record.id);
    const summary = skillTestSummary(record.scenarios);
    const when = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(record.at));
    const used = summary.costUsd !== undefined ? t("ai.workshop.test.cost", { cost: money.format(summary.costUsd), tokens: number.format(summary.tokens) }) : t("ai.workshop.test.tokens", { tokens: number.format(summary.tokens) });
    groups.push({
      id: record.id,
      title: app ? t(`ai.skills.${app.key}.title`) : entry.source.skill?.plainva.title || nameOf(entry.source),
      note: `${when} · ${record.model} · ${used}`,
      lines: record.scenarios.map((result) => scenarioLine(t, result)),
    });
  }
  return groups;
}

/** What a finished regression run says, in one line. */
export function skillTestOutcomeText(t: Translate, outcome: SkillTestOutcome, providerLabel: string): { tone: "success" | "info" | "error"; text: string } {
  if (outcome.kind === "refused") return { tone: "error", text: t(`ai.workshop.test.refused.${outcome.reason}`) };
  if (outcome.stopped === "failed") return { tone: "error", text: t("ai.workshop.test.stopped.failed", { reason: outcome.failure ? aiFailureText(t, outcome.failure, providerLabel) : "" }) };
  const done = t("ai.workshop.test.done", { passed: outcome.passed, ran: outcome.ran });
  if (outcome.stopped) return { tone: "info", text: `${done} ${t(`ai.workshop.test.stopped.${outcome.stopped}`)}` };
  return { tone: outcome.failed > 0 ? "info" : "success", text: done };
}

export interface ImportFacts {
  /** "One skill in the Agent Skills format: name", or null when it cannot be imported. */
  ok: string | null;
  /** Why it cannot be imported; null when it can. */
  blocked: string | null;
  problems: string[];
  /** Licence, size, and what the user should know (scripts, unknown tools, files that are no text). */
  notes: string[];
  /** Where it lands and how it is approved; null when blocked. */
  lands: string | null;
  /** The vault already has an own skill of this name: importing replaces it only when asked. */
  exists: boolean;
}

export function importFacts(t: Translate, imported: SkillImport, existing: boolean, language: string): ImportFacts {
  if (imported.blocked) {
    return {
      ok: null,
      blocked: t(`ai.workshop.importDialog.blocked.${imported.blocked}`),
      problems: imported.blocked === "invalid" ? blockingProblems(imported.problems).map((p) => problemText(t, p)) : [],
      notes: [],
      lands: null,
      exists: false,
    };
  }
  const bytes = imported.files.reduce((sum, f) => sum + f.bytes.length, 0);
  const notes = [
    imported.notes.license ? t("ai.workshop.importDialog.license", { license: imported.notes.license }) : t("ai.workshop.importDialog.noLicense"),
    t("ai.workshop.importDialog.size", { count: imported.files.length, size: size(bytes, language) }),
  ];
  if (imported.notes.scripts.length) notes.push(t("ai.workshop.scripts", { count: imported.notes.scripts.length }));
  if (imported.notes.unknownTools.length) notes.push(t("ai.workshop.unknownTools", { tools: imported.notes.unknownTools.join(", ") }));
  if (imported.notes.binaries.length) notes.push(t("ai.workshop.importDialog.binaries", { files: imported.notes.binaries.join(", ") }));
  return {
    ok: t("ai.workshop.importDialog.ok", { name: imported.name }),
    blocked: null,
    problems: [],
    notes,
    lands: t("ai.workshop.importDialog.lands", { path: `.agent/skills/${imported.name}/` }),
    exists: existing,
  };
}
