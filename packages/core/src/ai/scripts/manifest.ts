import { z } from "zod";
import { TOOL_DESCRIPTION_LIMIT, TOOL_NAME_PATTERN, toolByName, type ToolDataClass, type ToolManifest } from "../tools.js";

/**
 * A script (ADR 0020 decision 6, plan KI-Harness P5.5): a folder in
 * `.agent/scripts/<name>/` with a manifest and one file of JavaScript. The
 * JavaScript is the body of an async function that gets its input and the
 * tools the manifest names — the app's own tools, behind the same gates as
 * for a model — and returns a value. It runs in a sandbox that has nothing
 * else: no file, no network, no clock of its own to wait on.
 *
 * The manifest is strict on purpose. A field nobody defined, a tool the app
 * does not have, a limit out of range: each makes the script one that does
 * not run, never one that runs with a guess.
 */

export const SCRIPTS_FOLDER = ".agent/scripts";
export const SCRIPT_MANIFEST_FILE = "manifest.json";
export const SCRIPT_MAIN_FILE = "main.js";
/** A publisher's signature over the script's seal, where the package brings one. */
export const SCRIPT_SIGNATURE_FILE = "signature";

/** A script is a small program, not a library: this many files and bytes at most. */
export const SCRIPT_MAX_FILES = 16;
export const SCRIPT_MAX_BYTES = 262_144;
export const SCRIPT_MAIN_MAX_BYTES = 65_536;
export const SCRIPT_MANIFEST_MAX_BYTES = 16_384;
export const SCRIPT_SIGNATURE_MAX_BYTES = 4_096;

/** Lower-case letters, digits and single hyphens: a script's name becomes part of a tool's name. */
export const SCRIPT_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const SCRIPT_NAME_MAX = 40;
export const SCRIPT_TITLE_MAX = 80;
export const SCRIPT_DESCRIPTION_MAX = 400;
export const SCRIPT_VERSION_MAX = 40;

/**
 * The tools a script can read with: what reads the vault or shows something
 * in the app. Not among them, and never reachable from a script: mail and the
 * descriptions of appointments (their text goes to a reader without tools,
 * and a script's result would carry it past that reader), the internet,
 * the tools of foreign servers, the skills, the tool search, other scripts.
 */
export const SCRIPT_READ_TOOL_NAMES: readonly string[] = [
  "search_vault",
  "read_note",
  "get_outline",
  "query_base",
  "get_tasks",
  "get_backlinks",
  "graph_neighborhood",
  "get_recent",
  "get_calendar",
  "run_command",
];

/**
 * The tools a script can lay something down with — the second stage, through
 * the approval chain of ADR 0019: a suggestion on a note's text or on one of
 * its properties, and the drafts of a note, a database entry, a task and a
 * journal line. Each ends as the same call of a model ends: a suggestion
 * round in the note's margin, a draft in the list — nothing in the vault
 * changes before the user accepts or creates.
 *
 * Not among them: the plans (rename, move, delete — each asks the user about
 * one thing, and a program that loops would ask without end) and the drafts
 * of an e-mail or an appointment, which are on their way out of the vault.
 */
export const SCRIPT_WRITE_TOOL_NAMES: readonly string[] = ["propose_edit", "set_property", "create_note", "create_entry", "create_task", "add_journal_entry"];

/** Every tool a script's manifest can name, the reading ones first. */
export const SCRIPT_TOOL_NAMES: readonly string[] = [...SCRIPT_READ_TOOL_NAMES, ...SCRIPT_WRITE_TOOL_NAMES];
export const SCRIPT_TOOLS_MAX = 20;

/** Whether a script lays something down: its manifest names a tool that does. */
export function scriptWrites(script: { tools: readonly string[] }): boolean {
  return script.tools.some((name) => SCRIPT_WRITE_TOOL_NAMES.includes(name));
}

export interface ScriptLimits {
  /** Seconds the script itself may compute; the time a tool takes does not count. */
  seconds: number;
  /** Megabytes of memory the engine gives it. */
  memoryMb: number;
  /** Steps of the engine, in units of ten thousand: the same amount of work on every device. */
  fuel: number;
  /** Tool calls in one run. */
  calls: number;
  /** Bytes of one tool call: its arguments, and what the tool hands back. */
  callBytes: number;
  /** Bytes of what the script returns. */
  resultBytes: number;
}

/**
 * What a script gets where its manifest says nothing. The steps are set so
 * that a fast computer reaches them at about the seconds (measured: some
 * fifteen thousand units a second in a tight loop); on a slower device the
 * seconds come first. Either way the run ends.
 */
