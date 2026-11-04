/**
 * The skill test harness (plan KI-Harness P3-3): every skill can carry test
 * scenarios — a message that starts it and what a good run does — in
 * `tests/scenarios.json` (`plainva.tests` names another file). The same
 * scenarios serve twice: deterministically in CI (the skill can reach the
 * notes and tools the scenario needs; nothing locked ever comes near it) and,
 * started by hand, against a real model whenever the model changes (§ 11.7):
 * did the run answer, call what it needed, cite what it should, and leave
 * out what it must?
 */

export const SKILL_SCENARIOS_FILE = "tests/scenarios.json";
/** Scenarios per skill, at most: a regression run must stay cheap. */
export const SKILL_SCENARIOS_MAX = 8;

export interface SkillScenario {
  id: string;
  /** The user's message that starts the skill. */
  message: string;
  /** Tools a good run calls, and tools it must not. */
  tools?: { required?: string[]; forbidden?: string[] };
  /** Notes a good answer names, by title (as its wikilinks write them). */
  cites?: string[];
  /** Text a run must never show: locked notes' titles or facts. */
  never?: string[];
  /** Vault paths the context of the message must reach (the deterministic check). */
  reaches?: string[];
}

const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const texts = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter(isText).map((s) => s.trim()) : undefined);

/** Reads a scenario file defensively: what does not read is reported and left out. */
export function readSkillScenarios(raw: string): { scenarios: SkillScenario[]; problems: string[] } {
  const problems: string[] = [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { scenarios: [], problems: ["not JSON"] };
  }
  const list = value && typeof value === "object" && (value as { version?: unknown }).version === 1 ? (value as { scenarios?: unknown }).scenarios : null;
  if (!Array.isArray(list)) return { scenarios: [], problems: ["no version 1 with a scenarios list"] };
  const scenarios: SkillScenario[] = [];
  const ids = new Set<string>();
  for (const [i, item] of list.entries()) {
    const s = (item ?? {}) as Record<string, unknown>;
    if (!isText(s.id) || !isText(s.message)) {
      problems.push(`scenario ${i + 1}: id and message are required`);
      continue;
    }
    if (ids.has(s.id)) {
      problems.push(`scenario ${s.id}: the id is used twice`);
      continue;
    }
    ids.add(s.id);
    const tools = s.tools && typeof s.tools === "object" ? (s.tools as Record<string, unknown>) : null;
    const required = texts(tools?.required);
    const forbidden = texts(tools?.forbidden);
    scenarios.push({
      id: s.id.trim(),
      message: s.message.trim(),
      ...(required || forbidden ? { tools: { ...(required ? { required } : {}), ...(forbidden ? { forbidden } : {}) } } : {}),
      ...(texts(s.cites) ? { cites: texts(s.cites)! } : {}),
      ...(texts(s.never) ? { never: texts(s.never)! } : {}),
      ...(texts(s.reaches) ? { reaches: texts(s.reaches)! } : {}),
    });
  }
  if (scenarios.length > SKILL_SCENARIOS_MAX) problems.push(`more than ${SKILL_SCENARIOS_MAX} scenarios; the rest is left out`);
  return { scenarios: scenarios.slice(0, SKILL_SCENARIOS_MAX), problems };
}

/** What a run did, as the regression run records it — no content beyond the answer it judges. */
export interface SkillRunTrace {
  /** How the run ended (`RunStop.kind`). */
  stop: string;
  calls: { name: string; ok: boolean }[];
  answer: string;
}

export type SkillCheckId = "answered" | "required" | "forbidden" | "cites" | "never";

export interface SkillCheck {
  id: SkillCheckId;
  ok: boolean;
  /** What was missing or what showed — names, never more of the answer. */
  missing?: string[];
}

export interface SkillVerdict {
  passed: boolean;
  checks: SkillCheck[];
}

const fold = (text: string) => text.normalize("NFC").toLowerCase();

/** Judges one run against its scenario: structure, not wording — a model may answer in its own words. */
export function judgeSkillRun(scenario: SkillScenario, trace: SkillRunTrace): SkillVerdict {
  const checks: SkillCheck[] = [{ id: "answered", ok: trace.stop === "answered" && trace.answer.trim().length > 0 }];
  const called = new Set(trace.calls.filter((c) => c.ok).map((c) => c.name));
  const tried = new Set(trace.calls.map((c) => c.name));
  if (scenario.tools?.required?.length) {
    const missing = scenario.tools.required.filter((name) => !called.has(name));
    checks.push({ id: "required", ok: missing.length === 0, ...(missing.length ? { missing } : {}) });
  }
  if (scenario.tools?.forbidden?.length) {
    const used = scenario.tools.forbidden.filter((name) => tried.has(name));
    checks.push({ id: "forbidden", ok: used.length === 0, ...(used.length ? { missing: used } : {}) });
  }
  const answer = fold(trace.answer);
  if (scenario.cites?.length) {
    const missing = scenario.cites.filter((title) => !answer.includes(`[[${fold(title)}`));
    checks.push({ id: "cites", ok: missing.length === 0, ...(missing.length ? { missing } : {}) });
  }
  if (scenario.never?.length) {
    const shown = scenario.never.filter((text) => answer.includes(fold(text)));
    checks.push({ id: "never", ok: shown.length === 0, ...(shown.length ? { missing: shown } : {}) });
  }
  return { passed: checks.every((c) => c.ok), checks };
}
