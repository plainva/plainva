import { isSystemJunkName } from "../../vault/systemJunk.js";
import { sha256Hex, utf8Encode } from "../../workspace/encoding.js";
import { stripInvisible } from "../trust.js";
import { parseSkillFile, SKILL_FILE, type SkillDefinition, type SkillProblem } from "./skillFile.js";

/**
 * Where approved instructions come from (ADR 0020, plan KI-Harness P3):
 * skills in `.agent/skills/<name>/` and an `AGENTS.md` at the vault's root,
 * read with every file's SHA-256 — an approval binds exactly those values.
 * Memory rules (P6), routines (P8) and skills a connected MCP server offers
 * (P4.5) will come in as further kinds through the same approval.
 */

export const SKILLS_FOLDER = ".agent/skills";
export const AGENTS_FILE = "AGENTS.md";

/** Per skill: at most this many files and bytes, and this much `SKILL.md` — a skill is instructions, not a library. */
export const SKILL_MAX_FILES = 64;
export const SKILL_MAX_BYTES = 1_048_576;
export const SKILL_MAIN_MAX_BYTES = 65_536;
export const AGENTS_MAX_BYTES = 16_384;
/** How deep a skill's own folders go: `references/`, `assets/` and one level below. */
const SKILL_MAX_DEPTH = 4;

export type InstructionKind = "skill" | "agents";
export type InstructionOrigin = "plainva" | "vault";

export interface InstructionFile {
  /** Relative to the source's root folder (`SKILL.md`, `references/terms.md`); for `AGENTS.md` its own name. */
  path: string;
  bytes: number;
  sha256: string;
}

export interface InstructionSource {
  /** `plainva:<name>` for a skill that comes with the app; the vault path of the folder or file otherwise. */
  id: string;
  kind: InstructionKind;
  origin: InstructionOrigin;
  /** The vault folder of a skill (`.agent/skills/<folder>`), `""` for `AGENTS.md` and the app's skills. */
  root: string;
  files: InstructionFile[];
  /** The main file's text (`SKILL.md`, `AGENTS.md`); null when it is missing or too large. */
  text: string | null;
  /** Parsed for a skill; null for `AGENTS.md` and for a file that is no skill. */
  skill: SkillDefinition | null;
  problems: SkillProblem[];
  /** Over the limits above: never approvable, never read in full. */
  tooLarge: boolean;
  /**
   * Invisible characters in the main file (zero-width, bidirectional, tag
   * characters): the approval dialog says so, and none of them reaches a
   * model — the user approves what they can see.
   */
  invisible?: number;
}

/** The vault as the scan needs it: folder entries and file bytes, nothing written. */
export interface InstructionIO {
  /** Entries directly inside a vault folder; empty when it does not exist. */
  list(folder: string): Promise<{ name: string; folder: boolean }[]>;
  /** A file's bytes; null when it does not exist. */
  read(path: string): Promise<Uint8Array | null>;
}

const decoder = new TextDecoder("utf-8", { fatal: false });

/** The hash the scan gives a file — what an approval binds. */
export function instructionFileHash(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}

/** A skill that comes with the app: its `SKILL.md`, read as it is bundled. */
export function appSkillSource(folder: string, text: string): InstructionSource {
  const parsed = parseSkillFile(text, folder);
  const bytes = utf8Encode(text);
  return {
    id: `plainva:${folder}`,
    kind: "skill",
    origin: "plainva",
    root: "",
    files: [{ path: SKILL_FILE, bytes: bytes.length, sha256: sha256Hex(bytes) }],
    text,
    skill: parsed.skill,
    problems: parsed.problems,
    tooLarge: false,
  };
}

