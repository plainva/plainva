import { describe, expect, it } from "vitest";
import { judgeSkillRun, readSkillScenarios, SKILL_SCENARIOS_MAX } from "./harness.js";

/** The skill test harness (plan KI-Harness P3-3): the scenario file, and how a run is judged. */

describe("scenario files", () => {
  it("reads the scenarios and reports what does not read", () => {
    const { scenarios, problems } = readSkillScenarios(
      JSON.stringify({
        version: 1,
        scenarios: [
          { id: "a", message: "Status?", tools: { required: ["read_note"], forbidden: ["run_command"] }, cites: ["Offer"], never: ["PIN"], reaches: ["Projects/Offer.md"] },
          { id: "b", message: "" },
          { id: "a", message: "Again?" },
          { id: "c", message: "Plain.", cites: "Offer" },
        ],
      }),
    );
    expect(scenarios).toEqual([
      { id: "a", message: "Status?", tools: { required: ["read_note"], forbidden: ["run_command"] }, cites: ["Offer"], never: ["PIN"], reaches: ["Projects/Offer.md"] },
      { id: "c", message: "Plain." },
    ]);
    expect(problems).toEqual(["scenario 2: id and message are required", "scenario a: the id is used twice"]);
  });

  it("never throws, and keeps a regression run cheap", () => {
    expect(readSkillScenarios("{").problems).toEqual(["not JSON"]);
    expect(readSkillScenarios('{"version":2}').problems).toEqual(["no version 1 with a scenarios list"]);
    const many = readSkillScenarios(JSON.stringify({ version: 1, scenarios: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, message: "m" })) }));
    expect(many.scenarios).toHaveLength(SKILL_SCENARIOS_MAX);
    expect(many.problems).toHaveLength(1);
  });
});

describe("judging a run", () => {
  const scenario = { id: "a", message: "Status?", tools: { required: ["read_note", "get_tasks"], forbidden: ["run_command"] }, cites: ["Harbour Bridge Lighting"], never: ["PIN 4711-2026"] };

  it("passes a run that answered, called what it needed, cited what it should and showed nothing locked", () => {
    const verdict = judgeSkillRun(scenario, {
      stop: "answered",
      calls: [
        { name: "read_note", ok: true },
        { name: "get_tasks", ok: true },
      ],
      answer: "The project is on track: see [[harbour bridge lighting]].",
    });
    expect(verdict).toEqual({ passed: true, checks: [{ id: "answered", ok: true }, { id: "required", ok: true }, { id: "forbidden", ok: true }, { id: "cites", ok: true }, { id: "never", ok: true }] });
  });

  it("names what was missing or what showed — never more of the answer", () => {
    const verdict = judgeSkillRun(scenario, {
      stop: "answered",
      calls: [
        { name: "read_note", ok: false },
        { name: "run_command", ok: false },
      ],
      answer: "Your PIN 4711-2026 is in the codes.",
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.checks).toEqual([
      { id: "answered", ok: true },
      { id: "required", ok: false, missing: ["read_note", "get_tasks"] },
      { id: "forbidden", ok: false, missing: ["run_command"] },
      { id: "cites", ok: false, missing: ["Harbour Bridge Lighting"] },
      { id: "never", ok: false, missing: ["PIN 4711-2026"] },
    ]);
    expect(judgeSkillRun({ id: "b", message: "m" }, { stop: "failed", calls: [], answer: "" })).toEqual({ passed: false, checks: [{ id: "answered", ok: false }] });
  });
});