export const SCRIPT_LIMIT_DEFAULTS: ScriptLimits = { seconds: 5, memoryMb: 32, fuel: 50_000, calls: 20, callBytes: 65_536, resultBytes: 65_536 };

/** What a manifest may ask for, lowest and highest. A value outside is a problem, never clamped. */
export const SCRIPT_LIMIT_BOUNDS: Record<keyof ScriptLimits, readonly [number, number]> = {
  seconds: [1, 30],
  memoryMb: [8, 128],
  fuel: [100, 500_000],
  calls: [0, 50],
  callBytes: [1_024, 262_144],
  resultBytes: [256, 262_144],
};

export type ScriptParameterType = "text" | "number" | "boolean";

/** One value a script asks for when it starts. */
export interface ScriptParameter {
  name: string;
  type: ScriptParameterType;
  description: string;
  required: boolean;
  /** For a text: the values it may have. */
  options?: string[];
}

export const SCRIPT_PARAMETERS_MAX = 12;
export const SCRIPT_PARAMETER_NAME = /^[a-z][a-zA-Z0-9_]{0,31}$/;
export const SCRIPT_PARAMETER_DESCRIPTION_MAX = 200;
export const SCRIPT_OPTIONS_MAX = 20;
export const SCRIPT_OPTION_MAX = 80;
/** A text a caller hands a script, at most. */
export const SCRIPT_TEXT_INPUT_MAX = 4_000;

export interface ScriptDefinition {
  name: string;
  /** A display name; the folder's name is the identity. */
  title?: string;
  description: string;
  version?: string;
  /** The tools the script may call, as listed — each one known and open to scripts. */
  tools: string[];
  parameters: ScriptParameter[];
  /** Complete: what the manifest leaves out is the default. */
  limits: ScriptLimits;
}

export type ScriptProblemCode =
  | "manifest-missing"
  | "manifest-json"
  | "field-unknown"
  | "field-type"
  | "name-missing"
  | "name-characters"
  | "name-folder"
  | "description-missing"
  | "description-too-long"
  | "tool-unknown"
  | "tool-not-for-scripts"
  | "input-entry"
  | "input-too-many"
  | "limit-value"
  | "main-missing"
  | "main-not-text"
  | "file-too-large"
  | "invisible-characters"
  | "signature-invalid";

/** A finding about a script; `detail` names the field or value, never more of the file. */
export interface ScriptProblem {
  code: ScriptProblemCode;
  detail?: string;
}

export interface ParsedScriptManifest {
  /** Null when the file is no manifest at all. With any problem a script does not run. */
  script: ScriptDefinition | null;
  problems: ScriptProblem[];
}

