import {
  DEFAULT_SEARCH_MODE,
  EmbeddingIndexer,
  EmbeddingScheduler,
  EmbeddingStore,
  HybridSearchService,
  embeddingEngineId,
  embeddingModel,
  goldenAgreement,
  type EmbeddingEngine,
  type EmbeddingModelSpec,
  type EmbeddingProgress,
  type GoldenAgreement,
  type IDatabaseAdapter,
  type SearchMode,
  type VaultQueryService,
} from "@plainva/core";
import { downloadPackage, openPackage, packageInstalled, type LocalModelBridge, type PackageProgress } from "./localModels";

/**
 * Search by meaning in one vault, the same way in both shells (plan
 * KI-Harness P2a-4): the package this device computes with (a device setting
 * — every device embeds for itself, the vectors never leave it), the engine
 * opened from it after it passed the device check, the pipeline that keeps
 * the vectors in step with the notes, and the search over words and meaning.
 * The shells hand in the native bridge, the vault's index and how to read a
 * note; they report the setting (`update`), a moved index (`indexChanged`)
 * and when the device may work (`ready`).
 */

export interface LocalEmbeddingsHost {
  bridge: LocalModelBridge;
  db: IDatabaseAdapter;
  query: Pick<VaultQueryService, "searchOccurrencesPage" | "searchFullText" | "filterByOperators" | "fileRecords" | "noteBytes">;
  readText(path: string): Promise<string | null>;
  /** Resolves when the device may take the next step (desktop: an idle moment; phone: in the foreground). */
  ready?(signal: AbortSignal): Promise<void>;
}

export type EngineState =
  | { kind: "off" }
  | { kind: "missing"; model: EmbeddingModelSpec }
  | { kind: "opening"; model: EmbeddingModelSpec }
  | { kind: "checking"; model: EmbeddingModelSpec }
  | { kind: "ready"; model: EmbeddingModelSpec; check: GoldenAgreement }
  | { kind: "failed"; model: EmbeddingModelSpec; reason: "check" | "runtime" | "load"; detail: string };

export interface LocalEmbeddingsState {
  engine: EngineState;
  /** How search ranks, as the device setting says; it counts only while the engine is ready. */
  mode: SearchMode;
  progress: EmbeddingProgress;
  download: (PackageProgress & { model: string }) | null;
  downloadError: string | null;
}

const IDLE_PROGRESS: EmbeddingProgress = { state: "idle", total: 0, current: 0, deferred: 0 };

/** The native error codes the shells answer with, as the reason the settings show. */
function failureReason(error: unknown): { reason: "runtime" | "load"; detail: string } {
  const detail = error instanceof Error ? error.message : String(error);
  return { reason: /runtime_(missing|load)/.test(detail) ? "runtime" : "load", detail };
}

export class LocalEmbeddings {
  private state: LocalEmbeddingsState = { engine: { kind: "off" }, mode: DEFAULT_SEARCH_MODE, progress: IDLE_PROGRESS, download: null, downloadError: null };
  private readonly listeners = new Set<() => void>();
  private model: string | null = null;
  private engine: EmbeddingEngine | null = null;
  private indexer: EmbeddingIndexer | null = null;
  private scheduler: EmbeddingScheduler | null = null;
  private generation = 0;
  /** Why embedding stands still: the reader paused it, or the app is in the background. Either holds it. */
  private readonly pauses = new Set<"user" | "background">();
  readonly search: HybridSearchService;

  constructor(private readonly host: LocalEmbeddingsHost) {
    this.search = new HybridSearchService({
      words: host.query,
      meaning: () => (this.state.engine.kind === "ready" ? this.indexer : null),
      mode: () => this.state.mode,
      readText: host.readText,
    });
  }

  snapshot = (): LocalEmbeddingsState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(change: Partial<LocalEmbeddingsState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }

  /** The device setting changed (or was read at start): the model to compute with, and the mode. */
  update({ model, mode }: { model: string | null; mode: SearchMode }): Promise<void> {
    if (mode !== this.state.mode) this.set({ mode });
    // The same model again is news only while it is missing (just loaded) or failed (a retry).
    const kind = this.state.engine.kind;
    if (model === this.model && kind !== "failed" && kind !== "missing") return Promise.resolve();
    this.model = model;
    return this.sync();
  }

