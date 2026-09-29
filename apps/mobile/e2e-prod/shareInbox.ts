import { createHash } from "node:crypto";
import type { BrowserContext } from "@playwright/test";

/**
 * A share inbox for the production bundle (plan Befunde 2026-09-24, E28).
 *
 * A browser has no share extension; the app reads what is waiting through its
 * `ShareTarget` plugin, and on the web that plugin does not exist. The app
 * therefore looks for an inbox under `__plainvaFixtureShareTarget` — only when
 * no native platform answers (`services/shareTarget.ts`), the same seam the
 * fixture SQLite bridge uses. This module is that inbox, kept in the test
 * process so it outlives reloads, and it keeps the native stores' contract:
 * a plan is made once and then kept (a retry finishes as planned), received
 * parts are marked one by one, and an entry leaves the inbox only when the
 * app acknowledges it — never before its note was written.
 */

const KEY = "__plainvaFixtureShareTarget";

export interface SharedFileFixture {
  name: string;
  mime: string;
  bytes: Buffer;
}

export interface ShareFixture {
  /** A share id in the native format (a lowercase UUID). */
  id: string;
  text: string;
  subject?: string;
  files?: SharedFileFixture[];
}

interface Plan {
  version: 1;
  vaultId: string;
  notePath: string;
  noteText: string;
  files: Array<{ id: string; path: string }>;
}

interface Entry {
  version: 1;
  id: string;
  createdAt: number;
  status: "ready";
  text: string;
  subject: string;
  files: Array<{ id: string; name: string; mime: string; size: number; sha256: string }>;
  plan?: Plan;
  filesDone?: string[];
  noteWritten?: boolean;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** File ids follow the share's: the same UUID with its last group counting up. */
const fileId = (shareId: string, n: number) => `${shareId.slice(0, 24)}${String(n + 1).padStart(12, "0")}`;

export async function installShareInbox(context: BrowserContext) {
  const entries = new Map<string, Entry>();
  const bytes = new Map<string, Buffer>();
  const acknowledged: Array<{ id: string; discard: boolean }> = [];

  await context.exposeFunction(`${KEY}__list`, () => ({ entries: [...entries.values()].map(clone) }));
  await context.exposeFunction(`${KEY}__chunk`, ({ fileId: id, offset, length }: { fileId: string; offset: number; length: number }) => {
    const data = bytes.get(id);
    if (!data) throw new Error("SHARE_FILE_UNKNOWN");
    return { data: data.subarray(offset, offset + length).toString("base64") };
  });
  await context.exposeFunction(`${KEY}__begin`, ({ id, plan }: { id: string; plan: Plan }) => {
    const entry = entries.get(id);
    if (!entry) throw new Error("SHARE_UNKNOWN");
    // The first plan wins, as in both native stores: a retry resumes it.
    entry.plan ??= clone(plan);
    return { entry: clone(entry) };
  });
  await context.exposeFunction(`${KEY}__mark`, ({ id, fileId: done, note }: { id: string; fileId?: string; note?: boolean }) => {
    const entry = entries.get(id);
    if (!entry) throw new Error("SHARE_UNKNOWN");
    if (note) entry.noteWritten = true;
    else if (done) entry.filesDone = [...new Set([...(entry.filesDone ?? []), done])];
  });
  await context.exposeFunction(`${KEY}__finish`, ({ id, discard }: { id: string; discard?: boolean }) => {
    const entry = entries.get(id);
    if (!entry) throw new Error("SHARE_UNKNOWN");
    if (!discard && !entry.noteWritten) throw new Error("SHARE_ACK_BEFORE_NOTE");
    entries.delete(id);
    acknowledged.push({ id, discard: !!discard });
  });
  await context.addInitScript((key) => {
    const g = globalThis as unknown as Record<string, unknown>;
    const call = (name: string) => (args?: unknown) => (g[`${key}__${name}`] as (value?: unknown) => Promise<unknown>)(args);
    g[key] = {
      listPendingShares: call("list"),
      readFileChunk: call("chunk"),
      beginImport: call("begin"),
      markImported: call("mark"),
      finishShare: call("finish"),
    };
  }, KEY);

  return {
    /** Something was shared to Plainva; the app sees it on its next look into the inbox. */
    share(share: ShareFixture) {
      const files = (share.files ?? []).map((file, n) => {
        const id = fileId(share.id, n);
        bytes.set(id, file.bytes);
        return { id, name: file.name, mime: file.mime, size: file.bytes.length, sha256: createHash("sha256").update(file.bytes).digest("hex") };
      });
      entries.set(share.id, { version: 1, id: share.id, createdAt: Date.now(), status: "ready", text: share.text, subject: share.subject ?? "", files });
      return files.map((f) => f.id);
    },
    /** What is still waiting, as the app would read it. */
    pending: () => [...entries.values()].map(clone),
    /** Entries the app acknowledged: imported (`discard: false`) or thrown away. */
    acknowledged: () => [...acknowledged],
  };
}
