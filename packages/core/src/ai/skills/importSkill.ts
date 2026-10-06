import { isSystemJunkName } from "../../vault/systemJunk.js";
import { sha256Hex, utf8Encode } from "../../workspace/encoding.js";
import { toolByName } from "../tools.js";
import { blockingProblems, parseSkillFile, type SkillDefinition, type SkillProblem } from "./skillFile.js";
import { isSkillEntryLeftOut, SKILL_MAIN_MAX_BYTES, SKILL_MAX_BYTES, SKILL_MAX_FILES } from "./sources.js";

/**
 * A skill from outside — a folder or an archive (`.zip`, `.skill`) the user
 * picked (plan KI-Harness P3-5, §14.3: "import only after a check of its
 * origin"). Read here, before anything is written: exactly one skill, paths
 * that stay inside it, the size limits, the format — and what the user should
 * know before approving it: scripts Plainva does not run, tools it does not
 * have, files that are no text, the licence. Written into the vault, the
 * skill keeps its bytes; where it came from is noted on this device only.
 */

export interface ImportedFile {
  /** The path inside the folder or archive, as the reader gives it. */
  path: string;
  bytes: Uint8Array;
}

export type ImportBlock =
  /** No SKILL.md anywhere. */
  | "no-skill"
  /** More than one SKILL.md: one skill per import. */
  | "several-skills"
  /** A path that would leave the skill's folder (`..`, absolute, a drive). */
  | "unsafe-path"
  /** Over the limits of a skill. */
  | "too-large"
  /** The SKILL.md breaks the format; the problems say how. */
  | "invalid";

export interface SkillImport {
  /** The skill's name — its folder under `.agent/skills/`. */
  name: string;
  /** The skill's files, relative to its own folder, with their SHA-256. */
  files: { path: string; bytes: Uint8Array; sha256: string }[];
  skill: SkillDefinition | null;
  problems: SkillProblem[];
  /** Null when it can be imported. */
  blocked: ImportBlock | null;
  /**
   * One SHA-256 over the skill's files (paths and their hashes, sorted): the
   * same in both shells, whatever the archive packed around it — noted with
   * the approval as where it came from.
   */
  contentHash: string;
  /** What the dialog says before the approval. */
  notes: {
    /** Files in `scripts/`: Plainva runs no scripts (P5.5 at the earliest, in a sandbox). */
    scripts: string[];
    /** Tools in `allowed-tools` that Plainva does not have: the skill runs without them. */
    unknownTools: string[];
    /** Files that are no text a reader could check. */
    binaries: string[];
    license?: string;
  };
}

const TEXT_FILE = /\.(md|markdown|txt|json|csv|tsv|ya?ml|xml|html?|css|js|mjs|ts|py|sh)$/i;
const JUNK_DIR = /^(__MACOSX|\.git)(\/|$)/;

function safePath(raw: string): string | null {
  const p = raw.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  if (!p || p.startsWith("/") || /^[a-z]:/i.test(p) || p.includes("\0")) return null;
  const parts = p.split("/");
  if (parts.some((part) => part === ".." || part === ".")) return null;
  // A trailing slash is a folder entry of the archive, not a file.
  return parts.filter((part, i) => part !== "" || i === parts.length - 1).join("/");
}

export function readSkillImport(entries: readonly ImportedFile[]): SkillImport {
  const empty = (blocked: ImportBlock, problems: SkillProblem[] = []): SkillImport => ({ name: "", files: [], skill: null, problems, blocked, contentHash: "", notes: { scripts: [], unknownTools: [], binaries: [] } });
  const files: ImportedFile[] = [];
  for (const entry of entries) {
    const path = safePath(entry.path);
    if (path === null) return empty("unsafe-path");
    if (!path || path.endsWith("/") || JUNK_DIR.test(path) || path.split("/").some(isSystemJunkName)) continue;
    files.push({ path, bytes: entry.bytes });
  }
  const mains = files.filter((f) => /(^|\/)skill\.md$/i.test(f.path));
  if (mains.length === 0) return empty("no-skill");
  if (mains.length > 1) return empty("several-skills");
  const main = mains[0]!;
  // The folder that holds SKILL.md is the skill, however deep the archive put it (a repository's zip: repo-main/skills/name/).
  const root = main.path.includes("/") ? main.path.slice(0, main.path.lastIndexOf("/") + 1) : "";
  // Hidden entries inside the skill's folder are not the skill — the same rule as the scan's, so what is written is
  // what the scan finds afterwards. The folders that lead to it may well be hidden (`.agent/skills/name/` in a vault's zip).
  const own = files
    .filter((f) => f.path.startsWith(root))
    .map((f) => ({ path: f.path.slice(root.length), bytes: f.bytes }))
    .filter((f) => !f.path.split("/").some(isSkillEntryLeftOut));
  const total = own.reduce((sum, f) => sum + f.bytes.length, 0);
  if (own.length > SKILL_MAX_FILES || total > SKILL_MAX_BYTES || main.bytes.length > SKILL_MAIN_MAX_BYTES) return empty("too-large");

  const text = new TextDecoder("utf-8", { fatal: false }).decode(main.bytes);
  const folder = root ? root.slice(0, -1).split("/").pop() : undefined;
  const parsed = parseSkillFile(text, folder);
  const name = parsed.skill?.name ?? folder ?? "";
  // The parser checks the name against the folder; at an archive's root, against the format alone.
  const problems = parsed.problems;
  const blocked = !parsed.skill || !name || blockingProblems(problems).length ? "invalid" : null;
  const mainRel = main.path.slice(root.length);
  const skillFiles = own
    .map((f) => ({ path: f.path === mainRel ? "SKILL.md" : f.path, bytes: f.bytes, sha256: sha256Hex(f.bytes) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    name,
    files: skillFiles,
    skill: parsed.skill,
    problems,
    blocked,
    contentHash: sha256Hex(utf8Encode(skillFiles.map((f) => `${f.path}\0${f.sha256}\n`).join(""))),
    notes: {
      scripts: own.filter((f) => f.path.startsWith("scripts/")).map((f) => f.path),
      unknownTools: (parsed.skill?.allowedTools ?? []).filter((tool) => !toolByName(tool)),
      binaries: own.filter((f) => !TEXT_FILE.test(f.path)).map((f) => f.path),
      ...(parsed.skill?.license ? { license: parsed.skill.license } : {}),
    },
  };
}
