import type { ToolScope } from "./vaultTools";
import {
  addUsage,
  aiMonthlyTotals,
  allProviders,
  appendAiLedgerEntry,
  appendTurn,
  assistantSystemPrompt,
  buildContextPackage,
  conversationMatches,
  conversationSummaryOf,
  conversationTitleFrom,
  EMPTY_USAGE,
  expiredConversations,
  fetchProviderJson,
  initialModelChoice,
  manifestOf,
  modelListSpec,
  parseModelList,
  providerById,
  readAiAppSettings,
  runAgent,
  scopeGrowth,
  sentStamps,
  startConversation,
  usageCostUsd,
  widenScope,
  type AiAppSettings,
  type ApprovedScope,
  type Candidate,
  type AiEgress,
  type ContextNote,
  type ContextPackage,
  type ContextPolicyHost,
  type ConversationRecord,
  type ConversationRepository,
  type ConversationSummary,
  type EgressManifest,
  type EgressRecipient,
  type LedgerEntry,
  type ModelChoice,
  type ModelFailure,
  type ModelInfo,
  type ProviderInfo,
  type RunMeta,
  type RunStop,
  type ScopeGrowth,
  type SituationInput,
  type ToolExecutor,
} from "@plainva/core";

/**
 * THE conversation state of the AI harness (plan §19.1): one store, whatever
 * dresses it. The companion window, the AI tab, the phone's sheet and its
 * screen all read and drive this one object, so switching the dress never
 * copies or forks a conversation.
 *
 * Framework-free (subscribe/getState) so both shells and the tests use it the
 * same way; `useAiSession` binds it to React. Nothing here touches Tauri or
 * Capacitor: the shells hand in the egress and the stores.
 */

export interface AiLedgerStore {
  load(): Promise<LedgerEntry[]>;
  save(entries: readonly LedgerEntry[]): Promise<void>;
}

export interface AiSessionHost {
  egress: AiEgress;
  loadSettings(): Promise<unknown>;
  saveSettings(settings: AiAppSettings): Promise<void>;
  /** Defaults of this build: a Labs build starts with AI switched on. */
  defaults: AiAppSettings;
  /** The English name of the app language: the default answer language. */
  language(): string;
  /** Today as an ISO date, in the app's notion of the day. */
  today(): string;
  now(): Date;
  newId(): string;
}

export interface AiVaultHost {
  conversations: ConversationRepository;
  ledger: AiLedgerStore;
  /** The note open right now, if any. */
  activeNote(): Promise<Omit<ContextNote, "pinned"> | null>;
  readNote(path: string): Promise<Omit<ContextNote, "pinned"> | null>;
  /** Where the user is right now (plan §7): the open note, tabs, due tasks, appointments. */
  situation(): Promise<SituationInput>;
  /** Candidate lists of the vault's sources for a question (§8.1); the package gates and ranks them. */
  candidates(question: string, activePath: string | null): Promise<Candidate[][]>;
  policy: ContextPolicyHost;
  /** The tools of a run for this recipient, optionally narrowed (the MCP server's clients); null when this vault offers none. */
  tools(recipient: EgressRecipient, scope?: ToolScope): { names: readonly string[]; executor: ToolExecutor } | null;
  /** Gives a note its own rule "never to the cloud" (View context, "only on this device"). */
  keepOnDevice?(path: string): Promise<void>;
}

/** What the next message would carry, built like a send and sent nowhere (plan §13.3, "View context"). */
export interface ContextPreview {
  manifest: EgressManifest;
  pack: ContextPackage;
  /** Distinct notes the sources proposed for this question, before the gate. */
  candidates: number;
}

export interface ProviderTest {
  state: "testing" | "ok" | "failed";
  at?: string;
  models?: ModelInfo[];
  failure?: ModelFailure;
}

export interface LiveRun {
  conversationId: string;
  /** The text of the step that is streaming right now. */
  text: string;
  tools: { id: string; name: string; state: "running" | "done" | "failed" }[];
  steps: number;
}

