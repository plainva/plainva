import { Capacitor, registerPlugin } from "@capacitor/core";

export const SHARE_LIMITS = { files: 10, fileBytes: 25 * 1024 * 1024, totalBytes: 50 * 1024 * 1024, textBytes: 512 * 1024, chunkBytes: 256 * 1024 } as const;
export interface SharedFile { id: string; name: string; mime: string; size: number; sha256: string }
/**
 * "Into the journal" (plan Journal, J4): the share becomes ONE entry of a day's
 * journal instead of a note of its own. Date, time, heading and text are fixed
 * when the plan is made, so a retry finds its own entry instead of writing a
 * second one.
 */
export interface ShareJournalEntry {
  /** Local day `YYYY-MM-DD`. */
  date: string;
  /** `HH:mm`. */
  time: string;
  heading: string;
  text: string;
}
export interface ShareImportPlan {
  version: 1;
  vaultId: string;
  notePath: string;
  noteText: string;
  files: Array<{ id: string; path: string }>;
  /**
   * Additive: both native stores keep the plan verbatim, and a build that does
   * not know the field never makes such a plan. With it, `notePath` names the
   * daily note and `noteText` stays empty.
   */
  journal?: ShareJournalEntry;
}
export interface PendingShare {
  version: 1;
  id: string;
  createdAt: number;
  status: "receiving" | "ready" | "failed";
  text: string;
  subject: string;
  files: SharedFile[];
  failure?: string;
  plan?: ShareImportPlan;
  filesDone?: string[];
  noteWritten?: boolean;
}
export interface ShareTargetPort {
  listPendingShares(): Promise<{ entries: PendingShare[] }>;
  readFileChunk(args: { id: string; fileId: string; offset: number; length: number }): Promise<{ data: string }>;
  beginImport(args: { id: string; plan: ShareImportPlan }): Promise<{ entry: PendingShare }>;
  markImported(args: { id: string; fileId?: string; note?: boolean }): Promise<void>;
  finishShare(args: { id: string; discard?: boolean }): Promise<void>;
}
const nativeShareTarget = registerPlugin<ShareTargetPort>("ShareTarget");

/**
 * The inbox of a production-bundle test run (plan Befunde 2026-09-24, E28).
 *
 * A plain browser has no share extension, so the share sheet — and "Create as
 * a task" in it — could never run against the bundle that ships; only its
 * import pipeline had tests, with a port handed in by hand. The e2e-prod
 * runner installs an inbox on `globalThis` before the bundle loads, the same
 * way the fixture SQLite bridge reaches the index: the seam sits at the
 * platform boundary, and it only exists when the runner installed it. On a
 * device the native plugin always answers; on the web without the fixture
 * nothing is pending.
 */
const FIXTURE_KEY = "__plainvaFixtureShareTarget";
const PORT_METHODS = ["listPendingShares", "readFileChunk", "beginImport", "markImported", "finishShare"] as const;

export function fixtureShareTarget(): ShareTargetPort | null {
  if (Capacitor.isNativePlatform()) return null;
  const candidate = (globalThis as Record<string, unknown>)[FIXTURE_KEY];
  if (!candidate || typeof candidate !== "object") return null;
  const port = candidate as Record<string, unknown>;
  return PORT_METHODS.every((method) => typeof port[method] === "function") ? (candidate as ShareTargetPort) : null;
}

const activeShareTarget = (): ShareTargetPort => fixtureShareTarget() ?? nativeShareTarget;

/** The port the app talks to: the native inbox, or — only while a test runner installed one — its fixture inbox. */
export const shareTarget: ShareTargetPort = {
  listPendingShares: () => activeShareTarget().listPendingShares(),
  readFileChunk: (args) => activeShareTarget().readFileChunk(args),
  beginImport: (args) => activeShareTarget().beginImport(args),
  markImported: (args) => activeShareTarget().markImported(args),
  finishShare: (args) => activeShareTarget().finishShare(args),
};
export const validShareId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

/** Native metadata is bounded and checked before allocating attachment buffers. */
export function validateShare(entry: PendingShare): PendingShare {
  if (!entry || entry.version !== 1 || !validShareId(entry.id) || !["receiving", "ready", "failed"].includes(entry.status)
    || !Number.isSafeInteger(entry.createdAt) || typeof entry.text !== "string" || typeof entry.subject !== "string"
    || new TextEncoder().encode(entry.text + entry.subject).length > SHARE_LIMITS.textBytes
    || !Array.isArray(entry.files) || entry.files.length > SHARE_LIMITS.files) throw new Error("SHARE_INVALID");
  let total = 0;
  const ids = new Set<string>();
  for (const file of entry.files) {
    if (!file || !validShareId(file.id) || ids.has(file.id) || typeof file.name !== "string" || file.name.length > 512
      || typeof file.mime !== "string" || file.mime.length > 256 || !Number.isSafeInteger(file.size) || file.size < 0
      || file.size > SHARE_LIMITS.fileBytes || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("SHARE_INVALID");
    ids.add(file.id); total += file.size;
  }
  if (total > SHARE_LIMITS.totalBytes) throw new Error("SHARE_LIMIT");
  return entry;
}

export async function listPendingShares(): Promise<PendingShare[]> {
  if (!Capacitor.isNativePlatform() && !fixtureShareTarget()) return [];
  const { entries } = await shareTarget.listPendingShares();
  if (!Array.isArray(entries) || entries.length > 20) throw new Error("SHARE_INVALID");
  return entries.map(validateShare);
}