  /**
   * Opens what the setting names, or closes what it no longer names. A model
   * that failed opens again: that is the retry.
   */
  async sync(): Promise<void> {
    const spec = embeddingModel(this.model ?? "") ?? null;
    const current = this.state.engine;
    if (!spec) {
      await this.close();
      return;
    }
    if ((current.kind === "ready" || current.kind === "opening" || current.kind === "checking") && current.model.id === spec.id) return;
    await this.close();
    const generation = ++this.generation;
    if (!(await packageInstalled(this.host.bridge, spec))) {
      if (generation === this.generation) this.set({ engine: { kind: "missing", model: spec } });
      return;
    }
    this.set({ engine: { kind: "opening", model: spec } });
    let engine: EmbeddingEngine;
    try {
      engine = await openPackage(this.host.bridge, spec);
    } catch (error) {
      if (generation === this.generation) this.set({ engine: { kind: "failed", model: spec, ...failureReason(error) } });
      return;
    }
    if (generation !== this.generation) {
      await engine.dispose();
      return;
    }
    // The device check: the whole chain against the catalog's reference, before a single note.
    this.set({ engine: { kind: "checking", model: spec } });
    let check: GoldenAgreement;
    try {
      const [vector] = await engine.embed([spec.golden.text], "document");
      check = goldenAgreement(spec, vector!);
    } catch (error) {
      await engine.dispose();
      if (generation === this.generation) this.set({ engine: { kind: "failed", model: spec, ...failureReason(error) } });
      return;
    }
    if (generation !== this.generation || !check.ok) {
      await engine.dispose();
      if (generation === this.generation) this.set({ engine: { kind: "failed", model: spec, reason: "check", detail: `cosine ${check.cosine.toFixed(3)}` } });
      return;
    }
    this.engine = engine;
    this.indexer = new EmbeddingIndexer({ db: this.host.db, engine, readText: this.host.readText });
    this.scheduler = new EmbeddingScheduler({
      indexer: this.indexer,
      ready: this.host.ready,
      onProgress: (progress) => this.set({ progress }),
    });
    this.set({ engine: { kind: "ready", model: spec, check } });
    if (this.pauses.size) this.scheduler.pause();
    else void this.scheduler.kick();
  }

  /** The index changed: plan again (cheap; the scheduler waits for the step under way). */
  indexChanged(): void {
    void this.scheduler?.kick();
  }

  pause(reason: "user" | "background" = "user"): void {
    this.pauses.add(reason);
    this.scheduler?.pause();
  }

  /** Lifts one reason; embedding goes on once none is left — a return to the foreground does not undo the reader's pause. */
  resume(reason: "user" | "background" = "user"): void {
    this.pauses.delete(reason);
    if (!this.pauses.size) void this.scheduler?.resume();
  }

  /** Downloads a package with progress; switching the setting to it is the caller's. */
  async install(spec: EmbeddingModelSpec): Promise<boolean> {
    this.set({ download: { model: spec.id, received: 0, total: 0, file: "" }, downloadError: null });
    try {
      await downloadPackage(this.host.bridge, spec, (progress) => this.set({ download: { ...progress, model: spec.id } }));
      this.set({ download: null });
      return true;
    } catch (error) {
      this.set({ download: null, downloadError: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  async cancelInstall(spec: EmbeddingModelSpec): Promise<void> {
    await this.host.bridge.cancel(spec.id);
  }

  /** Removes a package and every vector it computed in this vault. */
  async remove(spec: EmbeddingModelSpec): Promise<void> {
    if (this.state.engine.kind !== "off" && this.state.engine.model.id === spec.id) await this.close();
    await this.host.bridge.remove(spec.id);
    await new EmbeddingStore(this.host.db).dropEngine(embeddingEngineId(spec));
  }

  /** The size of the vault's notes, for the load dialog's estimate. */
  noteBytes(): Promise<number> {
    return this.host.query.noteBytes();
  }

  /** Free space for packages on this device, or null when the shell cannot say. */
  async freeSpace(): Promise<number | null> {
    try {
      return await this.host.bridge.freeSpace();
    } catch {
      return null;
    }
  }

  /** Stops the pipeline and unloads the model (vault closed, model switched). */
  async close(): Promise<void> {
    this.generation++;
    this.scheduler?.stop();
    this.scheduler = null;
    this.indexer = null;
    const engine = this.engine;
    this.engine = null;
    this.set({ engine: { kind: "off" }, progress: IDLE_PROGRESS });
    await engine?.dispose();
  }
}