export type AiDress = "window" | "tab" | "dock" | "sheet" | "screen";

export interface AiState {
  loaded: boolean;
  settings: AiAppSettings;
  /** Provider id → a key is stored. Only presence: the value never reaches this side. */
  keys: Record<string, boolean>;
  tests: Record<string, ProviderTest>;
  summaries: ConversationSummary[];
  active: ConversationRecord | null;
  /** Pins chosen before the first message of a new conversation. */
  draftPins: string[];
  /** A model chosen for a new conversation before its first message. */
  draftChoice: ModelChoice | null;
  /** The open note stays out of the next message. */
  excludeActive: boolean;
  /** Notes the user left out of the next message in "View context". */
  leaveOutNext: string[];
  live: LiveRun | null;
  /** The last run's end, when it ended in a way the reader must see. */
  notice: { conversationId: string; stop: RunStop } | null;
  dress: AiDress | null;
  /** A vault is attached (AI v1 runs only where a vault is open). */
  hasVault: boolean;
  /**
   * The send overview waiting for the user's answer (plan §13.3): shown before
   * the first request of the session and whenever the scope grows.
   */
  consent: { manifest: EgressManifest; growth: ScopeGrowth[] } | null;
}

type Listener = () => void;

/** How the send overview was answered: send, send nothing, or build it again without one note. */
type ConsentAnswer = "send" | "cancel" | { leaveOut: string };

