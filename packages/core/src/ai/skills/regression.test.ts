import { describe, expect, it } from "vitest";
import {
  EMPTY_SKILL_TESTS,
  pruneSkillTests,
  readSkillTests,
  recordSkillTest,
  scenarioGaps,
  scenarioNotApplicable,
  scenarioNotRun,
  scenarioResult,
  serializeSkillTests,
  SKILL_TEST_NOT_APPLICABLE,
  SKILL_TEST_NOT_RUN,
  skillTestBudgetLeft,
  skillTestState,
  skillTestSummary,
  skillTestVersion,
  type SkillTestRecord,
} from "./regression.js";
import type { SkillScenario } from "./harness.js";

/** The regression run of the skill test harness (plan KI-Harness P3-8): what a result is, and what it still says. */

const scenario: SkillScenario = {
  id: "named-project",
  message: "What is the status of the project Harbour Bridge Lighting?",
  tools: { required: ["read_note"], forbidden: ["run_command"] },
  cites: ["Harbour Bridge Lighting"],
  reaches: ["Projects/en/Harbour Bridge Lighting.md"],
  never: ["PIN 4711-2026"],
};
const good = { stop: "answered", calls: [{ name: "read_note", ok: true }], answer: "On track — see [[Harbour Bridge Lighting]]." };

const record = (over: Partial<SkillTestRecord> = {}): SkillTestRecord => ({
  id: "plainva:project-status",
  version: "v1",
  providerId: "p",
  model: "m-1",
  at: "2026-10-06T10:00:00.000Z",
  scenarios: [scenarioResult(scenario, good, { tokens: 1200, costUsd: 0.004, conversationId: "c1" })],
  ...over,
});

describe("a scenario's result", () => {
  it("keeps the verdict and what the run used, and none of the answer", () => {
    const result = scenarioResult(scenario, good, { tokens: 1200, costUsd: 0.004, conversationId: "c1" });
    expect(result).toEqual({
      id: "named-project",
      passed: true,
      checks: [
        { id: "answered", ok: true },
        { id: "required", ok: true },
        { id: "forbidden", ok: true },
        { id: "cites", ok: true },
        { id: "never", ok: true },
      ],
      stop: "answered",
      tokens: 1200,
      costUsd: 0.004,
      conversationId: "c1",
    });
    expect(JSON.stringify(result)).not.toContain("On track");
    const bad = scenarioResult(scenario, { stop: "answered", calls: [{ name: "run_command", ok: false }], answer: "PIN 4711-2026" }, { tokens: 10 });
    expect(bad.passed).toBe(false);
    expect(bad.checks.filter((c) => !c.ok).map((c) => [c.id, c.missing])).toEqual([
      ["required", ["read_note"]],
      ["forbidden", ["run_command"]],
      ["cites", ["Harbour Bridge Lighting"]],
      ["never", ["PIN 4711-2026"]],
    ]);
    expect(bad.costUsd).toBeUndefined();
  });

  it("does not apply where the vault lacks what the scenario asks about, and says what is missing", () => {
    const here = { hasNote: () => true, hasPath: () => true };
    const elsewhere = { hasNote: () => false, hasPath: (path: string) => !path.startsWith("Projects/") };
    expect(scenarioGaps(scenario, here)).toEqual([]);
    expect(scenarioGaps(scenario, elsewhere)).toEqual(["Harbour Bridge Lighting", "Projects/en/Harbour Bridge Lighting.md"]);
    // A scenario that names no note applies in every vault.
    expect(scenarioGaps({ id: "today", message: "What matters today?", tools: { required: ["get_tasks"] } }, elsewhere)).toEqual([]);
    expect(scenarioNotApplicable(scenario, ["Harbour Bridge Lighting"])).toEqual({ id: "named-project", passed: false, checks: [], skipped: ["Harbour Bridge Lighting"], stop: SKILL_TEST_NOT_APPLICABLE, tokens: 0 });
    expect(scenarioNotRun(scenario)).toEqual({ id: "named-project", passed: false, checks: [], stop: SKILL_TEST_NOT_RUN, tokens: 0 });
  });

  it("sums a run: passed and failed among what ran, apart from what did not run or did not apply", () => {
    const failed = scenarioResult({ ...scenario, id: "b" }, { ...good, answer: "No idea." }, { tokens: 300 });
    const summary = skillTestSummary([record().scenarios[0]!, failed, scenarioNotRun({ ...scenario, id: "c" }), scenarioNotApplicable({ ...scenario, id: "d" }, ["X"])]);
    expect(summary).toEqual({ total: 4, passed: 1, failed: 1, notRun: 1, notApplicable: 1, tokens: 1500, costUsd: 0.004 });
    expect(skillTestSummary([failed]).costUsd).toBeUndefined();
  });
});

