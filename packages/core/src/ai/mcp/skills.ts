import { canonicalJson } from "../../settingsSync/canonicalJson.js";
import { fromBase64, sha256Hex, utf8Encode } from "../../workspace/encoding.js";
import { hiddenCharacters, stripInvisible, writesMarkup } from "../trust.js";
import { blockingProblems, parseSkillFile, readSkillFields, type SkillDefinition, type SkillProblem } from "../skills/skillFile.js";
import { SKILL_MAIN_MAX_BYTES, type InstructionSource } from "../skills/sources.js";

/**
 * Skills a connected MCP server serves (plan KI-Harness P9-4b, the MCP
 * skills extension `MCP_SKILLS_EXTENSION`, SEP-2640): what a server
 * lists of them, read and checked; the source of instructions each becomes
 * on this device; and the check of every byte that is read of one later.
 *
 * Three rules carry it, all of them the extension's own:
 * - **Nothing is read ahead.** A skill is listed with its frontmatter and
 *   its manifest — every file's address, size and SHA-256. Its files are
 *   read when they are needed: when a conversation loads the skill, or when
 *   the user asks to see its instructions. An approval binds the manifest.
 * - **Every byte is checked.** A file that is read must have the size and
 *   the digest the manifest names, and `SKILL.md` must say in its
 *   frontmatter, field for field, what the server listed. What fails is not
 *   used.
 * - **A skill is its server and its address.** The name is a label: two
 *   skills of one name never stand for each other, and a server's skill
 *   never for one of the vault or the app. The server is who this device
 *   calls it — the id the user gave it —, never what it calls itself.
 */

export const MCP_SKILL_LIMITS = {
  /** Skills of one server that are read, at most. */
  skills: 64,
  /** Files of one skill: the extension's limit, which a host must carry. */
  files: 512,
  /** Bytes of one skill, all its files together: the extension's limit. */
  bytes: 16 * 1024 * 1024,
  /** An address. */
  uri: 2048,
  /** The frontmatter as it is listed, serialized. */
  frontmatter: 16_384,
  /** Addresses the user added by hand to one server. */
  added: 16,
  /** A file of a skill that is read for a model or a person, at most: a skill is instructions, not a library. */
  readable: 1_048_576,
} as const;

const SKILL_SUFFIX = "/SKILL.md";
const DIGEST = /^sha256:([0-9a-f]{64})$/;

export interface McpSkillFile {
  /** Relative to the skill's root (`SKILL.md`, `references/checklist.md`), as the address writes it. */
  path: string;
  uri: string;
  sha256: string;
  size: number;
}

export type McpSkillProblem =
  /** Generated content without a manifest: nothing could bind an approval to it, and Plainva declines it. */
  | "dynamic"
  /** The manifest is missing or broken: a file twice, one outside the skill, no `SKILL.md`, a digest or a size that does not read. */
  | "manifest"
  /** The address is not one of a skill's `SKILL.md` that Plainva reads. */
  | "address"
  /** The frontmatter is no map, or too large to keep. */
  | "frontmatter"
  /** Over 512 files or 16 MiB. */
  | "too-large"
  /** Another skill of the same server has this name: neither may stand for the other. */
  | "same-name";

export interface McpSkillEntry {
  /** The address of its `SKILL.md`: with the server, its identity. */
  uri: string;
  /** Its folder: the address without `/SKILL.md`. */
  root: string;
  /** The last segment of the folder — a label, never an identity. */
  name: string;
  /** Every field of its frontmatter as the server lists it; null where that is no map. */
  frontmatter: Record<string, unknown> | null;
  /** The manifest; empty where there is none to keep. */
  files: McpSkillFile[];
  /** What keeps it from being approved; null when nothing. */
  problem: McpSkillProblem | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether a text has a character below the blank or the delete character; with `blank`, the blank as well. Code points, so that no pattern holds one. */
export function mcpHasControl(text: string, blank = false): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || (blank && code === 0x20)) return true;
  }
  return false;
}

