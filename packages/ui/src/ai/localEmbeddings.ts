import {
  DEFAULT_SEARCH_MODE,
  EMBEDDING_BUDGETS,
  EMBEDDING_MODELS,
  EMPTY_USAGE,
  EmbeddingIndexer,
  EmbeddingScheduler,
  EmbeddingStore,
  HybridSearchService,
  ProviderEmbeddingError,
  appendAiLedgerEntry,
  checkBudgets,
  createProviderEmbeddingEngine,
  embeddableNotes,
  embeddingEngineId,
  embeddingPackageBytes,
  fetchProviderJson,
  gateDecision,
  goldenAgreement,
  isLocalTarget,
  measureEngine,
  probeAgreement,
  prominence,
  providerEngineId,
  standingManifestOf,
  usageCostUsd,
  type AiEgress,
  type BudgetCheck,
  type DeviceClass,
  type EgressManifest,
  type EmbeddingAdmission,
  type EmbeddingEngine,
  type EmbeddingMeasurement,
  type EmbeddingModelSpec,
  type EmbeddingProgress,
  type EmbeddingSpaceSummary,
  type GoldenAgreement,
  type HttpRequestSpec,
  type IDatabaseAdapter,
  type ModelFailure,
  type ProviderJsonAnswer,
  type ProviderTarget,
  type SearchMode,
  type SemanticSource,
  type VaultQueryService,
} from "@plainva/core";
import type { AiLedgerStore } from "./aiSession";
import type { StandingApproval, StandingApprovalStore } from "./aiStores";
import type { VaultPolicyHost } from "./aiVaultHost";
import { downloadPackage, openPackage, packageInstalled, type LocalModelBridge, type PackageProgress } from "./localModels";

/**
 * Search by meaning in one vault, the same way in both shells (plan
 * KI-Harness P2a-4/P2a-5). What computes the vectors is a device setting —
 * a catalog package run by the native runtime, or the model of the profile
 * "Embeddings" at an own provider (`semanticSourceOf`). The controller opens
 * it after its check (a package against the catalog's reference vector, a
 * provider's model against the fingerprint it left), keeps the vectors in
 * step with the notes, and searches over words and meaning. The shells hand
 * in the native bridge, the vault's index, how to read a note and — for an
 * own provider — the egress, the vault's privacy rules and its app data;
 * they report the setting (`update`), a moved index (`indexChanged`) and when
 * the device may work (`ready`).
 */

/** What computing with an own provider needs (plan P2a-5), bound to one vault on this device. */
export interface ProviderEmbeddingHost {
  /** The native egress: the keys stay there. */
  egress: AiEgress;
  /** The vault's privacy rules (ADR 0018). */
  policy: Pick<VaultPolicyHost, "policyOf" | "rules">;
  /** Inside an encrypted workspace nothing goes to a cloud. */
  encrypted(): boolean;
  /** The standing approvals of this vault on this device. */
  approvals: StandingApprovalStore;
  /** The vault's run ledger: what the vectors cost. */
  ledger: AiLedgerStore;
  newId(): string;
  now(): Date;
}

export interface LocalEmbeddingsHost {
  bridge: LocalModelBridge;
  db: IDatabaseAdapter;
  query: Pick<VaultQueryService, "searchOccurrencesPage" | "searchFullText" | "filterByOperators" | "fileRecords" | "noteBytes">;
  readText(path: string): Promise<string | null>;
  /** Resolves when the device may take the next step (desktop: an idle moment; phone: in the foreground). */
  ready?(signal: AbortSignal): Promise<void>;
  /** Absent where the shell offers no own provider. */
  provider?: ProviderEmbeddingHost;
}

type PackageSource = Extract<SemanticSource, { kind: "package" }>;
type ProviderSource = Extract<SemanticSource, { kind: "provider" }>;

