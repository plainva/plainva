import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * The AI privacy policy of a vault (ADR 0018; the format is documented for
 * people and other tools in the user guide's File Format Reference).
 *
 * Two dimensions, each allow or deny:
 *
 * - `cloud` — may this content go to a cloud recipient (a provider API, a
 *   gateway the user chose, Apple Private Cloud Compute)? A denied note
 *   contributes nothing: no title, gist, file name, link anchor or embedding.
 * - `web` — may this content share a run with web tools (fetch, search)?
 *
 * Local models and the on-device platform model are not cloud recipients and
 * stay allowed separately.
 *
 * Where the policy lives:
 *
 * - a note: frontmatter `plainva: { ai: { cloud: deny } }`
 * - folders: `.agent/policy.yml` with `folders: { "Private/": { cloud: deny } }`;
 *   Plainva writes no marker files into the user's folders
 * - defaults: app-wide, with a vault override; encrypted workspaces default to
 *   `cloud: deny` (ADR 0017)
 *
 * Resolution: the note's own value wins; otherwise the nearest folder rule
 * (longest matching prefix); otherwise the default. Each dimension resolves on
 * its own, so a folder can deny the web while a note in it only says
 * something about the cloud.
 *
 * Beside the two dimensions a folder can carry one permission of another
 * kind (plan "KI direkt schreiben", W1): `write: direct` — an assistant may
 * change and create notes there without asking first. It is no privacy rule:
 * it says nothing about where content may go, only whether a change waits for
 * the user, so it is not one of `AI_POLICY_DIMENSIONS` and no note carries it.
 * `write: ask` takes it back for a folder below one that has it. A file
 * without the key reads as it always did — nothing in it changes, and every
 * folder asks (`directFolderOf`).
 */

export type AiPermission = "allow" | "deny";

export interface AiPolicy {
  cloud: AiPermission;
  web: AiPermission;
}

export type AiPolicyDimension = keyof AiPolicy;
export const AI_POLICY_DIMENSIONS: readonly AiPolicyDimension[] = ["cloud", "web"];

/** Whether an assistant's change in a folder waits for the user (`ask`, the default) or is written at once (`direct`). */
export type AiWriteRule = "direct" | "ask";

export interface FolderPolicyRule {
  /** Vault-relative folder, normalised to forward slashes with a trailing slash. */
  folder: string;
  cloud?: AiPermission;
  web?: AiPermission;
  /** "Change without asking" (plan KI direkt schreiben): absent, the folder above decides, and at the top: ask. */
  write?: AiWriteRule;
}

/** Why a dimension resolved the way it did — shown as the "effective policy". */
export type PolicySource =
  | { kind: "note" }
  | { kind: "folder"; folder: string }
  | { kind: "default" };

export interface EffectivePolicy {
  policy: AiPolicy;
  sources: Record<AiPolicyDimension, PolicySource>;
}

/** The vault's own conservative defaults when nothing says otherwise. */
export const DEFAULT_AI_POLICY: AiPolicy = { cloud: "allow", web: "allow" };

/** Encrypted workspaces promise that content leaves the device only encrypted. */
export const ENCRYPTED_WORKSPACE_AI_POLICY: AiPolicy = { cloud: "deny", web: "deny" };

function permission(value: unknown): AiPermission | undefined {
  if (value === "allow" || value === "deny") return value;
  // YAML users write booleans too: `cloud: false` reads as a denial. A value
  // Plainva does not understand is NOT silently allow — it is ignored and the
  // next level decides, and the parser reports it.
  if (value === false) return "deny";
  if (value === true) return "allow";
  return undefined;
}

/**
 * The note's own policy from its parsed frontmatter (`plainva.ai`). Total:
 * anything that is not the documented shape yields no opinion.
 */
export function notePolicyFrom(frontmatter: unknown): Partial<AiPolicy> {
  if (!frontmatter || typeof frontmatter !== "object") return {};
  const plainva = (frontmatter as Record<string, unknown>).plainva;
  if (!plainva || typeof plainva !== "object") return {};
  const ai = (plainva as Record<string, unknown>).ai;
  if (!ai || typeof ai !== "object") return {};
  const out: Partial<AiPolicy> = {};
  for (const dimension of AI_POLICY_DIMENSIONS) {
    const value = permission((ai as Record<string, unknown>)[dimension]);
    if (value) out[dimension] = value;
  }
  return out;
}

export function normalizeFolder(folder: string): string {
  const slashed = folder.replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\/+/g, "/");
  if (slashed === "" || slashed === "/") return "";
  return slashed.endsWith("/") ? slashed : `${slashed}/`;
}