/**
 * Characters no address of a skill carries: control characters and blanks,
 * anything else a person cannot see (`hiddenCharacters`), markup (`<`, `>`,
 * quotes, the backtick and look-alike brackets — none is in a URI either), a
 * backslash, a query, a fragment. An address is shown in the review and its
 * path written into Plainva's own words to a model: it hides nothing there,
 * and writes nothing.
 */
const notInAddress = (text: string) => mcpHasControl(text, true) || hiddenCharacters(text) > 0 || writesMarkup(text) || /[\\?#]/.test(text);

/** Whether an address the user typed is one Plainva reads at all (`notInAddress`). */
export const mcpSkillUriReadable = (uri: string): boolean => !notInAddress(uri);
/** A dot or a slash in disguise: a path that says `..` without writing it. */
const DISGUISED = /%(2e|2f|5c)/i;

/** SHA-256 of a frontmatter as canonical JSON; null where it is nothing JSON can say. */
export function mcpFrontmatterHash(frontmatter: unknown): string | null {
  try {
    return sha256Hex(utf8Encode(canonicalJson(frontmatter)));
  } catch {
    return null;
  }
}

/** The folder name of a skill's root, read as text; null where there is none. */
function lastSegment(root: string): string | null {
  const at = root.lastIndexOf("/");
  const raw = at < 0 ? "" : root.slice(at + 1);
  if (!raw || raw === "." || raw === "..") return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** A file's path below the root, where it is one: segments that are not empty and do not climb. */
function relativeTo(root: string, uri: string): string | null {
  if (!uri.startsWith(`${root}/`)) return null;
  const rel = uri.slice(root.length + 1);
  if (!rel || DISGUISED.test(rel) || notInAddress(rel)) return null;
  return rel.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..") ? rel : null;
}

function readManifest(root: string, raw: unknown): { files: McpSkillFile[]; problem: McpSkillProblem | null } {
  if (raw === "dynamic") return { files: [], problem: "dynamic" };
  if (!Array.isArray(raw)) return { files: [], problem: "manifest" };
  if (raw.length > MCP_SKILL_LIMITS.files) return { files: [], problem: "too-large" };
  const files: McpSkillFile[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  for (const item of raw) {
    if (!isRecord(item) || typeof item.uri !== "string" || item.uri.length > MCP_SKILL_LIMITS.uri || typeof item.digest !== "string") return { files: [], problem: "manifest" };
    const digest = DIGEST.exec(item.digest);
    const size = item.size;
    if (!digest || typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) return { files: [], problem: "manifest" };
    const path = relativeTo(root, item.uri);
    if (path === null || seen.has(item.uri)) return { files: [], problem: "manifest" };
    seen.add(item.uri);
    bytes += size;
    files.push({ path, uri: item.uri, sha256: digest[1]!, size });
  }
  if (bytes > MCP_SKILL_LIMITS.bytes) return { files: [], problem: "too-large" };
  // The manifest names SKILL.md, exactly once: without it there is nothing to load and nothing to bind.
  const main = files.filter((f) => f.path === "SKILL.md");
  if (main.length !== 1) return { files: [], problem: "manifest" };
  // Instructions longer than a skill of the vault may have do not go into a conversation either.
  if (main[0]!.size > SKILL_MAIN_MAX_BYTES) return { files: [], problem: "too-large" };
  return { files: files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)), problem: null };
}

/** A frontmatter as canonical JSON; null where it is nothing JSON can say. */
function serialized(frontmatter: Record<string, unknown>): string | null {
  try {
    return canonicalJson(frontmatter);
  } catch {
    return null;
  }
}

/**
 * One entry of `skills/list` or `skills/get`, read and checked. Null where
 * there is not even an address to name it by: what has no identity is not
 * shown. Everything else is kept, with what keeps it from being approved.
 */
export function readMcpSkillEntry(raw: unknown): McpSkillEntry | null {
  if (!isRecord(raw) || typeof raw.uri !== "string" || !raw.uri || raw.uri.length > MCP_SKILL_LIMITS.uri || mcpHasControl(raw.uri)) return null;
  const uri = raw.uri;
  const root = uri.endsWith(SKILL_SUFFIX) ? uri.slice(0, -SKILL_SUFFIX.length) : uri;
  const name = lastSegment(root);
  const frontmatter = isRecord(raw.frontmatter) ? raw.frontmatter : null;
  const unusable = (problem: McpSkillProblem): McpSkillEntry => ({ uri, root, name: name ?? "", frontmatter: null, files: [], problem });
  // The name, read: percent-decoding must not bring back what the address could not carry.
  if (!uri.endsWith(SKILL_SUFFIX) || notInAddress(uri) || DISGUISED.test(uri) || name === null || hiddenCharacters(name) > 0) return unusable("address");
  const text = frontmatter ? serialized(frontmatter) : null;
  if (!frontmatter || text === null || text.length > MCP_SKILL_LIMITS.frontmatter) return unusable("frontmatter");
  const manifest = readManifest(root, raw.resources);
  return { uri, root, name, frontmatter, files: manifest.files, problem: manifest.problem };
}

/**
 * An entry as this device keeps it (plan P9-4b): what the server listed and
 * nothing more, in the server's own shape — read back with the same checks
 * (`readStoredMcpSkillEntries`), so a kept entry is never more than a
 * listed one. Only "too large" is kept as a word: its manifest is not.
 */
export function storedMcpSkillEntry(entry: McpSkillEntry): Record<string, unknown> {
  return {
    uri: entry.uri,
    frontmatter: entry.frontmatter,
    resources: entry.problem === "dynamic" ? "dynamic" : entry.files.map((f) => ({ uri: f.uri, digest: `sha256:${f.sha256}`, size: f.size })),
    ...(entry.problem === "too-large" ? { tooLarge: true } : {}),
  };
}

/** One kept entry, read the way a listing's is — and "too large" kept as it was said. */
function readStoredMcpSkillEntry(item: unknown): McpSkillEntry | null {
  const entry = readMcpSkillEntry(item);
  if (!entry || !isRecord(item) || item.tooLarge !== true || entry.problem === "address" || entry.problem === "frontmatter") return entry;
  return { ...entry, files: [], problem: "too-large" };
}

/** Kept entries, read the way a listing is read. */
export function readStoredMcpSkillEntries(raw: unknown): McpSkillEntry[] {
  const items = Array.isArray(raw) ? raw : [];
  return combineMcpSkillEntries(items.slice(0, MCP_SKILL_LIMITS.skills + MCP_SKILL_LIMITS.added).map(readStoredMcpSkillEntry).filter((entry): entry is McpSkillEntry => entry !== null));
}

/** A name as a key writes it: the format folds it (NFKC), and two names that fold alike are one key. */
const sameKey = (name: string) => name.normalize("NFKC").toLowerCase();

/**
 * Entries from several readings, in the order of precedence: the first of
 * each address counts — an address the user added before what the server
 * lists, so that a long list never pushes it out —, at most as many as are
 * kept. Where two skills come to one name, both are marked: a name is a
 * label, and which of the two a model means, nobody could tell. A mark of
 * an earlier reading is read anew, never kept.
 */
export function combineMcpSkillEntries(entries: readonly McpSkillEntry[]): McpSkillEntry[] {
  const out: McpSkillEntry[] = [];
  for (const entry of entries) {
    if (out.length >= MCP_SKILL_LIMITS.skills + MCP_SKILL_LIMITS.added) break;
    if (!out.some((other) => other.uri === entry.uri)) out.push(entry.problem === "same-name" ? { ...entry, problem: null } : entry);
  }
  const counts = new Map<string, number>();
  for (const entry of out) if (entry.name) counts.set(sameKey(entry.name), (counts.get(sameKey(entry.name)) ?? 0) + 1);
  return out.map((entry) => ((counts.get(sameKey(entry.name)) ?? 0) > 1 && entry.problem === null ? { ...entry, problem: "same-name" } : entry));
}

/** What a server lists, read: every entry that has an address, at most as many as are read (`combineMcpSkillEntries`). */
export function readMcpSkillEntries(items: readonly unknown[]): McpSkillEntry[] {
  return combineMcpSkillEntries(items.slice(0, MCP_SKILL_LIMITS.skills).map(readMcpSkillEntry).filter((entry): entry is McpSkillEntry => entry !== null));
}

/**
 * The id of a server's skill on this device: the server, its registration,
 * the address. `registration` is what is registered and when it was added
 * (`mcpSkillRegistration`): a server registered anew — even at the same
 * address, after it was removed — is another, and an approval of its skills
 * in another vault does not come back with it.
 */
export function mcpSkillSourceId(serverId: string, registration: string, uri: string): string {
  return `mcp:${serverId}:${mcpSkillRegistrationKey(registration)}:${uri}`;
}

/** What a skill's id carries of its server's registration (`readMcpSkillSourceId` reads it back): 12 hex characters of its SHA-256. */
export const mcpSkillRegistrationKey = (registration: string): string => sha256Hex(utf8Encode(registration)).slice(0, 12);

/** What makes a registration this one: what is registered, and when it was added on this device. */
export const mcpSkillRegistration = (target: string, addedAt: string): string => `${target}\n${addedAt}`;

/** The server, the key of its registration (`mcpSkillRegistrationKey`) and the address of a server skill's id; null for every other id. */
export function readMcpSkillSourceId(id: string): { serverId: string; registration: string; uri: string } | null {
  const match = /^mcp:([a-z][a-z0-9]{0,15}):([0-9a-f]{12}):(.+)$/s.exec(id);
  return match ? { serverId: match[1]!, registration: match[2]!, uri: match[3]! } : null;
}

/** How a person reads a server skill's id: the key the AI loads it by (`mcp_<server>/<name>`); null for every other id. */
export function mcpSkillIdLabel(id: string): string | null {
  const parsed = readMcpSkillSourceId(id);
  if (!parsed) return null;
  const root = parsed.uri.endsWith(SKILL_SUFFIX) ? parsed.uri.slice(0, -SKILL_SUFFIX.length) : parsed.uri;
  return `mcp_${parsed.serverId}/${lastSegment(root) ?? "?"}`;
}

const SERVER_PROBLEMS: Record<McpSkillProblem, SkillProblem["code"] | null> = {
  dynamic: "server-dynamic",
  manifest: "server-manifest",
  address: "server-address",
  frontmatter: "server-frontmatter",
  "too-large": null,
  "same-name": "server-same-name",
};

/** At most this many of the tools a server's skill names are kept, to say that they count for nothing here. */
const NAMED_TOOLS_MAX = 20;

/**
 * A skill of a server as a skill like the app's and the vault's, as far as
 * it can be one: read from the frontmatter it lists — without instructions,
 * since nothing of it was read —, its manifest as its files. What the format
 * lets a skill choose for itself counts for nothing in a server's skill: its
 * `allowed-tools` is ignored (the extension's rule) and so are Plainva's own
 * fields in `metadata`; what it may use is decided by where it comes from
 * (`serverSkillGrant`).
 */
export function mcpSkillSource(server: { id: string; label: string; registration: string }, entry: McpSkillEntry): InstructionSource {
  const parsed = entry.frontmatter ? readSkillFields(entry.frontmatter, "", entry.name) : null;
  const problems: SkillProblem[] = [...(parsed?.problems ?? [])];
  const mapped = entry.problem ? SERVER_PROBLEMS[entry.problem] : null;
  if (mapped) problems.unshift({ code: mapped });
  const frontmatter = entry.frontmatter ? mcpFrontmatterHash(entry.frontmatter) : null;
  if (entry.frontmatter && frontmatter === null && !mapped) problems.unshift({ code: "server-frontmatter" });
  const listed = parsed?.skill?.allowedTools ?? null;
  const skill: SkillDefinition | null = parsed?.skill ? { ...parsed.skill, allowedTools: null, plainva: {} } : null;
  const invisible = skill ? stripInvisible(`${skill.name}${skill.description}`).removed : 0;
  return {
    id: mcpSkillSourceId(server.id, server.registration, entry.uri),
    kind: "skill",
    origin: "server",
    root: entry.root,
    files: entry.files.map((f) => ({ path: f.path, bytes: f.size, sha256: f.sha256 })),
    text: null,
    skill,
    problems,
    tooLarge: entry.problem === "too-large",
    ...(invisible ? { invisible } : {}),
    server: {
      serverId: server.id,
      label: server.label,
      uri: entry.uri,
      frontmatter: frontmatter ?? "",
      ...(listed?.length ? { namedTools: listed.slice(0, NAMED_TOOLS_MAX).map((name) => name.slice(0, 80)) } : {}),
    },
  };
}

/**
 * The bytes of one file as `resources/read` returned it: the one content of
 * the asked address, its text as UTF-8 or its blob decoded. Null where the
 * answer is no such content — none, several, another address, neither text
 * nor blob, a blob that does not decode.
 */
export function mcpResourceBytes(result: Record<string, unknown>, uri: string): Uint8Array | null {
  const contents = Array.isArray(result.contents) ? result.contents.filter(isRecord) : [];
  const mine = contents.filter((content) => content.uri === uri);
  if (mine.length !== 1) return null;
  const content = mine[0]!;
  if (typeof content.text === "string" && content.blob === undefined) return utf8Encode(content.text);
  if (typeof content.blob === "string" && content.text === undefined) {
    try {
      return fromBase64(content.blob);
    } catch {
      return null;
    }
  }
  return null;
}

/** Whether bytes are the file the manifest names: its size, its SHA-256. */
export function mcpSkillFileMatches(file: Pick<McpSkillFile, "size" | "sha256"> | { bytes: number; sha256: string }, bytes: Uint8Array): boolean {
  const size = "size" in file ? file.size : file.bytes;
  return bytes.length === size && sha256Hex(bytes) === file.sha256;
}

export type McpSkillCheck =
  | { ok: true; text: string; skill: SkillDefinition; invisible: number }
  /**
   * `digest`: other bytes than the manifest names; `text`: no UTF-8;
   * `frontmatter`: the file says of itself other than the server listed;
   * `invalid`: no skill as the format defines it.
   */
  | { ok: false; reason: "digest" | "text" | "frontmatter" | "invalid" };

/**
 * The `SKILL.md` of a server's skill, read: the bytes the manifest names,
 * UTF-8, a skill the format accepts, and a frontmatter that is, field for
 * field, what the server listed (compared as canonical JSON, so the order of
 * the fields counts for nothing and every value does). What passes is the
 * skill with its instructions — with nothing it could choose for itself:
 * no tools, none of Plainva's fields.
 */
export function checkMcpSkillMain(source: Pick<InstructionSource, "files" | "server"> & { name: string }, bytes: Uint8Array): McpSkillCheck {
  const main = source.files.find((f) => f.path === "SKILL.md");
  if (!main || !mcpSkillFileMatches(main, bytes)) return { ok: false, reason: "digest" };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: "text" };
  }
  const parsed = parseSkillFile(text, source.name);
  // A frontmatter that does not read at all — none, unclosed, no YAML, `---` inside a line — is no skill, not one that says otherwise.
  if (!parsed.skill && parsed.problems.some((problem) => problem.code.startsWith("frontmatter-"))) return { ok: false, reason: "invalid" };
  if (!parsed.frontmatter || !source.server || mcpFrontmatterHash(parsed.frontmatter) !== source.server.frontmatter) return { ok: false, reason: "frontmatter" };
  if (!parsed.skill || blockingProblems(parsed.problems).length) return { ok: false, reason: "invalid" };
  return { ok: true, text, skill: { ...parsed.skill, allowedTools: null, plainva: {} }, invisible: stripInvisible(text).removed };
}

/** A file of a server's skill, read: the bytes the manifest names (`digest` where they are not), as UTF-8 text (`text` where it is none). */
export function checkMcpSkillFile(file: { bytes: number; sha256: string }, bytes: Uint8Array): { ok: true; text: string } | { ok: false; reason: "digest" | "text" } {
  if (!mcpSkillFileMatches(file, bytes)) return { ok: false, reason: "digest" };
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: "text" };
  }
}