/**
 * Why no engine computes: the device check failed, the runtime or the files
 * are missing, the profile names no model, the provider has no embeddings,
 * the workspace is encrypted (no cloud), or the provider answered with a
 * failure.
 */
export type EngineFailure = "check" | "runtime" | "load" | "no-model" | "no-route" | "encrypted" | "provider";

export type EngineState =
  | { kind: "off" }
  | { kind: "missing"; source: PackageSource }
  | { kind: "opening"; source: SemanticSource }
  | { kind: "checking"; source: SemanticSource }
  /** A cloud model waits for the standing approval of what goes there. */
  | { kind: "approval"; source: ProviderSource; manifest: EgressManifest }
  | { kind: "ready"; source: SemanticSource; check: GoldenAgreement | null }
  | { kind: "failed"; source: SemanticSource; reason: EngineFailure; detail: string; failure?: ModelFailure };

export interface LocalEmbeddingsState {
  engine: EngineState;
  /** How search ranks, as the device setting says; it counts only while the engine is ready. */
  mode: SearchMode;
  progress: EmbeddingProgress;
  download: (PackageProgress & { model: string }) | null;
  downloadError: string | null;
  /** The last search by meaning could not be answered (an own provider offline, a key refused): its hits were by words. */
  meaningFailure: ModelFailure | null;
  /** Why the last run stopped, when a provider said so (a key revoked, a quota used up). */
  runFailure: ModelFailure | null;
  /** The device check is running (plan P2a-6). */
  measuring: boolean;
  /** Its last result, for the engine open now. */
  measurement: MeasurementReport | null;
  measureError: string | null;
}

/** The device check's result: what was measured, and each budget of the device's class. */
export interface MeasurementReport {
  device: DeviceClass;
  measurement: EmbeddingMeasurement;
  checks: BudgetCheck[];
  /** When it was measured (ISO 8601). */
  at: string;
}

/**
 * A note close in meaning to a question, for the context package (plan P2b):
 * its closest section and a signal from how far it stands out of the vault.
 */
export interface SemanticCandidate {
  path: string;
  ordinal: number;
  hash: string;
  /** 0.05–1; 0.5 and more is strong enough for evidence. */
  score: number;
}

/**
 * How far a hit must stand out of the vault's band for the question (robust
 * deviations, `prominence`) to take part, and to be strong. Measured on the
 * embedding spike's corpus (308 notes, 90 questions in ten languages,
 * 01.10.): from 2 on, 80 % of the notes that answer take part and about 8
 * notes per question; from 4 on, one to three notes per question, the ones
 * worth sending as evidence. A cosine or its ratio to the best hit says
 * nothing here: the default model puts every note of a vault between 0.7 and
 * 0.9, and the best hit's ratio is 1 for any question.
 */
const CANDIDATE_PROMINENCE = 2;
const STRONG_PROMINENCE = 4;
/** Below this many notes a vault's band has no shape: meaning adds no candidates, the words still do. */
const MIN_SPREAD_NOTES = 10;
/** At or above this cosine two sections are one source. */
const NEAR_DUPLICATE_COSINE = 0.95;

/** The signal of a prominence: 0.5 at the strong line, 1 twice as far out, never below 0.05. */
function prominenceSignal(lead: number): number {
  return Math.min(1, Math.max(0.05, (0.5 * (lead - CANDIDATE_PROMINENCE)) / (STRONG_PROMINENCE - CANDIDATE_PROMINENCE)));
}

/** What this device keeps for search by meaning but does not use now. */
export interface UnusedEmbeddings {
  packages: EmbeddingModelSpec[];
  spaces: EmbeddingSpaceSummary[];
}

const IDLE_PROGRESS: EmbeddingProgress = { state: "idle", total: 0, current: 0, deferred: 0, withheld: 0 };

/** A provider that could not be reached is tried again on the next index change, at most this often. */
const RETRY_MS = 60_000;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The native error codes the shells answer with, as the reason the settings show. */
function failureReason(error: unknown): { reason: "runtime" | "load"; detail: string } {
  const detail = errorText(error);
  return { reason: /runtime_(missing|load)/.test(detail) ? "runtime" : "load", detail };
}

