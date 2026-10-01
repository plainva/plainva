import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { aiTestVaultFiles, LOCKED_FACTS } from "../../../scripts/ai-test-vault.mjs";
import { buildContextPackage, estimateTokens, type ContextBuildHost, type SituationInput } from "../src/ai/context/package.js";
import type { Candidate } from "../src/ai/context/ranking.js";
import { questionTerms } from "../src/ai/context/terms.js";
import type { EgressRecipient } from "../src/ai/egressGate.js";
import { effectivePolicy, notePolicyFrom, parsePolicyFile } from "../src/ai/policy.js";
import { readSkillScenarios, SKILL_SCENARIOS_FILE, type SkillScenario } from "../src/ai/skills/harness.js";
import { skillGrant } from "../src/ai/skills/narrowing.js";
import { parseSkillFile, SKILL_FILE, type SkillDefinition } from "../src/ai/skills/skillFile.js";
import { toolsFor } from "../src/ai/tools.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import { realSqlite } from "./helpers/realSqlite.js";

/**
 * The golden scenarios of the skills that come with the app (plan KI-Harness
 * P3-3, gate "the core skills pass the golden scenarios"). What CI can check
 * without a model, on the AI test vault:
 *
 * - every skill is a valid SKILL.md, its scenarios read, and they name only
 *   tools Plainva has;
 * - the tools a scenario needs survive the skill's own narrowing — a skill
 *   that lists too few tools fails here, not in front of a user;
 * - where a scenario names notes it must reach, the context of its message
 *   (the real full-text index, a cloud recipient) carries them;
 * - no locked fact of the vault ever comes near a skill's context;
 * - the instructions stay lean: a skill's body is what every bound request
 *   carries.
 *
 * Whether a model then calls those tools and cites those notes is the other
 * half of the same scenarios: the regression run against a real model,
 * started by hand whenever the model changes (`judgeSkillRun`).
 */

const SKILLS_DIR = new URL("../../ui/src/ai/skills/", import.meta.url);
/** What one bound request may spend on a skill's instructions, at most. */
const SKILL_BODY_TOKENS = 700;

interface AppSkill {
  folder: string;
  skill: SkillDefinition;
  scenarios: SkillScenario[];
  problems: string[];
}

const skills: AppSkill[] = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const text = readFileSync(new URL(`${entry.name}/${SKILL_FILE}`, SKILLS_DIR), "utf8");
    const parsed = parseSkillFile(text, entry.name);
    const tests = parsed.skill?.plainva.tests ?? SKILL_SCENARIOS_FILE;
    const read = readSkillScenarios(readFileSync(new URL(`${entry.name}/${tests}`, SKILLS_DIR), "utf8"));
    return { folder: entry.name, skill: parsed.skill!, scenarios: read.scenarios, problems: [...parsed.problems.map((p) => `${p.code} ${p.detail ?? ""}`.trim()), ...read.problems] };
  });

const HARNESS_TOOLS = toolsFor("harness").map((tool) => tool.name);

const cloud: EgressRecipient = { kind: "cloud", provider: "p", model: "m" };
const situation: SituationInput = { now: "2026-10-01 09:00", weekday: "Thursday", calendarDay: "2026-10-01", journalDay: "2026-10-01", active: null, tabs: [], tasks: [], events: [], dailyNote: null };
const { files } = aiTestVaultFiles();
const disk = new Map<string, string>(files);
const rules = parsePolicyFile(disk.get(".agent/policy.yml")!).rules;
const titleOf = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/, "");
const frontmatter = (text: string): unknown => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return m ? parseYaml(m[1]!) : {};
};
const host: ContextBuildHost = {
  policyOf: async (path, content) => effectivePolicy(path, notePolicyFrom(frontmatter(content ?? disk.get(path) ?? "")), rules),
  resolveLink: async (target) => [...disk.keys()].find((path) => titleOf(path) === target.replace(/#.*$/, "")) ?? null,
  async readNote(path) {
    const text = disk.get(path);
    return text === undefined ? null : { title: titleOf(path), text };
  },
};

let query: VaultQueryService;

async function wordCandidates(question: string): Promise<Candidate[]> {
  const hits = await query.searchCandidates(questionTerms(question), 30);
  const best = Math.max(...hits.map((h) => h.score), 0) || 1;
  return hits.map((h) => ({ path: h.path, title: h.title, signals: { lexical: h.score / best }, ...(h.snippet ? { snippet: h.snippet } : {}) }));
}

beforeAll(async () => {
  const db = await realSqlite();
  const vault = new MemoryVaultAdapter(1_000);
  for (const [path, text] of files) await vault.writeTextFile(path, text);
  await new VaultIndexer(vault, db).indexVaultFull();
  query = new VaultQueryService(db);
}, 60_000);

describe("the golden scenarios of the app's skills", () => {
  it("finds the skills and their scenarios, every file without a problem", () => {
    expect(skills.map((s) => s.folder).sort()).toEqual(expect.arrayContaining(["daily-orientation", "project-status", "weekly-review"]));
    for (const { folder, scenarios, problems } of skills) {
      expect(problems, folder).toEqual([]);
      expect(scenarios.length, folder).toBeGreaterThan(0);
    }
  });

  it("name only tools Plainva has, and keep the ones a scenario needs after their own narrowing", () => {
    for (const { folder, skill, scenarios } of skills) {
      expect(skill.allowedTools, folder).not.toBeNull();
      for (const tool of skill.allowedTools!) expect(HARNESS_TOOLS, `${folder}: ${tool}`).toContain(tool);
      const granted = skillGrant(skill, HARNESS_TOOLS).tools;
      for (const scenario of scenarios) {
        for (const tool of [...(scenario.tools?.required ?? []), ...(scenario.tools?.forbidden ?? [])]) expect(HARNESS_TOOLS, `${folder}/${scenario.id}: ${tool}`).toContain(tool);
        for (const tool of scenario.tools?.required ?? []) expect(granted, `${folder}/${scenario.id} needs ${tool}`).toContain(tool);
      }
    }
  });

  it("reach the notes a scenario names, through the context of its message — and never a locked fact", async () => {
    for (const { folder, scenarios } of skills) {
      for (const scenario of scenarios) {
        const pack = await buildContextPackage({ question: scenario.message, recipient: cloud, situation, candidates: [await wordCandidates(scenario.message)], pins: [] }, host);
        for (const path of scenario.reaches ?? []) {
          const ref = pack.refs.find((r) => r.path === path);
          expect(ref && (ref.tier === "evidence" || ref.tier === "card"), `${folder}/${scenario.id} reaches ${path}`).toBeTruthy();
        }
        for (const fact of LOCKED_FACTS) expect(pack.part.text, `${folder}/${scenario.id}`).not.toContain(fact);
      }
    }
  });

  it("stay lean: what every bound request carries", () => {
    for (const { folder, skill } of skills) expect(estimateTokens(skill.body), folder).toBeLessThanOrEqual(SKILL_BODY_TOKENS);
  });
});