describe("what a stored result still says", () => {
  it("is bound to the skill's files and scenarios and to the model", () => {
    const files = [{ path: "SKILL.md", sha256: "a".repeat(64) }, { path: "references/x.md", sha256: "b".repeat(64) }];
    const version = skillTestVersion(files, "{}");
    expect(version).toMatch(/^[0-9a-f]{64}$/);
    // The order of the listing does not matter; a changed file or a changed scenario file does.
    expect(skillTestVersion([...files].reverse(), "{}")).toBe(version);
    expect(skillTestVersion([{ ...files[0]!, sha256: "c".repeat(64) }, files[1]!], "{}")).not.toBe(version);
    expect(skillTestVersion(files, '{"version":1}')).not.toBe(version);

    const now = { version: "v1", providerId: "p", model: "m-1" };
    expect(skillTestState(undefined, now)).toBe("untested");
    expect(skillTestState(record(), now)).toBe("current");
    expect(skillTestState(record(), { ...now, model: "m-2" })).toBe("model-changed");
    expect(skillTestState(record(), { ...now, providerId: "q" })).toBe("model-changed");
    // A changed skill outweighs a changed model: the result is about another text.
    expect(skillTestState(record(), { version: "v2", providerId: "q", model: "m-2" })).toBe("skill-changed");
  });

  it("keeps the newest result per skill and forgets those of skills that are gone", () => {
    let tests = recordSkillTest(EMPTY_SKILL_TESTS, record());
    tests = recordSkillTest(tests, record({ id: ".agent/skills/own" }));
    tests = recordSkillTest(tests, record({ model: "m-2" }));
    expect(tests.records.map((r) => [r.id, r.model])).toEqual([[".agent/skills/own", "m-1"], ["plainva:project-status", "m-2"]]);
    expect(pruneSkillTests(tests, new Set(["plainva:project-status"])).records.map((r) => r.id)).toEqual(["plainva:project-status"]);
    expect(pruneSkillTests(tests, new Set(tests.records.map((r) => r.id)))).toBe(tests);
  });

  it("reads back what it wrote, and takes a damaged file for no result at all", () => {
    const tests = recordSkillTest(EMPTY_SKILL_TESTS, record());
    expect(readSkillTests(serializeSkillTests(tests))).toEqual(tests);
    expect(readSkillTests(null)).toBe(EMPTY_SKILL_TESTS);
    expect(readSkillTests("{")).toBe(EMPTY_SKILL_TESTS);
    expect(readSkillTests('{"version":2,"records":[]}')).toBe(EMPTY_SKILL_TESTS);
    // A record cannot claim more than its checks say; unknown checks and malformed entries drop out.
    const forged = JSON.stringify({
      version: 1,
      records: [
        { id: "a", version: "v", providerId: "p", model: "m", at: "t", scenarios: [{ id: "s", stop: "answered", passed: true, checks: [{ id: "answered", ok: false }, { id: "made-up", ok: true }], tokens: -5 }] },
        { id: "a", version: "v", providerId: "p", model: "m", at: "t", scenarios: [{ id: "twice", stop: "answered", passed: true, checks: [{ id: "answered", ok: true }] }] },
        { id: "b", version: "v", providerId: "p", model: "m", at: "t", scenarios: [] },
        { id: "c" },
      ],
    });
    expect(readSkillTests(forged).records).toEqual([
      { id: "a", version: "v", providerId: "p", model: "m", at: "t", scenarios: [{ id: "s", passed: false, checks: [{ id: "answered", ok: false }], stop: "answered", tokens: 0 }] },
    ]);
  });
});

describe("the ceiling of a run", () => {
  it("lets another scenario start only below it: money where the price is known, tokens always", () => {
    const priced = { maxCostUsd: 0.5, maxTokens: 400_000 };
    expect(skillTestBudgetLeft({ tokens: 10_000, costUsd: 0.1 }, priced)).toBe(true);
    expect(skillTestBudgetLeft({ tokens: 10_000, costUsd: 0.5 }, priced)).toBe(false);
    expect(skillTestBudgetLeft({ tokens: 400_000, costUsd: 0.1 }, priced)).toBe(false);
    const unpriced = { maxCostUsd: null, maxTokens: 400_000 };
    expect(skillTestBudgetLeft({ tokens: 399_999, costUsd: 0 }, unpriced)).toBe(true);
    expect(skillTestBudgetLeft({ tokens: 400_000, costUsd: 0 }, unpriced)).toBe(false);
  });
});
