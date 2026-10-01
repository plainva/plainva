import { nameOf, type InstructionEntry } from "@plainva/core";
import { ScrollText, type LucideIcon } from "lucide-react";
import { APP_SKILL_SOURCES, APP_SKILLS, appSkillOf } from "./appSkills";

/**
 * How a skill shows where a person starts it (plan KI-Harness P3): a chip in
 * an empty conversation, a row in the AI tab and on the phone's list, a
 * command in the palette, a prompt of the MCP server. One definition, so a
 * skill looks and starts the same everywhere. The sentence that starts it is
 * the user's language and stands in the conversation like anything typed;
 * the skill's own instructions go with it as approved instructions.
 */

type Translate = (key: string, vars?: Record<string, unknown>) => string;

export interface SkillView {
  /** The source's id (`plainva:<name>`, `.agent/skills/<folder>`). */
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** The user's message that starts it. */
  start: string;
  origin: "plainva" | "vault";
  /** A chip of an empty conversation. */
  featured: boolean;
  /** The palette command's id: stable for the app's skills (`ai-skill-daily`). */
  commandId: string;
}

export function skillView(t: Translate, entry: InstructionEntry): SkillView {
  const id = entry.source.id;
  const app = appSkillOf(id);
  if (app) {
    return {
      id,
      title: t(`ai.skills.${app.key}.title`),
      description: t(`ai.skills.${app.key}.description`),
      icon: app.icon,
      start: t(`ai.skills.${app.key}.prompt`),
      origin: "plainva",
      featured: Boolean(app.featured),
      commandId: `ai-skill-${app.key}`,
    };
  }
  const skill = entry.source.skill;
  const title = skill?.plainva.title || nameOf(entry.source);
  return {
    id,
    title,
    description: skill?.description ?? "",
    icon: ScrollText,
    start: t("ai.skills.runOwn", { title }),
    origin: "vault",
    featured: false,
    commandId: `ai-skill-own-${nameOf(entry.source)}`,
  };
}

/** The skills a person can start now: active, the app's first — as the registry orders them. */
export function startableSkills(t: Translate, entries: readonly InstructionEntry[]): SkillView[] {
  return entries.filter((e) => e.status === "active" && e.source.kind === "skill" && e.source.skill).map((e) => skillView(t, e));
}

/** A prompt as the MCP server offers it; `{{<argument>}}` is filled by the server from the argument. */
export interface McpPromptSpec {
  name: string;
  title: string;
  description: string;
  text: string;
  argument?: { name: string; description: string };
}

/**
 * The app's skills for an MCP client (ADR 0022: the vault's own never leave
 * the app). A client has no open note: a skill that takes an argument names
 * it instead (the project of the project status).
 */
export function mcpSkillPrompts(t: Translate): McpPromptSpec[] {
  return APP_SKILLS.filter((skill) => skill.mcp).map((skill) => {
    const base = { name: skill.name, title: t(`ai.skills.${skill.key}.title`), description: t(`ai.skills.${skill.key}.description`) };
    const argument = APP_SKILL_SOURCES.find((s) => s.id === `plainva:${skill.name}`)?.skill?.plainva.argument;
    if (!argument) return { ...base, text: t(`ai.skills.${skill.key}.prompt`) };
    return {
      ...base,
      // The placeholder goes to the server as it is: interpolating it with itself keeps it.
      text: t(`ai.skills.${skill.key}.promptFor`, { [argument.name]: `{{${argument.name}}}`, interpolation: { escapeValue: false } }),
      argument: { name: argument.name, description: t(`ai.skills.${skill.key}.argument`) },
    };
  });
}
