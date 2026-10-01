import { blockingProblems, nameOf, skillGrant, toolByName, type InstructionEntry, type InstructionStatus, type SkillImport, type SkillProblem } from "@plainva/core";
import { compareLines, type CompareLine } from "../lib/compareVersions";
import { appSkillOf } from "./appSkills";
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
