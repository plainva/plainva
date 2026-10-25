import {
  EMPTY_MCP_GRANT,
  MCP_SERVER_ID_PATTERN,
  MCP_SKILL_LIMITS,
  mcpSkillUriReadable,
  NEW_MCP_SERVER,
  capMcpText,
  readMcpListing,
  readMcpServerGrant,
  readMcpServerReview,
  readStoredMcpSkillEntries,
  storedMcpSkillEntry,
  type McpEra,
  type McpListing,
  type McpServerGrant,
  type McpServerReview,
  type McpSkillEntry,
} from "@plainva/core";
import type { AiFileStore } from "./aiStores";

/**
 * What Plainva remembers of foreign MCP servers (plan KI-Harness P4.5), in
 * the app's data folder and never in a vault: whoever can write the vault
 * could otherwise write an approval.
 *
 * Two files, because two things are decided in two places. A server is added
 * and its texts are approved once per DEVICE (`mcp/servers.json`): the texts
 * are the same whatever vault is open. Whether a VAULT uses the server, and
 * what the server may be called with there, is each vault's own
 * (`<vault>/mcp.json`) — a server is off in a vault until the user switches
 * it on, like the internet. Where a request really goes is in neither file:
 * the address and the command live in the native registry.
 */

export interface McpServerRecord {
  /** The user's name for the server. */
  label: string;
  addedAt: string;
  /** What was registered natively when the listing below was approved (`mcpServerTarget`). */
  target: string;
  review: McpServerReview;
  /** The listing the user approved, as the server sent it then: the only source of what a model reads. */
  snapshot: McpListing | null;
  /** What the server called itself and spoke at the last look. For display. */
  seen?: { name: string; era: McpEra; version: string; at: string; clipped: boolean };
  /**
   * The skills it serves, as it listed them last (plan P9-4b), with the
   * addresses the user added by hand. Nothing of their files: those are read
   * when a skill is needed, and checked against the manifest kept here.
   * Absent for a server that serves none.
   */
  skills?: McpSkillsRecord;
}

/** What this device keeps of a server's skills (plan P9-4b). */
export interface McpSkillsRecord {
  /** When the list was read last (ISO 8601). */
  at: string;
  /** The last reading failed: the entries are the ones before it. */
  failed: boolean;
  /** The server lists more than Plainva reads or keeps; the rest is not offered. */
  clipped: boolean;
  entries: McpSkillEntry[];
  /** Addresses the user added by hand: asked for with `skills/get` at every reading. */
  added: string[];
}

/** What is kept of one server's skills, at most, as JSON: beyond it the last entries are not kept, and the list says it is clipped. */
export const MCP_SKILLS_RECORD_LIMIT = 4_000_000;

export interface McpDeviceStore {
  load(): Promise<Record<string, McpServerRecord>>;
  save(servers: Record<string, McpServerRecord>): Promise<void>;
}

export interface McpVaultEntry {
  /** The vault uses the server. */
  enabled: boolean;
  grant: McpServerGrant;
  /**
   * What was registered when the vault made this choice (`mcpServerTarget`).
   * A choice belongs to that registration: a server registered anew under the
   * same id — another address, another command — starts off, with nothing
   * granted, in every vault.
   */
  target: string;
}

export type McpAuditOutcome =
  /** The call went out and an answer came back. */
  | "answered"
  /** The server answered that the tool failed. */
  | "tool-error"
  /** The user said no. */
  | "declined"
  /** A rule kept the call back before the user was asked. */
  | "refused"
  /** The server's listing had changed: it was blocked instead. */
  | "blocked"
  /** The call went out and no answer came back. */
  | "failed"
  /** The server wanted to ask the user something during the call, and may not in this vault (plan P9-4a). */
  | "questions-off";

/** One call, as the log of a vault keeps it: who, what, how it ended, how much — never what was said. */
export interface McpAuditEntry {
  at: string;
  server: string;
  tool: string;
  outcome: McpAuditOutcome;
  /** Characters of the arguments and of the result. */
  sent: number;
  received: number;
  conversation: string;
}

export interface McpVaultStore {
  load(): Promise<Record<string, McpVaultEntry>>;
  save(servers: Record<string, McpVaultEntry>): Promise<void>;
  audit(): Promise<McpAuditEntry[]>;
  log(entry: McpAuditEntry): Promise<void>;
}