function failureOf(error: unknown): ModelFailure {
  return error instanceof ProviderEmbeddingError ? error.failure : { kind: "provider_error", message: errorText(error) };
}

/** Failures that pass by themselves: a server not started yet, a network gone, a provider asking to wait. */
function passing(failure: ModelFailure | undefined): boolean {
  return failure?.kind === "offline" || failure?.kind === "rate_limited" || failure?.kind === "overloaded" || failure?.kind === "stream_broken";
}

/** The recipient an approval names. */
export function recipientOf(target: ProviderTarget): string {
  return `${target.provider.id}/${target.model}`;
}

/** The engine id a source computes into. */
function engineIdOf(source: SemanticSource): string | null {
  if (source.kind === "package") return embeddingEngineId(source.spec);
  return source.target ? providerEngineId(source.target.provider.id, source.target.model) : null;
}

export class LocalEmbeddings {
  private state: LocalEmbeddingsState = {
    engine: { kind: "off" },
    mode: DEFAULT_SEARCH_MODE,
    progress: IDLE_PROGRESS,
    download: null,
    downloadError: null,
    meaningFailure: null,
    runFailure: null,
    measuring: false,
    measurement: null,
    measureError: null,
  };
  private readonly listeners = new Set<() => void>();
  private source: SemanticSource | null = null;
  private engine: EmbeddingEngine | null = null;
  private indexer: EmbeddingIndexer | null = null;
  private scheduler: EmbeddingScheduler | null = null;
  private generation = 0;
  /** Why embedding stands still: the reader paused it, the app is in the background, or the device check runs. Any holds it. */
  private readonly pauses = new Set<"user" | "background" | "measure">();
  /** The provider model computing now, and what it counted since the last ledger entry. */
  private target: ProviderTarget | null = null;
  private usage: { tokens: number; requests: number } | null = null;
  private ledgerLane: Promise<void> = Promise.resolve();
  /** The provider's last word on a request: null after an answer, its failure otherwise. */
  private lastFailure: ModelFailure | null = null;
  private openedAt = 0;
  readonly search: HybridSearchService;

