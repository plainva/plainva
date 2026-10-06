import type { ToolScope } from "./vaultTools";
import { APP_SKILL_SOURCES, appSkillOf, appSkillScenarios } from "./appSkills";
import type { InstructionApprovalStore, SkillTestStore } from "./aiStores";
import { createSkillExecutor, newSkillRunState, skillScope, type SkillRunState } from "./skillRuntime";
import {
  PASSAGE_ONLY,
  passageOf,
  relocate,
  SELECTION_MAX_CHARS,
  selectionChunks,
  selectionInstruction,
  type AiSuggestAction,
  type SuggestionAuthor,
} from "./aiSelectionActions";
import { defuseNewAddresses } from "./aiWriteLint";
import type { SuggestionChunk } from "../components/suggestMode";
import {
  addUsage,
  approveInstruction,
  blockingProblems,
  DEFAULT_RUN_LIMITS,
  instructionFileHash,
  parseSkillFile,
  pruneInstructionApprovals,
  sameFiles,
  serializeSkillFile,
  SKILLS_FOLDER,
  utf8Encode,
  EMPTY_INSTRUCTION_APPROVALS,
  EMPTY_SKILL_TESTS,
  pruneSkillTests,
  readSkillScenarios,
  recordSkillTest,
  resolveInstructions,
  revokeInstruction,
  scenarioGaps,
  scenarioNotApplicable,
  scenarioNotRun,
  scenarioResult,
  SKILL_SCENARIOS_FILE,
  SKILL_TEST_MAX_TOKENS,
  SKILL_TEST_RUN_LIMITS,
  skillCatalog,
  skillGrant,
  skillTestBudgetLeft,
  skillTestVersion,
  switchInstruction,
  aiMonthlyTotals,
  allProviders,
  appendAiLedgerEntry,
  appendTurn,
  assistantSystemPrompt,
  buildContextPackage,
  contextBudgetFor,
  PLATFORM_CONTEXT_DEFAULT,
  conversationMatches,
  conversationSummaryOf,
  conversationTitleFrom,
  EMPTY_USAGE,
  estimateTokens,
  fenceUntrusted,
  gateDecision,
  isCloudRecipient,
  payload,
  sensitiveFindings,
  sensitiveKinds,
  withholdDeniedLinks,
  withholdPlaces,
  TRANSCRIPTION_MAX_BYTES,
  transcriptBlock,
  transcriptionRequest,
  transcriptionRoute,
  transcriptionUsage,
  transcriptOf,
  expiredConversations,
  fetchProviderJson,
  initialModelChoice,
  manifestOf,
  modelListSpec,
  parseModelList,
  providerById,
  recipientOf,
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
  type ConversationInstructions,
  type ConversationRecord,
  type ApprovalHow,
  type InstructionApproval,
  type InstructionApprovals,
  type InstructionEntry,
  type SkillImport,
  type SkillProblem,
  type SkillRunTrace,
  type SkillScenario,
  type SkillScenarioResult,
  type SkillTestRecord,
  type InstructionSource,
  type ManifestInstructions,
  type RunLimits,
  type SystemPromptInput,
  type ConversationUsage,
  type ConversationRepository,
  type ConversationSummary,
  type EgressManifest,
  type EgressRecipient,
  type LedgerEntry,
  type ModelChoice,
  type ModelFailure,
  type ModelInfo,
  type PackageGists,
  type Part,
  type TextPart,
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
  /** A text of the app in its language (conversation titles and round notes of the selection actions). */
  label?(key: string, vars?: Record<string, string>): string;
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
  /** The recipient decides whether a cloud embedding model may see the question (plan P2b). */
  candidates(question: string, activePath: string | null, recipient?: EgressRecipient): Promise<Candidate[][]>;
  /** Note sizes as the index knows them (plan P2b-5); absent, the lens leaves the naive comparison out. */
  noteSizes?(paths: readonly string[]): Promise<Map<string, number>>;
  policy: ContextPolicyHost;
  /** The tools of a run for this recipient, optionally narrowed (the MCP server's clients); null when this vault offers none. */
  tools(recipient: EgressRecipient, scope?: ToolScope, redact?: ReadonlySet<string>): { names: readonly string[]; executor: ToolExecutor } | null;
  /** Gives a note its own rule "never to the cloud" (View context, "only on this device"). */
  keepOnDevice?(path: string): Promise<void>;
  /** Checked gists of the model on this computer (plan P2b-3), read when a message is built; null while there are none. */
  gists?(): PackageGists | null;
  /** Writes a suggestion round into a note's comments (plan P1.5); nothing enters the note until someone accepts. */
  propose?(round: { path: string; base: string; chunks: readonly SuggestionChunk[]; note: string; author: SuggestionAuthor }): Promise<void>;
  /** True inside an encrypted workspace: its sealed comments cannot carry an author yet (E32). */
  encrypted?(): boolean;
  /**
   * Posts a reply into a comment thread of a note under the assistant's name
   * (plan P3-6) — a remark like any other: journaled, synced, deletable.
   * Absent where the shell has no comments to write.
   */
  reply?(reply: { path: string; parentCommentId: string; body: string; author: SuggestionAuthor }): Promise<void>;
  /** What the regression runs of the skills found on this device (plan P3-8); absent, results are not kept. */
  skillTests?: SkillTestStore;
  /**
   * The vault's own instructions — skills in `.agent/skills/` and a root
   * `AGENTS.md` — and their approvals on this device (plan KI-Harness P3);
   * absent where the shell cannot read them.
   */
  instructions?: AiInstructionsHost;
}

export interface AiInstructionsHost {
  scan(): Promise<InstructionSource[]>;
  /** One source as it is now; null when it is gone. */
  scanOne(id: string): Promise<InstructionSource | null>;
  /** A file of a source as the scan saw it (its hash checked again), as text; null otherwise. */
  readFile(source: InstructionSource, rel: string): Promise<string | null>;
  approvals: InstructionApprovalStore;
  /** Writes one file into the vault, its folder created — synced and backed up like any edit (the workshop's skills, plan P3-5). */
  write?(path: string, bytes: Uint8Array): Promise<void>;
  /** Removes a folder of the vault after the user confirmed it: through the adapters, so it is backed up and goes to the trash. */
  remove?(path: string): Promise<void>;
}

/** How writing a skill from the workshop ended. */
export type SkillWriteOutcome =
  | { ok: true; id: string; path: string }
  | { ok: false; reason: "no-vault" | "invalid" | "exists" | "write-failed" | "changed"; problems?: SkillProblem[] };

/** Skills and vault instructions as the workshop and the entry points show them (plan KI-Harness P3). */
export interface AiSkillsState {
  /** Every source with its state on this device: the app's skills first, then the vault's. */
  entries: InstructionEntry[];
  /** Active skills the catalog had no room for — still startable by hand. */
  omitted: string[];
}

/** A skill as the regression run sees it (plan KI-Harness P3-8). */
export interface SkillTestTarget {
  id: string;
  /** The skill's files and scenarios as they are now: what a result is bound to. */
  version: string;
  /** Scenarios that apply in this vault. */
  scenarios: number;
  /** Scenarios written for another vault: they name notes this one does not have. */
  notApplicable: number;
  /** What did not read in the scenario file. */
  problems: string[];
}

/** What a regression run would do, before it does it. */
export interface SkillTestPlan {
  choice: ModelChoice;
  providerLabel: string;
  /** A model on this device: nothing leaves it, and nothing is billed. */
  local: boolean;
  /** The model's price is known, so the ceiling can be an amount. */
  priced: boolean;
  targets: SkillTestTarget[];
  /** Scenarios that would run. */
  total: number;
}

export interface SkillTestProgress {
  skill: string;
  scenario: string;
  /** Scenarios finished so far, and how many the run has. */
  done: number;
  total: number;
}

export interface AiSkillTestsState {
  /** The newest result per skill on this device. */
  records: SkillTestRecord[];
  /** The scenario running right now; null while no regression run is under way. */
  running: SkillTestProgress | null;
}

export type SkillTestOutcome =
  | {
      kind: "done";
      ran: number;
      passed: number;
      failed: number;
      /** Why the run ended before its last scenario: the ceiling, the user, or a request that failed (`failure`). */
      stopped: null | "ceiling" | "cancelled" | "failed";
      failure?: ModelFailure;
    }
  | { kind: "refused"; reason: "off" | "no-model" | "busy" | "nothing" };

/** An action at a selection (plan P1.5): the passage, where it stands, and what to do with it. */
export interface SelectionRequest {
  action: AiSuggestAction;
  range: { path: string; from: number; to: number; text: string; doc: string };
  /** For "translate": the target language's English name. */
  language?: string;
}

export type SelectionOutcome =
  | { kind: "proposed"; conversationId: string; changes: number }
  | { kind: "unchanged"; conversationId: string }
  | {
      kind: "refused";
      reason: "off" | "no-model" | "busy" | "empty" | "too-long" | "denied" | "withheld" | "encrypted" | "cancelled" | "changed" | "failed";
      message?: string;
    };

/** A voice note to transcribe (plan P1.5, E28): the note it stands in, its target as written there, the file. */
export interface TranscriptionRequest {
  notePath: string;
  /** The embed's target as the note has it: the transcript goes under the line that holds it. */
  target: string;
  audio: { path: string; name: string; mime: string; bytes: Uint8Array };
}

