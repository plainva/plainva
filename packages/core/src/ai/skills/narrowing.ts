import { toolByName, WEB_TOOL_NAMES, type ToolRiskClass } from "../tools.js";
import type { SkillDefinition } from "./skillFile.js";

/**
 * What a skill may use (ADR 0020: "skills create no rights — a skill can only
 * narrow what the tools allow"). Every field is the conversation's own set,
 * cut down: the tools a skill lists (`allowed-tools`, read as "the tools it
 * uses"), its highest risk class, its data classes, its folders and its
 * budget. A skill that names a tool the conversation does not carry does not
 * get it; a name Plainva does not know (`Bash(git:*)` from another harness)
 * is reported and dropped.
 */
export interface SkillGrant {
  /** The tools the skill may use: always a subset of the conversation's tools, in their order. */
  tools: string[];
  /** Tools and context only inside these folders; null when the skill names none. */
  folders: string[] | null;
  /** The output tokens of a run that starts with the skill, at most; null for the default. */
  maxOutputTokens: number | null;
  /** Listed in `allowed-tools`, but no tool of Plainva's. */
  unknownTools: string[];
}

const RISK_RANK: Record<ToolRiskClass, number> = { read: 0, ui: 1, write: 2, critical: 3, external: 4, script: 5 };
/** The classes whose tools propose, plan or act — everything that is more than reading and showing. */
const WRITE_RISKS: ReadonlySet<ToolRiskClass> = new Set<ToolRiskClass>(["write", "critical", "external", "script"]);

/**
 * Whether a skill names the internet's tools itself (plan KI-Harness P4-6).
 * Only such a skill, started by the user, brings them into its conversation —
 * and only where the vault allows the internet; each request still asks. A
 * skill without an `allowed-tools` line uses whatever a conversation has, but
 * naming nothing it asks for nothing: it never brings the internet along.
 */
export function skillNamesWeb(skill: Pick<SkillDefinition, "allowedTools">): boolean {
  return Boolean(skill.allowedTools?.some((name) => WEB_TOOL_NAMES.includes(name)));
}

export function skillGrant(skill: SkillDefinition, available: readonly string[], defaultMaxOutputTokens?: number): SkillGrant {
  const listed = skill.allowedTools;
  const meta = skill.plainva;
  const tools = available.filter((name) => {
    if (listed !== null && !listed.includes(name)) return false;
    const tool = toolByName(name);
    if (!tool) return false;
    // A tool that writes is never part of "whatever a conversation has" (plan KI-Harness P5): a skill has it only by
    // naming it. So a skill approved before there were such tools gains none, and the approval shows each one it names.
    if (listed === null && WRITE_RISKS.has(tool.risk)) return false;
    if (meta.risk && RISK_RANK[tool.risk] > RISK_RANK[meta.risk]) return false;
    if (meta.dataClasses && !tool.dataClasses.every((c) => meta.dataClasses!.includes(c))) return false;
    return true;
  });
  const budget = meta.budgetTokens ?? null;
  return {
    tools,
    folders: meta.folders ? [...meta.folders] : null,
    maxOutputTokens: budget === null ? null : defaultMaxOutputTokens !== undefined ? Math.min(budget, defaultMaxOutputTokens) : budget,
    unknownTools: (listed ?? []).filter((name) => !toolByName(name)),
  };
}

/**
 * How one version of a skill differs from another in what it may use (plan
 * KI-Harness P6): both grants measured against the same tools. The workshop
 * shows it wherever one version follows another — a change that arrived, a
 * proposal, an earlier version to go back to —, so a skill that reaches
 * further is never approved as "a few lines changed".
 */
export interface GrantChanges {
  /** Tools the later version may use that the earlier could not. */
  toolsAdded: string[];
  /** Tools the earlier version could use that the later may not. */
  toolsRemoved: string[];
  /** The folders, where they differ; null stands for the whole vault. */
  folders: { before: string[] | null; after: string[] | null } | null;
  /** The output tokens of a run at most, where they differ; null stands for the conversation's own bound. */
  budget: { before: number | null; after: number | null } | null;
  /** More than before in any way: a tool it did not have, a place outside its folders, a bound that went up or away. */
  widened: boolean;
}

export function grantChanges(before: SkillGrant, after: SkillGrant): GrantChanges {
  const toolsAdded = after.tools.filter((name) => !before.tools.includes(name));
  const toolsRemoved = before.tools.filter((name) => !after.tools.includes(name));
  const folded = (folders: readonly string[]) => [...new Set(folders.map(fold))].sort();
  const sameFolders =
    before.folders === null || after.folders === null ? before.folders === after.folders : folded(before.folders).join("\n") === folded(after.folders).join("\n");
  // Wider: the whole vault where there were folders, or a folder that lies in none of the old ones.
  const foldersWider = !sameFolders && before.folders !== null && (after.folders === null || after.folders.some((folder) => !withinFolders(folder, before.folders!)));
  const sameBudget = before.maxOutputTokens === after.maxOutputTokens;
  const budgetWider = !sameBudget && before.maxOutputTokens !== null && (after.maxOutputTokens === null || after.maxOutputTokens > before.maxOutputTokens);
  return {
    toolsAdded,
    toolsRemoved,
    folders: sameFolders ? null : { before: before.folders ? [...before.folders] : null, after: after.folders ? [...after.folders] : null },
    budget: sameBudget ? null : { before: before.maxOutputTokens, after: after.maxOutputTokens },
    widened: toolsAdded.length > 0 || foldersWider || budgetWider,
  };
}

/** Whether two versions may use exactly the same: nothing a review would have to show. */
export function sameGrant(changes: GrantChanges): boolean {
  return changes.toolsAdded.length === 0 && changes.toolsRemoved.length === 0 && changes.folders === null && changes.budget === null;
}

/** Lower case, NFC, forward slashes, no slash at either end — compared, never stored. */
function fold(value: string): string {
  const slashed = value.normalize("NFC").toLowerCase().split("\\").join("/");
  let start = 0;
  let end = slashed.length;
  while (start < end && slashed[start] === "/") start++;
  while (end > start && slashed[end - 1] === "/") end--;
  return slashed.slice(start, end);
}

/**
 * True when a vault path lies in one of the folders — as the MCP server's
 * folder grants read it (letter case and Unicode form ignored: narrowing
 * gives nothing the privacy gate would not allow anyway). An empty folder
 * (`""`) is the whole vault; an empty list is nothing.
 */
export function withinFolders(path: string, folders: readonly string[]): boolean {
  const p = fold(path);
  return folders.some((folder) => {
    const f = fold(folder);
    return f === "" || p === f || p.startsWith(`${f}/`);
  });
}
