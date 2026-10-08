import {
  blockingProblems,
  nameOf,
  SKILL_TEST_MAX_TOKENS,
  SKILL_TEST_NOT_APPLICABLE,
  SKILL_TEST_NOT_RUN,
  hasWebTools,
  scriptWrites,
  skillGrant,
  skillNamesWeb,
  skillTestState,
  skillTestSummary,
  toolByName,
  WEB_TOOL_NAMES,
  type InstructionEntry,
  type InstructionKind,
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
import { SKILL_TOOL_NAMES } from "./vaultTools";

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
  /** The vault's scripts, approved here — on or switched off (plan P5.5, mockup chapter 21). */
  scripts: InstructionEntry[];
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
    scripts: vault.filter((e) => e.source.kind === "script" && !WAITING.has(e.status)),
    app: entries.filter((e) => e.source.origin === "plainva"),
    agents: vault.find((e) => e.source.kind === "agents" && !WAITING.has(e.status)) ?? null,
  };
}

/** What a row of the workshop is called: the app's word for one of its skills, a skill's or a script's own title, the file's name. */
export function workshopTitle(t: Translate, entry: InstructionEntry): string {
  if (entry.source.kind === "agents") return "AGENTS.md";
  if (entry.source.kind === "script") return entry.source.script?.title || nameOf(entry.source);
  return skillView(t, entry).title;
}

/** The names of tools as a line of the workshop writes them. */
const toolWords = (t: Translate, names: readonly string[]): string => names.map((name) => t(`ai.tool.${name}`, { defaultValue: name })).join(" · ");

/** The count a settings row or a badge shows: what waits for the user. */
export const waitingCount = (entries: readonly InstructionEntry[]): number => entries.filter((e) => e.source.origin === "vault" && (e.status === "new" || e.status === "changed")).length;

export interface ApprovalFacts {
  title: string;
  /** What the source is: the dialogs choose their words and their icon by it. */
  kind: InstructionKind;
  status: InstructionStatus;
  /**
   * A script (plan P5.5): its limits in one line, the inputs it asks for,
   * and its code exactly as it would run — with how long it is. Absent for
   * everything that is no script.
   */
  limits?: string;
  inputs?: string[];
  code?: string | null;
  codeSize?: string;
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

/**
 * A script before it may run on this device (plan P5.5, mockup chapter 21):
 * what its manifest asks for, in words — the tools, the limits, the inputs —,
 * then its code in full. The tools are the whole of what it can reach, and
 * the dialog says so: whatever the code does, that is the boundary.
 */
function scriptFacts(t: Translate, entry: InstructionEntry, language: string): ApprovalFacts {
  const { source, approval } = entry;
  const script = source.script ?? null;
  const number = new Intl.NumberFormat(language);
  // A script that names a writing tool (the second stage) lays down suggestions and drafts — and the review says what
  // that means, in the words a skill's review uses for the same tools: nothing changes before the user takes it.
  const may = script
    ? [script.tools.length ? t("ai.scripts.mayTools", { tools: toolWords(t, script.tools) }) : t("ai.scripts.mayNoTools"), t("ai.scripts.mayNothingElse"), t(scriptWrites(script) ? "ai.scripts.mayPropose" : "ai.scripts.mayReadOnly")]
    : [];
  const limits = script
    ? t("ai.scripts.limitsLine", {
        seconds: number.format(script.limits.seconds),
        memory: number.format(script.limits.memoryMb),
        calls: number.format(script.limits.calls),
        callSize: size(script.limits.callBytes, language),
        resultSize: size(script.limits.resultBytes, language),
      })
    : undefined;
  const inputs = script
    ? script.parameters.length
      ? script.parameters.map((p) =>
          t(p.description ? "ai.scripts.inputLineDescribed" : "ai.scripts.inputLine", {
            name: p.name,
            type: p.options ? t("ai.scripts.typeChoice", { options: p.options.join(", ") }) : t(p.type === "number" ? "ai.scripts.typeNumber" : p.type === "boolean" ? "ai.scripts.typeBoolean" : "ai.scripts.typeText"),
            need: t(p.required ? "ai.scripts.required" : "ai.scripts.optional"),
            description: p.description,
          }),
        )
      : [t("ai.scripts.inputNone")]
    : undefined;
  const code = typeof source.code === "string" ? source.code : null;

  const origin = [t("ai.workshop.originPath", { path: source.root })];
  if (approval) {
    const when = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(approval.at));
    origin.push(t(`ai.workshop.approvedHow.${approval.how}`, { when }));
    // Its files are the approved ones, and still it waits: the approval is not this device's.
    if (entry.status === "new") origin.push(t("ai.scripts.notThisDevice"));
  } else {
    origin.push(t("ai.workshop.neverApproved"));
  }
  const signature = source.signature;
  origin.push(signature?.state === "valid" ? t("ai.scripts.signedBy", { publisher: signature.publisher }) : signature?.state === "unknown-key" ? t("ai.scripts.signedUnknown", { key: signature.keyId }) : t("ai.scripts.unsigned"));