async function walk(io: InstructionIO, folder: string, prefix: string, depth: number, into: string[]): Promise<boolean> {
  for (const entry of await io.list(folder)) {
    if (isSystemJunkName(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.folder) {
      if (depth >= SKILL_MAX_DEPTH) return false;
      if (!(await walk(io, `${folder}/${entry.name}`, rel, depth + 1, into))) return false;
    } else {
      into.push(rel);
      if (into.length > SKILL_MAX_FILES) return false;
    }
  }
  return true;
}

/** One skill folder: every file hashed (in path order), the main file parsed. */
export async function scanSkillFolder(io: InstructionIO, folder: string): Promise<InstructionSource> {
  const root = `${SKILLS_FOLDER}/${folder}`;
  const source: InstructionSource = { id: root, kind: "skill", origin: "vault", root, files: [], text: null, skill: null, problems: [], tooLarge: false };
  const paths: string[] = [];
  if (!(await walk(io, root, "", 1, paths))) return { ...source, tooLarge: true };
  paths.sort();
  let total = 0;
  let main: Uint8Array | null = null;
  const mainName = paths.includes(SKILL_FILE) ? SKILL_FILE : paths.includes("skill.md") ? "skill.md" : null;
  for (const rel of paths) {
    const bytes = await io.read(`${root}/${rel}`);
    if (!bytes) continue;
    total += bytes.length;
    if (total > SKILL_MAX_BYTES) return { ...source, files: [], tooLarge: true };
    source.files.push({ path: rel, bytes: bytes.length, sha256: sha256Hex(bytes) });
    if (rel === mainName) main = bytes;
  }
  if (!main) return { ...source, problems: [{ code: "skill-file-missing" }] };
  if (main.length > SKILL_MAIN_MAX_BYTES) return { ...source, tooLarge: true };
  const text = decoder.decode(main);
  const parsed = parseSkillFile(text, folder);
  const invisible = stripInvisible(text).removed;
  return { ...source, text, skill: parsed.skill, problems: parsed.problems, ...(invisible ? { invisible } : {}) };
}

/** The vault's own instructions: every skill folder and a root `AGENTS.md`. */
export async function scanVaultInstructions(io: InstructionIO): Promise<InstructionSource[]> {
  const sources: InstructionSource[] = [];
  const folders = (await io.list(SKILLS_FOLDER).catch(() => [])).filter((e) => e.folder && !isSystemJunkName(e.name)).map((e) => e.name);
  for (const folder of folders.sort()) sources.push(await scanSkillFolder(io, folder).catch(() => brokenSkill(folder)));
  const agents = await scanAgents(io);
  if (agents) sources.push(agents);
  return sources;
}

/** The root AGENTS.md as a source; null when there is none. */
async function scanAgents(io: InstructionIO): Promise<InstructionSource | null> {
  const agents = await io.read(AGENTS_FILE).catch(() => null);
  if (!agents) return null;
  const file = { path: AGENTS_FILE, bytes: agents.length, sha256: sha256Hex(agents) };
  const tooLarge = agents.length > AGENTS_MAX_BYTES;
  const text = tooLarge ? null : decoder.decode(agents);
  const invisible = text === null ? 0 : stripInvisible(text).removed;
  return { id: AGENTS_FILE, kind: "agents", origin: "vault", root: "", files: [file], text, skill: null, problems: [], tooLarge, ...(invisible ? { invisible } : {}) };
}

/** One source of the vault as it is now — a skill folder or the root AGENTS.md; null when it is gone. */
export async function scanInstruction(io: InstructionIO, id: string): Promise<InstructionSource | null> {
  if (id === AGENTS_FILE) return scanAgents(io);
  const prefix = `${SKILLS_FOLDER}/`;
  if (!id.startsWith(prefix) || id.slice(prefix.length).includes("/")) return null;
  const source = await scanSkillFolder(io, id.slice(prefix.length)).catch(() => null);
  return source && (source.files.length || source.tooLarge) ? source : null;
}

/**
 * A file of a source as the scan saw it: its bytes must still hash to the
 * scanned value — a file changed since does not count as approved — and be
 * UTF-8 text. Null otherwise.
 */
export async function readInstructionFile(io: InstructionIO, source: InstructionSource, rel: string): Promise<string | null> {
  const file = source.files.find((f) => f.path === rel);
  if (!file) return null;
  const bytes = await io.read(source.root ? `${source.root}/${rel}` : rel).catch(() => null);
  if (!bytes || sha256Hex(bytes) !== file.sha256) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** A folder the scan could not read: shown, never run. */
function brokenSkill(folder: string): InstructionSource {
  const root = `${SKILLS_FOLDER}/${folder}`;
  return { id: root, kind: "skill", origin: "vault", root, files: [], text: null, skill: null, problems: [{ code: "skill-file-missing" }], tooLarge: false };
}
