import { estimateTokens } from "../context/package.js";
import { approvalOf, instructionStatus, type InstructionApproval, type InstructionApprovals, type InstructionStatus } from "./approvals.js";
import type { InstructionSource } from "./sources.js";

/**
 * The registry and its catalog (plan KI-Harness P3, progressive loading as the
 * Agent Skills format describes it): a conversation with tools lists the
 * active skills by name and description — level 1, about a hundred tokens
 * each —, the model loads a skill's instructions with `use_skill` when a
 * request matches (level 2), and a file of the skill only when it needs one
 * (level 3).
 */

export interface InstructionEntry {
  source: InstructionSource;
  status: InstructionStatus;
  approval: InstructionApproval | null;
}

/** Every source with its state on this device: the app's skills first, then the vault's, each by name. */
export function resolveInstructions(sources: readonly InstructionSource[], approvals: InstructionApprovals): InstructionEntry[] {
  const order = (s: InstructionSource) => (s.origin === "plainva" ? 0 : s.kind === "skill" ? 1 : 2);
  return [...sources]
    .sort((a, b) => order(a) - order(b) || nameOf(a).localeCompare(nameOf(b)) || a.id.localeCompare(b.id))
    .map((source) => ({ source, status: instructionStatus(source, approvals), approval: approvalOf(approvals, source.id) }));
}

/** A source's name: the skill's own, or its folder or file when it is no valid skill. */
export function nameOf(source: InstructionSource): string {
  return source.skill?.name || source.root.slice(source.root.lastIndexOf("/") + 1) || source.id;
}

/** Waiting on the user: arrived or changed, not approved — the workshop's list. */
export function pendingInstructions(entries: readonly InstructionEntry[]): InstructionEntry[] {
  return entries.filter((e) => e.source.origin === "vault" && (e.status === "new" || e.status === "changed"));
}

export interface SkillCatalogEntry {
  /** What the model calls `use_skill` with: the name, or `<origin>/<name>` where two skills share it. */
  key: string;
  id: string;
  description: string;
}

export interface SkillCatalog {
  entries: SkillCatalogEntry[];
  /** The catalog as the system prompt carries it; empty without active skills. */
  text: string;
  tokens: number;
  /** Active skills left out because the catalog was full — still startable by hand. */
  omitted: string[];
}

/** The catalog's whole text stays below this; the app's skills come first. */
export const SKILL_CATALOG_MAX_CHARS = 6_000;

const CATALOG_HEAD =
  "Skills are instructions the user approved for recurring work. When a request matches one, call use_skill with its name before you answer, then follow the instructions it returns. Skip them otherwise.";

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

export function skillCatalog(entries: readonly InstructionEntry[]): SkillCatalog {
  const active = entries.filter((e) => e.status === "active" && e.source.kind === "skill" && e.source.skill);
  const counts = new Map<string, number>();
  for (const e of active) counts.set(e.source.skill!.name, (counts.get(e.source.skill!.name) ?? 0) + 1);
  const out: SkillCatalogEntry[] = [];
  const omitted: string[] = [];
  let length = CATALOG_HEAD.length;
  for (const e of active) {
    const skill = e.source.skill!;
    const key = (counts.get(skill.name) ?? 0) > 1 ? `${e.source.origin}/${skill.name}` : skill.name;
    const description = oneLine(skill.description);
    const line = `\n- ${key}: ${description}`;
    if (length + line.length > SKILL_CATALOG_MAX_CHARS) {
      omitted.push(e.source.id);
      continue;
    }
    length += line.length;
    out.push({ key, id: e.source.id, description });
  }
  if (!out.length) return { entries: [], text: "", tokens: 0, omitted };
  const text = `${CATALOG_HEAD}${out.map((e) => `\n- ${e.key}: ${e.description}`).join("")}`;
  return { entries: out, text, tokens: estimateTokens(text), omitted };
}

/** The entry a `use_skill` call names, by its exact key. */
export function catalogEntry(catalog: SkillCatalog, name: string): SkillCatalogEntry | null {
  const wanted = name.trim();
  return catalog.entries.find((e) => e.key === wanted) ?? null;
}