/** A listing larger than this is not stored, so it cannot be approved: nobody reviews a megabyte of tool descriptions. */
export const MCP_SNAPSHOT_LIMIT = 1_000_000;
export const MCP_AUDIT_CAP = 300;
const MCP_MAX_SERVERS = 32;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isId = (value: string) => MCP_SERVER_ID_PATTERN.test(value);
const OUTCOMES: readonly McpAuditOutcome[] = ["answered", "tool-error", "declined", "refused", "blocked", "failed", "questions-off"];

function readSeen(raw: unknown): McpServerRecord["seen"] | undefined {
  if (!isRecord(raw) || (raw.era !== "modern" && raw.era !== "legacy") || typeof raw.at !== "string") return undefined;
  return { name: capMcpText(raw.name, 80).text, era: raw.era, version: capMcpText(raw.version, 32).text, at: raw.at, clipped: raw.clipped === true };
}

/** An address the user may add by hand: one of a skill's `SKILL.md`, no longer than any address is read, hiding nothing (`mcpSkillUriReadable`). */
export function mcpSkillAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const uri = raw.trim();
  return uri.length > 0 && uri.length <= MCP_SKILL_LIMITS.uri && uri.endsWith("/SKILL.md") && mcpSkillUriReadable(uri) ? uri : null;
}

/** What was kept of a server's skills, read with the checks a listing gets: a kept entry is never more than a listed one. */
export function readMcpSkillsRecord(raw: unknown): McpSkillsRecord | undefined {
  // A time that does not read is no time a list was read at.
  if (!isRecord(raw) || typeof raw.at !== "string" || !Number.isFinite(Date.parse(raw.at))) return undefined;
  const added = (Array.isArray(raw.added) ? raw.added : []).map(mcpSkillAddress).filter((uri): uri is string => uri !== null);
  return {
    at: raw.at,
    failed: raw.failed === true,
    clipped: raw.clipped === true,
    entries: readStoredMcpSkillEntries(raw.entries),
    added: [...new Set(added)].slice(0, MCP_SKILL_LIMITS.added),
  };
}

/** A server's skills as they are written: each entry in the server's own shape. */
function storedSkills(skills: McpSkillsRecord): Record<string, unknown> {
  return { at: skills.at, failed: skills.failed, clipped: skills.clipped, entries: skills.entries.map(storedMcpSkillEntry), added: skills.added };
}

/** One entry may take at most this share of what is kept: beyond it, it is kept as "too large" — without its manifest. */
const MCP_SKILL_ENTRY_LIMIT = MCP_SKILLS_RECORD_LIMIT / 8;

/**
 * A server's skills cut to what is kept. An entry too large to keep on its
 * own stays, as "too large" without its manifest — it never pushes the others
 * out —; then the last entries go first, and the list says it is clipped.
 */
export function fitMcpSkillsRecord(skills: McpSkillsRecord): McpSkillsRecord {
  let changed = false;
  let entries = skills.entries.map((entry) => {
    if (JSON.stringify(storedMcpSkillEntry(entry)).length <= MCP_SKILL_ENTRY_LIMIT) return entry;
    changed = true;
    return { ...entry, files: [], problem: "too-large" as const };
  });
  let clipped = skills.clipped;
  while (entries.length && JSON.stringify(storedSkills({ ...skills, entries })).length > MCP_SKILLS_RECORD_LIMIT) {
    entries = entries.slice(0, -1);
    clipped = true;
    changed = true;
  }
  return changed ? { ...skills, entries, clipped } : skills;
}

/** Reads the device's file. A record that cannot be read is a server nobody approved — never an approved one. */
export function readMcpServerRecords(raw: string | null): Record<string, McpServerRecord> {
  const out: Record<string, McpServerRecord> = {};
  if (raw === null) return out;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return out;
  }
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.servers)) return out;
  for (const [id, entry] of Object.entries(value.servers).slice(0, MCP_MAX_SERVERS)) {
    if (!isId(id) || !isRecord(entry)) continue;
    const snapshot = isRecord(entry.snapshot) ? readMcpListing(entry.snapshot) : null;
    const review = snapshot ? readMcpServerReview(entry.review) : NEW_MCP_SERVER;
    const seen = readSeen(entry.seen);
    const skills = readMcpSkillsRecord(entry.skills);
    out[id] = {
      label: capMcpText(entry.label, 60).text || id,
      addedAt: typeof entry.addedAt === "string" ? entry.addedAt : "",
      target: typeof entry.target === "string" ? entry.target : "",
      review,
      snapshot: review.status === "new" ? null : snapshot,
      ...(seen ? { seen } : {}),
      ...(skills ? { skills } : {}),
    };
  }
  return out;
}