export type TranscriptionOutcome =
  | { kind: "proposed"; model: string }
  | {
      kind: "refused";
      reason: "off" | "no-model" | "no-route" | "too-large" | "busy" | "missing" | "denied" | "encrypted" | "cancelled" | "changed" | "empty" | "failed";
      provider?: string;
      model?: string;
      size?: number;
      failure?: ModelFailure;
      message?: string;
    };

/**
 * A remark that addresses the assistant in a comment thread (plan P3-6): the
 * note, the thread so far, and what was asked.
 */
export interface ThreadReplyRequest {
  /** The note the thread belongs to. */
  path: string;
  /** The thread's first remark: the reply hangs under it, like every reply. */
  rootCommentId: string;
  /** The passage the thread is attached to, if it has one. */
  quote: string | null;
  /** The remarks before the question, oldest first — other people's words, so data. */
  thread: readonly { author: string; body: string; at: string }[];
  /** The user's remark without the mention; empty when it was the mention alone. */
  question: string;
}

export type ThreadReplyOutcome =
  | { kind: "replied"; conversationId: string; model: string }
  | {
      kind: "refused";
      /** `empty`: the remark asked nothing — the mention alone, on the note as a whole. `no-answer`: the model wrote nothing. */
      reason: "off" | "no-model" | "busy" | "encrypted" | "denied" | "cancelled" | "empty" | "no-answer" | "failed" | "post-failed";
      /** Set once a conversation exists: the answer, if there was one, is in the history. */
      conversationId?: string;
      message?: string;
    };

/** One request to the model of the profile "Local" on this device (plans P2b-3, P2c): no conversation, no tools, no transcript. */
export interface LocalCompletion {
  providerId: string;
  model: string;
  complete(instruction: string, text: string, signal?: AbortSignal): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }>;
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
  /** Sources the next message sends as the original instead of their gist ("View context", P2b-3). */
  originalsNext: string[];
  /** Sources a new conversation sends redacted, chosen before its first message (P2b-6); afterwards the conversation keeps them. */
  draftRedact: string[];
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
  skills: AiSkillsState;
  skillTests: AiSkillTestsState;
}

type Listener = () => void;

/** What the send overview shows of a conversation's instructions (plan KI-Harness P3). */
function manifestInstructionsOf(instructions: ConversationInstructions | undefined): ManifestInstructions | undefined {
  if (!instructions) return undefined;
  const out: ManifestInstructions = {};
  const skill = instructions.skill;
  if (skill) out.skill = { id: skill.id, name: skill.name, origin: skill.origin, tokens: instructions.skillTokens ?? 0, ...(skill.localPreferred ? { localPreferred: true } : {}) };
  if (instructions.catalog?.length) {
    out.catalog = { count: instructions.catalog.length, vault: instructions.catalog.filter((e) => e.origin === "vault").map((e) => e.id), tokens: instructions.catalogTokens ?? 0 };
  }
  if (instructions.vaultTokens) out.vault = { tokens: instructions.vaultTokens };
  return Object.keys(out).length ? out : undefined;
}

/** What a new conversation starts with: its tools, the blocks of its system prompt, and the record of both. */
interface ConversationStart {
  tools: string[];
  prompt: Pick<SystemPromptInput, "skill" | "skillCatalog" | "vaultInstructions">;
  instructions: ConversationInstructions | null;
}

/**
 * A message that starts a conversation of its own from a place outside the
 * composer (a door, plan §19.1 D) and runs like any message: the context of
 * the question, the gate, the send overview, the tools.
 */
interface DoorStart {
  title: string;
  /** Notes that go along whatever is open. */
  pins: string[];
  /** What the door brings, before the user's words — fenced where it is not the user's own. */
  lead: TextPart[];
  /** Names in the send overview what `lead` carries. */
  disclose(manifest: EgressManifest): EgressManifest;
  limits?: RunLimits;
}

/**
 * A run started apart from the composer without being a door — a scenario of
 * the skills' regression run (plan P3-8): a conversation of its own under a
 * title of its own, bound to its skill like a run by hand.
 */
interface DetachedStart {
  title: string;
  limits?: RunLimits;
}

/** How a run ended; with the conversation it left and the answer's text once a request went out. */
interface RunOutcome {
  stop: RunStop;
  record?: ConversationRecord;
  answer?: string;
}

/**
 * A reply in a comment thread is a few sentences after, at most, a few looks
 * into the vault. The output budget is the run's, tool calls included, and a
 * reasoning model spends part of it on thinking.
 */
const THREAD_REPLY_LIMITS: RunLimits = { maxSteps: 6, maxToolCalls: 8, maxOutputTokens: 4_000 };

const THREAD_REPLY_RULES =
  "Your answer is posted as a reply in this comment thread, under your name, for everyone who reads the note's comments. " +
  "Answer what is asked in a few sentences of running text, in the language of the question. " +
  "Name a note you rely on as a wiki link ([[Note title]]). No headings, no lists, no preamble, no sign-off.";

const APP_ENTRIES = (): InstructionEntry[] => resolveInstructions(APP_SKILL_SOURCES, EMPTY_INSTRUCTION_APPROVALS);

/** The text of the conversation's last answer. */
function lastAnswerText(conversation: ConversationRecord["conversation"]): string {
  for (let i = conversation.turns.length - 1; i >= 0; i--) {
    const turn = conversation.turns[i]!;
    if (turn.role !== "assistant") continue;
    return turn.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
  }
  return "";
}

/** What a run did since `fromTurn`, for the regression run's verdict: the tools it called and its answer. */
function runTrace(record: ConversationRecord, fromTurn: number, stop: RunStop, answer: string): SkillRunTrace {
  const calls: SkillRunTrace["calls"] = [];
  for (const turn of record.conversation.turns.slice(fromTurn)) {
    for (const part of turn.parts) if (part.type === "tool_result") calls.push({ name: part.name, ok: !part.isError });
  }
  return { stop: stop.kind, calls, answer };
}

/** How the send overview was answered: send, send nothing, or build it again without one note or with one redacted (or no longer). */
type ConsentAnswer = "send" | "cancel" | { leaveOut: string } | { redact: string };