const MANIFEST_FIELDS: readonly string[] = ["name", "title", "description", "version", "tools", "input", "limits"];
const PARAMETER_FIELDS: readonly string[] = ["name", "type", "description", "required", "options"];
const PARAMETER_TYPES: readonly ScriptParameterType[] = ["text", "number", "boolean"];
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/** A detail as a problem carries it: one line, short, without characters that draw nothing. */
function detailOf(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return text.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

const isMap = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function readParameter(raw: unknown, index: number, seen: Set<string>, problems: ScriptProblem[]): ScriptParameter | null {
  const bad = (what: string) => {
    problems.push({ code: "input-entry", detail: what });
    return null;
  };
  if (!isMap(raw)) return bad(`#${index + 1}`);
  const name = typeof raw.name === "string" ? raw.name : "";
  const label = name ? detailOf(name) : `#${index + 1}`;
  if (!SCRIPT_PARAMETER_NAME.test(name) || seen.has(name)) return bad(label);
  if (Object.keys(raw).some((key) => !PARAMETER_FIELDS.includes(key))) return bad(label);
  const type = PARAMETER_TYPES.find((candidate) => candidate === raw.type);
  if (!type) return bad(label);
  if (raw.description !== undefined && typeof raw.description !== "string") return bad(label);
  if (raw.required !== undefined && typeof raw.required !== "boolean") return bad(label);
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (description.length > SCRIPT_PARAMETER_DESCRIPTION_MAX) return bad(label);
  let options: string[] | undefined;
  if (raw.options !== undefined) {
    const listed = raw.options;
    if (type !== "text" || !Array.isArray(listed) || listed.length === 0 || listed.length > SCRIPT_OPTIONS_MAX) return bad(label);
    if (!listed.every((option): option is string => typeof option === "string" && option.length > 0 && option.length <= SCRIPT_OPTION_MAX)) return bad(label);
    if (new Set(listed).size !== listed.length) return bad(label);
    options = [...listed];
  }
  seen.add(name);
  return { name, type, description, required: raw.required === true, ...(options ? { options } : {}) };
}

/**
 * Reads a `manifest.json`. `folder` is the name of the folder it sits in (the
 * name must equal it); without it that check is skipped. Never throws.
 */
export function parseScriptManifest(content: string, folder?: string): ParsedScriptManifest {
  const source = content.startsWith(BYTE_ORDER_MARK) ? content.slice(1) : content;
  let doc: unknown;
  try {
    doc = JSON.parse(source);
  } catch {
    return { script: null, problems: [{ code: "manifest-json" }] };
  }
  if (!isMap(doc)) return { script: null, problems: [{ code: "manifest-json" }] };
  const problems: ScriptProblem[] = [];
  for (const key of Object.keys(doc)) if (!MANIFEST_FIELDS.includes(key)) problems.push({ code: "field-unknown", detail: detailOf(key) });
  const textField = (key: "name" | "title" | "description" | "version"): string => {
    const value = doc[key];
    if (value === undefined) return "";
    if (typeof value !== "string") {
      problems.push({ code: "field-type", detail: key });
      return "";
    }
    return value.trim();
  };

  const name = textField("name");
  if (!name) problems.push({ code: "name-missing" });
  else if (name.length > SCRIPT_NAME_MAX || !SCRIPT_NAME_PATTERN.test(name)) problems.push({ code: "name-characters", detail: detailOf(name) });
  else if (folder !== undefined && folder !== name) problems.push({ code: "name-folder", detail: detailOf(folder) });

  const description = textField("description");
  if (!description) problems.push({ code: "description-missing" });
  else if (description.length > SCRIPT_DESCRIPTION_MAX) problems.push({ code: "description-too-long" });

  const title = textField("title");
  if (title.length > SCRIPT_TITLE_MAX) problems.push({ code: "field-type", detail: "title" });
  const version = textField("version");
  if (version.length > SCRIPT_VERSION_MAX) problems.push({ code: "field-type", detail: "version" });

  const tools: string[] = [];
  if (doc.tools !== undefined) {
    if (!Array.isArray(doc.tools) || doc.tools.length > SCRIPT_TOOLS_MAX) problems.push({ code: "field-type", detail: "tools" });
    else
      for (const entry of doc.tools) {
        if (typeof entry !== "string" || !TOOL_NAME_PATTERN.test(entry) || !toolByName(entry)) problems.push({ code: "tool-unknown", detail: detailOf(entry) });
        else if (!SCRIPT_TOOL_NAMES.includes(entry)) problems.push({ code: "tool-not-for-scripts", detail: entry });
        else if (!tools.includes(entry)) tools.push(entry);
      }
  }

  const parameters: ScriptParameter[] = [];
  if (doc.input !== undefined) {
    if (!Array.isArray(doc.input)) problems.push({ code: "field-type", detail: "input" });
    else if (doc.input.length > SCRIPT_PARAMETERS_MAX) problems.push({ code: "input-too-many" });
    else {
      const seen = new Set<string>();
      doc.input.forEach((raw, index) => {
        const parameter = readParameter(raw, index, seen, problems);
        if (parameter) parameters.push(parameter);
      });
    }
  }

  const limits: ScriptLimits = { ...SCRIPT_LIMIT_DEFAULTS };
  if (doc.limits !== undefined) {
    if (!isMap(doc.limits)) problems.push({ code: "field-type", detail: "limits" });
    else
      for (const [key, value] of Object.entries(doc.limits)) {
        const bounds = Object.prototype.hasOwnProperty.call(SCRIPT_LIMIT_BOUNDS, key) ? SCRIPT_LIMIT_BOUNDS[key as keyof ScriptLimits] : null;
        if (!bounds || typeof value !== "number" || !Number.isInteger(value) || value < bounds[0] || value > bounds[1]) problems.push({ code: "limit-value", detail: detailOf(key) });
        else limits[key as keyof ScriptLimits] = value;
      }
  }

  return {
    script: { name, ...(title ? { title: title.slice(0, SCRIPT_TITLE_MAX) } : {}), description, ...(version ? { version: version.slice(0, SCRIPT_VERSION_MAX) } : {}), tools, parameters, limits },
    problems,
  };
}

/** Writes a manifest — for a script the user makes here. Only what differs from the defaults is written. */
export function serializeScriptManifest(script: Pick<ScriptDefinition, "name" | "description"> & Partial<Pick<ScriptDefinition, "title" | "version" | "tools" | "parameters" | "limits">>): string {
  const limits = Object.fromEntries(Object.entries(script.limits ?? {}).filter(([key, value]) => SCRIPT_LIMIT_DEFAULTS[key as keyof ScriptLimits] !== value));
  const doc: Record<string, unknown> = { name: script.name };
  if (script.title) doc.title = script.title;
  doc.description = script.description;
  if (script.version) doc.version = script.version;
  doc.tools = [...(script.tools ?? [])];
  if (script.parameters?.length) {
    doc.input = script.parameters.map((p) => ({ name: p.name, type: p.type, ...(p.description ? { description: p.description } : {}), ...(p.required ? { required: true } : {}), ...(p.options ? { options: [...p.options] } : {}) }));
  }
  if (Object.keys(limits).length) doc.limits = limits;
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export type ScriptInput = Record<string, string | number | boolean>;

/**
 * What a caller hands a script, held against its parameters: every required
 * value there, every value of its type, nothing the manifest does not name.
 * Never throws; the error names the parameter, not the value.
 */
export function parseScriptInput(parameters: readonly ScriptParameter[], raw: unknown): { ok: true; value: ScriptInput } | { ok: false; error: string } {
  if (raw !== undefined && raw !== null && !isMap(raw)) return { ok: false, error: "input: must be an object" };
  const given = (raw ?? {}) as Record<string, unknown>;
  const unknown = Object.keys(given).find((key) => !parameters.some((p) => p.name === key));
  if (unknown !== undefined) return { ok: false, error: `${detailOf(unknown)}: is not a parameter of this script` };
  const value: ScriptInput = {};
  for (const parameter of parameters) {
    const v = given[parameter.name];
    if (v === undefined || v === null) {
      if (parameter.required) return { ok: false, error: `${parameter.name}: is required` };
      continue;
    }
    if (parameter.type === "text") {
      if (typeof v !== "string") return { ok: false, error: `${parameter.name}: must be a text` };
      if (v.length > SCRIPT_TEXT_INPUT_MAX) return { ok: false, error: `${parameter.name}: is longer than ${SCRIPT_TEXT_INPUT_MAX} characters` };
      if (parameter.options && !parameter.options.includes(v)) return { ok: false, error: `${parameter.name}: must be one of ${parameter.options.join(", ")}` };
      value[parameter.name] = v;
    } else if (parameter.type === "number") {
      if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, error: `${parameter.name}: must be a number` };
      value[parameter.name] = v;
    } else {
      if (typeof v !== "boolean") return { ok: false, error: `${parameter.name}: must be true or false` };
      value[parameter.name] = v;
    }
  }
  return { ok: true, value };
}

/** A script's parameters as the schema of a tool's arguments. */
export function scriptInputSchema(parameters: readonly ScriptParameter[]): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const parameter of parameters) {
    let field: z.ZodType;
    if (parameter.type === "number") field = z.number();
    else if (parameter.type === "boolean") field = z.boolean();
    else if (parameter.options?.length) field = z.enum(parameter.options as [string, ...string[]]);
    else field = z.string().max(SCRIPT_TEXT_INPUT_MAX);
    if (parameter.description) field = field.describe(parameter.description);
    shape[parameter.name] = parameter.required ? field : field.optional();
  }
  return z.strictObject(shape);
}