export function serializeMcpServerRecords(servers: Record<string, McpServerRecord>): string {
  const written = Object.fromEntries(Object.entries(servers).map(([id, record]) => [id, record.skills ? { ...record, skills: storedSkills(record.skills) } : record]));
  return JSON.stringify({ version: 1, servers: written });
}

/** Whether a listing is small enough to be stored and so to be approved. */
export function mcpSnapshotFits(listing: McpListing): boolean {
  return JSON.stringify(listing).length <= MCP_SNAPSHOT_LIMIT;
}

/** Reads a vault's file. A damaged entry switches a server off and grants nothing. */
export function readMcpVaultEntries(raw: string | null): Record<string, McpVaultEntry> {
  const out: Record<string, McpVaultEntry> = {};
  if (raw === null) return out;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return out;
  }
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.servers)) return out;
  for (const [id, entry] of Object.entries(value.servers).slice(0, MCP_MAX_SERVERS)) {
    if (!isId(id) || !isRecord(entry)) continue;
    out[id] = { enabled: entry.enabled === true, grant: readMcpServerGrant(entry.grant), target: typeof entry.target === "string" ? entry.target : "" };
  }
  return out;
}

export const EMPTY_MCP_VAULT_ENTRY: McpVaultEntry = { enabled: false, grant: EMPTY_MCP_GRANT, target: "" };

/** A vault's choice for a server as it is registered now: the stored one where it was made for this registration, else none. */
export function mcpVaultEntryFor(entries: Readonly<Record<string, McpVaultEntry>>, id: string, target: string): McpVaultEntry {
  const entry = entries[id];
  return entry && entry.target === target ? entry : { ...EMPTY_MCP_VAULT_ENTRY, target };
}

function readAudit(raw: string | null): McpAuditEntry[] {
  if (raw === null) return [];
  try {
    const value = JSON.parse(raw) as { version?: number; entries?: unknown };
    if (value.version !== 1 || !Array.isArray(value.entries)) return [];
    return value.entries
      .filter(
        (e): e is McpAuditEntry =>
          isRecord(e) &&
          typeof e.at === "string" &&
          typeof e.server === "string" &&
          typeof e.tool === "string" &&
          OUTCOMES.includes(e.outcome as McpAuditOutcome) &&
          typeof e.sent === "number" &&
          typeof e.received === "number" &&
          typeof e.conversation === "string",
      )
      .slice(-MCP_AUDIT_CAP);
  } catch {
    return [];
  }
}

export function createMcpDeviceStore(files: AiFileStore): McpDeviceStore {
  const path = "mcp/servers.json";
  return {
    load: async () => readMcpServerRecords(await files.read(path)),
    save: (servers) => files.write(path, serializeMcpServerRecords(servers)),
  };
}

export function createMcpVaultStore(files: AiFileStore, vaultKey: string): McpVaultStore {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(vaultKey)) throw new Error("invalid vault key");
  const settings = `${vaultKey}/mcp.json`;
  const audit = `${vaultKey}/mcp-audit.json`;
  // One lane: two calls that end at the same moment both reach the log.
  let lane: Promise<unknown> = Promise.resolve();
  return {
    load: async () => readMcpVaultEntries(await files.read(settings)),
    save: (servers) => files.write(settings, JSON.stringify({ version: 1, servers })),
    audit: async () => readAudit(await files.read(audit)),
    log(entry) {
      const run = lane
        .catch(() => undefined)
        .then(async () => {
          const entries = [...readAudit(await files.read(audit)), entry].slice(-MCP_AUDIT_CAP);
          await files.write(audit, JSON.stringify({ version: 1, entries }));
        });
      lane = run;
      return run;
    },
  };
}
