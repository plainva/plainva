import { describe, expect, it, vi } from "vitest";
import i18n from "@plainva/ui/i18n";
import { EMPTY_INSTRUCTION_APPROVALS, resolveInstructions, skillCatalog, switchInstruction } from "@plainva/core";
import { APP_SKILL_FOLDERS, APP_SKILL_SOURCES, APP_SKILLS, buildAppCommands, mcpSkillPrompts, startableSkills, type CommandDeps } from "@plainva/ui";

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);
const entries = () => resolveInstructions(APP_SKILL_SOURCES, EMPTY_INSTRUCTION_APPROVALS);

/** Plan KI-Harness P3-2: the skills that come with the app, as SKILL.md files, started by hand or loaded by the model. */
describe("the app's own skills", () => {
  it("are SKILL.md files in the Agent Skills format, one entry each, without a problem", () => {
    expect([...APP_SKILL_FOLDERS].sort()).toEqual(APP_SKILLS.map((s) => s.name).sort());
    for (const source of APP_SKILL_SOURCES) {
      expect(source.problems, source.id).toEqual([]);
      expect(source.skill!.name).toBe(source.id.slice("plainva:".length));
      expect(source.skill!.body.length, source.id).toBeGreaterThan(200);
      // English instructions for the model; the user's words come from the locales.
      expect(source.skill!.plainva.risk).toBe("read");
    }
  });

  it("start with the user's sentence in the app's language", async () => {
    await i18n.changeLanguage("de");
    const de = startableSkills(t, entries());
    expect(de.find((s) => s.id === "plainva:daily-orientation")!.start).toMatch(/^Was ist heute wichtig\?/);
    await i18n.changeLanguage("en");
    const en = startableSkills(t, entries());
    expect(en.find((s) => s.id === "plainva:weekly-review")!.start).toMatch(/^Review my week/);
    expect(en.find((s) => s.id === "plainva:project-status")!.start).toContain("the open note");
    expect(en.filter((s) => s.featured).map((s) => s.commandId)).toEqual(["ai-skill-daily", "ai-skill-weekly", "ai-skill-project"]);
  });

  it("a skill switched off on this device is not startable", () => {
    const off = resolveInstructions(APP_SKILL_SOURCES, switchInstruction(EMPTY_INSTRUCTION_APPROVALS, "plainva:weekly-review", false));
    expect(startableSkills(t, off).map((s) => s.id)).not.toContain("plainva:weekly-review");
  });

  it("go to MCP clients as prompts, where the project status names its project by an argument", () => {
    const prompts = mcpSkillPrompts(t);
    expect(prompts.map((p) => p.name)).toEqual(["daily-orientation", "weekly-review", "project-status", "meeting-prep", "task-triage"]);
    const project = prompts.find((p) => p.name === "project-status")!;
    expect(project.argument?.name).toBe("project");
    // The server fills the placeholder; the app hands it over untouched.
    expect(project.text).toContain("“{{project}}”");
    expect(project.text).not.toContain("the open note");
    // The meeting preparation names its meeting the same way.
    expect(prompts.find((p) => p.name === "meeting-prep")!.text).toContain("{{meeting}}");
    expect(prompts.filter((p) => p.argument).map((p) => p.argument!.name)).toEqual(["project", "meeting"]);
    for (const prompt of prompts) expect(prompt.title && prompt.description && prompt.text).toBeTruthy();
  });

  it("are palette commands only where a shell starts them, one per startable skill", () => {
    const skills = startableSkills(t, entries());
    const skillIds = (d: CommandDeps) => buildAppCommands(d).map((c) => c.id).filter((id) => id.startsWith("ai-skill-"));
    expect(skillIds({ aiSkills: skills } as CommandDeps)).toEqual([]);
    const runAiSkill = vi.fn();
    const commands = buildAppCommands({ aiSkills: skills, runAiSkill } as CommandDeps).filter((c) => c.id.startsWith("ai-skill-"));
    expect(commands.map((c) => c.id)).toEqual(skills.map((s) => s.commandId));
    expect(commands.map((c) => c.title)).toEqual(skills.map((s) => s.title));
    commands.find((c) => c.id === "ai-skill-project")!.run();
    expect(runAiSkill).toHaveBeenCalledWith("plainva:project-status");
  });

  it("keep the catalog small: its cost in every conversation with tools is measured and capped", () => {
    const catalog = skillCatalog(entries());
    expect(catalog.entries.map((e) => e.key)).toEqual(APP_SKILLS.map((s) => s.name));
    expect(catalog.omitted).toEqual([]);
    // A ratchet: the app's catalog may grow with new skills, but never past this.
    expect(catalog.tokens).toBeLessThanOrEqual(1_200);
  });
});
