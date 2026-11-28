import type { TabItem } from "../hooks/usePaneLayout";
import type { TextFileShape } from "@plainva/ui";
import { loadPart } from "@plainva/ui";

export interface TransferredDocument {
  text: string;
  base: string | null;
  shape: TextFileShape | null;
  viewMode: "read" | "live" | "source";
  selection: { anchor: number; head: number } | null;
  scrollTop: number;
  suggestion?: { copy: string; note: string; base?: string };
}
export interface TabTransfer {
  id: string;
  vaultPath: string;
  source: string;
  path: string;
  tab: TabItem;
  document?: TransferredDocument;
}
export type TransferStatus = "pending" | "applying" | "accepted" | "canceled" | "failed" | "unknown";
export interface TransferResult { status: TransferStatus }
type Entry = { status: TransferStatus; fingerprint: string; source: string; snapshot?: TabTransfer };

/** A timeout is not rejection: the source must ask this ledger before closing. */
export class TabTransferManager {
  private entries = new Map<string, Entry>();
  private lane: Promise<void> = Promise.resolve();
  constructor(private deps: {
    persist(snapshot: TabTransfer): Promise<void>;
    adopt(snapshot: TabTransfer): Promise<void>;
  }) {}

  async begin(snapshot: TabTransfer, from: string): Promise<TransferResult> {
    snapshot = structuredClone(snapshot);
    if (snapshot.source !== from || !from || from === "main" || !snapshot.id || !snapshot.vaultPath
      || !Array.isArray(snapshot.tab?.history) || snapshot.tab.history.length > 256
      || snapshot.tab.history[snapshot.tab.historyIndex] !== snapshot.path
      || snapshot.tab.history.some(path => typeof path !== "string")
      || snapshot.id.length > 100 || !snapshot.path) throw new Error("Invalid tab transfer");
    const document = snapshot.document;
    if (document && (typeof document.text !== "string" || document.base !== null && typeof document.base !== "string"
      || !["read", "live", "source"].includes(document.viewMode) || !Number.isFinite(document.scrollTop) || document.scrollTop < 0
      || document.suggestion && (document.viewMode === "read" || typeof document.suggestion.copy !== "string" || typeof document.suggestion.note !== "string"))) throw new Error("Invalid transferred document");
    if (document?.selection && [document.selection.anchor, document.selection.head].some(value => !Number.isInteger(value) || value < 0
      || value > (document.suggestion?.copy ?? document.text).length)) throw new Error("Invalid transferred selection");
    const encoded = new TextEncoder().encode(JSON.stringify(snapshot));
    if (encoded.length > 16 * 1024 * 1024) throw new Error("Tab transfer is too large");
    const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoded)), n => n.toString(16).padStart(2, "0")).join("");
    const existing = this.entries.get(snapshot.id);
    if (existing) {
      if (existing.status === "canceled" && existing.source === from && !existing.fingerprint) return { status: "canceled" };
      if (existing.fingerprint !== fingerprint || existing.source !== from) throw new Error("Transfer ID already names different content");
      return { status: existing.status };
    }
    // Do not evict an accepted receipt whose acknowledgement may be lost.
    // The small ledger lasts for this owner process, with a hard memory cap.
    if (this.entries.size >= 4096) throw new Error("The transfer receipt ledger is full");
    if ([...this.entries.values()].filter(entry => entry.status === "pending" || entry.status === "applying").length >= 4) throw new Error("Another tab transfer is still pending");
    const entry: Entry = { status: "pending", fingerprint, source: from, snapshot: structuredClone(snapshot) };
    this.entries.set(snapshot.id, entry);
    // One target at a time: opening vault B cannot unmount the editor adopting A.
    this.lane = this.lane.catch(() => {}).then(async () => {
      try {
        if (entry.status !== "pending") return;
        await this.deps.persist(entry.snapshot!);
        if (entry.status !== "pending") return;
        entry.status = "applying";
        await this.deps.adopt(entry.snapshot!);
        entry.status = "accepted";
      } catch { entry.status = "failed"; }
      finally {
        delete entry.snapshot;
      }
    });
    return { status: entry.status };
  }

  status(id: string, from: string): TransferResult {
    const entry = this.entries.get(id);
    return { status: entry?.source === from ? entry.status : "unknown" };
  }
  cancel(id: string, from: string): TransferResult {
    const entry = this.entries.get(id);
    if (!entry && id && id.length <= 100 && from && from !== "main") {
      if (this.entries.size >= 4096) return { status: "canceled" };
      // A delayed begin (including its fingerprint calculation) must not
      // resurrect a transfer canceled before its receipt was acknowledged.
      this.entries.set(id, { source: from, fingerprint: "", status: "canceled" });
    }
    // Once application started, only its actual outcome resolves ownership.
    if (entry?.source === from && entry.status === "pending") entry.status = "canceled";
    return this.status(id, from);
  }
  async whenIdle(): Promise<void> { await this.lane; }
}

export interface CapturedTabDocument {
  document: TransferredDocument;
  finish(accepted: boolean): Promise<void>;
}
export interface TabDocumentEndpoint {
  capture(): Promise<CapturedTabDocument>;
  adopt(document: TransferredDocument, transferId: string): Promise<void>;
}
const editors = new Map<string, TabDocumentEndpoint>();
const endpointKey = (vault: string, path: string) => `${vault}\0${path}`;
export function registerTabDocument(vault: string, path: string, endpoint: TabDocumentEndpoint): () => void {
  const key = endpointKey(vault, path);
  editors.set(key, endpoint);
  return () => { if (editors.get(key) === endpoint) editors.delete(key); };
}
export function tabDocument(vault: string, path: string): TabDocumentEndpoint | undefined { return editors.get(endpointKey(vault, path)); }

type Target = (snapshot: TabTransfer) => Promise<void>;
let mainOpener: ((path: string) => Promise<void>) | null = null;
let target: { vault: string; adopt: Target } | null = null;
export function registerMainTabOpener(open: (path: string) => Promise<void>): () => void {
  mainOpener = open;
  return () => { if (mainOpener === open) mainOpener = null; };
}
export function registerMainTabTarget(vault: string, adopt: Target): () => void {
  const value = { vault, adopt }; target = value;
  return () => { if (target === value) target = null; };
}
export async function waitForTabDocument(vault: string, path: string): Promise<TabDocumentEndpoint> {
  for (let i = 0; i < 300; i++) {
    const endpoint = tabDocument(vault, path);
    if (endpoint) return endpoint;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("The target editor did not become ready");
}
export const mainTabTransfers = new TabTransferManager({
  async persist(snapshot) {
    if (snapshot.document) {
      const { recordDraft } = await loadPart(() => import("./draftJournal"));
      await recordDraft(snapshot.vaultPath, snapshot.path, snapshot.document.text, 0, `transfer:${snapshot.id}`);
    }
  },
  async adopt(snapshot) {
    if (!mainOpener) throw new Error("The main window is unavailable");
    if (target?.vault !== snapshot.vaultPath) await mainOpener(snapshot.vaultPath);
    for (let i = 0; i < 300; i++) {
      const current = target;
      if (current?.vault === snapshot.vaultPath) { await current.adopt(snapshot); return; }
      if (!mainOpener) throw new Error("The main window closed");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("The main vault did not become ready");
  },
});