export interface ParsedPolicyFile {
  rules: FolderPolicyRule[];
  /** Human-readable problems; a broken entry never widens anything. */
  problems: string[];
}

/**
 * Parses `.agent/policy.yml`. Never throws: a file that does not parse yields
 * no rules and a problem — and because a missing rule falls back to the
 * default rather than to "allow", a broken file cannot open anything the
 * defaults keep closed.
 */
export function parsePolicyFile(text: string): ParsedPolicyFile {
  const problems: string[] = [];
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (error) {
    return { rules: [], problems: [`policy file does not parse: ${(error as Error).message}`] };
  }
  if (doc == null) return { rules: [], problems };
  if (typeof doc !== "object" || Array.isArray(doc)) return { rules: [], problems: ["policy file is not a mapping"] };
  const folders = (doc as Record<string, unknown>).folders;
  if (folders == null) return { rules: [], problems };
  if (typeof folders !== "object" || Array.isArray(folders)) return { rules: [], problems: ["`folders` is not a mapping"] };
  const rules: FolderPolicyRule[] = [];
  for (const [rawFolder, value] of Object.entries(folders as Record<string, unknown>)) {
    const folder = normalizeFolder(rawFolder);
    if (folder.split("/").some((part) => part === "..")) {
      problems.push(`folder "${rawFolder}" leaves the vault`);
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      problems.push(`folder "${rawFolder}" has no cloud/web settings`);
      continue;
    }
    const rule: FolderPolicyRule = { folder };
    for (const dimension of AI_POLICY_DIMENSIONS) {
      const raw = (value as Record<string, unknown>)[dimension];
      if (raw === undefined) continue;
      const parsed = permission(raw);
      if (parsed) rule[dimension] = parsed;
      else problems.push(`folder "${rawFolder}": ${dimension} must be allow or deny`);
    }
    // A value Plainva does not understand opens nothing: it is reported, and the folder asks as before.
    const write = (value as Record<string, unknown>).write;
    if (write === "direct" || write === "ask") rule.write = write;
    else if (write !== undefined) problems.push(`folder "${rawFolder}": write must be direct or ask`);
    rules.push(rule);
  }
  return { rules, problems };
}

/**
 * Writes folder rules back as `.agent/policy.yml` — what the settings save
 * when a person changes a rule there. The whole file is Plainva's format, so
 * it is written whole; rules without a value are dropped rather than written
 * as an empty mapping the parser would report.
 */
export function serializePolicyFile(rules: readonly FolderPolicyRule[]): string {
  const folders: Record<string, Partial<Record<AiPolicyDimension, AiPermission>> & { write?: AiWriteRule }> = {};
  for (const rule of rules) {
    const entry: Partial<Record<AiPolicyDimension, AiPermission>> & { write?: AiWriteRule } = {};
    for (const dimension of AI_POLICY_DIMENSIONS) if (rule[dimension]) entry[dimension] = rule[dimension];
    if (rule.write) entry.write = rule.write;
    if (Object.keys(entry).length) folders[rule.folder === "" ? "/" : rule.folder] = entry;
  }
  const header = "# Plainva AI privacy rules (see the File Format Reference of the user guide).";
  return `${header}\n${stringifyYaml({ folders })}`;
}

/**
 * Writes changed folder rules into `.agent/policy.yml` as it lies there —
 * the settings' way of saving. What Plainva writes is the rules' own keys
 * (`cloud`, `web`, `write`); every other key stays where it was: one a later
 * version of the app reads, one another tool keeps, a top-level key beside
 * `folders`. So no version of the app drops a key it does not know when the
 * user changes a rule here — as versions before this one dropped `write`
 * (plan "KI direkt schreiben"). A folder entry left with nothing but such
 * keys stays with them. A file that does not read as a mapping is replaced
 * by the rules alone, as before; its problems were reported where it was read.
 */
