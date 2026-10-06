import { appSkillSource, type InstructionSource } from "@plainva/core";
import { CalendarCheck, CalendarClock, CalendarRange, Feather, FolderKanban, Link2, ListOrdered, PenLine, ShieldCheck, Sprout, type LucideIcon } from "lucide-react";

/**
 * The skills that come with the app (plan KI-Harness P3, §14.2): each a
 * folder under ./skills/ with a SKILL.md in the Agent Skills format, bundled
 * as text. They are part of the app like its code — no approval, only a
 * switch per vault on this device. Their instructions are English, the
 * model's working language; their names, descriptions and the sentence that
 * starts them are the user's language (`ai.skills.<key>.*` in the locales).
 */
const FILES = import.meta.glob<string>("./skills/*/SKILL.md", { query: "?raw", import: "default", eager: true });

export interface AppSkill {
  /** The folder, and the skill's `name`. */
  name: string;
  /** Its texts in the locales: `ai.skills.<key>.title`, `.description`, `.prompt`. */
  key: string;
  icon: LucideIcon;
  /** A chip of an empty conversation. */
  featured?: boolean;
  /** A prompt of the MCP server (ADR 0022: only the app's own skills leave the app). */
  mcp?: boolean;
}

/**
 * In the order every list shows them — the most used first. Research with
 * source capture and mail and calendar capture wait for the web and mail
 * tools (P4), memory curation for memory itself (P6).
 */
export const APP_SKILLS: readonly AppSkill[] = [
  { name: "daily-orientation", key: "daily", icon: CalendarCheck, featured: true, mcp: true },
  { name: "weekly-review", key: "weekly", icon: CalendarRange, featured: true, mcp: true },
  { name: "project-status", key: "project", icon: FolderKanban, featured: true, mcp: true },
  { name: "meeting-prep", key: "meeting", icon: CalendarClock, mcp: true },
  { name: "task-triage", key: "triage", icon: ListOrdered, mcp: true },
  { name: "writing", key: "writing", icon: PenLine },
  { name: "knowledge-upkeep", key: "upkeep", icon: Sprout },
  { name: "link-cleanup", key: "links", icon: Link2 },
  // Meant for a model on this device (a hint in the send overview, never a block): they read what is most private.
  { name: "privacy-check", key: "privacy", icon: ShieldCheck },
  { name: "reflection", key: "reflection", icon: Feather },
];

/** The bundled folders — a guard checks that each has its entry above and the other way round. */
export const APP_SKILL_FOLDERS: readonly string[] = Object.keys(FILES).map((path) => path.split("/")[2]!);

export const APP_SKILL_SOURCES: readonly InstructionSource[] = APP_SKILLS.flatMap((skill) => {
  const text = FILES[`./skills/${skill.name}/SKILL.md`];
  return text === undefined ? [] : [appSkillSource(skill.name, text)];
});

// The scenarios of the regression run (plan KI-Harness P3-8), bundled as text like the skills themselves.
const SCENARIOS = import.meta.glob<string>("./skills/*/tests/scenarios.json", { query: "?raw", import: "default", eager: true });

/** The test scenarios an app skill brings, as written; null when it has none. */
export function appSkillScenarios(id: string): string | null {
  return id.startsWith("plainva:") ? (SCENARIOS[`./skills/${id.slice("plainva:".length)}/tests/scenarios.json`] ?? null) : null;
}

/** The app's skill behind a source id (`plainva:<name>`); null for the vault's own. */
export function appSkillOf(id: string): AppSkill | null {
  return id.startsWith("plainva:") ? (APP_SKILLS.find((s) => s.name === id.slice("plainva:".length)) ?? null) : null;
}
