import { CalendarCheck, CalendarRange, FolderKanban, type LucideIcon } from "lucide-react";

/**
 * The core skills of the beta (plan KI-Harness P1.5, §14.2): prompt
 * templates started by hand — a chip in an empty conversation, a row in the
 * AI tab and on the phone's conversation list, a command in the palette, a
 * prompt of the MCP server. Their words are the user's language (locales):
 * the prompt is the user's message, visible like anything typed, and the
 * model answers in kind. P3's skill registry takes them over as files.
 */

export type AiSkillId = "daily" | "weekly" | "project";

export interface AiSkill {
  id: AiSkillId;
  icon: LucideIcon;
  /** The name an MCP client lists it under. */
  mcpName: string;
}

export const AI_CORE_SKILLS: readonly AiSkill[] = [
  { id: "daily", icon: CalendarCheck, mcpName: "daily-orientation" },
  { id: "weekly", icon: CalendarRange, mcpName: "weekly-review" },
  { id: "project", icon: FolderKanban, mcpName: "project-status" },
];

type Translate = (key: string, vars?: Record<string, unknown>) => string;

/** What a skill sends: the prompt in the user's language. */
export function skillPrompt(t: Translate, id: AiSkillId): string {
  return t(`ai.skills.${id}.prompt`);
}

/** A prompt as the MCP server offers it; `{{project}}` is filled by the server from the argument. */
export interface McpPromptSpec {
  name: string;
  title: string;
  description: string;
  text: string;
  argument?: { name: string; description: string };
}

/**
 * The skills for an MCP client, which has no open note: the project status
 * names its project through an argument instead.
 */
export function mcpSkillPrompts(t: Translate): McpPromptSpec[] {
  return AI_CORE_SKILLS.map((skill) => {
    const base = { name: skill.mcpName, title: t(`ai.skills.${skill.id}.title`), description: t(`ai.skills.${skill.id}.description`) };
    if (skill.id !== "project") return { ...base, text: skillPrompt(t, skill.id) };
    return {
      ...base,
      // The placeholder goes to the server as it is: interpolating it with itself keeps it.
      text: t("ai.skills.project.promptFor", { project: "{{project}}", interpolation: { escapeValue: false } }),
      argument: { name: "project", description: t("ai.skills.project.argument") },
    };
  });
}
