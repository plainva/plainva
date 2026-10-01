import { describe, expect, it } from "vitest";
import i18n from "@plainva/ui/i18n";
import { approveInstruction, EMPTY_INSTRUCTION_APPROVALS, readSkillImport, resolveInstructions, scanVaultInstructions, utf8Encode, type InstructionIO } from "@plainva/core";
import { APP_SKILL_SOURCES, approvalFacts, importFacts, workshopSections } from "@plainva/ui";

/** The skills workshop's one model for both shells (plan KI-Harness P3-5). */

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);
const SKILL = (description: string) => `---\nname: offer-check\ndescription: ${description}\nallowed-tools: read_note search_vault\nmetadata:\n  plainva.folders: Projects/\n---\n\nRead the offer.\n`;

function io(files: Record<string, string>): InstructionIO {
  const disk = new Map(Object.entries(files));
  return {
    async list(folder) {
      const prefix = `${folder}/`;
      const names = new Map<string, boolean>();
      for (const path of disk.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        names.set(slash < 0 ? rest : rest.slice(0, slash), slash >= 0);
      }
      return [...names].map(([name, folder]) => ({ name, folder }));
    },
    async read(path) {
      const text = disk.get(path);
      return text === undefined ? null : utf8Encode(text);
    },
  };
}

describe("the skills workshop", () => {
  it("puts what waits first, then the vault's own, AGENTS.md and the app's", async () => {
    await i18n.changeLanguage("en");
    const vault = await scanVaultInstructions(io({ ".agent/skills/offer-check/SKILL.md": SKILL("Checks an offer."), ".agent/skills/broken/SKILL.md": "no frontmatter", "AGENTS.md": "Be brief." }));
    let approvals = EMPTY_INSTRUCTION_APPROVALS;
    approvals = approveInstruction(approvals, vault.find((s) => s.id === "AGENTS.md")!, "2026-10-01T08:00:00Z", "review");
    const sections = workshopSections(resolveInstructions([...APP_SKILL_SOURCES, ...vault], approvals));
    expect(sections.waiting.map((e) => [e.source.id, e.status])).toEqual([
      [".agent/skills/broken", "invalid"],
      [".agent/skills/offer-check", "new"],
    ]);
    expect(sections.own).toEqual([]);
    expect(sections.agents?.status).toBe("active");
    expect(sections.app.map((e) => e.source.id)).toEqual(APP_SKILL_SOURCES.map((s) => s.id));
  });

  it("says in words what a skill may do, what changed, and binds exactly what it showed", async () => {
    await i18n.changeLanguage("en");
    const before = await scanVaultInstructions(io({ ".agent/skills/offer-check/SKILL.md": SKILL("Checks an offer.") }));
    const approvals = approveInstruction(EMPTY_INSTRUCTION_APPROVALS, before[0]!, "2026-10-01T08:00:00Z", "review");
    const after = await scanVaultInstructions(io({ ".agent/skills/offer-check/SKILL.md": SKILL("Checks an offer and sends it.") }));
    const [entry] = resolveInstructions(after, approvals);
    const facts = approvalFacts(t, entry!, "en");
    expect(facts.status).toBe("changed");
    expect(facts.may).toEqual(["Uses: Searching the vault · Reading a note", "Only notes in: Projects/", "Changes nothing, sends nothing."]);
    expect(facts.changes?.some((line) => line.type === "add" && line.text.includes("sends it"))).toBe(true);
    expect(facts.changes?.some((line) => line.type === "del" && line.text.includes("Checks an offer."))).toBe(true);
    expect(facts.canApprove).toBe(true);
    expect(facts.seen).toEqual({ "SKILL.md": after[0]!.files[0]!.sha256 });
    expect(facts.origin.some((line) => line.startsWith("Approved on this device on"))).toBe(true);
  });

  it("shows the app's own skills read only, and an invalid one with its problems", async () => {
    await i18n.changeLanguage("en");
    const [daily] = resolveInstructions(APP_SKILL_SOURCES.slice(0, 1), EMPTY_INSTRUCTION_APPROVALS);
    const appFacts = approvalFacts(t, daily!, "en");
    expect(appFacts.title).toBe("Daily orientation");
    expect(appFacts.canApprove).toBe(false);
    expect(appFacts.origin).toEqual(["Comes with Plainva"]);
    const broken = resolveInstructions(await scanVaultInstructions(io({ ".agent/skills/broken/SKILL.md": "no frontmatter" })), EMPTY_INSTRUCTION_APPROVALS)[0]!;
    const brokenFacts = approvalFacts(t, broken, "en");
    expect(brokenFacts.canApprove).toBe(false);
    expect(brokenFacts.problems).toEqual(["SKILL.md does not start with its properties (---)."]);
  });

  it("names what an import brings before anything is written", async () => {
    await i18n.changeLanguage("en");
    const imported = readSkillImport([
      { path: "x/SKILL.md", bytes: utf8Encode("---\nname: x\ndescription: d\nlicense: MIT\nallowed-tools: read_note Bash(git:*)\n---\n\nbody") },
      { path: "x/scripts/a.py", bytes: utf8Encode("print()") },
    ]);
    const facts = importFacts(t, imported, true, "en");
    expect(facts.ok).toBe("One skill in the Agent Skills format: x");
    expect(facts.notes).toEqual([
      "Licence: MIT",
      expect.stringMatching(/^2 files, /),
      "Contains a script. Plainva runs no scripts; the instructions apply without it.",
      "Names tools Plainva does not have: Bash(git:*) — the skill runs without them.",
    ]);
    expect(facts.exists).toBe(true);
    expect(importFacts(t, readSkillImport([]), false, "en")).toMatchObject({ ok: null, blocked: "No SKILL.md found — this is no skill.", lands: null });
  });
});