const sortSummaries = (list: ConversationSummary[]) => [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export class AiSession {
  private state: AiState;
  private readonly listeners = new Set<Listener>();
  private vault: AiVaultHost | null = null;
  private abort: AbortController | null = null;
  /** Set synchronously on send: two quick presses never start two runs. */
  private sending = false;
  /** What the user approved in this app session (E25); a server on this computer needs none. */
  private scope: ApprovedScope | null = null;
  private consentAnswer: ((answer: ConsentAnswer) => void) | null = null;

  constructor(private readonly host: AiSessionHost) {
    this.state = {
      loaded: false,
      settings: host.defaults,
      keys: {},
      tests: {},
      summaries: [],
      active: null,
      draftPins: [],
      draftChoice: null,
      excludeActive: false,
      leaveOutNext: [],
      live: null,
      notice: null,
      dress: null,
      hasVault: false,
      consent: null,
    };
  }

  readonly getState = (): AiState => this.state;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(patch: Partial<AiState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  // --------------------------------------------------------------- settings

  async load(): Promise<void> {
    let raw: unknown;
    try {
      raw = await this.host.loadSettings();
    } catch {
      raw = undefined;
    }
    this.set({ settings: readAiAppSettings(raw, this.host.defaults), loaded: true });
    await this.refreshKeys();
  }

  async updateSettings(change: (current: AiAppSettings) => AiAppSettings): Promise<void> {
    const settings = change(this.state.settings);
    this.set({ settings });
    await this.host.saveSettings(settings);
  }

  providers(): ProviderInfo[] {
    return allProviders(this.state.settings.custom);
  }

  async refreshKeys(): Promise<void> {
    const keys: Record<string, boolean> = {};
    for (const provider of this.providers()) {
      if (!provider.endpoint.needsKey) continue;
      try {
        keys[provider.id] = await this.host.egress.hasKey(provider.id);
      } catch {
        keys[provider.id] = false;
      }
    }
    this.set({ keys });
  }

  async setKey(providerId: string, key: string): Promise<void> {
    await this.host.egress.setKey(providerId, key.trim());
    this.set({ keys: { ...this.state.keys, [providerId]: true } });
  }

  async deleteKey(providerId: string): Promise<void> {
    await this.host.egress.deleteKey(providerId);
    const tests = { ...this.state.tests };
    delete tests[providerId];
    this.set({ keys: { ...this.state.keys, [providerId]: false }, tests });
  }

  /** Puts a built-in provider on the list of the settings. */
  async addProvider(id: string): Promise<void> {
    await this.updateSettings((s) => (s.providers.includes(id) ? s : { ...s, providers: [...s.providers, id] }));
  }

  /** Takes a provider off the list: its key leaves the device, its profiles empty. */
  async removeProvider(id: string): Promise<void> {
    const provider = providerById(id, this.state.settings.custom);
    if (provider?.custom) {
      await this.removeCustom(id);
      return;
    }
    if (provider?.endpoint.needsKey) await this.deleteKey(id).catch(() => undefined);
    await this.updateSettings((s) => ({
      ...s,
      providers: s.providers.filter((p) => p !== id),
      profiles: Object.fromEntries(Object.entries(s.profiles).filter(([, choice]) => choice?.providerId !== id)),
    }));
  }

  /** Token and cost totals of one month (`YYYY-MM`) in this vault's run ledger. */
  async usage(month: string): Promise<ReturnType<typeof aiMonthlyTotals>> {
    const vault = this.vault;
    if (!vault) return [];
    return aiMonthlyTotals(await vault.ledger.load().catch(() => []), month);
  }

  /** Adds an OpenAI-compatible server after the shell's native confirmation. */
  async addCustom(label: string, baseUrl: string, id: string, local: boolean): Promise<boolean> {
    const added = await this.host.egress.addEndpoint(id, baseUrl);
    if (!added) return false;
    await this.updateSettings((s) => ({ ...s, custom: [...s.custom.filter((c) => c.id !== id), { id, label, baseUrl, api: "openai-chat", local }] }));
    return true;
  }

  async removeCustom(id: string): Promise<void> {
    await this.host.egress.removeEndpoint(id);
    await this.updateSettings((s) => ({
      ...s,
      custom: s.custom.filter((c) => c.id !== id),
      profiles: Object.fromEntries(Object.entries(s.profiles).filter(([, choice]) => choice?.providerId !== id)),
    }));
  }

  /** The connection test: the provider's own model list, through the native egress. */
  async testProvider(providerId: string): Promise<ProviderTest> {
    const provider = providerById(providerId, this.state.settings.custom);
    const at = this.host.now().toISOString();
    if (!provider) return { state: "failed", at, failure: { kind: "unknown_endpoint", message: providerId } };
    this.set({ tests: { ...this.state.tests, [providerId]: { ...this.state.tests[providerId], state: "testing" } } });
    let test: ProviderTest;
    try {
      const answer = await fetchProviderJson(this.host.egress, modelListSpec(provider.endpoint), `test-${this.host.newId()}`);
      test = answer.ok
        ? { state: "ok", at, models: parseModelList(provider.endpoint, answer.json) }
        : { state: "failed", at, failure: answer.failure };
    } catch (error) {
      test = { state: "failed", at, failure: { kind: "offline", message: error instanceof Error ? error.message : String(error) } };
    }
    this.set({ tests: { ...this.state.tests, [providerId]: test } });
    return test;
  }

  /** Where a conversation is shown; the conversation itself stays the same. */
  present(dress: AiDress | null): void {
    this.set({ dress });
  }

  // ------------------------------------------------------------------ vault

  async attachVault(vault: AiVaultHost | null): Promise<void> {
    this.stop();
    this.answerConsent(false);
    this.vault = vault;
    this.set({ summaries: [], active: null, live: null, excludeActive: false, draftPins: [], draftChoice: null, notice: null, hasVault: Boolean(vault) });
    if (!vault) return;
    const summaries: ConversationSummary[] = await vault.conversations.list().catch(() => []);
    const old = expiredConversations(summaries, this.state.settings.historyDays, this.host.now());
    for (const id of old) await vault.conversations.remove(id).catch(() => undefined);
    if (this.vault !== vault) return;
    this.set({ summaries: sortSummaries(summaries.filter((s) => !old.includes(s.id))) });
  }

  async open(id: string): Promise<void> {
    const vault = this.vault;
    if (!vault || this.state.live) return;
    const record = await vault.conversations.load(id);
    if (record && this.vault === vault) this.set({ active: record, excludeActive: false, notice: null });
  }

  newConversation(): void {
    if (this.state.live) return;
    this.set({ active: null, excludeActive: false, draftPins: [], draftChoice: null, notice: null });
  }

  async remove(id: string): Promise<void> {
    const vault = this.vault;
    if (!vault) return;
    if (this.state.live?.conversationId === id) this.stop();
    await vault.conversations.remove(id);
    this.set({
      summaries: this.state.summaries.filter((s) => s.id !== id),
      active: this.state.active?.id === id ? null : this.state.active,
    });
  }

  async removeAll(): Promise<void> {
    const vault = this.vault;
    if (!vault) return;
    this.stop();
    await vault.conversations.removeAll();
    this.set({ summaries: [], active: null, notice: null });
  }

  async rename(id: string, title: string): Promise<void> {
    const vault = this.vault;
    const clean = title.trim();
    if (!vault || !clean) return;
    const record = this.state.active?.id === id ? this.state.active : await vault.conversations.load(id);
    if (!record) return;
    const next = { ...record, title: clean };
    await vault.conversations.save(next);
    this.set({
      active: this.state.active?.id === id ? next : this.state.active,
      summaries: this.state.summaries.map((s) => (s.id === id ? { ...s, title: clean } : s)),
    });
  }

  /** Ids of the conversations whose title or text contains the query (history search, §16). */
  async search(query: string): Promise<string[]> {
    const vault = this.vault;
    const q = query.trim();
    if (!vault || !q) return this.state.summaries.map((s) => s.id);
    const hits: string[] = [];
    for (const summary of this.state.summaries) {
      if (summary.title.toLowerCase().includes(q.toLowerCase())) {
        hits.push(summary.id);
        continue;
      }
      const record = await vault.conversations.load(summary.id).catch(() => null);
      if (record && conversationMatches(record, q)) hits.push(summary.id);
    }
    return hits;
  }

  setExcludeActive(exclude: boolean): void {
    this.set({ excludeActive: exclude });
  }

  /** Leaves a note out of the next message, or takes it back in ("View context"). */
  toggleLeaveOut(path: string): void {
    const list = this.state.leaveOutNext;
    this.set({ leaveOutNext: list.includes(path) ? list.filter((p) => p !== path) : [...list, path] });
  }

  /** Keeps a note on this device for good: its own rule, written into the note by the user's hand. */
  async keepOnDevice(path: string): Promise<boolean> {
    const vault = this.vault;
    if (!vault?.keepOnDevice) return false;
    try {
      await vault.keepOnDevice(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The context the next message would carry (plan §13.3, "View context"):
   * the same situation, candidates, gate and package a send builds — for the
   * model chosen now — and nothing leaves the device.
   */
  async previewContext(question: string): Promise<ContextPreview | null> {
    const vault = this.vault;
    const choice = this.choice();
    if (!vault || !choice || !this.state.settings.enabled) return null;
    const provider = providerById(choice.providerId, this.state.settings.custom);
    if (!provider) return null;
    const record = this.state.active;
    const context = await this.contextOf(question, vault, choice, provider, record ? record.pins : this.state.draftPins, record ? record.conversation.turns : []);
    const built = await context.build(new Set(this.state.leaveOutNext));
    if (this.vault !== vault) return null;
    const proposed = new Set(context.candidates.flat().map((c) => c.path));
    return { ...built, candidates: proposed.size };
  }

  /**
   * One message's context, the one way the send, the overview and the lens
   * build it (plan §7–§9): the situation and the notes that may matter,
   * through the hard gate before anything is ranked; `build` puts it
   * together without the notes left out.
   */
  private async contextOf(
    message: string,
    vault: AiVaultHost,
    choice: ModelChoice,
    provider: ProviderInfo,
    pins: readonly string[],
    turns: ConversationRecord["conversation"]["turns"],
  ) {
    const recipient: EgressRecipient =
      provider.kind === "local" ? { kind: "local", provider: provider.id, model: choice.model } : { kind: "cloud", provider: provider.id, model: choice.model };
    const tools = vault.tools(recipient);
    const situation = await vault.situation().catch(() => this.bareSituation());
    const seen = this.state.excludeActive ? { ...situation, active: null } : situation;
    const candidates = await vault.candidates(message, seen.active?.kind === "note" ? seen.active.path : null).catch(() => [] as Candidate[][]);
    const build = async (leaveOut: ReadonlySet<string>): Promise<{ pack: ContextPackage; manifest: EgressManifest }> => {
      const pack = await buildContextPackage(
        { question: message, recipient, situation: seen, candidates, pins: pins.filter((p) => !leaveOut.has(p)), alreadySent: sentStamps(turns), leaveOut },
        { policyOf: vault.policy.policyOf, resolveLink: vault.policy.resolveLink, readNote: (path) => vault.readNote(path) },
      );
      const manifest = manifestOf(pack, { id: provider.id, label: provider.label, local: provider.kind === "local" }, choice.model, {
        tools: tools?.names ?? [],
        questionChars: message.length,
        ...(this.priceOf(choice) ? { priceUsdPerMillionInput: this.priceOf(choice)!.input } : {}),
      });
      return { pack, manifest };
    };
    return { seen, candidates, build };
  }

  async pin(path: string): Promise<void> {
    const active = this.state.active;
    if (!active) {
      this.set({ draftPins: [...new Set([...this.state.draftPins, path])] });
      return;
    }
    await this.saveActive({ ...active, pins: [...new Set([...active.pins, path])] });
  }

  async unpin(path: string): Promise<void> {
    const active = this.state.active;
    if (!active) {
      this.set({ draftPins: this.state.draftPins.filter((p) => p !== path) });
      return;
    }
    await this.saveActive({ ...active, pins: active.pins.filter((p) => p !== path) });
  }

  private async saveActive(record: ConversationRecord): Promise<void> {
    this.set({ active: record });
    await this.vault?.conversations.save(record);
  }

  // -------------------------------------------------------------------- run

  /** The provider and model the next message goes to. */
  choice(): ModelChoice | null {
    const active = this.state.active;
    return active ? { providerId: active.providerId, model: active.model } : (this.state.draftChoice ?? initialModelChoice(this.state.settings));
  }

  /** Switches the model of the open conversation, or of the next new one. */
  async setChoice(choice: ModelChoice): Promise<void> {
    const active = this.state.active;
    if (active) await this.saveActive({ ...active, providerId: choice.providerId, model: choice.model });
    else this.set({ draftChoice: choice });
  }

  stop(): void {
    this.abort?.abort();
    this.answerConsent(false);
  }

  /** The user's answer to the send overview: send within the shown scope, or send nothing. */
  answerConsent(approved: boolean): void {
    this.settleConsent(approved ? "send" : "cancel");
  }

  /** Leaves one note out of the waiting request; the overview is built again without it. */
  leaveOutOfConsent(path: string): void {
    this.settleConsent({ leaveOut: path });
  }

  private settleConsent(answer: ConsentAnswer): void {
    const settle = this.consentAnswer;
    this.consentAnswer = null;
    if (this.state.consent) this.set({ consent: null });
    settle?.(answer);
  }

  private askConsent(manifest: EgressManifest, growth: ScopeGrowth[]): Promise<ConsentAnswer> {
    this.settleConsent("cancel");
    return new Promise((resolve) => {
      this.consentAnswer = resolve;
      this.set({ consent: { manifest, growth } });
    });
  }

  /** The situation when the shell cannot tell one: the time and the app's today. */
  private bareSituation(): SituationInput {
    const now = this.host.now();
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      now: `${this.host.today()} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
      weekday: now.toLocaleDateString("en-US", { weekday: "long" }),
      calendarDay: this.host.today(),
      journalDay: this.host.today(),
      active: null,
      tabs: [],
      tasks: [],
      events: [],
      dailyNote: null,
    };
  }

  dismissNotice(): void {
    this.set({ notice: null });
  }

  /** Sends a message; resolves with how the run ended, or null when nothing was sent. */
  async send(text: string): Promise<RunStop | null> {
    const message = text.trim();
    const vault = this.vault;
    const choice = this.choice();
    if (!message || !vault || !choice || this.state.live || this.sending || !this.state.settings.enabled) return null;
    this.sending = true;
    try {
      return await this.runMessage(message, vault, choice);
    } catch (error) {
      // Whatever broke on the way (a vault read, the store) ends the run as a
      // failure the reader sees — never as a spinner that turns forever.
      this.abort = null;
      const stop: RunStop = { kind: "failed", failure: { kind: "offline", message: error instanceof Error ? error.message : String(error) } };
      this.set({ live: null, notice: { conversationId: this.state.active?.id ?? "", stop } });
      return stop;
    } finally {
      this.sending = false;
    }
  }

  private async runMessage(message: string, vault: AiVaultHost, choice: ModelChoice): Promise<RunStop | null> {
    const provider = providerById(choice.providerId, this.state.settings.custom);
    if (!provider) {
      const stop: RunStop = { kind: "failed", failure: { kind: "unknown_endpoint", message: choice.providerId } };
      this.set({ notice: { conversationId: this.state.active?.id ?? "", stop } });
      return stop;
    }
    const recipient: EgressRecipient =
      provider.kind === "local" ? { kind: "local", provider: provider.id, model: choice.model } : { kind: "cloud", provider: provider.id, model: choice.model };
    const tools = vault.tools(recipient);
    const now = this.host.now().toISOString();

    let record: ConversationRecord = this.state.active ?? (() => {
      const id = this.host.newId();
      return {
        version: 1 as const,
        id,
        title: conversationTitleFrom(message, message),
        createdAt: now,
        updatedAt: now,
        providerId: choice.providerId,
        model: choice.model,
        conversation: startConversation(id, assistantSystemPrompt({ language: this.host.language(), today: this.host.today(), tools: tools?.names ?? [] }), tools?.names ?? []),
        usage: EMPTY_USAGE,
        runs: [],
        pins: this.state.draftPins,
      };
    })();

    // The context of this message: what "View context" showed, without the notes left out there.
    const { seen, build } = await this.contextOf(message, vault, choice, provider, record.pins, record.conversation.turns);
    const leaveOut = new Set<string>(this.state.leaveOutNext);
    let { pack, manifest } = await build(leaveOut);
    // The send overview as the scope approval (E25): on the first request, when the scope grows, or always for the strict.
    // Once the user reviews the overview, it stays until they send or cancel:
    // leaving a note out never sends on its own.
    let reviewing = false;
    for (;;) {
      const growth = scopeGrowth(manifest, this.scope);
      if (!reviewing && growth.length === 0 && !(this.state.settings.confirmEveryRequest && !manifest.local)) break;
      const answer = await this.askConsent(manifest, growth);
      if (this.vault !== vault || answer === "cancel") return null;
      if (answer === "send") break;
      reviewing = true;
      leaveOut.add(answer.leaveOut);
      ({ pack, manifest } = await build(leaveOut));
    }
    if (!manifest.local) this.scope = widenScope(this.scope, manifest);
    const parts = [pack.part, { type: "text" as const, text: message }];
    const userTurn = record.conversation.turns.length;
    record = { ...record, conversation: appendTurn(record.conversation, { role: "user", parts, at: now }), updatedAt: now };

    const controller = new AbortController();
    this.abort = controller;
    const toolLog: LedgerEntry["tools"] = [];
    this.set({ active: record, draftPins: [], draftChoice: null, excludeActive: false, leaveOutNext: [], notice: null, live: { conversationId: record.id, text: "", tools: [], steps: 0 } });

    // Rule of Two (§13.4): vault text is private and untrusted at once.
    const carriesVault = pack.refs.length > 0 || pack.dataClasses.length > 1 || Boolean(seen.active);
    const result = await runAgent({
      conversation: record.conversation,
      egress: this.host.egress,
      endpoint: provider.endpoint,
      model: choice.model,
      executor: tools?.executor ?? { execute: async () => ({ content: "This conversation has no tools.", isError: true }) },
      context: { privateContext: carriesVault, untrustedContext: carriesVault },
      signal: controller.signal,
      cache: true,
      newRequestId: () => `ai-${this.host.newId()}`,
      now: () => this.host.now().toISOString(),
      onEvent: (event) => {
        const live = this.state.live;
        if (!live || live.conversationId !== record.id) return;
        if (event.type === "model" && event.event.type === "text") {
          this.set({ live: { ...live, text: live.text + event.event.text } });
        } else if (event.type === "tool_start") {
          this.set({ live: { ...live, tools: [...live.tools, { id: event.call.id, name: event.call.name, state: "running" }] } });
        } else if (event.type === "tool_done") {
          toolLog.push({ name: event.call.name, ok: !event.outcome.isError, ms: event.ms });
          this.set({ live: { ...live, tools: live.tools.map((t) => (t.id === event.call.id ? { ...t, state: event.outcome.isError ? "failed" : "done" } : t)) } });
        } else if (event.type === "turn") {
          record = { ...record, conversation: event.conversation };
          this.set({ active: this.state.active?.id === record.id ? record : this.state.active, live: { ...live, text: "", steps: live.steps + 1 } });
        }
      },
    });
    if (this.abort === controller) this.abort = null;

    const usage = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, cacheReadTokens: result.usage.cacheReadTokens, cacheWriteTokens: result.usage.cacheWriteTokens };
    const costUsd = usageCostUsd(usage, this.priceOf(choice));
    const run: RunMeta = {
      userTurn,
      providerId: choice.providerId,
      model: choice.model,
      sent: pack.refs.map((r) => r.path),
      kept: pack.excluded.map((e) => e.path),
      usage,
      steps: result.usage.steps,
      stop: result.stop.kind,
      ...(result.stop.kind === "failed" ? { failure: result.stop.failure.kind } : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
      manifest,
    };
    record = {
      ...record,
      conversation: result.conversation,
      usage: addUsage(record.usage, usage),
      updatedAt: this.host.now().toISOString(),
      runs: [...record.runs, run],
    };
    try {
      await vault.conversations.save(record);
      const ledger = await vault.ledger.load();
      await vault.ledger.save(
        appendAiLedgerEntry(ledger, {
          at: record.updatedAt,
          conversationId: record.id,
          providerId: choice.providerId,
          model: choice.model,
          stop: result.stop.kind,
          steps: result.usage.steps,
          tools: toolLog,
          usage,
          ...(costUsd !== undefined ? { costUsd } : {}),
          ...(result.stop.kind === "failed" ? { failure: result.stop.failure.kind } : {}),
        }),
      );
    } catch {
      // The answer stays on screen even when app data cannot be written.
    }
    if (this.vault !== vault) return result.stop;
    const shown = this.state.active?.id === record.id || !this.state.active;
    this.set({
      active: shown ? record : this.state.active,
      live: null,
      notice: result.stop.kind === "answered" ? null : { conversationId: record.id, stop: result.stop },
      summaries: sortSummaries([conversationSummaryOf(record), ...this.state.summaries.filter((s) => s.id !== record.id)]),
    });
    return result.stop;
  }

  private priceOf(choice: ModelChoice): { input: number; output: number } | undefined {
    return this.state.settings.prices[`${choice.providerId}/${choice.model}`] ?? this.state.tests[choice.providerId]?.models?.find((m) => m.id === choice.model)?.price;
  }
}
