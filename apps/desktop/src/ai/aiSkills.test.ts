import { describe, expect, it, vi } from "vitest";
import i18n from "@plainva/ui/i18n";
import { AI_CORE_SKILLS, buildAppCommands, mcpSkillPrompts, skillPrompt, type CommandDeps } from "@plainva/ui";

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);

/** Plan KI-Harness P1.5: the core skills, started by hand. */
describe("the core skills", () => {
  it("send their prompt in the app's language, as the user's own message", async () => {
    await i18n.changeLanguage("de");
    expect(skillPrompt(t, "daily")).toMatch(/^Was ist heute wichtig\?/);
    await i18n.changeLanguage("en");
    expect(skillPrompt(t, "weekly")).toMatch(/^Review my week/);
    expect(skillPrompt(t, "project")).toContain("the open note");
  });

  it("go to MCP clients as prompts, where the project status names its project by an argument", () => {
    const prompts = mcpSkillPrompts(t);
    expect(prompts.map((p) => p.name)).toEqual(["daily-orientation", "weekly-review", "project-status"]);
    const project = prompts.find((p) => p.name === "project-status")!;
    expect(project.argument?.name).toBe("project");
    // The server fills the placeholder; the app hands it over untouched.
    expect(project.text).toContain("“{{project}}”");
    expect(project.text).not.toContain("the open note");
    expect(prompts.filter((p) => p.argument)).toHaveLength(1);
    for (const prompt of prompts) expect(prompt.title && prompt.description && prompt.text).toBeTruthy();
  });

  it("are palette commands only where a shell starts them", () => {
    const skillIds = (d: CommandDeps) => buildAppCommands(d).map((c) => c.id).filter((id) => id.startsWith("ai-skill-"));
    expect(skillIds({} as CommandDeps)).toEqual([]);
    const runAiSkill = vi.fn();
    const commands = buildAppCommands({ runAiSkill } as CommandDeps).filter((c) => c.id.startsWith("ai-skill-"));
    expect(commands.map((c) => c.id)).toEqual(AI_CORE_SKILLS.map((skill) => `ai-skill-${skill.id}`));
    commands[2]!.run();
    expect(runAiSkill).toHaveBeenCalledWith("project");
  });
});