  constructor(private readonly host: LocalEmbeddingsHost) {
    this.search = new HybridSearchService({
      words: host.query,
      meaning: () => (this.state.engine.kind === "ready" ? this.indexer : null),
      mode: () => this.state.mode,
      readText: host.readText,
      onMeaning: (outcome) => {
        const failure = outcome.ok ? null : failureOf(outcome.error);
        if (failure || this.state.meaningFailure) this.set({ meaningFailure: failure });
      },
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

  /** The device setting changed (or was read at start): what computes the vectors (`semanticSourceOf`), and the mode. */
  update({ source, mode }: { source: SemanticSource | null; mode: SearchMode }): Promise<void> {
    if (mode !== this.state.mode) this.set({ mode });
    const kind = this.state.engine.kind;
    const same = (source?.key ?? null) === (this.source?.key ?? null);
    this.source = source;
    // The same source again is news only while it waits: missing, failed, waiting for approval, or not open at all.
    const waiting = kind === "failed" || kind === "missing" || kind === "approval" || (kind === "off" && source !== null);
    if (same && !waiting) {
      // A price may change under the same key.
      if (source?.kind === "provider" && source.target && this.target) this.target = source.target;
      return Promise.resolve();
    }
    return this.sync();
  }

  /**
   * Opens what the setting names, or closes what it no longer names. A source
   * that failed or waits opens again: that is the retry.
   */
  async sync(): Promise<void> {
    const source = this.source;
    const current = this.state.engine;
    if (!source) {
      await this.close();
      return;
    }
    if ((current.kind === "ready" || current.kind === "opening" || current.kind === "checking") && current.source.key === source.key) return;
    await this.close();
    const generation = ++this.generation;
    this.openedAt = Date.now();
    if (source.kind === "package") await this.openPackage(source, generation);
    else await this.openProvider(source, generation);
  }

  private async openPackage(source: PackageSource, generation: number): Promise<void> {
    const spec = source.spec;
    if (!(await packageInstalled(this.host.bridge, spec))) {
      if (generation === this.generation) this.set({ engine: { kind: "missing", source } });
      return;
    }
    this.set({ engine: { kind: "opening", source } });
    let engine: EmbeddingEngine;
    try {
      engine = await openPackage(this.host.bridge, spec);
    } catch (error) {
      if (generation === this.generation) this.set({ engine: { kind: "failed", source, ...failureReason(error) } });
      return;
    }
    if (generation !== this.generation) {
      await engine.dispose();
      return;
    }
    // The device check: the whole chain against the catalog's reference, before a single note.
    this.set({ engine: { kind: "checking", source } });
    let check: GoldenAgreement;
    try {
      const [vector] = await engine.embed([spec.golden.text], "document");
      check = goldenAgreement(spec, vector!);
    } catch (error) {
      await engine.dispose();
      if (generation === this.generation) this.set({ engine: { kind: "failed", source, ...failureReason(error) } });
      return;
    }
    if (generation !== this.generation || !check.ok) {
      await engine.dispose();
      if (generation === this.generation) this.set({ engine: { kind: "failed", source, reason: "check", detail: `cosine ${check.cosine.toFixed(3)}` } });
      return;
    }
    this.start(engine, source, check);
  }

  /**
   * The profile "Embeddings" (plan P2a-5). A server on this computer opens
   * at once; a cloud needs the standing approval first, and an encrypted
   * workspace sends it nothing. The probe — a fixed text, no note — learns
   * the model; when it answers other than the fingerprint the space was
   * computed with, the old vectors go instead of being mixed with new ones.
   */
  private async openProvider(source: ProviderSource, generation: number): Promise<void> {
    const host = this.host.provider;
    const fail = (reason: EngineFailure, detail = "", failure?: ModelFailure) => {
      if (generation === this.generation) this.set({ engine: { kind: "failed", source, reason, detail, ...(failure ? { failure } : {}) } });
    };
    const target = source.target;
    if (!target) return fail("no-model");
    if (!target.route) return fail("no-route");
    if (!host) return fail("load", "no provider access in this window");
    const cloud = !isLocalTarget(target);
    if (cloud && host.encrypted()) return fail("encrypted");
    if (cloud && !(await this.approvalOf(target))) {
      const manifest = await this.standingManifest(host, target);
      if (generation === this.generation) this.set({ engine: { kind: "approval", source, manifest } });
      return;
    }
    if (generation !== this.generation) return;
    this.set({ engine: { kind: "opening", source } });
    this.target = target;
    let engine: Awaited<ReturnType<typeof createProviderEmbeddingEngine>>;
    try {
      engine = await createProviderEmbeddingEngine({
        endpoint: target.provider.endpoint,
        route: target.route,
        model: target.model,
        send: this.sender(host, cloud),
        onUsage: (tokens) => {
          this.usage = { tokens: (this.usage?.tokens ?? 0) + tokens, requests: (this.usage?.requests ?? 0) + 1 };
        },
      });
    } catch (error) {
      if (generation === this.generation) this.target = null;
      return fail("provider", errorText(error), failureOf(error));
    }
    if (generation !== this.generation) {
      await engine.dispose();
      return;
    }
    try {
      const store = new EmbeddingStore(this.host.db);
      if (await store.writable()) {
        const space = (await store.spaces()).find((s) => s.engine === engine.id);
        const kept = space ? await store.probeOf(engine.id, space.dim) : null;
        const same = space !== undefined && space.dim === engine.dim && kept !== null && probeAgreement(kept, engine.probe);
        if (space && !same) await store.dropEngine(engine.id);
        if (!same) await store.setProbe(engine.id, engine.probe);
      }
    } catch (error) {
      await engine.dispose();
      return fail("load", errorText(error));
    }
    if (generation !== this.generation) {
      await engine.dispose();
      return;
    }
    this.start(engine, source, null, cloud ? this.admission(host, target) : undefined);
  }

  private start(engine: EmbeddingEngine, source: SemanticSource, check: GoldenAgreement | null, admission?: EmbeddingAdmission): void {
    this.engine = engine;
    this.indexer = new EmbeddingIndexer({ db: this.host.db, engine, readText: this.host.readText, admission });
    this.scheduler = new EmbeddingScheduler({
      indexer: this.indexer,
      ready: this.host.ready,
      onProgress: (progress) => {
        this.set({ progress, runFailure: progress.state === "failed" ? this.lastFailure : null });
        if (progress.state !== "working") void this.record(progress.state === "failed" ? "failed" : "answered");
      },
    });
    this.set({ engine: { kind: "ready", source, check } });
    if (this.pauses.size) this.scheduler.pause();
    else void this.scheduler.kick();
  }

  /** One request through the native egress; an encrypted workspace stops a cloud even mid-run. */
  private sender(host: ProviderEmbeddingHost, cloud: boolean) {
    return async (spec: HttpRequestSpec, signal?: AbortSignal): Promise<ProviderJsonAnswer> => {
      if (cloud && host.encrypted()) {
        void this.close().then(() => this.sync());
        throw new Error("encrypted workspace: nothing goes to a cloud");
      }
      const requestId = `embed-${host.newId()}`;
      const abort = () => void host.egress.cancel(requestId);
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const answer = await fetchProviderJson(host.egress, spec, requestId);
        this.lastFailure = answer.ok ? null : answer.failure;
        return answer;
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    };
  }

  /** The privacy rules as the pipeline asks them, for one cloud recipient. */
  private admission(host: ProviderEmbeddingHost, target: ProviderTarget): EmbeddingAdmission {
    const run = { recipient: { kind: "cloud" as const, provider: target.provider.id, model: target.model }, webTools: false };
    return {
      rulesKey: async () => JSON.stringify([(await host.policy.rules()).rules, host.encrypted()]),
      async deniedByRules(paths) {
        const out = new Set<string>();
        // An empty text: the note's own rule is not read here, only its folder's and the default.
        for (const path of paths) if (!gateDecision(await host.policy.policyOf(path, ""), run).allowed) out.add(path);
        return out;
      },
      admits: async (path, text) => gateDecision(await host.policy.policyOf(path, text), run).allowed,
    };
  }

  /** What a standing approval for this model covers, as the send overview shows it. */
  private async standingManifest(host: ProviderEmbeddingHost, target: ProviderTarget): Promise<EgressManifest> {
    const notes = await embeddableNotes(this.host.db).catch(() => []);
    const denied = await this.admission(host, target)
      .deniedByRules(notes.map((note) => note.path))
      .catch(() => new Set<string>());
    const going = notes.filter((note) => !denied.has(note.path));
    return standingManifestOf(
      { providerId: target.provider.id, providerLabel: target.provider.label, model: target.model, ...(target.price ? { price: target.price } : {}) },
      { paths: going.map((note) => note.path), withheld: denied.size, bytes: going.reduce((sum, note) => sum + note.bytes, 0) },
    );
  }

  /** The standing approval of a cloud model, if the reader gave it on this device for this vault. */
  async approvalOf(target: ProviderTarget): Promise<StandingApproval | null> {
    const host = this.host.provider;
    if (!host) return null;
    const recipient = recipientOf(target);
    try {
      return (await host.approvals.load()).find((a) => a.recipient === recipient && a.purpose === "embeddings") ?? null;
    } catch {
      return null;
    }
  }

  /** The reader approved the overview: notes and search questions may go to this cloud model until withdrawn. */
  async approve(): Promise<void> {
    const engine = this.state.engine;
    const host = this.host.provider;
    if (engine.kind !== "approval" || !host || !engine.source.target) return;
    const recipient = recipientOf(engine.source.target);
    const others = (await host.approvals.load().catch(() => [])).filter((a) => !(a.recipient === recipient && a.purpose === "embeddings"));
    await host.approvals.save([...others, { recipient, purpose: "embeddings", at: host.now().toISOString() }]);
    await this.sync();
  }

  /** Withdraws the approval of a cloud model: nothing more goes there, and search by meaning waits for a new one. */
  async withdraw(target: ProviderTarget): Promise<void> {
    const host = this.host.provider;
    if (!host) return;
    const recipient = recipientOf(target);
    await host.approvals.save((await host.approvals.load().catch(() => [])).filter((a) => !(a.recipient === recipient && a.purpose === "embeddings")));
    await this.close();
    await this.sync();
  }

  /**
   * Writes what a provider counted since the last entry into the vault's
   * ledger — one entry per run, not per request. Entries go one after the
   * other, so two never read the ledger at once and lose each other.
   */
  private record(stop: "answered" | "failed"): Promise<void> {
    const usage = this.usage;
    const target = this.target;
    const host = this.host.provider;
    if (!usage || !target || !host) return this.ledgerLane;
    this.usage = null;
    this.ledgerLane = this.ledgerLane.then(async () => {
      const counted = { ...EMPTY_USAGE, inputTokens: usage.tokens };
      const costUsd = usageCostUsd(counted, target.price);
      try {
        const ledger = await host.ledger.load();
        await host.ledger.save(
          appendAiLedgerEntry(ledger, {
            at: host.now().toISOString(),
            conversationId: `embeddings-${host.newId()}`,
            providerId: target.provider.id,
            model: target.model,
            stop,
            steps: usage.requests,
            tools: [],
            usage: counted,
            ...(costUsd !== undefined ? { costUsd } : {}),
          }),
        );
      } catch {
        // The vectors count even when app data cannot be written.
      }
    });
    return this.ledgerLane;
  }

  /** The index changed: plan again (cheap; the scheduler waits for the step under way). A provider out of reach is tried again. */
  indexChanged(): void {
    const engine = this.state.engine;
    if (engine.kind === "failed" && engine.reason === "provider" && passing(engine.failure) && Date.now() - this.openedAt >= RETRY_MS) {
      void this.sync();
      return;
    }
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

  /**
   * The device check (plan P2a-6): this device against the budgets of the
   * embedding spike — with sample text, never the notes. Embedding waits
   * until the step under way is done and while it measures, so the numbers
   * are the engine's alone.
   */
  async measure(device: DeviceClass): Promise<MeasurementReport | null> {
    const state = this.state.engine;
    const engine = this.engine;
    if (state.kind !== "ready" || !engine || this.state.measuring) return null;
    const generation = this.generation;
    this.set({ measuring: true, measureError: null });
    this.pauses.add("measure");
    this.scheduler?.pause();
    try {
      await this.scheduler?.idle();
      const measured = await measureEngine(engine);
      const memory = this.host.bridge.memory ? await this.host.bridge.memory().catch(() => null) : null;
      const measurement: EmbeddingMeasurement = {
        ...measured,
        peakMemoryBytes: memory?.peak ?? null,
        downloadBytes: state.source.kind === "package" ? embeddingPackageBytes(state.source.spec) : null,
      };
      const report: MeasurementReport = { device, measurement, checks: checkBudgets(measurement, EMBEDDING_BUDGETS[device]), at: new Date().toISOString() };
      if (generation === this.generation) this.set({ measurement: report });
      return report;
    } catch (error) {
      if (generation === this.generation) this.set({ measureError: errorText(error) });
      return null;
    } finally {
      this.pauses.delete("measure");
      this.set({ measuring: false });
      if (!this.pauses.size) void this.scheduler?.resume();
    }
  }

  /**
   * Notes close in meaning to a question, for the context of a message (plan
   * P2b): none while no engine is ready. A cloud embedding model gets the
   * question only when the conversation goes to a cloud itself — a local
   * conversation stays local. A hit counts by how far it stands out of the
   * vault's band for this question; near-duplicates count once.
   */
  async semanticCandidates(question: string, limit: number, options: { cloudQuestion: boolean }): Promise<SemanticCandidate[]> {
    const engine = this.state.engine;
    const indexer = this.indexer;
    if (engine.kind !== "ready" || !indexer || !question.trim() || limit <= 0) return [];
    if (engine.source.kind === "provider" && engine.source.target && !isLocalTarget(engine.source.target) && !options.cloudQuestion) return [];
    try {
      const { hits, spread } = await indexer.rankedSearch(question, limit * 2);
      if (spread.notes < MIN_SPREAD_NOTES) return [];
      const prominent = hits.filter((hit) => prominence(hit.score, spread) >= CANDIDATE_PROMINENCE);
      const kept = (await indexer.distinct(prominent, NEAR_DUPLICATE_COSINE)).slice(0, limit);
      return kept.map((hit) => ({ path: hit.path, ordinal: hit.ordinal, hash: hit.hash, score: prominenceSignal(prominence(hit.score, spread)) }));
    } catch {
      // Meaning could not answer (a provider out of reach): the words still can.
      return [];
    }
  }

  /** Downloads a package with progress; switching the setting to it is the caller's. */
  async install(spec: EmbeddingModelSpec): Promise<boolean> {
    this.set({ download: { model: spec.id, received: 0, total: 0, file: "" }, downloadError: null });
    try {
      await downloadPackage(this.host.bridge, spec, (progress) => this.set({ download: { ...progress, model: spec.id } }));
      this.set({ download: null });
      return true;
    } catch (error) {
      this.set({ download: null, downloadError: errorText(error) });
      return false;
    }
  }

  async cancelInstall(spec: EmbeddingModelSpec): Promise<void> {
    await this.host.bridge.cancel(spec.id);
  }

  /** Removes a package and every vector it computed in this vault. */
  async remove(spec: EmbeddingModelSpec): Promise<void> {
    const engine = this.state.engine;
    if (engine.kind !== "off" && engine.source.kind === "package" && engine.source.spec.id === spec.id) await this.close();
    await this.host.bridge.remove(spec.id);
    await new EmbeddingStore(this.host.db).dropEngine(embeddingEngineId(spec));
  }

  /** Packages on this device that are not chosen, and the vector spaces of other models in this vault. */
  async unused(): Promise<UnusedEmbeddings> {
    const source = this.source;
    const active = source ? engineIdOf(source) : null;
    const packages: EmbeddingModelSpec[] = [];
    for (const spec of EMBEDDING_MODELS) {
      if (source?.kind === "package" && source.spec.id === spec.id) continue;
      if (await packageInstalled(this.host.bridge, spec).catch(() => false)) packages.push(spec);
    }
    const spaces = (await new EmbeddingStore(this.host.db).spaces().catch(() => [])).filter((space) => space.engine !== active);
    return { packages, spaces };
  }

  /** Removes what `unused` lists: the files of those packages and those vectors. */
  async removeUnused(): Promise<void> {
    const { packages, spaces } = await this.unused();
    for (const spec of packages) await this.host.bridge.remove(spec.id);
    const store = new EmbeddingStore(this.host.db);
    for (const space of spaces) await store.dropEngine(space.engine);
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
    const recorded = this.record("answered");
    this.target = null;
    this.lastFailure = null;
    this.set({ engine: { kind: "off" }, progress: IDLE_PROGRESS, meaningFailure: null, runFailure: null, measurement: null, measureError: null });
    await Promise.all([engine?.dispose(), recorded]);
  }
}