const sortSummaries = (list: ConversationSummary[]) => [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export class AiSession {
  private state: AiState;
  private readonly listeners = new Set<Listener>();
  private vault: AiVaultHost | null = null;
  private abort: AbortController | null = null;
  /** Set synchronously on send: two quick presses never start two runs. */
  private sending = false;
  /** Recordings being transcribed now: one run per file. */
  private transcribing = new Set<string>();
  /** What the user approved in this app session (E25); a server on this computer needs none. */
  private scope: ApprovedScope | null = null;
  private consentAnswer: ((answer: ConsentAnswer) => void) | null = null;
  /** Conversations on screen right now: the places where the send overview can be answered. */
  private surfaces = 0;
  /** How the shell puts a conversation on screen (the companion, the AI sheet). */
  private reveal: (() => void) | null = null;

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
      originalsNext: [],
      draftRedact: [],
      live: null,
      notice: null,
      dress: null,
      hasVault: false,
      consent: null,
      skills: { entries: APP_ENTRIES(), omitted: [] },
      skillTests: { records: [], running: null },
    };
  }

  readonly getState = (): AiState => this.state;

  /** The native egress, for search by meaning's own provider (plan P2a-5): the keys stay native. */
  get egress(): AiEgress {
    return this.host.egress;
  }

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

  /**
   * A conversation is on screen until the returned function is called — its
   * component's mount and unmount. The send overview is answered inside one.
   */
  mountSurface(): () => void {
    this.surfaces += 1;
    let mounted = true;
    return () => {
      if (!mounted) return;
      mounted = false;
      this.surfaces -= 1;
    };
  }

  /**
   * The shell's way to put a conversation on screen. A door outside the
   * conversation — "Transcribe" at a voice note, "@AI" in a comment thread —
   * may need the send overview while none is shown; without this, the
   * question would wait where nobody can see it.
   */
  setReveal(reveal: (() => void) | null): void {
    this.reveal = reveal;
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

  /**
   * The window of the chosen model where it is known (plan P2c): what the
   * provider's model list reported, else what a platform model has.
   */
  private windowOf(provider: ProviderInfo, model: string): number | undefined {
    return this.state.tests[provider.id]?.models?.find((m) => m.id === model)?.contextTokens ?? provider.contextTokens;
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
    this.set({
      summaries: [],
      active: null,
      live: null,
      excludeActive: false,
      draftPins: [],
      draftRedact: [],
      draftChoice: null,
      notice: null,
      hasVault: Boolean(vault),
      skills: { entries: APP_ENTRIES(), omitted: [] },
      skillTests: { records: [], running: null },
    });
    if (!vault) return;
    void this.refreshSkills();
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
    this.set({ active: null, excludeActive: false, draftPins: [], draftRedact: [], draftChoice: null, notice: null });
  }

  // ----------------------------------------------------------------- skills

  /** Every source of instructions as it is now, with its state on this device (plan KI-Harness P3). */
  private async instructionEntries(vault: AiVaultHost): Promise<{ entries: InstructionEntry[]; approvals: InstructionApprovals }> {
    const host = vault.instructions;
    if (!host) return { entries: APP_ENTRIES(), approvals: EMPTY_INSTRUCTION_APPROVALS };
    const [approvals, sources] = await Promise.all([host.approvals.load().catch(() => EMPTY_INSTRUCTION_APPROVALS), host.scan().catch(() => [] as InstructionSource[])]);
    return { entries: resolveInstructions([...APP_SKILL_SOURCES, ...sources], approvals), approvals };
  }

  /** Reads the instructions again: the workshop and the entry points show what is there now. */
  async refreshSkills(): Promise<InstructionEntry[]> {
    const vault = this.vault;
    if (!vault) return this.state.skills.entries;
    const { entries } = await this.instructionEntries(vault);
    // What the regression runs found goes with the list: the workshop shows both.
    const tests = vault.skillTests ? await vault.skillTests.load().catch(() => EMPTY_SKILL_TESTS) : EMPTY_SKILL_TESTS;
    if (this.vault === vault) this.set({ skills: { entries, omitted: skillCatalog(entries).omitted }, skillTests: { ...this.state.skillTests, records: tests.records } });
    return entries;
  }

  /**
   * Approves a source exactly as the user saw it — `seen` maps every file the
   * dialog showed to its SHA-256 (ADR 0020). When the files changed in the
   * meantime nothing is approved, and the state is read again.
   */
  async approveInstruction(id: string, seen: Readonly<Record<string, string>>): Promise<boolean> {
    const vault = this.vault;
    const host = vault?.instructions;
    if (!vault || !host) return false;
    const source = await host.scanOne(id).catch(() => null);
    const same = Boolean(source) && source!.files.length === Object.keys(seen).length && source!.files.every((f) => seen[f.path] === f.sha256);
    if (same) {
      const approvals = await host.approvals.load().catch(() => EMPTY_INSTRUCTION_APPROVALS);
      await host.approvals.save(approveInstruction(approvals, source!, this.host.now().toISOString(), "review"));
    }
    await this.refreshSkills();
    return same;
  }

  /** Withdraws an approval on this device: the source is "new" again. */
  async revokeInstruction(id: string): Promise<void> {
    const host = this.vault?.instructions;
    if (!host) return;
    await host.approvals.save(revokeInstruction(await host.approvals.load().catch(() => EMPTY_INSTRUCTION_APPROVALS), id));
    await this.refreshSkills();
  }

  /** Switches a skill or AGENTS.md on or off on this device — the app's own skills too. */
  async switchInstruction(id: string, on: boolean): Promise<void> {
    const host = this.vault?.instructions;
    if (!host) return;
    await host.approvals.save(switchInstruction(await host.approvals.load().catch(() => EMPTY_INSTRUCTION_APPROVALS), id, on));
    await this.refreshSkills();
  }

  /**
   * Writes a skill into `.agent/skills/<name>/` and approves exactly what was
   * written — the user wrote, copied or picked it here (plan KI-Harness P3-5).
   * What reads back different from what was written is not approved; an own
   * skill of the same name is only replaced when the user said so (its folder
   * goes to the trash first).
   */
  private async writeSkill(name: string, files: readonly { path: string; bytes: Uint8Array }[], how: ApprovalHow, options: { from?: InstructionApproval["from"]; replace?: boolean } = {}): Promise<SkillWriteOutcome> {
    const host = this.vault?.instructions;
    if (!host?.write) return { ok: false, reason: "no-vault" };
    const id = `${SKILLS_FOLDER}/${name}`;
    const existing = await host.scanOne(id).catch(() => null);
    if (existing && !options.replace) return { ok: false, reason: "exists" };
    try {
      if (existing && host.remove) await host.remove(id);
      for (const file of files) await host.write(`${id}/${file.path}`, file.bytes);
    } catch {
      await this.refreshSkills();
      return { ok: false, reason: "write-failed" };
    }
    const written = await host.scanOne(id).catch(() => null);
    const expected = Object.fromEntries(files.map((f) => [f.path, instructionFileHash(f.bytes)]));
    if (!written || !sameFiles(expected, written.files)) {
      await this.refreshSkills();
      return { ok: false, reason: "changed" };
    }
    const approvals = await host.approvals.load().catch(() => EMPTY_INSTRUCTION_APPROVALS);
    await host.approvals.save(approveInstruction(approvals, written, this.host.now().toISOString(), how, options.from));
    await this.refreshSkills();
    return { ok: true, id, path: `${id}/SKILL.md` };
  }

  /** A new skill from the workshop's form: name, description, instructions — written and approved here. */
  async createSkill(input: { name: string; description: string; body: string }): Promise<SkillWriteOutcome> {
    const name = input.name.trim();
    const text = serializeSkillFile({ name, description: input.description.trim(), body: input.body, metadata: { "plainva.version": "1" } });
    const parsed = parseSkillFile(text, name);
    const problems = blockingProblems(parsed.problems);
    if (!input.body.trim()) problems.push({ code: "description-missing", detail: "body" });
    if (problems.length) return { ok: false, reason: "invalid", problems };
    return this.writeSkill(name, [{ path: "SKILL.md", bytes: utf8Encode(text) }], "created");
  }

  /**
   * One of the app's skills as an own version in the vault, to change there;
   * the app's own is switched off on this device so the two do not compete.
   */
  async copyAppSkill(id: string): Promise<SkillWriteOutcome> {
    const source = APP_SKILL_SOURCES.find((s) => s.id === id);
    if (!source?.skill || source.text === null) return { ok: false, reason: "invalid" };
    const result = await this.writeSkill(source.skill.name, [{ path: "SKILL.md", bytes: utf8Encode(source.text) }], "copied");
    if (result.ok) await this.switchInstruction(id, false);
    return result;
  }

  /** A skill the user picked and checked in the import dialog (`readSkillImport`), with where it came from. */
  async importSkill(imported: SkillImport, from: { label: string; sha256?: string }, replace = false): Promise<SkillWriteOutcome> {
    if (imported.blocked) return { ok: false, reason: "invalid", problems: imported.problems };
    return this.writeSkill(imported.name, imported.files, "imported", { from, replace });
  }

  /** Deletes an own skill or AGENTS.md after the user confirmed it; its approval and switch go with it. */
  async deleteInstruction(id: string): Promise<boolean> {
    const host = this.vault?.instructions;
    if (!host?.remove || id.startsWith("plainva:")) return false;
    try {
      await host.remove(id);
    } catch {
      await this.refreshSkills();
      return false;
    }
    const approvals = await host.approvals.load().catch(() => EMPTY_INSTRUCTION_APPROVALS);
    await host.approvals.save(pruneInstructionApprovals(revokeInstruction(approvals, id), new Set((await host.scan().catch(() => [] as InstructionSource[])).map((s) => s.id))));
    await this.refreshSkills();
    return true;
  }

  /**
   * Starts a skill in a new conversation (plan KI-Harness P3): bound from the
   * first message — its instructions in the system prompt, the tools, folders
   * and budget narrowed to it. `text` is the user's message that starts it.
   * Nothing runs when the skill is not active on this device at this moment.
   */
  async runSkill(id: string, text: string): Promise<RunStop | null> {
    const vault = this.vault;
    const choice = this.choice();
    const message = text.trim();
    if (!message || !vault || !choice || this.state.live || this.sending || !this.state.settings.enabled) return null;
    this.sending = true;
    try {
      const { entries } = await this.instructionEntries(vault);
      if (this.vault !== vault) return null;
      this.set({ skills: { entries, omitted: skillCatalog(entries).omitted } });
      const entry = entries.find((e) => e.source.id === id);
      if (!entry || entry.status !== "active" || !entry.source.skill) return null;
      this.set({ active: null, excludeActive: false, notice: null });
      return (await this.runMessage(message, vault, this.choice() ?? choice, { skills: { entries, bind: id } }))?.stop ?? null;
    } catch (error) {
      this.abort = null;
      const stop: RunStop = { kind: "failed", failure: { kind: "offline", message: error instanceof Error ? error.message : String(error) } };
      this.set({ live: null, notice: { conversationId: this.state.active?.id ?? "", stop } });
      return stop;
    } finally {
      this.sending = false;
    }
  }

  // ------------------------------------------------- skills: the regression run

  /** The provider and model a new conversation starts with — what a skill started from the workshop runs on. */
  newConversationChoice(): ModelChoice | null {
    return this.state.draftChoice ?? initialModelChoice(this.state.settings);
  }

  /**
   * The active skills that bring scenarios, with what of them applies in this
   * vault: a scenario that names a note or a path the vault does not have was
   * written for another vault and is not run here.
   */
  private async skillTestTargets(
    vault: AiVaultHost,
    entries: readonly InstructionEntry[],
    ids: readonly string[] | null,
  ): Promise<{ target: SkillTestTarget; entry: InstructionEntry; scenarios: SkillScenario[]; gaps: Map<string, string[]> }[]> {
    const found: { target: SkillTestTarget; entry: InstructionEntry; scenarios: SkillScenario[]; gaps: Map<string, string[]> }[] = [];
    const notes = new Map<string, boolean>();
    const paths = new Map<string, boolean>();
    for (const entry of entries) {
      const skill = entry.source.skill;
      if (!skill || entry.status !== "active" || (ids && !ids.includes(entry.source.id))) continue;
      let raw: string | null;
      if (entry.source.origin === "plainva") raw = appSkillScenarios(entry.source.id);
      else {
        const rel = skill.plainva.tests ?? SKILL_SCENARIOS_FILE;
        raw = vault.instructions && entry.source.files.some((f) => f.path === rel) ? await vault.instructions.readFile(entry.source, rel).catch(() => null) : null;
      }
      if (raw === null) continue;
      const { scenarios, problems } = readSkillScenarios(raw);
      if (!scenarios.length && !problems.length) continue;
      for (const scenario of scenarios) {
        for (const title of scenario.cites ?? []) if (!notes.has(title)) notes.set(title, Boolean(await vault.policy.resolveLink(title, "").catch(() => null)));
        for (const path of scenario.reaches ?? []) if (!paths.has(path)) paths.set(path, Boolean(await vault.readNote(path).catch(() => null)));
      }
      const lookup = { hasNote: (title: string) => notes.get(title) === true, hasPath: (path: string) => paths.get(path) === true };
      const gaps = new Map(scenarios.map((scenario) => [scenario.id, scenarioGaps(scenario, lookup)]));
      const notApplicable = scenarios.filter((scenario) => (gaps.get(scenario.id) ?? []).length > 0).length;
      found.push({
        entry,
        scenarios,
        gaps,
        target: { id: entry.source.id, version: skillTestVersion(entry.source.files, raw), scenarios: scenarios.length - notApplicable, notApplicable, problems },
      });
    }
    return found;
  }

  /**
   * What a regression run would do (plan KI-Harness P3-8), for the dialog that
   * starts it: the model, whether its price is known, and per skill how many
   * scenarios would run. `ids` narrows it to some skills; null means all.
   */
  async skillTestPlan(ids: readonly string[] | null = null): Promise<SkillTestPlan | null> {
    const vault = this.vault;
    const choice = this.newConversationChoice();
    const provider = choice ? providerById(choice.providerId, this.state.settings.custom) : undefined;
    if (!vault || !choice || !provider || !this.state.settings.enabled) return null;
    const { entries } = await this.instructionEntries(vault);
    const targets = (await this.skillTestTargets(vault, entries, ids)).map((found) => found.target);
    return {
      choice,
      providerLabel: provider.label,
      local: !isCloudRecipient(recipientOf(provider, choice.model)),
      priced: Boolean(this.priceOf(choice)),
      targets,
      total: targets.reduce((sum, target) => sum + target.scenarios, 0),
    };
  }

  /**
   * The regression run (plan KI-Harness P3-8, § 11.7): every scenario of the
   * chosen skills as one ordinary run of its skill against the model a new
   * conversation starts with — the same gate, the same send overview, the
   * same tools — judged for what it did, not for its wording. Started by
   * hand, never by itself.
   *
   * The run has a ceiling: an amount where the model's price is known, tokens
   * always. It is checked between scenarios (one scenario is bounded by its
   * run limits), and what did not run is recorded as not run. Each scenario
   * leaves its conversation in the history, replacing the one of its last
   * run; the composer's open conversation and drafts are untouched.
   */
  async testSkills(ids: readonly string[] | null, ceiling: { maxCostUsd: number | null; maxTokens?: number }): Promise<SkillTestOutcome> {
    const vault = this.vault;
    if (!this.state.settings.enabled || !vault) return { kind: "refused", reason: "off" };
    const choice = this.newConversationChoice();
    if (!choice || !providerById(choice.providerId, this.state.settings.custom)) return { kind: "refused", reason: "no-model" };
    if (this.state.live || this.sending) return { kind: "refused", reason: "busy" };
    this.sending = true;
    const before = this.state.active;
    let ran = 0;
    let passed = 0;
    let stopped: null | "ceiling" | "cancelled" | "failed" = null;
    let failure: ModelFailure | undefined;
    try {
      const { entries } = await this.instructionEntries(vault);
      const found = this.vault === vault ? await this.skillTestTargets(vault, entries, ids) : [];
      const total = found.reduce((sum, f) => sum + f.target.scenarios, 0);
      if (total === 0) return { kind: "refused", reason: "nothing" };
      const budget = { maxCostUsd: this.priceOf(choice) ? ceiling.maxCostUsd : null, maxTokens: ceiling.maxTokens ?? SKILL_TEST_MAX_TOKENS };
      const spent = { tokens: 0, costUsd: 0 };
      let tests = vault.skillTests ? await vault.skillTests.load().catch(() => EMPTY_SKILL_TESTS) : EMPTY_SKILL_TESTS;
      // Named `t`: the locale guard finds keys by their `t(` call (localeParity.test.ts).
      const t = (key: string, vars?: Record<string, string>) => this.host.label?.(key, vars) ?? key;
      for (const { entry, target, scenarios, gaps } of found) {
        const skill = entry.source.skill!;
        const app = appSkillOf(target.id);
        const title = app ? t(`ai.skills.${app.key}.title`) : skill.plainva.title || skill.name;
        const previous = tests.records.find((r) => r.id === target.id);
        const results: SkillScenarioResult[] = [];
        for (const scenario of scenarios) {
          const missing = gaps.get(scenario.id) ?? [];
          if (missing.length) {
            results.push(scenarioNotApplicable(scenario, missing));
            continue;
          }
          if (!stopped && !skillTestBudgetLeft(spent, budget)) stopped = "ceiling";
          if (stopped) {
            results.push(scenarioNotRun(scenario));
            continue;
          }
          this.set({ skillTests: { ...this.state.skillTests, running: { skill: target.id, scenario: scenario.id, done: ran, total } } });
          // The history keeps one conversation per scenario: the one of its last run makes room.
          const old = previous?.scenarios.find((s) => s.id === scenario.id)?.conversationId;
          if (old) await this.remove(old).catch(() => undefined);
          this.set({ active: null, notice: null });
          const outcome = await this.runMessage(scenario.message, vault, choice, {
            skills: { entries, bind: target.id },
            detached: { title: t("ai.workshop.test.conversation", { skill: title, scenario: scenario.id }), limits: SKILL_TEST_RUN_LIMITS },
          });
          // Stopped by the user, the send overview declined, the vault gone — or the request itself failed, which
          // says nothing about the skill: the run ends here, and the unfinished scenario leaves no conversation.
          const broke = outcome?.stop.kind === "failed" ? outcome.stop.failure : null;
          if (this.vault !== vault || !outcome || !outcome.record || outcome.stop.kind === "cancelled" || broke) {
            stopped = broke ? "failed" : "cancelled";
            if (broke) failure = broke;
            if (outcome?.record && this.vault === vault) await this.remove(outcome.record.id).catch(() => undefined);
            results.push(scenarioNotRun(scenario));
            continue;
          }
          const run = outcome.record.runs[outcome.record.runs.length - 1];
          const tokens = run ? run.usage.inputTokens + run.usage.outputTokens : 0;
          spent.tokens += tokens;
          spent.costUsd += run?.costUsd ?? 0;
          const result = scenarioResult(scenario, runTrace(outcome.record, run?.userTurn ?? 0, outcome.stop, outcome.answer ?? ""), {
            tokens,
            ...(run?.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
            conversationId: outcome.record.id,
          });
          results.push(result);
          ran += 1;
          if (result.passed) passed += 1;
        }
        // A skill none of whose scenarios ran keeps the result it had.
        if (this.vault === vault && results.some((r) => r.checks.length > 0)) {
          const record: SkillTestRecord = { id: target.id, version: target.version, providerId: choice.providerId, model: choice.model, at: this.host.now().toISOString(), scenarios: results };
          tests = recordSkillTest(tests, record);
          await vault.skillTests?.save(tests).catch(() => undefined);
          this.set({ skillTests: { ...this.state.skillTests, records: tests.records } });
        }
      }
      // Results of skills that are gone go with them.
      if (this.vault === vault && vault.skillTests && ids === null && !stopped) {
        const pruned = pruneSkillTests(tests, new Set(entries.map((e) => e.source.id)));
        if (pruned !== tests) {
          await vault.skillTests.save(pruned).catch(() => undefined);
          this.set({ skillTests: { ...this.state.skillTests, records: pruned.records } });
        }
      }
      return { kind: "done", ran, passed, failed: ran - passed, stopped, ...(failure ? { failure } : {}) };
    } catch (error) {
      // Whatever broke on the way (a vault read, the store) ends the run as a failure that is said, never as a spinner.
      this.abort = null;
      if (this.state.live) this.set({ live: null });
      return { kind: "done", ran, passed, failed: ran - passed, stopped: "failed", failure: { kind: "offline", message: error instanceof Error ? error.message : String(error) } };
    } finally {
      this.sending = false;
      if (this.vault === vault) {
        // The conversation that was open before is open again; the scenarios' own are in the history.
        const kept = before && this.state.summaries.some((s) => s.id === before.id) ? before : null;
        this.set({ active: kept, notice: null, skillTests: { ...this.state.skillTests, running: null } });
      }
    }
  }

  /**
   * The tools and the system prompt's blocks of a new conversation: the
   * vault's AGENTS.md when it is active here; a bound skill with its grant —
   * or, with tools, the catalog and `use_skill`. Fixed from the first message
   * on (the conversation is append-only).
   */
  private conversationStart(entries: readonly InstructionEntry[], offered: readonly string[], bind?: string): ConversationStart {
    const prompt: ConversationStart["prompt"] = {};
    const instructions: ConversationInstructions = {};
    const agents = entries.find((e) => e.source.kind === "agents" && e.status === "active" && e.source.text);
    if (agents?.source.text) {
      prompt.vaultInstructions = agents.source.text;
      instructions.vaultTokens = estimateTokens(agents.source.text);
    }
    const result = (tools: string[]): ConversationStart => ({ tools, prompt, instructions: Object.keys(instructions).length ? instructions : null });
    const bound = bind ? entries.find((e) => e.source.id === bind && e.status === "active" && e.source.skill) : undefined;
    if (bound?.source.skill) {
      const skill = bound.source.skill;
      const grant = skillGrant(skill, offered, DEFAULT_RUN_LIMITS.maxOutputTokens);
      prompt.skill = { name: skill.name, instructions: skill.body };
      instructions.skill = {
        id: bound.source.id,
        name: skill.name,
        origin: bound.source.origin,
        sha256: bound.source.files.find((f) => /^skill\.md$/i.test(f.path))?.sha256 ?? "",
        ...(grant.folders ? { folders: grant.folders } : {}),
        ...(grant.maxOutputTokens !== null ? { maxOutputTokens: grant.maxOutputTokens } : {}),
        ...(skill.plainva.localPreferred ? { localPreferred: true } : {}),
      };
      instructions.skillTokens = estimateTokens(skill.body);
      return result(grant.tools);
    }
    const catalog = offered.length ? skillCatalog(entries) : null;
    if (catalog?.entries.length) {
      prompt.skillCatalog = catalog.text;
      instructions.catalog = catalog.entries.map((e) => ({ key: e.key, id: e.id, origin: e.id.startsWith("plainva:") ? ("plainva" as const) : ("vault" as const) }));
      instructions.catalogTokens = catalog.tokens;
      return result([...offered, "use_skill"]);
    }
    return result([...offered]);
  }

  /** How a run reaches the skills its conversation lists: read again at the moment, hash checked. */
  private skillRuntime(vault: AiVaultHost, record: ConversationRecord) {
    return {
      catalog: record.instructions?.catalog ?? [],
      entry: async (id: string): Promise<InstructionEntry | null> => {
        if (id.startsWith("plainva:")) return APP_ENTRIES().find((e) => e.source.id === id) ?? null;
        const host = vault.instructions;
        if (!host) return null;
        const [source, approvals] = await Promise.all([host.scanOne(id).catch(() => null), host.approvals.load().catch(() => EMPTY_INSTRUCTION_APPROVALS)]);
        if (!source) return null;
        // The app's switches count for the app's skills too; read them with the vault's approvals.
        return resolveInstructions([source], approvals)[0] ?? null;
      },
      file: async (entry: InstructionEntry, rel: string): Promise<string | null> => (entry.source.origin === "vault" && vault.instructions ? vault.instructions.readFile(entry.source, rel) : null),
    };
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

  /**
   * An action at a selection (plan P1.5, E33): the passage alone goes to the
   * model — through the gate and the send overview like any message — in a
   * conversation of its own, and the answer comes back as a suggestion round
   * in the note, authored "Plainva AI · model". Nothing is written into the
   * note until someone accepts; a passage whose links or place stamps may not
   * go is refused rather than rewritten without them.
   */
  async proposeForSelection(request: SelectionRequest): Promise<SelectionOutcome> {
    const vault = this.vault;
    const choice = this.choice();
    if (!this.state.settings.enabled || !vault || !vault.propose) return { kind: "refused", reason: "off" };
    if (!choice) return { kind: "refused", reason: "no-model" };
    if (this.state.live || this.sending) return { kind: "refused", reason: "busy" };
    if (vault.encrypted?.()) return { kind: "refused", reason: "encrypted" };
    const { range, action } = request;
    if (!range.text.trim()) return { kind: "refused", reason: "empty" };
    if (range.text.length > SELECTION_MAX_CHARS) return { kind: "refused", reason: "too-long" };
    const provider = providerById(choice.providerId, this.state.settings.custom);
    if (!provider) return { kind: "refused", reason: "no-model" };
    const recipient: EgressRecipient = recipientOf(provider, choice.model);
    const run = { recipient, webTools: false };
    // The note passes the gate with the text in the editor: an unsaved `cloud: deny` counts.
    if (!gateDecision(await vault.policy.policyOf(range.path, range.doc), run).allowed) return { kind: "refused", reason: "denied" };
    const places = withholdPlaces(range.text);
    const links = isCloudRecipient(recipient)
      ? await withholdDeniedLinks(range.text, range.path, vault.policy.resolveLink, async (path) => gateDecision(await vault.policy.policyOf(path), run).allowed)
      : { text: range.text };
    if (places.withheld > 0 || links.text !== range.text) return { kind: "refused", reason: "withheld" };

    this.sending = true;
    try {
      const title = range.path.slice(range.path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
      // Named `t`: the locale guard finds dynamic keys by their `t(` call (localeParity.test.ts).
      const t = (key: string, vars?: Record<string, string>) => this.host.label?.(key, vars) ?? key;
      const passage: TextPart = {
        type: "text",
        text: `The passage, from the note [[${title}]]:\n${fenceUntrusted(payload(range.text, { kind: "vault", path: range.path, section: "selection" }))}`,
        context: [],
      };
      const instruction = `${selectionInstruction(action, request.language)}\n\n${PASSAGE_ONLY}`;
      const pack: ContextPackage = {
        part: passage,
        refs: [{ path: range.path, title, tier: "evidence", reasons: ["active"], score: 1, chars: range.text.length }],
        excluded: [],
        redactions: { withheldLinks: 0, places: 0, moodProperties: 0, sensitive: 0 },
        dataClasses: ["selection"],
        estimatedTokens: estimateTokens(passage.text + instruction),
        material: { sentChars: range.text.length, sourceChars: range.text.length, candidateChars: null },
      };
      const price = this.priceOf(choice);
      const folder = range.path.includes("/") ? range.path.slice(0, range.path.indexOf("/")) : "";
      // The passage goes as it is — a placeholder would end up in the proposal —, but the overview names what it holds (P2b-6).
      const seen = isCloudRecipient(recipient) ? sensitiveKinds(sensitiveFindings(range.text)) : [];
      const manifest: EgressManifest = {
        providerId: provider.id,
        providerLabel: provider.label,
        model: choice.model,
        local: !isCloudRecipient(recipient),
        sources: [{ path: range.path, title, tier: "evidence", chars: range.text.length, reasons: ["active"], selection: true, ...(seen.length ? { sensitive: seen } : {}) }],
        ...(seen.length ? { sensitive: seen } : {}),
        dataClasses: ["selection"],
        folders: [folder],
        withheld: { notes: 0, links: 0, places: 0, moodProperties: 0 },
        excluded: [],
        estimatedTokens: pack.estimatedTokens,
        ...(price ? { estimatedCostUsd: (pack.estimatedTokens / 1_000_000) * price.input } : {}),
        tools: [],
        web: false,
      };
      const growth = scopeGrowth(manifest, this.scope);
      if (growth.length > 0 || (this.state.settings.confirmEveryRequest && !manifest.local)) {
        const answer = await this.askConsent(manifest, growth);
        if (this.vault !== vault || answer !== "send") return { kind: "refused", reason: "cancelled" };
      }
      if (!manifest.local) this.scope = widenScope(this.scope, manifest);

      const now = this.host.now().toISOString();
      const id = this.host.newId();
      const record: ConversationRecord = {
        version: 1,
        id,
        title: t(`ai.selection.title.${action}`, { note: title }),
        createdAt: now,
        updatedAt: now,
        providerId: choice.providerId,
        model: choice.model,
        conversation: startConversation(id, assistantSystemPrompt({ language: this.host.language(), today: this.host.today(), tools: [] }), []),
        usage: EMPTY_USAGE,
        runs: [],
        pins: [],
      };
      const { stop, answer, record: saved } = await this.execute({
        vault,
        choice,
        provider,
        record,
        pack,
        manifest,
        parts: [passage, { type: "text", text: instruction }],
        executor: null,
        carriesVault: true,
        usedDrafts: false,
      });
      if (stop.kind !== "answered") return { kind: "refused", reason: stop.kind === "cancelled" ? "cancelled" : "failed" };
      const text = passageOf(answer);
      if (!text) return { kind: "refused", reason: "failed" };
      // The editor may have moved on while the model wrote: the round is laid on the note as it is now.
      const note = await vault.readNote(range.path);
      const base = note?.text ?? range.doc;
      const place = relocate(base, range.from, range.to, range.text);
      if (!place) return { kind: "refused", reason: "changed" };
      // The whole new passage is linted, then diffed: a block of the round is a fragment, and half an address is none.
      const linted = defuseNewAddresses(text, [base]);
      const chunks = selectionChunks(base, place.from, place.to, linted.text, action === "tasks" ? "insert" : "replace");
      if (!chunks.length) return { kind: "unchanged", conversationId: saved.id };
      const roundNote = t(`ai.selection.roundNote.${action}`, { model: choice.model });
      await vault.propose({
        path: range.path,
        base,
        chunks,
        note: linted.defused ? `${roundNote} ${t("ai.lint.defused")}` : roundNote,
        author: { id: `plainva-ai/${choice.model}`, displayName: t("ai.suggestionAuthor", { model: choice.model }) },
      });
      return { kind: "proposed", conversationId: saved.id, changes: chunks.length };
    } catch (error) {
      return { kind: "refused", reason: "failed", message: error instanceof Error ? error.message : String(error) };
    } finally {
      this.sending = false;
    }
  }

  /**
   * Transcribes a voice note (plan P1.5, §10.7, E28): the recording goes, in
   * its own format, to the model of the profile "Audio" — through the gate
   * (the note's rules and the recording's own) and the send overview with the
   * data class "audio" — and the transcript comes back as a suggestion round
   * under the recording, authored "Plainva AI · model". Nothing enters the
   * note until someone accepts.
   */
  async transcribe(request: TranscriptionRequest): Promise<TranscriptionOutcome> {
    type Refusal = Extract<TranscriptionOutcome, { kind: "refused" }>;
    const refused = (reason: Refusal["reason"], extra: Omit<Refusal, "kind" | "reason"> = {}): TranscriptionOutcome => ({ kind: "refused", reason, ...extra });
    const vault = this.vault;
    if (!this.state.settings.enabled || !vault || !vault.propose) return refused("off");
    if (vault.encrypted?.()) return refused("encrypted");
    const choice = this.state.settings.profiles.audio ?? null;
    const provider = choice ? providerById(choice.providerId, this.state.settings.custom) : undefined;
    if (!choice || !provider) return refused("no-model");
    const route = transcriptionRoute(provider.endpoint);
    if (!route) return refused("no-route", { provider: provider.label });
    const { audio, notePath, target } = request;
    if (audio.bytes.length > TRANSCRIPTION_MAX_BYTES) return refused("too-large", { size: audio.bytes.length });
    if (this.transcribing.has(audio.path)) return refused("busy");
    const recipient: EgressRecipient = recipientOf(provider, choice.model);
    const run = { recipient, webTools: false };
    const note = await vault.readNote(notePath);
    if (!note || !note.text.includes(target)) return refused("changed");
    // The note's rules and the recording's own (its folder, the vault's rules) both decide.
    if (!gateDecision(await vault.policy.policyOf(notePath, note.text), run).allowed) return refused("denied");
    if (!gateDecision(await vault.policy.policyOf(audio.path), run).allowed) return refused("denied");

    const folder = notePath.includes("/") ? notePath.slice(0, notePath.indexOf("/")) : "";
    const manifest: EgressManifest = {
      providerId: provider.id,
      providerLabel: provider.label,
      model: choice.model,
      local: !isCloudRecipient(recipient),
      sources: [{ path: audio.path, title: audio.name, tier: "evidence", chars: 0, reasons: ["active"], audioBytes: audio.bytes.length }],
      dataClasses: ["audio"],
      folders: [folder],
      withheld: { notes: 0, links: 0, places: 0, moodProperties: 0 },
      excluded: [],
      estimatedTokens: 0,
      tools: [],
      web: false,
    };
    const growth = scopeGrowth(manifest, this.scope);
    if (growth.length > 0 || (this.state.settings.confirmEveryRequest && !manifest.local)) {
      const answer = await this.askConsent(manifest, growth);
      if (this.vault !== vault || answer !== "send") return refused("cancelled");
    }
    if (!manifest.local) this.scope = widenScope(this.scope, manifest);

    this.transcribing.add(audio.path);
    // Named `t`: the locale guard finds keys by their `t(` call (localeParity.test.ts).
    const t = (key: string, vars?: Record<string, string>) => this.host.label?.(key, vars) ?? key;
    try {
      const spec = transcriptionRequest(provider.endpoint, route, choice.model, audio);
      const answer = await fetchProviderJson(this.host.egress, spec, `ai-${this.host.newId()}`);
      await this.recordTranscription(vault, choice, answer.ok ? transcriptionUsage(answer.json) : EMPTY_USAGE, answer.ok ? undefined : answer.failure.kind);
      if (!answer.ok) return refused("failed", { failure: answer.failure, provider: provider.label, model: choice.model });
      const transcript = transcriptOf(route, answer.json);
      if (!transcript) return refused("empty");
      // The note may have moved on meanwhile: the round is laid on it as it is now, under the one line with the recording.
      const base = (await vault.readNote(notePath))?.text ?? "";
      const at = base.indexOf(target);
      if (at < 0 || base.indexOf(target, at + 1) >= 0) return refused("changed");
      const lineEnd = base.indexOf("\n", at + target.length);
      const end = lineEnd < 0 ? base.length : lineEnd;
      // What was said in a recording is text a model wrote down: an address in it is made inert like any other.
      const linted = defuseNewAddresses(transcript, [base]);
      const roundNote = t("ai.transcribe.roundNote", { name: audio.name });
      await vault.propose({
        path: notePath,
        base,
        chunks: [{ fromA: end, toA: end, replacement: transcriptBlock(linted.text) }],
        note: linted.defused ? `${roundNote} ${t("ai.lint.defused")}` : roundNote,
        author: { id: `plainva-ai/${choice.model}`, displayName: t("ai.suggestionAuthor", { model: choice.model }) },
      });
      return { kind: "proposed", model: choice.model };
    } catch (error) {
      return refused("failed", { message: error instanceof Error ? error.message : String(error), provider: provider.label, model: choice.model });
    } finally {
      this.transcribing.delete(audio.path);
    }
  }

  /** A transcription in the run ledger: usage and cost count like any request's. */
  private async recordTranscription(vault: AiVaultHost, choice: ModelChoice, usage: ConversationUsage, failure?: string): Promise<void> {
    const costUsd = usageCostUsd(usage, this.priceOf(choice));
    try {
      const ledger = await vault.ledger.load();
      await vault.ledger.save(
        appendAiLedgerEntry(ledger, {
          at: this.host.now().toISOString(),
          conversationId: `transcript-${this.host.newId()}`,
          providerId: choice.providerId,
          model: choice.model,
          stop: failure ? "failed" : "answered",
          steps: 1,
          tools: [],
          usage,
          ...(costUsd !== undefined ? { costUsd } : {}),
          ...(failure ? { failure } : {}),
        }),
      );
    } catch {
      // The transcript still goes to the note when app data cannot be written.
    }
  }

  /**
   * "@AI" in a comment thread (plan P3-6, §19.1 D): the user's remark is the
   * question, the thread and the passage it hangs on go along as data, and
   * the answer comes back as a reply in the thread, authored "Plainva AI ·
   * model". It runs like a message typed in the composer — the context of the
   * question with the thread's note along, the gate, the send overview naming
   * the thread, the read tools — in a conversation of its own that the
   * history keeps, and without skills.
   *
   * Unlike a proposal, a reply does not wait to be accepted: it is in the
   * thread once the model has answered. So the note the thread belongs to
   * decides (where the note may not go, its comments do not go either), the
   * thread's places and its links to notes the rules keep back are withheld
   * like a note's, and every address the model brought is made inert before
   * the reply is stored.
   */
  async replyInThread(request: ThreadReplyRequest): Promise<ThreadReplyOutcome> {
    type Refusal = Extract<ThreadReplyOutcome, { kind: "refused" }>;
    const refused = (reason: Refusal["reason"], extra: Omit<Refusal, "kind" | "reason"> = {}): ThreadReplyOutcome => ({ kind: "refused", reason, ...extra });
    const vault = this.vault;
    if (!this.state.settings.enabled || !vault || !vault.reply) return refused("off");
    if (vault.encrypted?.()) return refused("encrypted");
    const choice = this.choice();
    const provider = choice ? providerById(choice.providerId, this.state.settings.custom) : undefined;
    if (!choice || !provider) return refused("no-model");
    if (this.state.live || this.sending) return refused("busy");
    const question = request.question.trim();
    const quote = request.quote?.trim() ?? "";
    if (!question && request.thread.length === 0 && !quote) return refused("empty");
    const recipient: EgressRecipient = recipientOf(provider, choice.model);
    const run = { recipient, webTools: false };
    const note = await vault.readNote(request.path);
    if (!gateDecision(await vault.policy.policyOf(request.path, note?.text), run).allowed) return refused("denied");

    this.sending = true;
    let conversationId: string | undefined;
    try {
      const cloud = isCloudRecipient(recipient);
      // Remarks are text like a note's: a place stays on the device, and a link to a note the rules keep back names nothing.
      const withheld = async (text: string): Promise<string> => {
        const places = withholdPlaces(text).text;
        return cloud ? (await withholdDeniedLinks(places, request.path, vault.policy.resolveLink, async (path) => gateDecision(await vault.policy.policyOf(path), run).allowed)).text : places;
      };
      const title = request.path.slice(request.path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
      // Named `t`: the locale guard finds keys by their `t(` call (localeParity.test.ts).
      const t = (key: string, vars?: Record<string, string>) => this.host.label?.(key, vars) ?? key;
      const remarks = (await Promise.all(request.thread.map(async (remark) => `${remark.author} (${remark.at}): ${await withheld(remark.body)}`))).join("\n\n");
      const passage = quote ? await withheld(quote) : "";
      const lead: TextPart = {
        type: "text",
        text: [
          `A comment thread on the note [[${title}]].`,
          ...(passage ? ["It is attached to this passage of the note:", fenceUntrusted(payload(passage, { kind: "vault", path: request.path, section: "comment anchor" }))] : []),
          ...(remarks ? ["The thread so far, oldest first:", fenceUntrusted(payload(remarks, { kind: "vault", path: request.path, section: "comments" }))] : []),
          THREAD_REPLY_RULES,
        ].join("\n"),
        context: [],
      };
      const folder = request.path.includes("/") ? request.path.slice(0, request.path.indexOf("/")) : "";
      const price = this.priceOf(choice);
      // The thread goes as it was written; the overview names what the local patterns see in it (P2b-6).
      const seen = cloud ? sensitiveKinds(sensitiveFindings(`${passage}\n${remarks}`)) : [];
      const disclose = (manifest: EgressManifest): EgressManifest => {
        const estimatedTokens = manifest.estimatedTokens + estimateTokens(lead.text);
        const sized = { ...manifest, estimatedTokens, ...(price ? { estimatedCostUsd: (estimatedTokens / 1_000_000) * price.input } : {}) };
        // A remark that starts a thread on the note as a whole brings nothing but the user's own words.
        if (!passage && !remarks) return sized;
        const sensitive = [...new Set([...(manifest.sensitive ?? []), ...seen])];
        return {
          ...sized,
          sources: [
            { path: request.path, title, tier: "evidence", chars: passage.length + remarks.length, reasons: ["active"], comments: request.thread.length, ...(seen.length ? { sensitive: seen } : {}) },
            ...manifest.sources,
          ],
          ...(sensitive.length ? { sensitive } : {}),
          dataClasses: manifest.dataClasses.includes("comments") ? manifest.dataClasses : [...manifest.dataClasses, "comments"],
          folders: manifest.folders.includes(folder) ? manifest.folders : [...manifest.folders, folder].sort(),
        };
      };
      const outcome = await this.runMessage(question || "Answer the question this comment thread asks.", vault, choice, {
        door: { title: t("ai.thread.title", { note: title }), pins: [request.path], lead: [lead], disclose, limits: THREAD_REPLY_LIMITS },
      });
      if (!outcome) return refused("cancelled");
      conversationId = outcome.record?.id;
      const withId = conversationId ? { conversationId } : {};
      if (outcome.stop.kind !== "answered") return refused(outcome.stop.kind === "cancelled" ? "cancelled" : "failed", withId);
      // What the user's own text already links to stays a link; what the model brought does not become one.
      const reply = defuseNewAddresses((outcome.answer ?? "").trim(), [note?.text ?? "", request.quote ?? "", request.question, ...request.thread.map((remark) => remark.body)]).text;
      if (!reply) return refused("no-answer", withId);
      try {
        await vault.reply({
          path: request.path,
          parentCommentId: request.rootCommentId,
          body: reply,
          author: { id: `plainva-ai/${choice.model}`, displayName: t("ai.suggestionAuthor", { model: choice.model }) },
        });
      } catch (error) {
        return refused("post-failed", { ...withId, message: error instanceof Error ? error.message : String(error) });
      }
      return { kind: "replied", conversationId: conversationId ?? "", model: choice.model };
    } catch (error) {
      this.abort = null;
      if (this.state.live) this.set({ live: null });
      return refused("failed", { ...(conversationId ? { conversationId } : {}), message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.sending = false;
    }
  }

  /** Leaves a note out of the next message, or takes it back in ("View context"). */
  toggleLeaveOut(path: string): void {
    const list = this.state.leaveOutNext;
    this.set({ leaveOutNext: list.includes(path) ? list.filter((p) => p !== path) : [...list, path] });
  }

  /**
   * Redacts one source's numbers and secrets for the rest of this
   * conversation, or no longer ("View context", P2b-6). Kept with the
   * conversation: what went redacted is never sent whole by a later message
   * the reader did not choose.
   */
  async toggleRedact(path: string): Promise<void> {
    const active = this.state.active;
    const list = active ? (active.redact ?? []) : this.state.draftRedact;
    const next = list.includes(path) ? list.filter((p) => p !== path) : [...list, path];
    if (!active) {
      this.set({ draftRedact: next });
      return;
    }
    await this.saveActive({ ...active, redact: next });
  }

  /** Gist or original for one source of the next message ("View context", P2b-3). */
  toggleOriginal(path: string): void {
    const list = this.state.originalsNext;
    this.set({ originalsNext: list.includes(path) ? list.filter((p) => p !== path) : [...list, path] });
  }

  /**
   * One request to the model of the profile "Local", only while it runs on
   * this device — a server on this computer, or the system's own model on
   * the phone (plans P2b-3 and P2c, gists): no conversation, no tools, no
   * transcript, nothing to a cloud. Null while the profile names no such model.
   */
  localCompletion(): LocalCompletion | null {
    const choice = this.state.settings.profiles.local;
    const provider = choice ? providerById(choice.providerId, this.state.settings.custom) : null;
    if (!choice || !provider || (provider.kind !== "local" && provider.kind !== "platform-device")) return null;
    return {
      providerId: provider.id,
      model: choice.model,
      complete: async (instruction, text, signal) => {
        const at = this.host.now().toISOString();
        const conversation = appendTurn(startConversation(`gist-${this.host.newId()}`, instruction, []), { role: "user", parts: [{ type: "text", text }], at });
        const result = await runAgent({
          conversation,
          egress: this.host.egress,
          endpoint: provider.endpoint,
          model: choice.model,
          executor: { execute: async () => ({ content: "No tools.", isError: true }) },
          context: { privateContext: true, untrustedContext: true },
          limits: { maxSteps: 1, maxToolCalls: 0, maxOutputTokens: 1_000 },
          ...(provider.endpoint.api === "platform" ? { contextTokens: this.windowOf(provider, choice.model) ?? PLATFORM_CONTEXT_DEFAULT } : {}),
          ...(signal ? { signal } : {}),
          newRequestId: () => `ai-${this.host.newId()}`,
          now: () => this.host.now().toISOString(),
        });
        if (result.stop.kind !== "answered") throw new Error(result.stop.kind === "failed" ? result.stop.failure.kind : result.stop.kind);
        const last = result.conversation.turns[result.conversation.turns.length - 1];
        const answer = last?.role === "assistant" ? last.parts.map((part) => (part.type === "text" ? part.text : "")).join("") : "";
        return { text: answer, usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens } };
      },
    };
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
    // A new conversation shows what it would start with: the catalog, AGENTS.md, the tools.
    const start = record ? null : this.conversationStart((await this.instructionEntries(vault)).entries, provider.endpoint.api === "platform" ? [] : (vault.tools(recipientOf(provider, choice.model))?.names ?? []));
    const context = await this.contextOf(question, vault, choice, provider, record ? record.pins : this.state.draftPins, record ? record.conversation.turns : [], {
      tools: record ? record.conversation.tools : (start?.tools ?? []),
      instructions: manifestInstructionsOf(record ? record.instructions : (start?.instructions ?? undefined)),
    });
    const built = await context.build(new Set(this.state.leaveOutNext), new Set(record ? (record.redact ?? []) : this.state.draftRedact));
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
    conversation: { tools: readonly string[]; instructions?: ManifestInstructions; withoutActive?: boolean },
  ) {
    const recipient: EgressRecipient = recipientOf(provider, choice.model);
    // The system's own model takes no tools, and a small window a smaller package (plan P2c).
    const platform = provider.endpoint.api === "platform";
    const budget = contextBudgetFor(this.windowOf(provider, choice.model));
    // The tools the conversation carries — what the model may call, as the overview lists them.
    const tools = platform ? [] : conversation.tools;
    const situation = await vault.situation().catch(() => this.bareSituation());
    const seen = this.state.excludeActive || conversation.withoutActive ? { ...situation, active: null } : situation;
    const candidates = await vault.candidates(message, seen.active?.kind === "note" ? seen.active.path : null, recipient).catch(() => [] as Candidate[][]);
    const gists = vault.gists?.() ?? null;
    const build = async (leaveOut: ReadonlySet<string>, redact: ReadonlySet<string>): Promise<{ pack: ContextPackage; manifest: EgressManifest }> => {
      const pack = await buildContextPackage(
        {
          question: message,
          recipient,
          situation: seen,
          candidates,
          pins: pins.filter((p) => !leaveOut.has(p)),
          // A platform model's request carries only the latest notes (plan P2c): nothing counts as sent before.
          ...(platform ? {} : { alreadySent: sentStamps(turns) }),
          leaveOut,
          originals: new Set(this.state.originalsNext),
          redact,
          ...(budget ? { budget } : {}),
        },
        {
          policyOf: vault.policy.policyOf,
          resolveLink: vault.policy.resolveLink,
          readNote: (path) => vault.readNote(path),
          ...(vault.noteSizes ? { noteSizes: (paths: readonly string[]) => vault.noteSizes!(paths) } : {}),
          ...(gists ? { gists } : {}),
        },
      );
      const manifest = manifestOf(pack, { id: provider.id, label: provider.label, local: !isCloudRecipient(recipient) }, choice.model, {
        tools,
        questionChars: message.length,
        ...(conversation.instructions ? { instructions: conversation.instructions } : {}),
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

  /** Redacts one source's numbers and secrets for this conversation, or no longer; the overview is built again (P2b-6). */
  redactInConsent(path: string): void {
    this.settleConsent({ redact: path });
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
      // Asked from a door while no conversation is on screen: the shell shows one, or nobody could answer.
      if (this.surfaces === 0) this.reveal?.();
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
      return (await this.runMessage(message, vault, choice))?.stop ?? null;
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

  private async runMessage(
    message: string,
    vault: AiVaultHost,
    choice: ModelChoice,
    options: { skills?: { entries: readonly InstructionEntry[]; bind?: string }; door?: DoorStart; detached?: DetachedStart } = {},
  ): Promise<RunOutcome | null> {
    const { skills, door, detached } = options;
    // Started apart from the composer: a conversation of its own, with none of the composer's drafts.
    const apart = door ?? detached ?? null;
    const provider = providerById(choice.providerId, this.state.settings.custom);
    if (!provider) {
      const stop: RunStop = { kind: "failed", failure: { kind: "unknown_endpoint", message: choice.providerId } };
      this.set({ notice: { conversationId: this.state.active?.id ?? "", stop } });
      return { stop };
    }
    const recipient: EgressRecipient = recipientOf(provider, choice.model);
    // Redacted for the whole conversation (P2b-6): in its context, and in what the model reads itself through the tools.
    // One set for both: a choice in the overview below reaches the tools of this run too.
    // A door starts a conversation of its own: what the composer's next message was given is not its to use.
    const redact = new Set<string>(apart ? [] : this.state.active ? (this.state.active.redact ?? []) : this.state.draftRedact);
    // The system's own model takes no tools (plan P2c).
    const platform = provider.endpoint.api === "platform";
    const now = this.host.now().toISOString();

    let record: ConversationRecord;
    if (this.state.active && !apart) {
      record = this.state.active;
    } else {
      // A new conversation: its system prompt and its tools are fixed from here on (append-only).
      // A door answers where it was asked: it reads the vault, it does not move the app.
      const offered = platform ? [] : (vault.tools(recipient)?.names ?? []).filter((name) => !door || name !== "run_command");
      const entries = skills?.entries ?? (await this.instructionEntries(vault)).entries;
      // A door runs without skills (plan P3-6): the vault's standing instructions still apply, the catalog does not.
      const start = this.conversationStart(door ? entries.filter((e) => e.source.kind === "agents") : entries, offered, skills?.bind);
      const id = this.host.newId();
      record = {
        version: 1 as const,
        id,
        title: apart?.title ?? conversationTitleFrom(message, message),
        createdAt: now,
        updatedAt: now,
        providerId: choice.providerId,
        model: choice.model,
        conversation: startConversation(id, assistantSystemPrompt({ language: this.host.language(), today: this.host.today(), tools: start.tools, ...start.prompt }), start.tools),
        usage: EMPTY_USAGE,
        runs: [],
        pins: door ? door.pins : detached ? [] : this.state.draftPins,
        ...(start.instructions ? { instructions: start.instructions } : {}),
      };
    }
    // A skill narrows the run (plan KI-Harness P3): the bound one's folders from the start, a loaded one's from its load.
    const skillState = newSkillRunState();
    const bound = record.instructions?.skill;
    const toolNames = platform ? [] : record.conversation.tools;
    const base = toolNames.length ? vault.tools(recipient, skillScope(bound?.folders, skillState), redact) : null;
    const tools = base ? { names: toolNames, executor: createSkillExecutor(base.executor, this.skillRuntime(vault, record), toolNames, skillState) } : null;
    // A skill's own budget narrows whatever limits the start brings; it never widens them.
    const own = bound?.maxOutputTokens;
    const limits: RunLimits | undefined =
      door?.limits ??
      (detached?.limits
        ? { ...detached.limits, maxOutputTokens: Math.min(detached.limits.maxOutputTokens, own ?? detached.limits.maxOutputTokens) }
        : own
          ? { ...DEFAULT_RUN_LIMITS, maxOutputTokens: own }
          : undefined);

    // The context of this message: what "View context" showed, without the notes left out there.
    const context = await this.contextOf(message, vault, choice, provider, record.pins, record.conversation.turns, {
      tools: toolNames,
      instructions: manifestInstructionsOf(record.instructions),
      // A regression run measures the skill, not whatever note happens to be open.
      ...(detached ? { withoutActive: true } : {}),
    });
    const { seen } = context;
    // What a door brings goes into the overview with everything else: the user sees it before it is sent.
    const build = async (out: ReadonlySet<string>, red: ReadonlySet<string>) => {
      const built = await context.build(out, red);
      return door ? { pack: built.pack, manifest: door.disclose(built.manifest) } : built;
    };
    const leaveOut = new Set<string>(apart ? [] : this.state.leaveOutNext);
    let { pack, manifest } = await build(leaveOut, redact);
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
      if ("leaveOut" in answer) leaveOut.add(answer.leaveOut);
      else if (redact.has(answer.redact)) redact.delete(answer.redact);
      else redact.add(answer.redact);
      ({ pack, manifest } = await build(leaveOut, redact));
    }
    if (redact.size || record.redact) record = { ...record, redact: [...redact] };
    if (!manifest.local) this.scope = widenScope(this.scope, manifest);
    return this.execute({
      vault,
      choice,
      provider,
      record,
      pack,
      manifest,
      parts: [pack.part, ...(door?.lead ?? []), { type: "text" as const, text: message }],
      executor: tools?.executor ?? null,
      // Rule of Two (§13.4): vault text is private and untrusted at once.
      carriesVault: Boolean(door) || pack.refs.length > 0 || pack.dataClasses.length > 1 || Boolean(seen.active),
      // A message typed in the composer used the drafts; a door or a regression run leaves them for the next one.
      usedDrafts: !apart,
      skillState,
      ...(limits ? { limits } : {}),
    });
  }

  /**
   * One user turn to the model and back — streaming, stop, the run's record
   * and the ledger — for a message typed in the composer and for an action at
   * a selection alike. The context and its approval come in ready.
   */
  private async execute(input: {
    vault: AiVaultHost;
    choice: ModelChoice;
    provider: ProviderInfo;
    record: ConversationRecord;
    pack: ContextPackage;
    manifest: EgressManifest;
    parts: Part[];
    executor: ToolExecutor | null;
    carriesVault: boolean;
    usedDrafts: boolean;
    /** The skills of the run (plan KI-Harness P3): what the model loaded, for the measurement. */
    skillState?: SkillRunState;
    limits?: RunLimits;
  }): Promise<{ stop: RunStop; record: ConversationRecord; answer: string }> {
    const { vault, choice, provider, pack, manifest } = input;
    const now = this.host.now().toISOString();
    let record = input.record;
    const userTurn = record.conversation.turns.length;
    record = { ...record, conversation: appendTurn(record.conversation, { role: "user", parts: input.parts, at: now }), updatedAt: now };

    const controller = new AbortController();
    this.abort = controller;
    const toolLog: LedgerEntry["tools"] = [];
    // A message typed in the composer used the drafts; an action at a selection leaves them for the next one.
    const drafts = input.usedDrafts ? { draftPins: [], draftRedact: [], draftChoice: null, excludeActive: false, leaveOutNext: [], originalsNext: [] } : {};
    this.set({ active: record, ...drafts, notice: null, live: { conversationId: record.id, text: "", tools: [], steps: 0 } });

    const carriesVault = input.carriesVault;
    const result = await runAgent({
      conversation: record.conversation,
      egress: this.host.egress,
      endpoint: provider.endpoint,
      model: choice.model,
      executor: input.executor ?? { execute: async () => ({ content: "This conversation has no tools.", isError: true }) },
      context: { privateContext: carriesVault, untrustedContext: carriesVault },
      signal: controller.signal,
      ...(input.limits ? { limits: input.limits } : {}),
      cache: true,
      ...(provider.endpoint.api === "platform" ? { contextTokens: this.windowOf(provider, choice.model) ?? PLATFORM_CONTEXT_DEFAULT } : {}),
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
    // What the skills cost (gate "token cost of skill selection measurable"): the bound one, the loaded ones, the catalog.
    const instructions = record.instructions;
    const skillsUsed: NonNullable<RunMeta["skills"]> = [
      ...(instructions?.skill ? [{ id: instructions.skill.id, how: "bound" as const, tokens: instructions.skillTokens ?? 0 }] : []),
      ...(input.skillState?.loads ?? []).map((load) => ({ id: load.id, how: "loaded" as const, tokens: load.tokens })),
    ];
    const skillCatalogMeta = instructions?.catalog?.length ? { count: instructions.catalog.length, tokens: instructions.catalogTokens ?? 0 } : null;
    const skillTokens = skillsUsed.reduce((sum, s) => sum + s.tokens, 0) + (skillCatalogMeta?.tokens ?? 0);
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
      ...(skillsUsed.length ? { skills: skillsUsed } : {}),
      ...(skillCatalogMeta ? { skillCatalog: skillCatalogMeta } : {}),
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
          ...(skillsUsed.length ? { skills: [...new Set(skillsUsed.map((s) => s.id))] } : {}),
          ...(skillTokens ? { skillTokens } : {}),
        }),
      );
    } catch {
      // The answer stays on screen even when app data cannot be written.
    }
    const answer = lastAnswerText(result.conversation);
    if (this.vault !== vault) return { stop: result.stop, record, answer };
    const shown = this.state.active?.id === record.id || !this.state.active;
    this.set({
      active: shown ? record : this.state.active,
      live: null,
      notice: result.stop.kind === "answered" ? null : { conversationId: record.id, stop: result.stop },
      summaries: sortSummaries([conversationSummaryOf(record), ...this.state.summaries.filter((s) => s.id !== record.id)]),
    });
    return { stop: result.stop, record, answer };
  }

  private priceOf(choice: ModelChoice): { input: number; output: number } | undefined {
    return this.state.settings.prices[`${choice.providerId}/${choice.model}`] ?? this.state.tests[choice.providerId]?.models?.find((m) => m.id === choice.model)?.price;
  }
}