  const problems = (source.scriptProblems ?? []).map((p) => t(`ai.scripts.problem.${p.code}`, { detail: p.detail ?? "" }));
  return {
    title: workshopTitle(t, entry),
    kind: "script",
    status: entry.status,
    may,
    changes: entry.status === "changed" && approval?.text !== undefined && source.text !== null ? compareLines(approval.text, source.text) : null,
    text: null,
    ...(limits ? { limits } : {}),
    ...(inputs ? { inputs } : {}),
    code,
    ...(code !== null ? { codeSize: t("ai.scripts.codeSize", { lines: number.format(code.split("\n").length - (code.endsWith("\n") ? 1 : 0)), chars: number.format(code.length) }) } : {}),
    files: source.files.map((f) => ({ path: f.path, size: size(f.bytes, language) })),
    origin,
    warnings: source.tooLarge ? [t("ai.scripts.tooLarge")] : [],
    problems,
    canApprove: !source.tooLarge && problems.length === 0 && Boolean(script) && code !== null && (entry.status === "new" || entry.status === "changed"),
    seen: Object.fromEntries(source.files.map((f) => [f.path, f.sha256])),
  };
}

/** A script's row: its state where it is not simply active, what it is, what it is for, which tools it calls. */
export function scriptRowDescription(t: Translate, entry: InstructionEntry): string {
  const script = entry.source.script;
  const waits = WAITING.has(entry.status);
  const status = entry.status === "active" ? null : t(`ai.workshop.status.${entry.status}`);
  const calls = script ? (script.tools.length ? t("ai.scripts.callsTools", { tools: toolWords(t, script.tools) }) : t("ai.scripts.callsNone")) : null;
  // Among what waits, skills and scripts stand in one list: the row says which this is.
  return [waits ? t("ai.scripts.kind") : null, status, script?.description || null, waits ? null : calls].filter(Boolean).join(" · ");
}

export function approvalFacts(t: Translate, entry: InstructionEntry, language: string): ApprovalFacts {
  if (entry.source.kind === "script") return scriptFacts(t, entry, language);
  const { source, approval } = entry;
  const app = appSkillOf(source.id);
  const skill = source.skill;
  const title = app ? t(`ai.skills.${app.key}.title`) : source.kind === "agents" ? "AGENTS.md" : skill?.plainva.title || nameOf(source);

  const may: string[] = [];
  if (source.kind === "agents") {
    may.push(t("ai.workshop.mayAgents"));
  } else if (skill) {
    // What a conversation can reach is the upper bound — its own tools and the further ones (mail); the skill can only narrow it.
    // The internet's tools are in that bound only for a skill that names them itself (plan P4-6): started by the user, it brings them along.
    const web = skillNamesWeb(skill);
    const grant = skillGrant(skill, web ? [...SKILL_TOOL_NAMES, ...WEB_TOOL_NAMES] : SKILL_TOOL_NAMES);
    may.push(grant.tools.length ? t("ai.workshop.mayTools", { tools: grant.tools.map((name) => t(`ai.tool.${name}`, { defaultValue: name })).join(" · ") }) : t("ai.workshop.mayNoTools"));
    may.push(grant.folders ? t("ai.workshop.mayFolders", { folders: grant.folders.join(", ") || "—" }) : t("ai.workshop.mayWholeVault"));
    if (grant.maxOutputTokens !== null) may.push(t("ai.workshop.mayBudget", { tokens: new Intl.NumberFormat(language).format(grant.maxOutputTokens) }));
    const reachesWeb = hasWebTools(grant.tools);
    if (reachesWeb) may.push(t("ai.workshop.mayWeb"));
    // A tool that reads or shows changes nothing; a request to the internet is the one thing that leaves.
    // A skill that names writing tools (plan P5) gets them, and the approval says what that means: proposals, drafts and plans — never a change the user did not take.
    const risks = grant.tools.map((name) => toolByName(name)?.risk);
    if (risks.some((risk) => risk === "write" || risk === "critical")) may.push(t("ai.workshop.mayPropose"));
    else if (risks.every((risk) => risk === "read" || risk === "ui")) may.push(t(reachesWeb ? "ai.workshop.mayNoChange" : "ai.workshop.mayReadOnly"));
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
    kind: source.kind,
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
  if (entry.source.kind === "script") return scriptRowDescription(t, entry);
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
