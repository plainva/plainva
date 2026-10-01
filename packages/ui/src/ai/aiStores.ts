import {
  conversationSummaryOf,
  readConversationRecord,
  type ConversationRecord,
  type ConversationRepository,
  type ConversationSummary,
  type LedgerEntry,
} from "@plainva/core";
import type { AiLedgerStore } from "./aiSession";

/**
 * Where the conversations of a vault live (plan §16): in the app's data
 * folder, `ai/<vault>/`, never in the vault — a transcript holds excerpts that
 * went to a cloud provider and would otherwise be synced past the privacy
 * policy. One file per conversation plus a small index, so the history list
 * opens without reading every transcript. The shells provide the file
 * primitives (desktop: the atomic write command; phone: the data directory).
 */
export interface AiFileStore {
  /** Text of a file below the AI data folder; null when it does not exist. */
  read(relPath: string): Promise<string | null>;
  /** Replaces a file atomically, creating folders as needed. */
  write(relPath: string, text: string): Promise<void>;
  remove(relPath: string): Promise<void>;
  /** Removes a folder and everything in it; absent is fine. */
  removeDir(relPath: string): Promise<void>;
}

/**
 * A standing approval (plan KI-Harness P2a-5): notes and search questions may
 * go to a cloud model for search by meaning until the reader withdraws it.
 * Kept per vault on this device, in the app's data — never in the vault,
 * never synced.
 */
export interface StandingApproval {
  /** `providerId/model`. */
  recipient: string;
  purpose: "embeddings";
  /** When it was given (ISO 8601). */
  at: string;
}

export interface StandingApprovalStore {
  load(): Promise<StandingApproval[]>;
  save(approvals: StandingApproval[]): Promise<void>;
}

/**
 * What the reader said about related notes (plan KI-Harness P2b-4): pairs
 * marked "not helpful", notes paused, the vault paused. Kept per vault on this
 * device like the approvals, and capped — the oldest word goes first — so it
 * never grows into a second index. It decides which hints show, never what a
 * search finds.
 */
export interface RelatedFeedback {
  /** Pairs of notes, each written with the smaller path first. */
  dismissed: { pair: [string, string]; at: string }[];
  paused: { path: string; at: string }[];
  vaultPaused: boolean;
}

export interface RelatedFeedbackStore {
  load(): Promise<RelatedFeedback>;
  save(feedback: RelatedFeedback): Promise<void>;
}

export const RELATED_DISMISSED_CAP = 500;
export const RELATED_PAUSED_CAP = 200;

export const EMPTY_RELATED_FEEDBACK: RelatedFeedback = { dismissed: [], paused: [], vaultPaused: false };

