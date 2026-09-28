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

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

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

export function createAiVaultStores(files: AiFileStore, vaultKey: string): { conversations: ConversationRepository; ledger: AiLedgerStore } {
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

  return { conversations, ledger };
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
