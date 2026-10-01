import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { normalizeFolder } from "../policy.js";
import type { ToolDataClass, ToolRiskClass } from "../tools.js";

/**
 * A skill in the Agent Skills format (agentskills.io, ADR 0020): a folder with
 * `SKILL.md` — YAML frontmatter, then Markdown instructions. Plainva reads the
 * format unchanged, so a skill written here runs in other harnesses and
 * theirs here. The checks follow the reference validator `skills-ref` (a
 * skill it accepts is accepted here). Plainva's own fields live in
 * `metadata` under `plainva.`; each of them can only narrow what the tools
 * allow (plan KI-Harness P3).
 */

export const SKILL_FILE = "SKILL.md";
export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 1024;
export const SKILL_COMPATIBILITY_MAX = 500;
/** The six fields of the format; anything else is reported, as `skills-ref` does. */
export const SKILL_FIELDS = ["name", "description", "license", "compatibility", "metadata", "allowed-tools"] as const;

export type SkillProblemCode =
  | "skill-file-missing"
  | "frontmatter-missing"
  | "frontmatter-unclosed"
  | "frontmatter-yaml"
  | "frontmatter-not-map"
  | "field-unknown"
  | "name-missing"
  | "name-too-long"
  | "name-uppercase"
  | "name-hyphen"
  | "name-characters"
  | "name-folder"
  | "description-missing"
  | "description-too-long"
  | "compatibility-too-long"
  | "field-not-text"
  | "metadata-not-map"
  | "plainva-value";

/** A finding about a skill file; `detail` names the field or value, never more of the file. */
export interface SkillProblem {
  code: SkillProblemCode;
  detail?: string;
}

/** Highest risk class a skill's tools may have — the classes that exist before writes (P5). */
export type SkillRisk = Extract<ToolRiskClass, "read" | "ui">;

/** Plainva's metadata, each value read defensively; a value that does not parse is dropped, never widened. */
export interface PlainvaSkillMeta {
  version?: string;
  /** The highest risk class among the tools the skill may use. */
  risk?: SkillRisk;
  /** Only tools whose data classes all lie within these. */
  dataClasses?: ToolDataClass[];
  /** Tools and context only inside these folders (normalized, ending in "/"). */
  folders?: string[];
  /** Output tokens of a run that starts with the skill, at most. */
  budgetTokens?: number;
  /** Meant for a model on this device — a hint in the send overview, never a block. */
  localPreferred?: boolean;
  /** One free argument the skill asks for (the MCP prompt, the start dialog). */
  argument?: { name: string; description: string };
  /** A display name; the folder name is the identity. */
  title?: string;
  /** Test scenarios, relative to the skill folder (the skill test harness). */
  tests?: string;
}

export interface SkillDefinition {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  /** `metadata` as the file writes it, values as text. */
  metadata: Record<string, string>;
  /** `allowed-tools` as listed; null when the field is absent (the skill uses what the conversation has). */
  allowedTools: string[] | null;
  /** The instructions: the Markdown after the frontmatter, trimmed. */
  body: string;
  plainva: PlainvaSkillMeta;
}

export interface ParsedSkillFile {
  /** Null when the file cannot be a skill at all; with problems a skill is not run. */
  skill: SkillDefinition | null;
  problems: SkillProblem[];
}

const RISKS: readonly SkillRisk[] = ["read", "ui"];
const DATA_CLASSES: readonly ToolDataClass[] = ["notes", "structure", "tasks", "calendar", "mail", "web", "commands"];

/** Scalars as `skills-ref` reads them (everything is text there); null for maps and lists. */
function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/**
 * Name rules of the format: lowercase letters (any script) and digits with
 * single hyphens between them, at most 64 characters, equal to the folder.
 */
export function skillNameProblems(raw: string, folder?: string): SkillProblem[] {
  const name = raw.trim().normalize("NFKC");
  if (!name) return [{ code: "name-missing" }];
  const problems: SkillProblem[] = [];
  if ([...name].length > SKILL_NAME_MAX) problems.push({ code: "name-too-long", detail: name });
  if (name !== name.toLowerCase()) problems.push({ code: "name-uppercase", detail: name });
  if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) problems.push({ code: "name-hyphen", detail: name });
  if (!/^[\p{L}\p{N}-]+$/u.test(name)) problems.push({ code: "name-characters", detail: name });
  if (folder !== undefined && folder.normalize("NFKC") !== name) problems.push({ code: "name-folder", detail: folder });
  return problems;
}