/** The name a script is called by: `script_` and its own, the hyphens as underscores. */
export function scriptToolName(name: string): string {
  return `script_${name.replace(/-/g, "_")}`;
}

/** Whether a tool's name is a script's — never one of the app's own tools. */
export function isScriptToolName(name: string): boolean {
  return /^script_[a-z][a-z0-9_]*$/.test(name) && !toolByName(name);
}

/** The script a tool's name stands for. A script's name carries no underscore, so the way back is exact. */
export function scriptNameOfTool(tool: string): string {
  return tool.slice("script_".length).replace(/_/g, "-");
}

/**
 * A script as a tool of one run (like a foreign server's tool, it is not in
 * the registry): built from the script the user approved, found through the
 * tool search, called through the dispatcher. Its data classes are those of
 * the tools it may call; its result is a program's output — tier 3.
 */
export function scriptToolManifest(id: string, script: ScriptDefinition): ToolManifest {
  const dataClasses = new Set<ToolDataClass>();
  for (const name of script.tools) for (const dataClass of toolByName(name)?.dataClasses ?? []) dataClasses.add(dataClass);
  return {
    name: scriptToolName(script.name),
    description: script.description.replace(/\s+/g, " ").trim().slice(0, TOOL_DESCRIPTION_LIMIT),
    risk: "script",
    input: scriptInputSchema(script.parameters),
    dataClasses: [...dataClasses],
    untrustedResult: true,
    core: false,
    surfaces: ["harness"],
    native: null,
    pageLimit: 1,
    script: { id, name: script.name, effect: script.tools.some((name) => !["read", "ui"].includes(toolByName(name)?.risk ?? "")) },
  };
}
