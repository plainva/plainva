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
