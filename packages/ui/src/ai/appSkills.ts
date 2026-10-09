import { appSkillSource, type InstructionSource } from "@plainva/core";
import { BookOpenCheck, CalendarCheck, CalendarClock, CalendarRange, Feather, FolderKanban, Inbox, Link2, ListOrdered, PenLine, ShieldCheck, Sprout, Telescope, type LucideIcon } from "lucide-react";

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
 * In the order every list shows them — the most used first.
 *
 * All of them read and show, with one exception (plan P6-3, ADR 0029):
 * memory care names the memory's two drafting tools, because what it finds is
 * only useful as something the user can accept — and a draft changes nothing
 * before they do. `aiSkills.test.ts` holds the exception to exactly that.
 */
export const APP_SKILLS: readonly AppSkill[] = [
  { name: "daily-orientation", key: "daily", icon: CalendarCheck, featured: true, mcp: true },
  { name: "weekly-review", key: "weekly", icon: CalendarRange, featured: true, mcp: true },
  { name: "project-status", key: "project", icon: FolderKanban, featured: true, mcp: true },
  { name: "meeting-prep", key: "meeting", icon: CalendarClock, mcp: true },
  { name: "task-triage", key: "triage", icon: ListOrdered, mcp: true },
  // The one skill that names the internet's tools (plan P4-6): started by the user, it brings them along where the vault allows the internet.
  // Not a prompt of the MCP server: a client there has its own way onto the web.
  { name: "research", key: "research", icon: Telescope },
  // Reads mail and appointments — through the tools that ask before mail is read for the first time.
  { name: "mail-and-calendar", key: "mailcal", icon: Inbox },
  { name: "writing", key: "writing", icon: PenLine },
  { name: "knowledge-upkeep", key: "upkeep", icon: Sprout },
  { name: "link-cleanup", key: "links", icon: Link2 },
  // Looks through the memory and drafts what to merge and what to take out; no prompt of the MCP server — the memory is the app's own conversations' only.
  { name: "memory-care", key: "memory", icon: BookOpenCheck },
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
