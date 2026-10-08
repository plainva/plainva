import {
  isScriptToolName,
  scriptNameOfTool,
  SCRIPT_LIMIT_BOUNDS,
  SCRIPT_LIMIT_DEFAULTS,
  SCRIPT_PARAMETERS_MAX,
  SCRIPT_TOOL_NAMES,
  type InstructionEntry,
  type ScriptCallRecord,
  type ScriptDefinition,
  type ScriptInput,
  type ScriptLimits,
  type ScriptOutcome,
  type ScriptParameter,
  type ScriptParameterType,
  type ScriptProblem,
} from "@plainva/core";
import type { ScriptDraft, ScriptWriteOutcome } from "./aiSession";

/**
 * The scripts of the workshop beyond their approval (plan KI-Harness P5.5,
 * mockup chapter 21): a run as its dialog shows it, and the form a script is
 * written in. One model for both shells — the desktop renders it in a
 * `Modal`, the phone in a sheet; neither decides anything of its own.
 */

type Translate = (key: string, vars?: Record<string, unknown>) => string;

function bytes(count: number, language: string): string {
  const unit = count >= 1024 ? "KB" : "B";
  const value = count >= 1024 ? count / 1024 : count;
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value)} ${unit}`;
}

/** What the dialogs say once the engine has read a script's code: readable, with how long it is — or not, and where. */
export function scriptCheckLine(t: Translate, check: { ok: true } | { ok: false; message: string }, codeSize: string | undefined): { mark: "pass" | "fail"; text: string } {
  if (check.ok) return { mark: "pass", text: [t("ai.scripts.codeOk"), codeSize].filter(Boolean).join(" ") };
  // The engine's own sentence about the place it stopped reading at.
  const where = check.message;
  return { mark: "fail", text: t("ai.scripts.codeBad", { message: where }) };
}

/** A script's tool in the app's words — "Running the script …" with its name; null for any other tool. */
export const scriptToolLabel = (t: Translate, tool: string): string | null => (isScriptToolName(tool) ? t("ai.tool.script", { name: scriptNameOfTool(tool) }) : null);

// --- a run ------------------------------------------------------------------------------------

/** What the fields of the run dialog hold: a text per parameter, or a switch. */
export type ScriptFieldValues = Record<string, string | boolean>;

export function scriptFieldDefaults(parameters: readonly ScriptParameter[]): ScriptFieldValues {
  return Object.fromEntries(parameters.map((p) => [p.name, p.type === "boolean" ? false : (p.options?.[0] ?? "")]));
}

/**
 * The fields as the input of a run: an empty text is no value, a number is
 * read as one. `missing`: a required parameter the user left empty, or a
 * number that does not read — the dialog keeps its start button off.
 */
export function scriptFieldInput(parameters: readonly ScriptParameter[], values: ScriptFieldValues): { input: ScriptInput; missing: string[] } {
  const input: ScriptInput = {};
  const missing: string[] = [];
  for (const p of parameters) {
    const raw = values[p.name];
    if (p.type === "boolean") {
      input[p.name] = raw === true;
      continue;
    }
    const text = typeof raw === "string" ? raw : "";
    if (p.type === "number") {
      const value = Number(text.trim().replace(",", "."));
      if (text.trim() === "") {
        if (p.required) missing.push(p.name);
      } else if (Number.isFinite(value)) input[p.name] = value;
      else missing.push(p.name);
      continue;
    }
    if (text === "") {
      if (p.required) missing.push(p.name);
    } else input[p.name] = text;
  }
  return { input, missing };
}

export interface ScriptCallLine {
  key: string;
  mark: "pass" | "fail" | "skip";
  /** The tool in the app's words. */
  tool: string;
  /** Its arguments, as the script wrote them. */
  args: string;
  /** How long it took and how much it handed back — or why it handed back nothing. */
  meta: string;
}

/** The calls of a run, each as a line: what was asked of which tool, and what came of it. */
export function scriptCallLines(t: Translate, calls: readonly ScriptCallRecord[], language: string): ScriptCallLine[] {
  const number = new Intl.NumberFormat(language);
  return calls.map((call, index) => ({
    key: `${index}`,
    mark: call.note === "not-run" ? "skip" : call.ok ? "pass" : "fail",
    tool: t(`ai.tool.${call.tool}`, { defaultValue: call.tool }),
    args: call.args,
    meta: call.note === "not-run" ? t("ai.scripts.run.notRun") : call.note === "too-large" ? t("ai.scripts.run.tooLarge") : call.ok ? `${number.format(Math.round(call.ms))} ms · ${bytes(call.bytes, language)}` : t("ai.scripts.run.refused"),
  }));
}

/** A run's value as its dialog shows it: JSON, set in lines. */
export function scriptValueText(outcome: ScriptOutcome): string | null {
  if (outcome.kind !== "done") return null;
  try {
    return JSON.stringify(outcome.value, null, 2) ?? "null";
  } catch {
    return outcome.json;
  }
}

/** What a run used of what its manifest gives it. */
export function scriptUsageLine(t: Translate, outcome: ScriptOutcome, limits: ScriptLimits, language: string): string {
  const number = new Intl.NumberFormat(language);
  return t("ai.scripts.run.usage", {
    seconds: new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(outcome.usage.ms / 1000),
    fuel: number.format(outcome.usage.fuel),
    fuelMax: number.format(limits.fuel),
    calls: number.format(outcome.calls.length),
    callsMax: number.format(limits.calls),
  });
}

/** How a run ended, in one sentence — and in which tone the dialog says it. */
export function scriptOutcomeText(t: Translate, outcome: ScriptOutcome, limits: ScriptLimits, dry: boolean, language: string): { tone: "success" | "warning" | "error"; text: string; note: string | null } {
  if (outcome.kind === "done") return { tone: "success", text: t(dry ? "ai.scripts.run.dryDone" : "ai.scripts.run.done"), note: null };
  const number = new Intl.NumberFormat(language);
  const vars = { seconds: number.format(limits.seconds), memory: number.format(limits.memoryMb), calls: number.format(limits.calls), message: outcome.message ?? "" };
  const note = outcome.calls.length ? t("ai.scripts.ended.note") : null;
  switch (outcome.reason) {
    case "unavailable":
      return { tone: "error", text: t("ai.scripts.unavailable"), note: null };
    case "input":
      return { tone: "error", text: t("ai.scripts.ended.input", vars), note: null };
    case "error":
      return { tone: "error", text: t("ai.scripts.ended.error", vars), note };
    case "stopped":
      return { tone: "warning", text: t("ai.scripts.ended.stopped"), note };
    case "output":
      return { tone: "warning", text: t("ai.scripts.ended.output", { size: bytes(limits.resultBytes, language) }), note };
    case "size":
      return { tone: "warning", text: t("ai.scripts.ended.size", { size: bytes(limits.callBytes, language) }), note };
    default:
      return { tone: outcome.reason === "crashed" ? "error" : "warning", text: t(`ai.scripts.ended.${outcome.reason}`, vars), note };
  }
}

// --- the form ---------------------------------------------------------------------------------

/** A script to start from: it shows the three things a script does — reads its input, awaits a tool, returns a value. */
export const SCRIPT_EXAMPLE_CODE = `const found = await tools.search_vault({ query: input.query, limit: 25 });
return { query: input.query, count: found.results.length, notes: found.results.map((hit) => hit.path) };
`;

export interface ScriptFormParameter extends ScriptParameter {
  /** Stable while the form is open, whatever the name is edited to. */
  row: number;
}

/** What the form holds while a script is written: texts for the numbers too, as the fields hold them. */
export interface ScriptFormState {
  name: string;
  title: string;
  description: string;
  tools: string[];
  parameters: ScriptFormParameter[];
  code: string;
  seconds: string;
  calls: string;
  memoryMb: string;
  /** The limits the form has no field for, kept as the script has them. */
  kept: Pick<ScriptLimits, "fuel" | "callBytes" | "resultBytes">;
}

const keptOf = (limits: ScriptLimits): ScriptFormState["kept"] => ({ fuel: limits.fuel, callBytes: limits.callBytes, resultBytes: limits.resultBytes });

export function newScriptForm(): ScriptFormState {
  return {
    name: "",
    title: "",
    description: "",
    tools: ["search_vault"],
    parameters: [{ row: 1, name: "query", type: "text", description: "", required: true }],
    code: SCRIPT_EXAMPLE_CODE,
    seconds: String(SCRIPT_LIMIT_DEFAULTS.seconds),
    calls: String(SCRIPT_LIMIT_DEFAULTS.calls),
    memoryMb: String(SCRIPT_LIMIT_DEFAULTS.memoryMb),
    kept: keptOf(SCRIPT_LIMIT_DEFAULTS),
  };
}

/** An existing script in the form — to change it; null where it cannot be read as one. */
export function scriptFormOf(entry: InstructionEntry): ScriptFormState | null {
  const script: ScriptDefinition | null | undefined = entry.source.script;
  if (!script || typeof entry.source.code !== "string") return null;
  return {
    name: script.name,
    title: script.title ?? "",
    description: script.description,
    tools: [...script.tools],
    parameters: script.parameters.map((p, index) => ({ ...p, row: index + 1 })),
    code: entry.source.code,
    seconds: String(script.limits.seconds),
    calls: String(script.limits.calls),
    memoryMb: String(script.limits.memoryMb),
    kept: keptOf(script.limits),
  };
}

/** The tools a script can be given, in the app's words — the form's list to tick. */
export function scriptToolChoices(t: Translate): { name: string; label: string }[] {
  return SCRIPT_TOOL_NAMES.map((name) => ({ name, label: t(`ai.tool.${name}`, { defaultValue: name }) }));
}

export const SCRIPT_PARAMETER_TYPES: readonly ScriptParameterType[] = ["text", "number", "boolean"];

export const scriptTypeLabel = (t: Translate, type: ScriptParameterType): string => t(type === "number" ? "ai.scripts.typeNumber" : type === "boolean" ? "ai.scripts.typeBoolean" : "ai.scripts.typeText");

export function addScriptParameter(form: ScriptFormState): ScriptFormState {
  if (form.parameters.length >= SCRIPT_PARAMETERS_MAX) return form;
  const row = form.parameters.reduce((max, p) => Math.max(max, p.row), 0) + 1;
  return { ...form, parameters: [...form.parameters, { row, name: "", type: "text", description: "", required: false }] };
}

export function changeScriptParameter(form: ScriptFormState, row: number, patch: Partial<Pick<ScriptParameter, "name" | "type" | "required">>): ScriptFormState {
  return {
    ...form,
    parameters: form.parameters.map((p) => {
      if (p.row !== row) return p;
      const next = { ...p, ...patch };
      // A list of values belongs to a text: another type loses it.
      if (next.type !== "text") delete next.options;
      return next;
    }),
  };
}

export const removeScriptParameter = (form: ScriptFormState, row: number): ScriptFormState => ({ ...form, parameters: form.parameters.filter((p) => p.row !== row) });

export const toggleScriptTool = (form: ScriptFormState, name: string, on: boolean): ScriptFormState => ({
  ...form,
  // In the order the app lists them, whatever the order of the ticks.
  tools: SCRIPT_TOOL_NAMES.filter((tool) => (tool === name ? on : form.tools.includes(tool))),
});

/** A whole number a field holds; NaN where it holds none — the manifest's own check then names the limit. */
const whole = (text: string): number => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);

/** The form as the script it describes. A number that does not read stays one the manifest refuses. */
export function scriptDraftOf(form: ScriptFormState): ScriptDraft {
  return {
    name: form.name.trim(),
    ...(form.title.trim() ? { title: form.title.trim() } : {}),
    description: form.description.trim(),
    tools: [...form.tools],
    parameters: form.parameters.map((p) => ({ name: p.name.trim(), type: p.type, description: p.description, required: p.required, ...(p.options ? { options: p.options } : {}) })),
    limits: { ...form.kept, seconds: whole(form.seconds), calls: whole(form.calls), memoryMb: whole(form.memoryMb) },
    code: form.code,
  };
}

/** Whether the form can be handed in at all: a name, a description, some code. What is wrong with them is the manifest's to say. */
export const scriptFormReady = (form: ScriptFormState): boolean => Boolean(form.name.trim() && form.description.trim() && form.code.trim());

/** The range a limit's field takes, for its hint. */
export const scriptLimitRange = (limit: "seconds" | "calls" | "memoryMb"): readonly [number, number] => SCRIPT_LIMIT_BOUNDS[limit];

export const scriptProblemText = (t: Translate, problem: ScriptProblem): string => t(`ai.scripts.problem.${problem.code}`, { detail: problem.detail ?? "" });

/** Why a script was not written, in words; null when it was. */
export function scriptWriteError(t: Translate, result: ScriptWriteOutcome): string | null {
  if (result.ok) return null;
  switch (result.reason) {
    case "exists":
      return t("ai.scripts.form.exists");
    case "invalid":
      return t("ai.scripts.form.invalid", { problems: (result.problems ?? []).map((p) => scriptProblemText(t, p)).join(" ") });
    case "syntax":
      return t("ai.scripts.codeBad", { message: result.message ?? "" });
    default:
      return t("ai.scripts.form.writeFailed");
  }
}
