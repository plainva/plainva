import { describe, expect, it } from "vitest";
import i18n from "@plainva/ui/i18n";
import { approveInstruction, EMPTY_INSTRUCTION_APPROVALS, readSkillImport, resolveInstructions, scanVaultInstructions, utf8Encode, type InstructionIO, type SkillTestRecord } from "@plainva/core";
import {
  APP_SKILL_SOURCES,
  approvalFacts,
  importFacts,
  skillRowDescription,
  skillTestFacts,
  skillTestGroups,
  skillTestNote,
  skillTestOutcomeText,
  skillTestOverview,
  skillTestPlanFor,
  workshopSections,
  type SkillTestPlan,
} from "@plainva/ui";

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

  it("names mail among what a skill may use — where the skill names it, or names nothing and leaves everything", async () => {
    await i18n.changeLanguage("en");
    const skill = (tools: string) => `---\nname: mail-digest\ndescription: Sums up new mail.\n${tools}---\n\nList the newest messages.\n`;
    const factsOf = async (tools: string) => approvalFacts(t, resolveInstructions(await scanVaultInstructions(io({ ".agent/skills/mail-digest/SKILL.md": skill(tools) })), EMPTY_INSTRUCTION_APPROVALS)[0]!, "en");
    // What is approved is what a conversation bound to the skill carries: the review must show mail before the yes.
    expect((await factsOf("allowed-tools: search_mail read_mail read_note\n")).may[0]).toBe("Uses: Reading a note · Searching mail · Reading a message");
    const everything = (await factsOf("")).may[0]!;
    expect(everything).toContain("Searching the vault");
    expect(everything).toContain("Searching mail · Reading a message");
    // The tool search is the conversation's, never a skill's: a skill is held against tools, not against a way to find more.
    expect(everything).not.toContain("Looking for further tools");
    expect((await factsOf("allowed-tools: read_note\n")).may[0]).toBe("Uses: Reading a note");
  });

  it("says before the yes that a skill reaches the internet — only one that names its tools does", async () => {
    await i18n.changeLanguage("en");
    const skill = (tools: string) => `---\nname: fact-check\ndescription: Checks a claim.\n${tools}---\n\nCheck the claim.\n`;
    const factsOf = async (tools: string) => approvalFacts(t, resolveInstructions(await scanVaultInstructions(io({ ".agent/skills/fact-check/SKILL.md": skill(tools) })), EMPTY_INSTRUCTION_APPROVALS)[0]!, "en");
    // The request to the internet is the one thing that leaves: the line no longer says "sends nothing".
    expect((await factsOf("allowed-tools: web_search fetch_url read_note\n")).may).toEqual([
      "Uses: Reading a note · Reading a web page · Searching the web",
      "Notes in the whole vault, as far as your rules allow",
      "Uses the internet where you allowed it for this vault. While notes are in the conversation, every page and every search asks first.",
      "Changes nothing.",
    ]);
    // A skill that names nothing leaves a conversation what it has — and brings no internet along.
    const everything = (await factsOf("")).may;
    expect(everything[0]).not.toContain("web");
    expect(everything).not.toContain("Uses the internet where you allowed it for this vault. While notes are in the conversation, every page and every search asks first.");
    expect(everything[everything.length - 1]).toBe("Changes nothing, sends nothing.");
    // The skill that comes with the app says the same about itself.
    const research = resolveInstructions(APP_SKILL_SOURCES, EMPTY_INSTRUCTION_APPROVALS).find((entry) => entry.source.id === "plainva:research")!;
    const facts = approvalFacts(t, research, "en");
    expect(facts.title).toBe("Research");
    expect(facts.may[0]).toBe("Uses: Searching the vault · Reading a note · Reading the outline · Reading backlinks · Reading a web page · Searching the web");
    expect(facts.may).toContain("Changes nothing.");
    for (const other of resolveInstructions(APP_SKILL_SOURCES, EMPTY_INSTRUCTION_APPROVALS).filter((entry) => entry.source.id !== "plainva:research")) {
      expect(approvalFacts(t, other, "en").may.join("\n"), other.source.id).not.toContain("Uses the internet");
    }
  });

  it("says before the yes that a skill may propose, draft and plan — only one that names those tools does", async () => {
    await i18n.changeLanguage("en");
    const skill = (tools: string) => `---\nname: tidy-up\ndescription: Tidies a note.\n${tools}---\n\nTidy the note.\n`;
    const factsOf = async (tools: string) => approvalFacts(t, resolveInstructions(await scanVaultInstructions(io({ ".agent/skills/tidy-up/SKILL.md": skill(tools) })), EMPTY_INSTRUCTION_APPROVALS)[0]!, "en");
    // Every writing tool it names is shown by name, and the line that used to say "changes nothing" says what it can do instead.
    expect((await factsOf("allowed-tools: read_note propose_edit create_note rename_note delete_note\n")).may).toEqual([
      "Uses: Reading a note · Suggesting changes to a note · Drafting a note · Laying out a plan to rename · Asking to delete a note",
      "Notes in the whole vault, as far as your rules allow",
      "May suggest changes, leave drafts and lay out plans. Nothing in the vault changes before you accept, create or confirm.",
    ]);
    // A skill that names nothing gained no writing tool when those arrived: what was approved before still says what it said.
    const everything = (await factsOf("")).may;
    expect(everything[0]).not.toMatch(/Suggesting|Drafting|Laying out|Asking to delete/);
    expect(everything[everything.length - 1]).toBe("Changes nothing, sends nothing.");
    // None of the skills that come with the app writes.
    for (const own of resolveInstructions(APP_SKILL_SOURCES, EMPTY_INSTRUCTION_APPROVALS)) {
      expect(approvalFacts(t, own, "en").may.join("\n"), own.source.id).not.toContain("May suggest changes");
    }
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

/** The regression run in the workshop (plan KI-Harness P3-8): one model in words for both shells. */
describe("the regression run in the workshop", () => {
  const DAILY = "plainva:daily-orientation";
  const PROJECT = "plainva:project-status";
  const entries = resolveInstructions(APP_SKILL_SOURCES, EMPTY_INSTRUCTION_APPROVALS);
  const plan = (over: Partial<SkillTestPlan> = {}): SkillTestPlan => ({
    choice: { providerId: "p", model: "m-2" },
    providerLabel: "Provider",
    local: false,
    priced: true,
    targets: [
      { id: DAILY, version: "v1", scenarios: 2, notApplicable: 0, problems: [] },
      { id: PROJECT, version: "v1", scenarios: 0, notApplicable: 2, problems: [] },
    ],
    total: 2,
    ...over,
  });
  const daily = (over: Partial<SkillTestRecord> = {}): SkillTestRecord => ({
    id: DAILY,
    version: "v1",
    providerId: "p",
    model: "m-2",
    at: "2026-10-06T10:00:00.000Z",
    scenarios: [
      { id: "today", passed: true, checks: [{ id: "answered", ok: true }], stop: "answered", tokens: 1200, costUsd: 0.004 },
      { id: "next-step", passed: false, checks: [{ id: "answered", ok: true }, { id: "required", ok: false, missing: ["get_tasks"] }, { id: "never", ok: false, missing: ["a", "b"] }], stop: "answered", tokens: 800, costUsd: 0.002 },
    ],
    ...over,
  });

  it("says before the run what would run, against which model, and where it ends", async () => {
    await i18n.changeLanguage("en");
    expect(skillTestFacts(t, plan(), "en")).toEqual({
      model: "Provider · m-2",
      scope: "2 scenarios from 1 skill",
      elsewhere: "2 more scenarios were written for another vault and do not run here.",
      // A price is known: the user sets an amount.
      ceiling: null,
      canRun: true,
    });
    expect(skillTestFacts(t, plan({ priced: false }), "en").ceiling).toBe("No price is known for this model: the run ends after 400,000 tokens at most.");
    expect(skillTestFacts(t, plan({ local: true, priced: false }), "en").ceiling).toBe("None: the model runs on this device. Nothing leaves it, nothing is billed.");
    expect(skillTestFacts(t, plan({ targets: [], total: 0 }), "en")).toMatchObject({ scope: "No active skill brings scenarios that apply in this vault.", elsewhere: null, canRun: false });
  });

  it("hands the dialog its part of the plan the workshop holds: one skill's scenarios, the same model and ceiling", () => {
    const all = plan();
    // Opened for everything: the plan as it is.
    expect(skillTestPlanFor(all, null)).toBe(all);
    // Opened from one skill's row: that skill only, counted again.
    expect(skillTestPlanFor(all, [DAILY])).toEqual({ ...all, targets: [all.targets[0]], total: 2 });
    // A skill whose scenarios were written for another vault: nothing to run, and the dialog says so.
    const elsewhere = skillTestPlanFor(all, [PROJECT])!;
    expect(elsewhere).toMatchObject({ choice: all.choice, priced: true, total: 0 });
    expect(skillTestFacts(t, elsewhere, "en").canRun).toBe(false);
    // Not read yet: nothing to show yet.
    expect(skillTestPlanFor(null, [DAILY])).toBeNull();
  });

  it("leads a row's line with its state and its last run: a phone's row shows one line and cuts off the end", async () => {
    await i18n.changeLanguage("en");
    const entry = entries.find((candidate) => candidate.source.id === DAILY)!;
    const about = "What matters today: due tasks, appointments and what you worked on lately.";
    expect(skillRowDescription(t, entry, [], plan())).toBe(about);
    expect(skillRowDescription(t, entry, [daily()], plan())).toBe(`tested: 1 of 2 · ${about}`);
    expect(skillRowDescription(t, { ...entry, status: "off" }, [daily()], plan())).toBe(`${t("ai.workshop.status.off")} · tested: 1 of 2 · ${about}`);
  });

  it("says on a skill's row what its last run still says: how it went, or why that no longer counts", async () => {
    await i18n.changeLanguage("en");
    expect(skillTestNote(t, daily(), plan())).toBe("tested: 1 of 2");
    expect(skillTestNote(t, daily({ model: "m-1" }), plan())).toBe("tested with m-1, not with the chosen model");
    expect(skillTestNote(t, daily({ version: "v0" }), plan())).toBe("changed since it was tested");
    // Never tested here, or the plan is not read yet: the row says nothing rather than something stale.
    expect(skillTestNote(t, undefined, plan())).toBeNull();
    expect(skillTestNote(t, daily(), null)).toBeNull();
  });

  it("sums the runs up for the workshop and hints once another model is chosen", async () => {
    await i18n.changeLanguage("en");
    expect(skillTestOverview(t, [], plan(), "en")).toEqual({ summary: "Not tested yet. The skills' test scenarios run against the chosen model — by hand, with a ceiling.", hint: null });
    const current = skillTestOverview(t, [daily()], plan(), "en");
    expect(current.summary).toMatch(/^Last tested on .+ — passed: 1 of 2\.$/);
    expect(current.hint).toBeNull();
    expect(skillTestOverview(t, [daily({ model: "m-1" })], plan(), "en").hint).toBe("1 skill has not been tested with the model chosen now (m-2).");
  });

  it("lists each scenario's verdict in words, without repeating what must never appear", async () => {
    await i18n.changeLanguage("en");
    const project: SkillTestRecord = {
      id: PROJECT,
      version: "v1",
      providerId: "p",
      model: "m-2",
      at: "2026-10-06T10:05:00.000Z",
      scenarios: [
        { id: "named-project", passed: false, checks: [], skipped: ["Harbour Bridge Lighting"], stop: "not-applicable", tokens: 0 },
        { id: "decision", passed: false, checks: [], stop: "not-run", tokens: 0 },
      ],
    };
    const groups = skillTestGroups(t, entries, [project, daily()], null, "en");
    // In the order of the lists, not of the runs.
    expect(groups.map((group) => [group.id, group.title])).toEqual([[DAILY, "Daily orientation"], [PROJECT, "Project status"]]);
    expect(groups[0]!.note).toMatch(/· m-2 · ≈ \$0\.006 · 2,000 tokens$/);
    expect(groups[0]!.lines).toEqual([
      { id: "today", mark: "pass", text: "passed" },
      { id: "next-step", mark: "fail", text: `did not use: ${t("ai.tool.get_tasks")} · shows 2 pieces of text that must never appear` },
    ]);
    expect(groups[1]!.note).toMatch(/· m-2 · 0 tokens$/);
    expect(groups[1]!.lines).toEqual([
      { id: "named-project", mark: "skip", text: "does not apply here — this vault lacks: Harbour Bridge Lighting" },
      { id: "decision", mark: "skip", text: "did not run" },
    ]);
    expect(skillTestGroups(t, entries, [project, daily()], [PROJECT], "en").map((group) => group.id)).toEqual([PROJECT]);
  });

  it("says in one line how a run ended", async () => {
    await i18n.changeLanguage("en");
    expect(skillTestOutcomeText(t, { kind: "done", ran: 2, passed: 2, failed: 0, stopped: null }, "Provider")).toEqual({ tone: "success", text: "Passed: 2 of 2." });
    expect(skillTestOutcomeText(t, { kind: "done", ran: 2, passed: 1, failed: 1, stopped: null }, "Provider")).toEqual({ tone: "info", text: "Passed: 1 of 2." });
    expect(skillTestOutcomeText(t, { kind: "done", ran: 1, passed: 1, failed: 0, stopped: "ceiling" }, "Provider")).toEqual({ tone: "info", text: "Passed: 1 of 1. The ceiling was reached; the rest did not run." });
    expect(skillTestOutcomeText(t, { kind: "done", ran: 0, passed: 0, failed: 0, stopped: "failed", failure: { kind: "invalid_key", status: 401 } }, "Provider").text).toBe(
      `Ended because a request failed: ${t("ai.error.invalidKey", { provider: "Provider" })}`,
    );
    expect(skillTestOutcomeText(t, { kind: "refused", reason: "busy" }, "Provider")).toEqual({ tone: "error", text: "The AI is still answering — wait for it or stop it." });
  });
});