/** A pair in its one written form. */
export function relatedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function readRelatedFeedback(raw: string | null): RelatedFeedback {
  if (raw === null) return EMPTY_RELATED_FEEDBACK;
  try {
    const value = JSON.parse(raw) as { version?: number; dismissed?: unknown; paused?: unknown; vaultPaused?: unknown };
    if (value.version !== 1) return EMPTY_RELATED_FEEDBACK;
    const dismissed = (Array.isArray(value.dismissed) ? value.dismissed : [])
      .filter(
        (d): d is { pair: [string, string]; at: string } =>
          Boolean(d) && typeof d === "object" && Array.isArray((d as { pair?: unknown }).pair) && (d as { pair: unknown[] }).pair.length === 2 && (d as { pair: unknown[] }).pair.every((p) => typeof p === "string") && typeof (d as { at?: unknown }).at === "string",
      )
      .map((d) => ({ pair: relatedPair(d.pair[0], d.pair[1]), at: d.at }))
      .slice(-RELATED_DISMISSED_CAP);
    const paused = (Array.isArray(value.paused) ? value.paused : [])
      .filter((p): p is { path: string; at: string } => Boolean(p) && typeof p === "object" && typeof (p as { path?: unknown }).path === "string" && typeof (p as { at?: unknown }).at === "string")
      .slice(-RELATED_PAUSED_CAP);
    return { dismissed, paused, vaultPaused: value.vaultPaused === true };
  } catch {
    // A damaged file hides nothing: every hint may show again.
    return EMPTY_RELATED_FEEDBACK;
  }
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

function readApprovals(raw: string | null): StandingApproval[] {
  if (raw === null) return [];
  try {
    const value = JSON.parse(raw) as { version?: number; approvals?: unknown };
    if (value.version !== 1 || !Array.isArray(value.approvals)) return [];
    return value.approvals.filter(
      (a): a is StandingApproval =>
        Boolean(a) && typeof a === "object" && typeof (a as StandingApproval).recipient === "string" && (a as StandingApproval).purpose === "embeddings" && typeof (a as StandingApproval).at === "string",
    );
  } catch {
    // A damaged file approves nothing: the overview asks again.
    return [];
  }
}

function readIndex(raw: string | null): ConversationSummary[] | null {
  if (raw === null) return [];
  try {
    const value = JSON.parse(raw) as { version?: number; conversations?: unknown };
    if (value.version !== 1 || !Array.isArray(value.conversations)) return null;
    return value.conversations.filter(
      (s): s is ConversationSummary =>
        Boolean(s) && typeof s === "object" && SAFE_ID.test((s as ConversationSummary).id) && typeof (s as ConversationSummary).title === "string" && typeof (s as ConversationSummary).updatedAt === "string",
    );
  } catch {
    return null;
  }
}

export function createAiVaultStores(
  files: AiFileStore,
  vaultKey: string,
): { conversations: ConversationRepository; ledger: AiLedgerStore; approvals: StandingApprovalStore; related: RelatedFeedbackStore } {
  if (!SAFE_ID.test(vaultKey)) throw new Error("invalid vault key");
  const dir = vaultKey;
  const indexPath = `${dir}/index.json`;
  const fileOf = (id: string) => {
    if (!SAFE_ID.test(id)) throw new Error("invalid conversation id");
    return `${dir}/conversations/${id}.json`;
  };
  // One lane per vault: an index update never races the next one.
  let lane: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = lane.catch(() => undefined).then(work);
    lane = run;
    return run;
  };
  const writeIndex = (list: ConversationSummary[]) => files.write(indexPath, JSON.stringify({ version: 1, conversations: list }));
  const loadIndex = async (): Promise<ConversationSummary[]> => readIndex(await files.read(indexPath)) ?? [];

  const conversations: ConversationRepository = {
    list: () => serial(loadIndex),
    async load(id) {
      if (!SAFE_ID.test(id)) return null;
      const raw = await files.read(fileOf(id));
      if (raw === null) return null;
      try {
        return readConversationRecord(JSON.parse(raw));
      } catch {
        return null;
      }
    },
    save: (record: ConversationRecord) =>
      serial(async () => {
        await files.write(fileOf(record.id), JSON.stringify(record));
        const list = (await loadIndex()).filter((s) => s.id !== record.id);
        await writeIndex([conversationSummaryOf(record), ...list]);
      }),
    remove: (id) =>
      serial(async () => {
        await files.remove(fileOf(id));
        await writeIndex((await loadIndex()).filter((s) => s.id !== id));
      }),
    removeAll: () =>
      serial(async () => {
        await files.removeDir(`${dir}/conversations`);
        await writeIndex([]);
      }),
  };

  const ledger: AiLedgerStore = {
    async load() {
      const raw = await files.read(`${dir}/ledger.json`);
      if (raw === null) return [];
      try {
        const value = JSON.parse(raw) as { version?: number; entries?: unknown };
        return value.version === 1 && Array.isArray(value.entries) ? (value.entries as LedgerEntry[]) : [];
      } catch {
        return [];
      }
    },
    save: (entries) => files.write(`${dir}/ledger.json`, JSON.stringify({ version: 1, entries })),
  };

  const approvals: StandingApprovalStore = {
    load: async () => readApprovals(await files.read(`${dir}/approvals.json`)),
    save: (list) => files.write(`${dir}/approvals.json`, JSON.stringify({ version: 1, approvals: list })),
  };

  const related: RelatedFeedbackStore = {
    load: async () => readRelatedFeedback(await files.read(`${dir}/related.json`)),
    save: (feedback) =>
      files.write(
        `${dir}/related.json`,
        JSON.stringify({ version: 1, dismissed: feedback.dismissed.slice(-RELATED_DISMISSED_CAP), paused: feedback.paused.slice(-RELATED_PAUSED_CAP), vaultPaused: feedback.vaultPaused }),
      ),
  };

  return { conversations, ledger, approvals, related };
}

/** A stable, file-name-safe handle for a vault (FNV-1a over its path or id). */
export function aiVaultKey(vaultIdentity: string): string {
  let hi = 0x811c9dc5;
  let lo = 0x01000193;
  for (let i = 0; i < vaultIdentity.length; i++) {
    const c = vaultIdentity.charCodeAt(i);
    hi = Math.imul(hi ^ c, 0x01000193) >>> 0;
    lo = Math.imul(lo ^ (c + i), 0x811c9dc5) >>> 0;
  }
  return `v${hi.toString(16).padStart(8, "0")}${lo.toString(16).padStart(8, "0")}`;
}
