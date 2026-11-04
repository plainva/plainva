import { acpAgentLabel, isAcpAgentId } from "@plainva/core";
import type { AiFileStore } from "./aiStores";

/**
 * What Plainva remembers of external agents (plan KI-Harness P4.6), in the
 * app's data folder and never in a vault.
 *
 * Per DEVICE (`acp/agents.json`): the user's name for an agent, and what
 * Plainva saw of its changes the last time it changed anything here — whether
 * they came through the app, as suggestions, or were written by the agent
 * itself. That is the one thing about an agent Plainva can know and nobody
 * can promise for it: it differs from agent to agent and from version to
 * version, so the list shows what happened on this device, not a claim.
 *
 * Per VAULT (`<vault>/acp-sessions.json`): one line per session — who, when,
 * how much went through the app. Never what was said.
 *
 * Which program an agent is lives in neither file: the native registry holds
 * it. And no credential lives anywhere in Plainva — an agent signs in by itself.
 */

export interface AcpAgentSeen {
  at: string;
  /** Changes that came through the app and became suggestions or waiting notes. */
  proposed: number;
  /** Changes the agent reported and wrote itself. */
  direct: number;
}

export interface AcpAgentRecord {
  /** The user's name for the agent. */
  label: string;
  addedAt: string;
  /** What was registered when the record was made (`acpAgentTarget`): another command under the same id starts without it. */
  target: string;
  seen?: AcpAgentSeen;
}

export interface AcpDeviceStore {
  load(): Promise<Record<string, AcpAgentRecord>>;
  save(agents: Record<string, AcpAgentRecord>): Promise<void>;
}

/** How a session ended: the user closed it, the program ended by itself, or it never came up. */
export type AcpSessionEnd = "closed" | "exited" | "failed";

/** One session, as a vault's log keeps it: who, when, how much — never what was said. */
export interface AcpSessionEntry {
  at: string;
  agent: string;
  label: string;
  turns: number;
  /** Files handed over through the app. */
  read: number;
  /** Changes that became suggestion rounds. */
  proposed: number;
  /** New notes the agent wrote that the user created. */
  created: number;
  /** Changes the agent reported and wrote itself. */
  direct: number;
  /** Requests the app refused. */
  refused: number;
  end: AcpSessionEnd;
}

export interface AcpVaultStore {
  sessions(): Promise<AcpSessionEntry[]>;
  log(entry: AcpSessionEntry): Promise<void>;
}

const ACP_MAX_AGENTS = 32;
export const ACP_SESSION_LOG_CAP = 50;
const ENDS: readonly AcpSessionEnd[] = ["closed", "exited", "failed"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): number => (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 1_000_000 ? value : 0);

function readSeen(raw: unknown): AcpAgentSeen | undefined {
  if (!isRecord(raw) || typeof raw.at !== "string") return undefined;
  return { at: raw.at, proposed: count(raw.proposed), direct: count(raw.direct) };
}

/** Reads the device's file. A record that cannot be read is an agent nobody named — it still is one, under its id. */
export function readAcpAgentRecords(raw: string | null): Record<string, AcpAgentRecord> {
  const out: Record<string, AcpAgentRecord> = {};
  if (raw === null) return out;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return out;
  }
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.agents)) return out;
  for (const [id, entry] of Object.entries(value.agents).slice(0, ACP_MAX_AGENTS)) {
    if (!isAcpAgentId(id) || !isRecord(entry)) continue;
    const seen = readSeen(entry.seen);
    out[id] = { label: acpAgentLabel(entry.label, id), addedAt: typeof entry.addedAt === "string" ? entry.addedAt : "", target: typeof entry.target === "string" ? entry.target : "", ...(seen ? { seen } : {}) };
  }
  return out;
}

export function createAcpDeviceStore(files: AiFileStore): AcpDeviceStore {
  const path = "acp/agents.json";
  return {
    load: async () => readAcpAgentRecords(await files.read(path)),
    save: (agents) => files.write(path, JSON.stringify({ version: 1, agents })),
  };
}

function readSessions(raw: string | null): AcpSessionEntry[] {
  if (raw === null) return [];
  try {
    const value = JSON.parse(raw) as { version?: number; entries?: unknown };
    if (value.version !== 1 || !Array.isArray(value.entries)) return [];
    const out: AcpSessionEntry[] = [];
    for (const entry of value.entries as unknown[]) {
      if (!isRecord(entry) || typeof entry.at !== "string" || typeof entry.agent !== "string" || !isAcpAgentId(entry.agent) || !ENDS.includes(entry.end as AcpSessionEnd)) continue;
      out.push({
        at: entry.at,
        agent: entry.agent,
        label: acpAgentLabel(entry.label, entry.agent),
        turns: count(entry.turns),
        read: count(entry.read),
        proposed: count(entry.proposed),
        created: count(entry.created),
        direct: count(entry.direct),
        refused: count(entry.refused),
        end: entry.end as AcpSessionEnd,
      });
    }
    return out.slice(-ACP_SESSION_LOG_CAP);
  } catch {
    return [];
  }
}

export function createAcpVaultStore(files: AiFileStore, vaultKey: string): AcpVaultStore {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(vaultKey)) throw new Error("invalid vault key");
  const path = `${vaultKey}/acp-sessions.json`;
  // One lane: two sessions that end at the same moment both reach the log.
  let lane: Promise<unknown> = Promise.resolve();
  return {
    sessions: async () => readSessions(await files.read(path)),
    log(entry) {
      const run = lane
        .catch(() => undefined)
        .then(async () => {
          const entries = [...readSessions(await files.read(path)), entry].slice(-ACP_SESSION_LOG_CAP);
          await files.write(path, JSON.stringify({ version: 1, entries }));
        });
      lane = run;
      return run;
    },
  };
}