export function updatePolicyFile(text: string, rules: readonly FolderPolicyRule[]): string {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch {
    return serializePolicyFile(rules);
  }
  if (doc == null || typeof doc !== "object" || Array.isArray(doc)) return serializePolicyFile(rules);
  const top = doc as Record<string, unknown>;
  const before = top.folders && typeof top.folders === "object" && !Array.isArray(top.folders) ? (top.folders as Record<string, unknown>) : {};
  const own = new Set<string>([...AI_POLICY_DIMENSIONS, "write"]);
  const foreign = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !own.has(key))) : {};
  const folders: Record<string, Record<string, unknown>> = {};
  // What each folder carries besides Plainva's rules, under the spelling the file used for it.
  const kept = new Map<string, { raw: string; rest: Record<string, unknown> }>();
  for (const [raw, value] of Object.entries(before)) {
    const rest = foreign(value);
    if (Object.keys(rest).length) kept.set(normalizeFolder(raw), { raw, rest });
  }
  for (const rule of rules) {
    const entry: Record<string, unknown> = { ...(kept.get(rule.folder)?.rest ?? {}) };
    for (const dimension of AI_POLICY_DIMENSIONS) if (rule[dimension]) entry[dimension] = rule[dimension];
    if (rule.write) entry.write = rule.write;
    if (Object.keys(entry).length) folders[kept.get(rule.folder)?.raw ?? (rule.folder === "" ? "/" : rule.folder)] = entry;
    kept.delete(rule.folder);
  }
  for (const { raw, rest } of kept.values()) folders[raw] = rest;
  const header = "# Plainva AI privacy rules (see the File Format Reference of the user guide).";
  return `${header}\n${stringifyYaml({ ...top, folders })}`;
}

/**
 * The effective policy of one vault-relative path. `defaults` is the app-wide
 * default merged with the vault override, or the encrypted-workspace policy.
 */
export function effectivePolicy(
  path: string,
  notePolicy: Partial<AiPolicy>,
  rules: readonly FolderPolicyRule[],
  defaults: AiPolicy = DEFAULT_AI_POLICY,
): EffectivePolicy {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").normalize("NFC");
  const policy = { ...defaults };
  const sources: Record<AiPolicyDimension, PolicySource> = { cloud: { kind: "default" }, web: { kind: "default" } };
  for (const dimension of AI_POLICY_DIMENSIONS) {
    const own = notePolicy[dimension];
    if (own) {
      policy[dimension] = own;
      sources[dimension] = { kind: "note" };
      continue;
    }
    let best: FolderPolicyRule | undefined;
    for (const rule of rules) {
      const value = rule[dimension];
      if (!value) continue;
      const folder = rule.folder.normalize("NFC");
      // A denial reaches every spelling of its folder (Windows and macOS do not
      // tell "Private/" from "private/"); a permission only its exact one, so
      // a case-sensitive file system never widens an allow by accident.
      const inside = folder === ""
        || (value === "deny" ? normalized.toLowerCase().startsWith(folder.toLowerCase()) : normalized.startsWith(folder));
      if (!inside) continue;
      if (!best || rule.folder.length > best.folder.length || (rule.folder.length === best.folder.length && value === "deny")) best = rule;
    }
    if (best) {
      policy[dimension] = best[dimension]!;
      sources[dimension] = { kind: "folder", folder: best.folder };
    }
  }
  return { policy, sources };
}

/**
 * The folder whose rule lets an assistant change and create notes at `path`
 * without asking (`write: direct`), or null where the user is asked as ever.
 * The nearest folder that says anything decides: `write: ask` below a folder
 * with `direct` takes it back. A permission matches its folder's exact
 * spelling only, as every allow does (`effectivePolicy`), so a case-sensitive
 * file system never widens it by accident; `ask` reaches every spelling.
 */
export function directFolderOf(path: string, rules: readonly FolderPolicyRule[]): string | null {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").normalize("NFC");
  let best: FolderPolicyRule | undefined;
  for (const rule of rules) {
    const value = rule.write;
    if (!value) continue;
    const folder = rule.folder.normalize("NFC");
    const inside = folder === "" || (value === "ask" ? normalized.toLowerCase().startsWith(folder.toLowerCase()) : normalized.startsWith(folder));
    if (!inside) continue;
    if (!best || rule.folder.length > best.folder.length || (rule.folder.length === best.folder.length && value === "ask")) best = rule;
  }
  return best?.write === "direct" ? best.folder : null;
}

/** Whether any folder of the vault lets an assistant change without asking — what a routine may then carry (plan W4). */
export function hasDirectFolder(rules: readonly FolderPolicyRule[]): boolean {
  return rules.some((rule) => rule.write === "direct");
}