/** Plainva's fields from `metadata`; what does not parse is reported and left out. */
function plainvaMeta(metadata: Record<string, string>, problems: SkillProblem[]): PlainvaSkillMeta {
  const meta: PlainvaSkillMeta = {};
  const bad = (key: string) => problems.push({ code: "plainva-value", detail: key });
  const words = (value: string) => value.split(/[\s,]+/).filter(Boolean);
  for (const [key, value] of Object.entries(metadata)) {
    if (!key.startsWith("plainva.")) continue;
    const v = value.trim();
    switch (key) {
      case "plainva.version":
        if (v) meta.version = v.slice(0, 32);
        break;
      case "plainva.risk":
        if ((RISKS as readonly string[]).includes(v)) meta.risk = v as SkillRisk;
        else bad(key);
        break;
      case "plainva.data-classes": {
        const listed = words(v);
        const known = listed.filter((w): w is ToolDataClass => (DATA_CLASSES as readonly string[]).includes(w));
        // An unknown class narrows to nothing rather than being ignored: the author meant less, not more.
        if (known.length !== listed.length) bad(key);
        meta.dataClasses = known;
        break;
      }
      case "plainva.folders": {
        const folders = v.split(",").map((f) => normalizeFolder(f.trim())).filter((f) => f !== "" && !f.split("/").includes(".."));
        if (!folders.length) bad(key);
        // No usable folder narrows to none: a skill that names folders never sees the whole vault.
        meta.folders = folders;
        break;
      }
      case "plainva.budget-tokens": {
        const n = Number(v);
        if (Number.isInteger(n) && n > 0) meta.budgetTokens = n;
        else bad(key);
        break;
      }
      case "plainva.local":
        if (v === "preferred") meta.localPreferred = true;
        else bad(key);
        break;
      case "plainva.argument": {
        const name = v.slice(0, 40);
        if (/^[a-z][a-z0-9-]*$/.test(name)) meta.argument = { name, description: (metadata["plainva.argument-description"] ?? "").trim().slice(0, 200) };
        else bad(key);
        break;
      }
      case "plainva.argument-description":
        break;
      case "plainva.title":
        if (v) meta.title = v.slice(0, 80);
        break;
      case "plainva.tests":
        if (v && !v.startsWith("/") && !v.split("/").includes("..")) meta.tests = v;
        else bad(key);
        break;
      default:
        // Another tool's or a later version's key: kept in `metadata`, read by nobody here.
        break;
    }
  }
  return meta;
}

/**
 * Reads a `SKILL.md`. `folder` is the name of the folder it sits in (the
 * name must equal it); without it that check is skipped. Never throws.
 */
export function parseSkillFile(content: string, folder?: string): ParsedSkillFile {
  const problems: SkillProblem[] = [];
  const source = content.replace(/^\uFEFF/, "");
  if (!source.startsWith("---")) return { skill: null, problems: [{ code: "frontmatter-missing" }] };
  // As the reference parser splits it: the first two `---` delimit the frontmatter.
  const parts = source.split("---");
  if (parts.length < 3) return { skill: null, problems: [{ code: "frontmatter-unclosed" }] };
  const front = parts[1]!;
  const body = parts.slice(2).join("---").trim();
  let doc: unknown;
  try {
    doc = parseYaml(front);
  } catch {
    return { skill: null, problems: [{ code: "frontmatter-yaml" }] };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { skill: null, problems: [{ code: "frontmatter-not-map" }] };
  const fields = doc as Record<string, unknown>;
  for (const key of Object.keys(fields)) if (!(SKILL_FIELDS as readonly string[]).includes(key)) problems.push({ code: "field-unknown", detail: key });

  const name = text(fields.name)?.trim().normalize("NFKC") ?? "";
  if (fields.name !== undefined && text(fields.name) === null) problems.push({ code: "field-not-text", detail: "name" });
  problems.push(...skillNameProblems(name, folder));

  const description = text(fields.description)?.trim() ?? "";
  if (!description) problems.push({ code: "description-missing" });
  else if (description.length > SKILL_DESCRIPTION_MAX) problems.push({ code: "description-too-long" });

  const optional = (key: "license" | "compatibility" | "allowed-tools"): string | undefined => {
    if (fields[key] === undefined || fields[key] === null) return undefined;
    const value = text(fields[key]);
    if (value === null) {
      problems.push({ code: "field-not-text", detail: key });
      return undefined;
    }
    return value.trim();
  };
  const license = optional("license");
  const compatibility = optional("compatibility");
  if (compatibility !== undefined && (compatibility.length === 0 || compatibility.length > SKILL_COMPATIBILITY_MAX)) problems.push({ code: "compatibility-too-long" });
  const allowed = optional("allowed-tools");

  const metadata: Record<string, string> = {};
  if (fields.metadata !== undefined && fields.metadata !== null) {
    if (typeof fields.metadata !== "object" || Array.isArray(fields.metadata)) problems.push({ code: "metadata-not-map" });
    else
      for (const [key, value] of Object.entries(fields.metadata as Record<string, unknown>)) {
        const v = text(value);
        if (v === null) problems.push({ code: "field-not-text", detail: `metadata.${key}` });
        else metadata[key] = v;
      }
  }

  const skill: SkillDefinition = {
    name,
    description,
    ...(license ? { license } : {}),
    ...(compatibility ? { compatibility } : {}),
    metadata,
    allowedTools: allowed === undefined ? null : allowed.split(/\s+/).filter(Boolean),
    body,
    plainva: plainvaMeta(metadata, problems),
  };
  return { skill, problems };
}

/** Problems that keep a skill from running; a `plainva-value` only drops that value. */
export function blockingProblems(problems: readonly SkillProblem[]): SkillProblem[] {
  return problems.filter((p) => p.code !== "plainva-value");
}

/** Writes a skill as `SKILL.md` — for one the user creates or copies here; an existing file is never rewritten. */
export function serializeSkillFile(skill: Pick<SkillDefinition, "name" | "description" | "body"> & Partial<Pick<SkillDefinition, "license" | "compatibility" | "metadata" | "allowedTools">>): string {
  const front: Record<string, unknown> = { name: skill.name, description: skill.description };
  if (skill.license) front.license = skill.license;
  if (skill.compatibility) front.compatibility = skill.compatibility;
  if (skill.allowedTools?.length) front["allowed-tools"] = skill.allowedTools.join(" ");
  if (skill.metadata && Object.keys(skill.metadata).length) front.metadata = { ...skill.metadata };
  const yaml = stringifyYaml(front, { lineWidth: 0, defaultStringType: "PLAIN", defaultKeyType: "PLAIN" }).trimEnd();
  return `---\n${yaml}\n---\n\n${skill.body.trim()}\n`;
}
