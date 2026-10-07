import { withoutReadCursor, type ToolScope } from "./vaultTools";
import { APP_SKILL_SOURCES, appSkillOf, appSkillScenarios } from "./appSkills";
import type { InstructionApprovalStore, SkillTestStore, WebSettingsStore } from "./aiStores";
import { createWebExecutor, newRunWeb, webToolNames } from "./webTools";
import { createPrivateDataExecutor, newRunReading, readSomething, type QuarantineReader } from "./privateData";
import type { PreparedImage, PrepareFailure } from "./aiImage";
import { capturedNotePath, captureNote, captureStamp, withInheritedRules } from "./aiCapture";
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
import { draftedEntryContent, draftedNoteContent, EMPTY_WRITE_DRAFTS, type DraftCreator, type OpenProposal, type WriteDraftState, type WriteDraftStore } from "./aiWrites";
import { isWriteToolName, type PlanQuestion, type WriteRun } from "./writeTools";
import { bringsAddress, FILL_INSTRUCTION, FILL_LIMITS, fillColumnLine, isFillColumn, parseFillAnswer, type FillColumn } from "./aiFill";
import { FILTER_INSTRUCTION, FILTER_WORDS_LIMITS, filterSchemaLines, parseFilterAnswer, type FilterSchemaColumn } from "./aiBaseFilter";
import type { PropertyFilterRule } from "../base/filterExpr";
import { safeFileStem } from "../lib/fileStem";
import type { SuggestionChunk } from "../components/suggestMode";
import {
  addressOrigin,
  addUsage,
  AI_POLICY_DIMENSIONS,
  assistantAuthorId,
  withoutWriteDraft,
  withWriteDraft,
  withWriteDraftOutcome,
  type RunWrites,
  type WriteDraft,
  type WriteDraftBody,
  calledToolName,
  dispatchedArgs,
  allowHost,
  approveInstruction,
  approveToolData,
  blockingProblems,
  checkWebUrl,
  DEFAULT_RUN_LIMITS,
  DEFAULT_WEB_SETTINGS,
  EFFECT_DECLINED,
  disallowHost,
  META_TOOL_NAMES,
  toolDataApproved,
  hasWebTools,
  skillNamesWeb,
  hostAllowed,
  knownAddresses,
  mergeCandidates,
  normalizeAllowedHost,
  rankCandidates,
  searchQuery,
  searchSupported,
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
  goingKinds,
  parseToolInput,
  redactSensitive,
  SENSITIVE_KINDS,
  sensitiveFindings,
  sensitiveKinds,
  toolByName,
  withholdDeniedLinks,
  withholdPlaces,
  IMAGE_MAX_BYTES,
  imageLead,
  imageRoute,
  imagesOf,
  imageTokens,
  isAiHiddenPath,
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
  type AiPolicyDimension,
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
  type ManifestSource,
  type SensitiveKind,
  WRITE_REFUSALS,
  type EgressRecipient,
  type LedgerEntry,
  type ModelChoice,
  type ModelFailure,
  type ModelInfo,
  type PackageGists,
  type Part,
  type TextPart,
  type ImagePart,
  type ProviderInfo,
  type RunMeta,
  type RunStop,
  type ScopeGrowth,
  type SituationInput,
  type ToolExecutor,
  type AddressOrigin,
  type RunReading,
  type RunWeb,
  type ToolCallPart,
  type ToolManifest,
  type WebFetcher,
  type WebSettings,
  asMcpError,
  isMcpExposedToolName,
  mcpPromptText,
  mcpRecipient,
  mcpServerStanding,
  RUN_READ_CAP,
  type GateRun,
  type McpToolEffect,
  type RunMcp,
} from "@plainva/core";
import { AiAcp, type AcpVaultSide, type AiAcpHost, type AiAcpState } from "./acpSession";
import { AiMcp, type AiMcpHost, type AiMcpState, type McpPromptReview, type McpPromptStart } from "./mcpSession";
import type { McpPromptLook } from "./mcpRuntime";
import type { McpVaultStore } from "./mcpStores";
import { createMcpExecutor, newRunMcp, type McpCallQuestion } from "./mcpTools";

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
  /**
   * The shell's native page fetch (plan KI-Harness P4): the desktop's
   * `ai_web_fetch`, the phone's `AiWeb` plugin. Absent, no page is read.
   */
  web?: WebFetcher;
  /**
   * Foreign MCP servers (plan KI-Harness P4.5): the shell's native side — the
   * registry behind a native dialog, the credentials, the requests and the
   * programs — and the device's record of what was approved. Absent, there
   * are no foreign servers in this shell.
   */
  mcp?: AiMcpHost;
  /**
   * External agents (plan KI-Harness P4.6): the shell's native side — the
   * registry behind a native dialog, the start of an agent's program in the
   * vault's folder, the terminal of its sign-in — and the device's record of
   * agents. Absent, this shell hosts no agents (a phone starts no programs).
   */
  acp?: AiAcpHost;
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
  /**
   * The tools of a run for this recipient, optionally narrowed (the MCP
   * server's clients); null when this vault offers none. `web`: the run also
   * carries tools that reach the internet, so a note whose rules say
   * `web: deny` does not exist for these tools either. `more`: the further
   * tools this shell can serve, reached through the tool search (ADR 0019);
   * `narrowed` tells that search what a skill the model loaded leaves;
   * `foreign` are the tools of foreign servers this run may find there too
   * (plan P4.5). `writing`: what the run brings to the writing tools — who
   * signs, how the user is asked, where a draft goes (plan P5); without it
   * they answer that this vault takes no changes here.
   */
  tools(
    recipient: EgressRecipient,
    scope?: ToolScope,
    redact?: ReadonlySet<string>,
    web?: boolean,
    narrowed?: () => readonly string[] | null,
    foreign?: () => readonly ToolManifest[],
    writing?: WriteRun,
  ): { names: readonly string[]; more?: readonly string[]; executor: ToolExecutor } | null;
  /** Whether the AI may use the internet in this vault, and the sites it need not ask for (plan P4); absent, it may not. */
  web?: WebSettingsStore;
  /** This vault's choices about foreign MCP servers (plan P4.5): which it uses, and what each may be called with. Absent, it uses none. */
  mcp?: McpVaultStore;
  /** What an external agent's session needs of this vault (plan P4.6): its folder, its files under its rules, its margin. Absent, no agent is started here. */
  agents?: AcpVaultSide;
  /** Gives a note its own rule "never to the cloud" (View context, "only on this device"). */
  keepOnDevice?(path: string): Promise<void>;
  /** Checked gists of the model on this computer (plan P2b-3), read when a message is built; null while there are none. */
  gists?(): PackageGists | null;
  /**
   * Where an answer kept as a note is written (plan P4-6): `folder` names the
   * vault's inbox folder, `write` puts the note there under a free name —
   * through the vault's adapters, so it is indexed, synced and backed up like
   * a note the user made — and returns its path. Absent where the shell
   * cannot write notes.
   */
  capture?: { folder(): Promise<string>; write(folder: string, stem: string, content: string): Promise<string> };
  /**
   * The notes that embed a file (plan P4-5): their rules decide whether a
   * picture may go to a cloud. `null` when that cannot be found out — which
   * is not "none", and neither is a host that cannot be asked at all: either
   * way the picture stays on the device.
   */
  embedders?(path: string): Promise<string[] | null>;
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
  /** The drafts of this vault on this device (plan KI-Harness P5): what an assistant wants to exist, until the user decides. */
  drafts?: WriteDraftStore;
  /** How this shell makes what a draft describes — a note, a task, a line in the journal — through the app's own ways. Absent where it cannot. */
  creates?: DraftCreator;
  /** The notes that carry open suggestions of a machine, from the vault's comments (plan P5); absent where the shell cannot list them. */
  proposals?(): Promise<OpenProposal[]>;
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
 * A picture of the vault to explain (plan P4-5, §10.7): where it stands, and
 * how to get it ready. `load` is called only once the rules let the picture
 * go to the chosen model — nothing is read or drawn for a picture that stays.
 */
export interface ImageRequest {
  path: string;
  /** The note it is embedded in, where the door stood on an embed: that note's rules decide too. */
  notePath?: string;
  load(): Promise<PreparedImage | PrepareFailure>;
}

export type ImageOutcome =
  | { kind: "answered"; conversationId: string }
  | {
      kind: "refused";
      /**
       * `no-route`: the chosen model's protocol has no place for a picture (a model of the system).
       * `denied`: the rules keep the picture, or a note that shows it, from this model.
       * `unchecked`: which notes show the picture could not be found out, so it stays.
       */
      reason: "off" | "no-model" | "no-route" | "busy" | "denied" | "unchecked" | "unreadable" | "too-large" | "cancelled" | "failed";
      provider?: string;
      /** Set once a conversation exists: it shows the question and why no answer came. */
      conversationId?: string;
      message?: string;
    };

/** How "Keep as a note" under an answer ended (plan P4-6). */
export type CaptureOutcome =
  /** `inherited`: the rules written into the note because what the answer rests on carries them. */
  | { kind: "captured"; path: string; title: string; inherited?: AiPolicyDimension[] }
  | {
      kind: "refused";
      /** `nothing`: the run has no answer to keep. `unavailable`: this shell writes no notes. `cancelled`: the user said no to a note other people read. */
      reason: "off" | "nothing" | "unavailable" | "busy" | "cancelled" | "failed";
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

/**
 * A step of a run that waits for the user.
 *
 * `fetch`, `search` — one request to the internet (plan KI-Harness P4, the
 * Rule of Two): it carries everything that would leave the device for it —
 * the whole address, or the search words — and, for an address, where it
 * came from.
 *
 * `data` — a kind of data no send overview named (plan P4-4): mail, reached
 * through the tool search. Asked at its first call, once for a recipient in
 * a session. It says who reads the raw text: a model on this device, or the
 * conversation's provider.
 */
export type EffectRequest =
  | { id: string; kind: "fetch"; url: string; host: string; question: string; origin: AddressOrigin }
  | { id: string; kind: "search"; query: string; provider: string }
  | { id: string; kind: "data"; dataClass: "mail"; tool: string; provider: string; reader: "provider" | "device"; readerLabel: string }
  /**
   * `write` — a note about to be written where other people read it (plan
   * P4-6, §12.1 "a write into a place third parties read"): an answer kept as
   * a note inside a shared workspace. Asked each time; `always` means yes.
   */
  | { id: string; kind: "write"; audience: "members"; title: string; folder: string }
  /**
   * `mcp` — one call to a tool of a foreign server (plan P4.5, §17.2 "before
   * every call visible: server, tool, data"). `server` is the user's name for
   * it, `args` the arguments in full, as they would go. Asked for every call:
   * there is no "from now on", and `always` means this once. `effect`: what the
   * call can do at the service as the approved listing says it (plan P5-6) —
   * a call that may change something there is asked about in other words.
   */
  | { id: string; kind: "mcp"; serverId: string; server: string; tool: string; title: string; args: string; effect: McpToolEffect }
  /**
   * `plan` — what cannot be reviewed part by part (plan P5, ADR 0019 §2): a
   * rename with the notes whose links change, a move, a deletion. The run
   * waits. A yes lets the app's own operation do it; for a deletion it opens
   * the app's delete dialog, and that one decides. Asked every time: `always`
   * means this once.
   */
  | { id: string; kind: "plan"; question: PlanQuestion };

/**
 * The user's answer. To a request to the internet: this once, from now on for
 * pages of this site that a source named, or not at all. To a kind of data:
 * `always` allows it for this recipient until the app closes.
 */
export type EffectAnswer = "once" | "always" | "deny";

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
  /** `declined`: the user said no to this call (a page, a search) — an answer, not a failure. */
  tools: { id: string; name: string; state: "running" | "done" | "failed" | "declined" }[];
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
  /**
   * The last run's end, when it ended in a way the reader must see. `related`:
   * when no answer came back, the notes that match the question best (plan
   * §19.4) — found on this device, shown on this device.
   */
  notice: { conversationId: string; stop: RunStop; related?: { path: string; title: string }[] } | null;
  dress: AiDress | null;
  /** A vault is attached (AI v1 runs only where a vault is open). */
  hasVault: boolean;
  /**
   * The send overview waiting for the user's answer (plan §13.3): shown before
   * the first request of the session and whenever the scope grows. `images`:
   * the pictures the request would carry, exactly as they would go (plan
   * P4-5). `blind`: the provider's own list says this model reads none.
   */
  consent: { manifest: EgressManifest; growth: ScopeGrowth[]; images?: readonly ImagePart[]; blind?: boolean } | null;
  skills: AiSkillsState;
  skillTests: AiSkillTestsState;
  /** The vault's internet settings on this device (plan KI-Harness P4): off until the user decides. */
  web: WebSettings;
  /** The next new conversation starts with the internet. Chosen per conversation, never kept as a default. */
  draftWeb: boolean;
  /** A page or a search waiting for the user's answer. */
  effect: EffectRequest | null;
  /** The foreign MCP servers of this device as they stand for this vault (plan P4.5): what the settings show. */
  mcp: AiMcpState;
  /** The external agents of this device and the session one of them has in this vault (plan P4.6). */
  agents: AiAcpState;
  /** The drafts that wait in this vault on this device, and what became of earlier ones (plan P5). */
  drafts: WriteDraftState;
  /** A column of a database being filled right now (plan P5-4): which, and how far the run is. */
  fill: FillProgress | null;
}

/** A column to fill (plan KI-Harness P5-4): the database, the column, and the entries that say nothing in it. */
export interface FillRequest {
  /** The database's `.base` file — what the progress line is shown at. */
  base: string;
  column: FillColumn;
  /** The entries to fill, in the view's order; a run takes the first `FILL_LIMITS.rows` of them. */
  rows: readonly { path: string; title: string }[];
}

export interface FillProgress {
  base: string;
  column: string;
  label: string;
  done: number;
  total: number;
}

export type FillOutcome =
  /**
   * The run is over. `proposed`: values laid on their notes. `silent`: notes
   * that do not say it. `kept`: notes the rules keep from this model, or that
   * are gone — not read. `failed`: answers that were no value, requests that
   * failed, proposals a note did not take. `stopped`: the user ended it early.
   */
  | { kind: "done"; proposed: number; silent: number; kept: number; failed: number; stopped: boolean; provider: string; model: string; failure?: ModelFailure }
  | { kind: "refused"; reason: "off" | "no-model" | "busy" | "encrypted" | "unfit" | "nothing" | "kept" | "cancelled" };

/** A sentence to turn into filter rules (plan KI-Harness P5-4): the database and its columns — nothing of its entries. */
export interface FilterWordsRequest {
  base: string;
  words: string;
  columns: readonly FilterSchemaColumn[];
}

export type FilterWordsOutcome =
  | { kind: "rules"; logic: "all" | "any"; rules: PropertyFilterRule[]; model: string }
  /** `none`: the model says the sentence cannot be said with these columns. `invalid`: its answer was no filter. */
  | { kind: "refused"; reason: "off" | "no-model" | "busy" | "empty" | "denied" | "cancelled" | "none" | "invalid" | "failed"; failure?: ModelFailure; provider?: string; model?: string };

/** How "Create" on a draft ended (plan P5). */
export type DraftOutcome =
  | { kind: "created"; path: string }
  /**
   * `unavailable`: this shell cannot make that kind of thing. `gone`: the draft is not there any more.
   * `no-entry-folder`: the database an entry was drafted for has no folder for new entries (yet, or any more).
   */
  | { kind: "refused"; reason: "off" | "unavailable" | "gone" | "busy" | "failed" | "no-entry-folder"; message?: string };

type Listener = () => void;

/** What the user typed in a conversation so far: their own words, without the context the app put beside them. */
function userTextsOf(conversation: ConversationRecord["conversation"]): string[] {
  return conversation.turns.flatMap((turn) => (turn.role === "user" ? turn.parts.flatMap((part) => (part.type === "text" && !part.context ? [part.text] : [])) : []));
}

/** The time of day as the journal writes it: HH:mm. */
function clockOf(now: Date): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

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
  /** The further tools it reaches through the tool search (ADR 0019); empty where it has no dispatcher. */
  more: string[];
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
  /** What the door brings, before the user's words — fenced where it is not the user's own; a picture, for "Explain image". */
  lead: (TextPart | ImagePart)[];
  /** Names in the send overview what `lead` carries. */
  disclose(manifest: EgressManifest): EgressManifest;
  limits?: RunLimits;
  /** The provider's own list says the chosen model reads no pictures (plan P4-5): the overview says so, and sends all the same. */
  blind?: boolean;
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

/** How many notes a run that got no answer shows instead (plan §19.4). */
const RELATED_ON_FAILURE = 6;

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
    // A call through the dispatcher counts as the tool it meant.
    for (const part of turn.parts) if (part.type === "tool_result") calls.push({ name: part.tool ?? part.name, ok: !part.isError });
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
  /** Ends the run that fills a column, between two of its entries. */
  private fillAbort: AbortController | null = null;
  /** A sentence is on its way to become filter rules. */
  private filtering = false;
  /** An answer is being kept as a note right now. */
  private capturing = false;
  /** What the user approved in this app session (E25); a server on this computer needs none. */
  private scope: ApprovedScope | null = null;
  private consentAnswer: ((answer: ConsentAnswer) => void) | null = null;
  /** The request to the internet that waits for an answer, if one does. */
  private effectAnswer: ((answer: EffectAnswer) => void) | null = null;
  /** The lane of changes to the list of drafts (plan P5). */
  private draftLane: Promise<unknown> = Promise.resolve();
  private creatingDraft = false;
  /** Conversations on screen right now: the places where the send overview can be answered. */
  private surfaces = 0;
  /** How the shell puts a conversation on screen (the companion, the AI sheet). */
  private reveal: (() => void) | null = null;
  /** Foreign MCP servers (plan P4.5): what the settings drive, and what a run asks before it calls one. */
  readonly mcp: AiMcp;
  /** External agents (plan P4.6): the agents of this device, and the session one has in the open vault. */
  readonly agents: AiAcp;

  constructor(private readonly host: AiSessionHost) {
    this.mcp = new AiMcp(host.mcp, { now: () => host.now(), newId: () => host.newId() }, (mcp) => this.set({ mcp }));
    this.agents = new AiAcp(host.acp, { now: () => host.now() }, (key, vars) => host.label?.(key, vars) ?? key, (agents) => this.set({ agents }));
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
      web: DEFAULT_WEB_SETTINGS,
      draftWeb: false,
      effect: null,
      mcp: this.mcp.state,
      agents: this.agents.state,
      drafts: EMPTY_WRITE_DRAFTS,
      fill: null,
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
      // Another vault's switch says nothing about this one: off until its own settings are read.
      web: DEFAULT_WEB_SETTINGS,
      draftWeb: false,
      // Another vault's drafts are not this one's.
      drafts: EMPTY_WRITE_DRAFTS,
      // A column that was being filled belongs to the vault that is gone; its run ends with its next entry.
      fill: null,
    });
    this.fillAbort?.abort();
    // The same for foreign servers: which this vault uses is its own choice, and the connections of the last one end here.
    this.mcp.attach(vault?.mcp ?? null);
    // And for an external agent: its session belongs to the vault it was started in, and ends with it.
    this.agents.attach(vault?.agents ?? null);
    if (!vault) return;
    void this.refreshSkills();
    void this.loadWebSettings(vault);
    void this.loadDrafts(vault);
    const summaries: ConversationSummary[] = await vault.conversations.list().catch(() => []);
    const old = expiredConversations(summaries, this.state.settings.historyDays, this.host.now());
    for (const id of old) await vault.conversations.remove(id).catch(() => undefined);
    if (this.vault !== vault) return;
    this.set({ summaries: sortSummaries(summaries.filter((s) => !old.includes(s.id))) });
  }

  async open(id: string): Promise<void> {
    const vault = this.vault;
    if (!vault || this.state.live) return;
    this.dropWriteQuestion();
    const record = await vault.conversations.load(id);
    if (record && this.vault === vault) this.set({ active: record, excludeActive: false, notice: null });
  }

  newConversation(): void {
    if (this.state.live) return;
    this.dropWriteQuestion();
    this.set({ active: null, excludeActive: false, draftPins: [], draftRedact: [], draftChoice: null, draftWeb: false, notice: null });
  }

  /**
   * The question before an answer is kept where others read (plan P4-6) is
   * about the conversation on screen. Leaving that conversation is a no: the
   * card does not stay behind over another one.
   */
  private dropWriteQuestion(): void {
    if (this.state.effect?.kind === "write") this.settleEffect("deny");
  }

  // ----------------------------------------------------------------- drafts

  private async loadDrafts(vault: AiVaultHost): Promise<void> {
    const drafts = vault.drafts ? await vault.drafts.load().catch(() => EMPTY_WRITE_DRAFTS) : EMPTY_WRITE_DRAFTS;
    if (this.vault === vault) this.set({ drafts });
  }

  /** One change at a time on the list of drafts — read, change, write —, so two drafts of one run both land. */
  private changeDrafts(vault: AiVaultHost, change: (state: WriteDraftState) => WriteDraftState | null): Promise<WriteDraftState | null> {
    const work = this.draftLane
      .catch(() => undefined)
      .then(async () => {
        if (!vault.drafts) return null;
        const next = change(await vault.drafts.load());
        if (!next) return null;
        await vault.drafts.save(next);
        if (this.vault === vault) this.set({ drafts: next });
        return next;
      });
    this.draftLane = work;
    return work;
  }

  /**
   * Leaves a draft in a vault's list (plan KI-Harness P5): something an
   * assistant wants to exist. Nothing is created; the list never drops a
   * waiting draft to make room, so the writer hears when it is full.
   */
  async leaveDraft(vault: AiVaultHost, draft: WriteDraft): Promise<{ ok: true; id: string } | { ok: false; problem: "full" | "invalid" }> {
    let problem: "full" | "invalid" = "invalid";
    const next = await this.changeDrafts(vault, (state) => {
      const added = withWriteDraft(state.drafts, draft);
      if (!added.ok) {
        problem = added.problem === "full" ? "full" : "invalid";
        return null;
      }
      return { ...state, drafts: added.drafts };
    }).catch(() => null);
    return next ? { ok: true, id: draft.id } : { ok: false, problem };
  }

  /**
   * What a writer outside every conversation brings to the writing tools
   * (plan KI-Harness P5-5): a program at Plainva's own MCP server. It signs
   * with its own id and the name the user knows it by. Nothing the user typed
   * is known here, so every address it brings is written inert. A draft of it
   * belongs to no conversation and rests on nothing the device could name.
   * How the user is asked about a plan is the caller's — the round trip of its
   * protocol —, never a card above a composer nobody is looking at.
   *
   * Such a writer reads as a cloud that may reach the internet: a note under
   * either rule does not exist for it, so nothing it read carries a rule that
   * the place of a proposal could lack.
   */
  outsideWriting(vault: AiVaultHost, author: SuggestionAuthor, ask: WriteRun["ask"]): WriteRun {
    return {
      author,
      userTexts: () => [],
      inherited: async () => [],
      draft: (input) =>
        this.leaveDraft(vault, {
          id: `d-${this.host.newId()}`,
          createdAt: this.host.now().toISOString(),
          author: { id: author.id, label: author.displayName },
          conversationId: null,
          title: input.title,
          body: input.body,
          inherited: [],
          sources: [],
          defused: input.defused,
        }),
      ask,
      writes: { rounds: [], drafts: [], plans: [] },
      today: () => this.host.today(),
      clock: () => clockOf(this.host.now()),
    };
  }

  /** Whether a draft can be created here: the shell makes notes, tasks and journal lines, and the AI is on. */
  canCreateDrafts(): boolean {
    return Boolean(this.state.settings.enabled && this.vault?.creates && this.vault.drafts);
  }

  /**
   * The provider list a task made from a draft can also be created in, by its
   * name; null where the task database names none. The card asks with it, the
   * way the capture field does — without a name there is nothing to ask.
   */
  async draftTaskList(): Promise<string | null> {
    const list = this.vault?.creates?.taskList;
    return list ? list().catch(() => null) : null;
  }

  /**
   * "Create" on a draft (plan P5): the app makes what the draft describes,
   * through its own way of making that kind of thing — the user's own step,
   * never a model's. A note is stamped with who wrote it and takes over the
   * rules of what it rests on, where the place it lands in would allow more.
   * A task goes to its provider list as well only with `atProvider` — the
   * chip on its card, as on the capture field. The draft is gone once the
   * thing exists; what became of it is kept.
   */
  async createDraft(id: string, choice: { atProvider?: boolean } = {}): Promise<DraftOutcome> {
    const refused = (reason: Extract<DraftOutcome, { kind: "refused" }>["reason"], message?: string): DraftOutcome => ({ kind: "refused", reason, ...(message ? { message } : {}) });
    const vault = this.vault;
    if (!this.state.settings.enabled || !vault) return refused("off");
    const creates = vault.creates;
    if (!creates || !vault.drafts) return refused("unavailable");
    if (this.creatingDraft) return refused("busy");
    const draft = this.state.drafts.drafts.find((candidate) => candidate.id === id);
    if (!draft) return refused("gone");
    const body = draft.body;
    this.creatingDraft = true;
    try {
      let path: string;
      if (body.kind === "note") {
        // A draft that names its own file is another writer's (an agent, a program): not made here yet.
        if (body.path) return refused("unavailable");
        const stem = safeFileStem(draft.title) ?? "Note";
        const denied = creates.placeDenies ? await creates.placeDenies(body.folder, stem).catch(() => []) : [];
        const rules = draft.inherited.filter((dimension) => !denied.includes(dimension));
        path = await creates.note({ folder: body.folder, stem, content: draftedNoteContent(draft, this.host.now(), rules) });
      } else if (body.kind === "task") {
        // Also at the provider list the task database names — only where the user left that on, on the card.
        path = await creates.task({ text: body.text, day: body.day, atProvider: choice.atProvider === true });
      }
      else if (body.kind === "journal") path = await creates.journal({ text: body.text, day: body.day, time: body.time, task: body.task });
      else {
        // An entry of a database is a note in the folder the database keeps its entries in (plan P5-4): the shell says
        // where that is and what an entry carries there; without a folder there is nowhere to make it yet.
        if (!creates.entryPlace) return refused("unavailable");
        const place = await creates.entryPlace(body.base);
        // The draft stays: the user chooses the folder with the database's first entry and creates it then.
        if (!place) return refused("no-entry-folder");
        const stem = safeFileStem(draft.title) ?? "Entry";
        const denied = creates.placeDenies ? await creates.placeDenies(place.folder, stem).catch(() => []) : [];
        const rules = draft.inherited.filter((dimension) => !denied.includes(dimension));
        path = await creates.note({ folder: place.folder, stem, content: draftedEntryContent(draft, this.host.now(), rules, place) });
      }
      const at = this.host.now().toISOString();
      await this.changeDrafts(vault, (state) => ({
        drafts: withoutWriteDraft(state.drafts, id),
        done: withWriteDraftOutcome(state.done, { id, kind: body.kind, title: draft.title, outcome: "created", path, at }),
      })).catch(() => null);
      return { kind: "created", path };
    } catch (error) {
      return refused("failed", error instanceof Error ? error.message : String(error));
    } finally {
      this.creatingDraft = false;
    }
  }

  /** "Discard" on a draft: it is gone, and its conversation can still say that it was. */
  async discardDraft(id: string): Promise<void> {
    const vault = this.vault;
    const draft = this.state.drafts.drafts.find((candidate) => candidate.id === id);
    if (!vault || !draft) return;
    const at = this.host.now().toISOString();
    await this.changeDrafts(vault, (state) => ({
      drafts: withoutWriteDraft(state.drafts, id),
      done: withWriteDraftOutcome(state.done, { id, kind: draft.body.kind, title: draft.title, outcome: "discarded", at }),
    })).catch(() => null);
  }

  /** The notes that carry open proposals of a machine (plan P5): what the list of everything that waits shows beside the drafts. */
  async openProposals(): Promise<OpenProposal[]> {
    const vault = this.vault;
    return vault?.proposals ? vault.proposals().catch(() => []) : [];
  }

  /** A plan of a run, asked above the composer like every question of a run; without a run there is nobody to ask. */
  private async askPlan(question: PlanQuestion, callId?: string): Promise<"yes" | "no" | "nobody"> {
    const signal = this.abort?.signal;
    if (!signal) return "nobody";
    // Under the call's own id where there is one: while the question stands, no step claims to be running.
    const answer = await this.askEffect({ id: callId ?? `plan-${this.host.newId()}`, kind: "plan", question }, signal);
    return answer === "deny" ? "no" : "yes";
  }

  // -------------------------------------------------------- foreign servers

  /**
   * Starts a prompt of a foreign server (plan KI-Harness P4.5). A prompt is a
   * text a server wrote that becomes the user's message, so it is checked at
   * the moment it is used: the expansion that was approved goes at once; one
   * nobody approved yet comes back for the user to read first
   * (`sendMcpPrompt` sends it); one that differs from the approved one blocks
   * the server, and nothing is sent.
   */
  async startMcpPrompt(serverId: string, name: string, args: Readonly<Record<string, string>>): Promise<McpPromptStart> {
    const vault = this.vault;
    if (!vault || this.state.live || !this.state.settings.enabled) return { kind: "unavailable" };
    const server = (await this.mcp.servers().catch(() => [])).find((entry) => entry.id === serverId);
    if (!server || mcpServerStanding(server) !== "ready" || !server.snapshot?.prompts.some((prompt) => prompt.name === name)) return { kind: "unavailable" };
    // The listing again before the server is asked for a text: a server that changed is blocked here already.
    const check = await this.mcp.check(serverId);
    if (!check.ok) return check.reason === "failed" ? { kind: "failed", failure: check.failure } : { kind: check.reason === "blocked" ? "blocked" : "unavailable" };
    let look: McpPromptLook;
    try {
      look = await this.mcp.prompt(serverId, name, args);
    } catch (error) {
      return { kind: "failed", failure: asMcpError(error).failure };
    }
    if (this.vault !== vault) return { kind: "unavailable" };
    if (look.standing === "changed") return { kind: "blocked" };
    const { text, dropped, truncated } = mcpPromptText(look.body);
    if (!text) return { kind: "empty" };
    if (look.standing === "unpinned") return { kind: "review", review: { serverId, server: server.label, name, key: look.key, body: look.body, text, dropped, truncated } };
    await this.send(text);
    return { kind: "sent" };
  }

  /** The user read what a server's prompt expanded to, and sends it: from now on this expansion is the approved one. */
  async sendMcpPrompt(review: McpPromptReview): Promise<void> {
    if (!this.vault || this.state.live) return;
    await this.mcp.pinPrompt(review.serverId, review.key, review.body);
    await this.send(review.text);
  }

  // --------------------------------------------------------------- internet

  private async loadWebSettings(vault: AiVaultHost): Promise<void> {
    const web = vault.web ? await vault.web.load().catch(() => DEFAULT_WEB_SETTINGS) : DEFAULT_WEB_SETTINGS;
    if (this.vault === vault) this.set({ web, draftWeb: this.state.draftWeb && web.enabled });
  }

  private async saveWebSettings(next: WebSettings): Promise<void> {
    const vault = this.vault;
    if (!vault?.web) return;
    this.set({ web: next, draftWeb: this.state.draftWeb && next.enabled });
    await vault.web.save(next);
  }

  /**
   * Lets the AI use the internet in this vault on this device, or no longer
   * (plan KI-Harness P4). Off is immediate: a conversation that carries the
   * web tools keeps them, and every call of them answers that it is off.
   */
  async setWebEnabled(enabled: boolean): Promise<void> {
    if (!enabled) this.settleEffect("deny");
    await this.saveWebSettings({ ...this.state.web, enabled });
  }

  /** Adds a site whose pages need no asking; false when what was typed names none. */
  async allowWebHost(raw: string): Promise<boolean> {
    if (!normalizeAllowedHost(raw)) return false;
    const next = allowHost(this.state.web, raw);
    if (next !== this.state.web) await this.saveWebSettings(next);
    return true;
  }

  async disallowWebHost(host: string): Promise<void> {
    const next = disallowHost(this.state.web, host);
    if (next !== this.state.web) await this.saveWebSettings(next);
  }

  /**
   * What a new conversation with the model chosen now could do on the
   * internet; null where it could do nothing — the vault's switch is off, the
   * model takes no tools, or neither reading nor searching exists here.
   */
  webOffer(): { fetch: boolean; search: boolean } | null {
    const choice = this.choice();
    const provider = choice ? providerById(choice.providerId, this.state.settings.custom) : undefined;
    if (!this.vault || !this.state.web.enabled || !provider || provider.endpoint.api === "platform") return null;
    const names = webToolNames(this.host.web ?? null, provider.endpoint);
    return names.length ? { fetch: names.includes("fetch_url"), search: names.includes("web_search") } : null;
  }

  /** Starts the next new conversation with the internet, or without. An open conversation keeps what it started with. */
  setDraftWeb(on: boolean): void {
    if (this.state.active) return;
    this.set({ draftWeb: on && this.state.web.enabled });
  }

  /** The user's answer to a page or a search that waits. */
  answerEffect(answer: EffectAnswer): void {
    this.settleEffect(answer);
  }

  private settleEffect(answer: EffectAnswer): void {
    const settle = this.effectAnswer;
    this.effectAnswer = null;
    if (this.state.effect) this.set({ effect: null });
    settle?.(answer);
  }

  private askEffect(request: EffectRequest, signal: AbortSignal): Promise<EffectAnswer> {
    this.settleEffect("deny");
    return new Promise((resolve) => {
      if (signal.aborted) return resolve("deny");
      // STOP is a "no" to whatever waits.
      const onAbort = () => this.settleEffect("deny");
      signal.addEventListener("abort", onAbort, { once: true });
      this.effectAnswer = (answer) => {
        signal.removeEventListener("abort", onAbort);
        resolve(answer);
      };
      this.set({ effect: request });
      // Asked while no conversation is on screen: the shell shows one, or nobody could answer.
      if (this.surfaces === 0) this.reveal?.();
    });
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
   *
   * `further`: the tools the shell serves beyond a conversation's own list
   * (ADR 0019). An open conversation reaches them through the tool search —
   * `find_tools` and `call_tool` join its list. A conversation bound to a
   * skill has no search: it carries exactly the tools its skill leaves, the
   * further ones among them — which is what the workshop showed when the
   * skill was approved (`SKILL_TOOL_NAMES`).
   */
  private conversationStart(entries: readonly InstructionEntry[], offered: readonly string[], bind?: string, further: readonly string[] = []): ConversationStart {
    const prompt: ConversationStart["prompt"] = {};
    const instructions: ConversationInstructions = {};
    const agents = entries.find((e) => e.source.kind === "agents" && e.status === "active" && e.source.text);
    if (agents?.source.text) {
      prompt.vaultInstructions = agents.source.text;
      instructions.vaultTokens = estimateTokens(agents.source.text);
    }
    const result = (tools: string[], more: string[] = []): ConversationStart => ({ tools, more, prompt, instructions: Object.keys(instructions).length ? instructions : null });
    const bound = bind ? entries.find((e) => e.source.id === bind && e.status === "active" && e.source.skill) : undefined;
    if (bound?.source.skill) {
      const skill = bound.source.skill;
      const grant = skillGrant(skill, [...offered, ...further.filter((name) => !offered.includes(name))], DEFAULT_RUN_LIMITS.maxOutputTokens);
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
    // Further tools need the two that reach them — and something to reach.
    const more = offered.length ? further.filter((name) => !offered.includes(name)) : [];
    const own = more.length ? [...offered, ...META_TOOL_NAMES] : [...offered];
    const catalog = offered.length ? skillCatalog(entries) : null;
    if (catalog?.entries.length) {
      prompt.skillCatalog = catalog.text;
      instructions.catalog = catalog.entries.map((e) => ({ key: e.key, id: e.id, origin: e.id.startsWith("plainva:") ? ("plainva" as const) : ("vault" as const) }));
      instructions.catalogTokens = catalog.tokens;
      return result([...own, "use_skill"], more);
    }
    return result(own, more);
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
    if (this.state.active?.id === id) this.dropWriteQuestion();
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
  private recordTranscription(vault: AiVaultHost, choice: ModelChoice, usage: ConversationUsage, failure?: string): Promise<void> {
    return this.recordRequests(vault, choice, { id: `transcript-${this.host.newId()}`, usage, steps: 1, stop: failure ? "failed" : "answered", ...(failure ? { failure } : {}) });
  }

  /** Requests that belong to no conversation, in the run ledger: usage and cost count like any request's. */
  private async recordRequests(vault: AiVaultHost, choice: ModelChoice, run: { id: string; usage: ConversationUsage; steps: number; stop: string; failure?: string }): Promise<void> {
    const costUsd = usageCostUsd(run.usage, this.priceOf(choice));
    try {
      const ledger = await vault.ledger.load();
      await vault.ledger.save(
        appendAiLedgerEntry(ledger, {
          at: this.host.now().toISOString(),
          conversationId: run.id,
          providerId: choice.providerId,
          model: choice.model,
          stop: run.stop,
          steps: run.steps,
          tools: [],
          usage: run.usage,
          ...(costUsd !== undefined ? { costUsd } : {}),
          ...(run.failure ? { failure: run.failure } : {}),
        }),
      );
    } catch {
      // What the request brought still goes where it belongs when app data cannot be written.
    }
  }

  /**
   * One request without tools and without a conversation of its own: fixed
   * sentences as the instruction, the parts as the message. What the parts
   * carry of the vault is fenced by whoever built them.
   */
  private async askOnce(
    provider: ProviderInfo,
    choice: ModelChoice,
    instruction: string,
    parts: TextPart[],
    maxOutputTokens: number,
    signal?: AbortSignal,
  ): Promise<{ stop: RunStop; answer: string; usage: ConversationUsage }> {
    const conversation = appendTurn(startConversation(`once-${this.host.newId()}`, instruction, []), { role: "user", parts, at: this.host.now().toISOString() });
    const result = await runAgent({
      conversation,
      egress: this.host.egress,
      endpoint: provider.endpoint,
      model: choice.model,
      executor: { execute: async () => ({ content: "No tools.", isError: true }) },
      context: { privateContext: true, untrustedContext: true },
      limits: { maxSteps: 1, maxToolCalls: 0, maxOutputTokens },
      ...(provider.endpoint.api === "platform" ? { contextTokens: this.windowOf(provider, choice.model) ?? PLATFORM_CONTEXT_DEFAULT } : {}),
      ...(signal ? { signal } : {}),
      newRequestId: () => `ai-${this.host.newId()}`,
      now: () => this.host.now().toISOString(),
    });
    return { stop: result.stop, answer: result.stop.kind === "answered" ? lastAnswerText(result.conversation) : "", usage: addUsage(EMPTY_USAGE, result.usage) };
  }

  /**
   * Fills one column of a database (plan P5-4): for each entry that says
   * nothing in it, the model a new conversation would get reads that entry's
   * note — one note per request, nothing of another — and what it answers is
   * laid on the note as a proposed value, through the tool every proposed
   * value takes. Nothing is written; the values wait in the database's cells
   * until someone decides them.
   *
   * The run asks once, before its first request, with everything it would
   * send in one overview: a note left out there is not part of the run, and
   * one redacted there goes redacted. A note the rules keep from this model
   * is never read, and counts as kept. A request that fails ends the run —
   * the next one would fail the same way —, with what was laid down so far.
   */
  async fillProperty(request: FillRequest): Promise<FillOutcome> {
    const refused = (reason: Extract<FillOutcome, { kind: "refused" }>["reason"]): FillOutcome => ({ kind: "refused", reason });
    const vault = this.vault;
    if (!this.state.settings.enabled || !vault) return refused("off");
    if (vault.encrypted?.()) return refused("encrypted");
    const choice = this.newConversationChoice();
    const provider = choice ? providerById(choice.providerId, this.state.settings.custom) : undefined;
    if (!choice || !provider) return refused("no-model");
    if (this.fillAbort || this.state.live || this.sending) return refused("busy");
    const { column } = request;
    if (!isFillColumn(column)) return refused("unfit");
    const rows = request.rows.slice(0, FILL_LIMITS.rows);
    if (rows.length === 0) return refused("nothing");
    const outlineTool = toolByName("get_outline");
    const readTool = toolByName("read_note");
    const writeTool = toolByName("set_property");
    if (!outlineTool || !readTool || !writeTool) return refused("off");

    const controller = new AbortController();
    this.fillAbort = controller;
    try {
      const recipient: EgressRecipient = recipientOf(provider, choice.model);
      const cloud = isCloudRecipient(recipient);
      // Named `t`: the locale guard finds keys by their `t(` call (localeParity.test.ts).
      const t = (key: string, vars?: Record<string, string>) => this.host.label?.(key, vars) ?? key;
      const writer = { id: assistantAuthorId(choice.model), displayName: t("ai.suggestionAuthor", { model: choice.model }) };
      const call = (tool: ToolManifest, args: unknown): ToolCallPart => ({ type: "tool_call", id: `fill-${this.host.newId()}`, name: tool.name, args });

      // Each entry is a run of its own: its own gate, its own record of what it read, its own round on its note.
      // Read here, on the device, before anyone is asked: the overview names what would go.
      interface FillEntry {
        path: string;
        title: string;
        executor: ToolExecutor;
        outline: string;
        text: string;
        cut: boolean;
      }
      const entries: FillEntry[] = [];
      let kept = 0;
      for (const row of rows) {
        if (controller.signal.aborted || this.vault !== vault) return refused("cancelled");
        // The rules of what this entry's run read: the note's own, and those of the notes it names in its links.
        const restricted = new Set<AiPolicyDimension>();
        const scope: ToolScope = {
          inside: () => true,
          passed: (_path, rules) => {
            for (const rule of rules) restricted.add(rule);
          },
        };
        const run: WriteRun = {
          author: writer,
          // The user typed nothing here: an address is the note's own, or it is none.
          userTexts: () => [],
          inherited: async () => AI_POLICY_DIMENSIONS.filter((dimension) => restricted.has(dimension)),
          draft: async () => ({ ok: false, problem: "invalid" }),
          // A column is no rule and no file: nothing here is a plan, and nobody is asked.
          ask: async () => "nobody",
          writes: { rounds: [], drafts: [], plans: [] },
          today: () => this.host.today(),
          clock: () => clockOf(this.host.now()),
        };
        const tools = vault.tools(recipient, scope, undefined, false, undefined, undefined, run);
        if (!tools) return refused("off");
        const outlineArgs = { path: row.path };
        const readArgs = { path: row.path, maxChars: FILL_LIMITS.noteChars };
        const outline = await tools.executor.execute(outlineTool, outlineArgs, call(outlineTool, outlineArgs), controller.signal).catch(() => null);
        const read = outline && !outline.isError ? await tools.executor.execute(readTool, readArgs, call(readTool, readArgs), controller.signal).catch(() => null) : null;
        if (!outline || outline.isError || !read || read.isError) {
          // Kept from this model by the rules, or gone: either way it is not read, and the model never learns of it.
          kept += 1;
          continue;
        }
        const body = withoutReadCursor(read.content);
        entries.push({ path: row.path, title: row.title, executor: tools.executor, outline: outline.content, text: body.text, cut: body.cut });
      }
      if (entries.length === 0) return refused("kept");

      /** What the local patterns see in a text that would go to a cloud (P2b-6), and the text as it goes. */
      const screen = (text: string, redacted: boolean): { text: string; kinds: SensitiveKind[]; redacted: number } => {
        if (!cloud) return { text, kinds: [], redacted: 0 };
        const findings = sensitiveFindings(text);
        if (!findings.length) return { text, kinds: [], redacted: 0 };
        const kinds = sensitiveKinds(findings);
        if (!redacted) return { text, kinds, redacted: 0 };
        const out = redactSensitive(text, findings);
        return { text: out.text, kinds, redacted: out.redacted };
      };
      const property = fillColumnLine(column);
      const price = this.priceOf(choice);
      const leftOut = new Set<string>();
      const redact = new Set<string>();
      const build = () => {
        const sources: ManifestSource[] = [];
        const requests = new Map<string, string>();
        const going = new Set<SensitiveKind>();
        let tokens = 0;
        let largest = 0;
        let redactions = 0;
        for (const entry of entries) {
          if (leftOut.has(entry.path)) continue;
          const outline = screen(entry.outline, redact.has(entry.path));
          const body = screen(entry.text, redact.has(entry.path));
          const text = [
            property,
            `The entry is the note [[${entry.title}]]. Its properties and headings:`,
            fenceUntrusted(payload(outline.text, { kind: "vault", path: entry.path, section: "properties" })),
            entry.cut ? "The beginning of its text — the note is longer than what you are given:" : "Its text:",
            fenceUntrusted(payload(body.text, { kind: "vault", path: entry.path })),
          ].join("\n");
          const size = estimateTokens(FILL_INSTRUCTION + text);
          tokens += size;
          largest = Math.max(largest, size);
          const kinds = SENSITIVE_KINDS.filter((kind) => outline.kinds.includes(kind) || body.kinds.includes(kind));
          const spans = outline.redacted + body.redacted;
          redactions += spans;
          for (const kind of goingKinds(kinds, spans > 0)) going.add(kind);
          sources.push({
            path: entry.path,
            title: entry.title,
            tier: "evidence",
            // Cut at the run's limit: the overview says "the beginning", as for any note that goes in part.
            ...(entry.cut ? { section: "" } : {}),
            chars: outline.text.length + body.text.length,
            reasons: [],
            ...(kinds.length ? { sensitive: kinds } : {}),
            ...(spans ? { redacted: spans } : {}),
          });
          requests.set(entry.path, text);
        }
        const manifest: EgressManifest = {
          providerId: provider.id,
          providerLabel: provider.label,
          model: choice.model,
          local: !cloud,
          sources,
          ...(going.size ? { sensitive: SENSITIVE_KINDS.filter((kind) => going.has(kind)) } : {}),
          dataClasses: ["notes"],
          folders: [...new Set(sources.map((source) => (source.path.includes("/") ? source.path.slice(0, source.path.indexOf("/")) : "")))].sort(),
          withheld: { notes: kept, links: 0, places: 0, moodProperties: 0, ...(redactions ? { sensitive: redactions } : {}) },
          excluded: [],
          estimatedTokens: tokens,
          ...(price ? { estimatedCostUsd: (tokens / 1_000_000) * price.input } : {}),
          tools: [],
          web: false,
          fill: { column: column.label },
        };
        return { manifest, requests, largest };
      };

      // The overview as the approval of the whole run (E25): asked once, with every note in it.
      let built = build();
      let reviewing = false;
      for (;;) {
        if (built.manifest.sources.length === 0) return refused("cancelled");
        const growth = scopeGrowth(built.manifest, this.scope);
        if (!reviewing && growth.length === 0 && !(this.state.settings.confirmEveryRequest && !built.manifest.local)) break;
        const answer = await this.askConsent(built.manifest, growth);
        if (this.vault !== vault || controller.signal.aborted || answer === "cancel") return refused("cancelled");
        if (answer === "send") break;
        reviewing = true;
        if ("leaveOut" in answer) leftOut.add(answer.leaveOut);
        else if (redact.has(answer.redact)) redact.delete(answer.redact);
        else redact.add(answer.redact);
        built = build();
      }
      // What was approved is each request, not their sum: a later request is measured against the largest of them.
      if (!built.manifest.local) this.scope = widenScope(this.scope, { ...built.manifest, estimatedTokens: built.largest });

      const going = entries.filter((entry) => !leftOut.has(entry.path));
      const progress = { base: request.base, column: column.key, label: column.label, total: going.length };
      this.set({ fill: { ...progress, done: 0 } });
      const roundNote = t("ai.fill.roundNote", { column: column.label }).slice(0, 300);
      let usage: ConversationUsage = EMPTY_USAGE;
      let steps = 0;
      let proposed = 0;
      let silent = 0;
      let failed = 0;
      let stopped = false;
      let failure: ModelFailure | undefined;
      for (const [index, entry] of going.entries()) {
        if (controller.signal.aborted || this.vault !== vault) {
          stopped = true;
          break;
        }
        const asked = await this.askOnce(provider, choice, FILL_INSTRUCTION, [{ type: "text", text: built.requests.get(entry.path)! }], FILL_LIMITS.outputTokens, controller.signal);
        usage = addUsage(usage, asked.usage);
        steps += 1;
        if (asked.stop.kind === "cancelled") {
          stopped = true;
          break;
        }
        if (asked.stop.kind === "failed") {
          failure = asked.stop.failure;
          break;
        }
        const answer: ReturnType<typeof parseFillAnswer> = asked.stop.kind === "answered" ? parseFillAnswer(asked.answer, column) : { kind: "invalid" };
        if (answer.kind === "none") silent += 1;
        // A value is to come from the note: an address the model was not given is none.
        else if (answer.kind === "invalid" || bringsAddress(answer.value, [entry.outline, entry.text])) failed += 1;
        else {
          // Through the tool every proposed value takes: its checks, its lint, its round — and the note as it is now.
          const args = parseToolInput(writeTool, { path: entry.path, key: column.key, value: answer.value, note: roundNote });
          const laid = args.ok ? await entry.executor.execute(writeTool, args.value, call(writeTool, args.value), controller.signal).catch(() => null) : null;
          if (laid && !laid.isError) proposed += 1;
          // The rules of what the note names keep the value from it: kept, like a note that was not read.
          else if (laid?.content === WRITE_REFUSALS.restricted) kept += 1;
          else failed += 1;
        }
        if (this.vault === vault && this.fillAbort === controller) this.set({ fill: { ...progress, done: index + 1 } });
      }
      if (steps > 0) {
        await this.recordRequests(vault, choice, {
          id: `fill-${this.host.newId()}`,
          usage,
          steps,
          stop: failure ? "failed" : stopped ? "cancelled" : "answered",
          ...(failure ? { failure: failure.kind } : {}),
        });
      }
      return { kind: "done", proposed, silent, kept, failed, stopped, provider: provider.label, model: choice.model, ...(failure ? { failure } : {}) };
    } finally {
      if (this.fillAbort === controller) {
        this.fillAbort = null;
        if (this.state.fill) this.set({ fill: null });
      }
    }
  }

  /** Ends the run that fills a column: the request on its way is cancelled, and what was laid down stays. */
  stopFill(): void {
    this.fillAbort?.abort();
  }

  /**
   * A filter in words (plan P5-4): the sentence and the database's columns —
   * their names, kinds and choices; no note and no value of any entry — go to
   * the model a new conversation would get, and what it answers comes back as
   * filter rules held against those columns. Nothing is filtered here: the
   * view shows the rules, and the user applies them or throws them away.
   *
   * The database's own rules decide whether its columns may go: its folder's
   * and the vault's, as for a note that lies there.
   */
  async filterFromWords(request: FilterWordsRequest): Promise<FilterWordsOutcome> {
    const refused = (reason: Extract<FilterWordsOutcome, { kind: "refused" }>["reason"]): FilterWordsOutcome => ({ kind: "refused", reason });
    const vault = this.vault;
    if (!this.state.settings.enabled || !vault) return refused("off");
    const choice = this.newConversationChoice();
    const provider = choice ? providerById(choice.providerId, this.state.settings.custom) : undefined;
    if (!choice || !provider) return refused("no-model");
    if (this.filtering || this.state.live || this.sending) return refused("busy");
    const words = request.words.replace(/\s+/g, " ").trim().slice(0, FILTER_WORDS_LIMITS.words);
    const columns = request.columns.slice(0, FILTER_WORDS_LIMITS.columns);
    if (!words || columns.length === 0) return refused("empty");
    const recipient: EgressRecipient = recipientOf(provider, choice.model);
    const cloud = isCloudRecipient(recipient);
    const effective = isAiHiddenPath(request.base) ? null : await vault.policy.policyOf(request.base, "").catch(() => null);
    if (!effective || !gateDecision(effective, { recipient, webTools: false }).allowed) return refused("denied");

    this.filtering = true;
    try {
      const schema = filterSchemaLines(columns);
      const lead: TextPart = { type: "text", text: `The columns of the database:\n${fenceUntrusted(payload(schema, { kind: "vault", path: request.base, section: "columns" }))}` };
      const sentence: TextPart = { type: "text", text: `The sentence:\n${words}` };
      const title = request.base.slice(request.base.lastIndexOf("/") + 1).replace(/\.base$/i, "");
      const folder = request.base.includes("/") ? request.base.slice(0, request.base.indexOf("/")) : "";
      const seen = cloud ? sensitiveKinds(sensitiveFindings(schema)) : [];
      const tokens = estimateTokens(FILTER_INSTRUCTION + lead.text + sentence.text);
      const price = this.priceOf(choice);
      const manifest: EgressManifest = {
        providerId: provider.id,
        providerLabel: provider.label,
        model: choice.model,
        local: !cloud,
        sources: [{ path: request.base, title, tier: "evidence", chars: schema.length, reasons: [], columns: columns.length, ...(seen.length ? { sensitive: seen } : {}) }],
        ...(seen.length ? { sensitive: seen } : {}),
        dataClasses: ["notes"],
        folders: [folder],
        withheld: { notes: 0, links: 0, places: 0, moodProperties: 0 },
        excluded: [],
        estimatedTokens: tokens,
        ...(price ? { estimatedCostUsd: (tokens / 1_000_000) * price.input } : {}),
        tools: [],
        web: false,
      };
      const growth = scopeGrowth(manifest, this.scope);
      if (growth.length > 0 || (this.state.settings.confirmEveryRequest && !manifest.local)) {
        const answer = await this.askConsent(manifest, growth);
        if (this.vault !== vault || answer !== "send") return refused("cancelled");
      }
      if (!manifest.local) this.scope = widenScope(this.scope, manifest);

      const asked = await this.askOnce(provider, choice, FILTER_INSTRUCTION, [lead, sentence], FILTER_WORDS_LIMITS.outputTokens);
      await this.recordRequests(vault, choice, {
        id: `filter-${this.host.newId()}`,
        usage: asked.usage,
        steps: 1,
        stop: asked.stop.kind,
        ...(asked.stop.kind === "failed" ? { failure: asked.stop.failure.kind } : {}),
      });
      if (asked.stop.kind === "cancelled") return refused("cancelled");
      if (asked.stop.kind === "failed") return { kind: "refused", reason: "failed", failure: asked.stop.failure, provider: provider.label, model: choice.model };
      if (asked.stop.kind !== "answered") return refused("invalid");
      const answer = parseFilterAnswer(asked.answer, columns);
      if (answer.kind !== "rules") return refused(answer.kind);
      return { kind: "rules", logic: answer.logic, rules: answer.rules, model: choice.model };
    } catch {
      return refused("failed");
    } finally {
      this.filtering = false;
    }
  }

  /**
   * "Explain image" at a picture of the vault (plan P4-5, §10.7): the picture
   * goes, with a question, to the model a new conversation would get — in a
   * conversation of its own that the history keeps, where the user can ask
   * on. It runs like a message typed in the composer: the gate first (the
   * picture's own rules, and those of the note it stands in), the context of
   * the question, the send overview with the picture in it as it would go.
   *
   * What goes is never the file: `load` hands in the picture scaled down and
   * encoded anew, so nothing of the file's metadata leaves the device. A
   * picture is data like a note's text and untrusted like it — the run is
   * classed that way, and a door carries no tool with an outside effect.
   */
  async explainImage(request: ImageRequest): Promise<ImageOutcome> {
    type Refusal = Extract<ImageOutcome, { kind: "refused" }>;
    const refused = (reason: Refusal["reason"], extra: Omit<Refusal, "kind" | "reason"> = {}): ImageOutcome => ({ kind: "refused", reason, ...extra });
    const vault = this.vault;
    if (!this.state.settings.enabled || !vault) return refused("off");
    // A door starts a conversation of its own: with the model a new one would get, not the open one's.
    const choice = this.newConversationChoice();
    const provider = choice ? providerById(choice.providerId, this.state.settings.custom) : undefined;
    if (!choice || !provider) return refused("no-model");
    if (!imageRoute(provider.endpoint)) return refused("no-route", { provider: provider.label });
    if (this.state.live || this.sending) return refused("busy");
    const { path } = request;
    if (isAiHiddenPath(path)) return refused("denied");
    const recipient: EgressRecipient = recipientOf(provider, choice.model);
    const run = { recipient, webTools: false };

    // Set before the first wait: two quick presses never start two runs.
    this.sending = true;
    let conversationId: string | undefined;
    try {
      // A picture has no front matter: its folder's rules and the vault's decide.
      if (!gateDecision(await vault.policy.policyOf(path, ""), run).allowed) return refused("denied");
      // A note's rule covers what the note shows, so the notes that embed the picture decide too — the one the door
      // stood in, and every other one: the viewer no longer knows which note a picture was opened from.
      const showing = new Set<string>(request.notePath ? [request.notePath] : []);
      if (isCloudRecipient(recipient)) {
        const embedders = vault.embedders ? await vault.embedders(path).catch(() => null) : null;
        // Not knowing is not "none": without an answer the picture stays.
        if (embedders === null) return refused("unchecked");
        for (const note of embedders) showing.add(note);
      }
      for (const notePath of showing) {
        const note = await vault.readNote(notePath);
        if (!gateDecision(await vault.policy.policyOf(notePath, note?.text), run).allowed) return refused("denied");
      }
      const noteTitle = request.notePath ? request.notePath.slice(request.notePath.lastIndexOf("/") + 1).replace(/\.md$/i, "") : undefined;
      const prepared = await request.load().catch((): PrepareFailure => "unreadable");
      if (this.vault !== vault) return refused("cancelled");
      if (typeof prepared === "string") return refused(prepared);
      if (prepared.bytes > IMAGE_MAX_BYTES) return refused("too-large");
      const name = path.slice(path.lastIndexOf("/") + 1);
      const picture: ImagePart = { type: "image", mime: prepared.mime, data: prepared.data, name, width: prepared.width, height: prepared.height, path };
      const lead: TextPart = { type: "text", text: imageLead({ path, ...(noteTitle ? { noteTitle } : {}) }), context: [] };
      const folder = path.includes("/") ? path.slice(0, path.indexOf("/")) : "";
      const price = this.priceOf(choice);
      const disclose = (manifest: EgressManifest): EgressManifest => {
        const estimatedTokens = manifest.estimatedTokens + imageTokens(prepared.width, prepared.height) + estimateTokens(lead.text);
        return {
          ...manifest,
          estimatedTokens,
          ...(price ? { estimatedCostUsd: (estimatedTokens / 1_000_000) * price.input } : {}),
          sources: [{ path, title: name, tier: "evidence", chars: 0, reasons: ["active"], image: { width: prepared.width, height: prepared.height, bytes: prepared.bytes } }, ...manifest.sources],
          dataClasses: manifest.dataClasses.includes("images") ? manifest.dataClasses : [...manifest.dataClasses, "images"],
          folders: manifest.folders.includes(folder) ? manifest.folders : [...manifest.folders, folder].sort(),
        };
      };
      // Named `t`: the locale guard finds keys by their `t(` call (localeParity.test.ts).
      const t = (key: string, vars?: Record<string, string>) => this.host.label?.(key, vars) ?? key;
      // The provider's own list, where this session has it, says whether the model reads pictures.
      const listed = this.state.tests[choice.providerId]?.models?.find((model) => model.id === choice.model)?.vision;
      // The answer is read in the conversation: it comes on screen before anything is asked.
      if (this.surfaces === 0) this.reveal?.();
      const outcome = await this.runMessage(t("ai.image.ask"), vault, choice, {
        door: { title: t("ai.image.title", { name }), pins: [], lead: [lead, picture], disclose, ...(listed === false ? { blind: true } : {}) },
      });
      if (!outcome) return refused("cancelled");
      conversationId = outcome.record?.id;
      if (outcome.stop.kind === "answered") return { kind: "answered", conversationId: conversationId ?? "" };
      return refused(outcome.stop.kind === "cancelled" ? "cancelled" : "failed", conversationId ? { conversationId } : {});
    } catch (error) {
      this.abort = null;
      if (this.state.live) this.set({ live: null });
      return refused("failed", { ...(conversationId ? { conversationId } : {}), message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.sending = false;
    }
  }

  /** Whether an answer can be kept as a note here: the shell writes notes, and the AI is on. */
  canCapture(): boolean {
    return Boolean(this.state.settings.enabled && this.vault?.capture);
  }

  /**
   * "Keep as a note" under an answer (plan P4-6, §17.1): the answer of the
   * run that began at `userTurn` becomes a note in the vault's inbox folder —
   * stamped as generated by the model, with the pages the run read, the
   * searches it made and the notes it rests on as its sources (`aiCapture`).
   * The user asks for it and the app writes it; no model is called.
   *
   * A note written where other people read it is an effect on them (§12.1):
   * inside a shared workspace the user is asked first, each time.
   */
  async captureAnswer(userTurn: number): Promise<CaptureOutcome> {
    const refused = (reason: Extract<CaptureOutcome, { kind: "refused" }>["reason"], message?: string): CaptureOutcome => ({ kind: "refused", reason, ...(message ? { message } : {}) });
    const vault = this.vault;
    const record = this.state.active;
    if (!this.state.settings.enabled || !vault) return refused("off");
    if (!vault.capture) return refused("unavailable");
    // One at a time, and not while a run is on: a run that ends answers every open question with no.
    if (this.capturing || this.state.live || this.sending) return refused("busy");
    const run = record?.runs.find((candidate) => candidate.userTurn === userTurn);
    if (!record || !run || run.stop !== "answered") return refused("nothing");
    const turns = record.conversation.turns;
    const next = record.runs.map((other) => other.userTurn).filter((turn) => turn > userTurn).sort((a, b) => a - b)[0] ?? turns.length;
    const mine = turns.slice(userTurn, next);
    const question = (mine[0]?.parts ?? []).map((part) => (part.type === "text" && !part.context ? part.text : "")).filter(Boolean).join("\n\n");
    const answer = [...mine].reverse().find((turn) => turn.role === "assistant" && turn.parts.some((part) => part.type === "text" && part.text.trim()));
    const text = answer ? answer.parts.map((part) => (part.type === "text" ? part.text : "")).join("") : "";
    if (!text.trim()) return refused("nothing");

    // What the answer rests on, from the record — never from the answer's own words: the notes that went along, and the ones a tool read.
    const title = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
    const notes = new Map<string, string>();
    for (const source of run.manifest?.sources ?? []) {
      if (!source.image && source.audioBytes === undefined && source.tier !== "map") notes.set(source.path, source.title);
    }
    const failed = new Set(mine.flatMap((turn) => turn.parts.flatMap((part) => (part.type === "tool_result" && part.isError ? [part.callId] : []))));
    for (const turn of mine) {
      for (const part of turn.parts) {
        if (part.type !== "tool_call" || failed.has(part.id)) continue;
        const args = (calledToolName(part) === part.name ? part.args : dispatchedArgs(part.args)) as { path?: unknown } | null;
        if (calledToolName(part) === "read_note" && typeof args?.path === "string" && !notes.has(args.path)) notes.set(args.path, title(args.path));
      }
    }
    // The note inherits the rules of what the answer may rest on: everything the conversation carried up to this answer —
    // the sources of each overview, the notes pinned to it, and what passed the tools of its runs. An answer a model on
    // this device made from a note that must never reach a cloud must not reach one as a note either. A rule that
    // cannot be looked up counts as one that says no.
    const inherited = new Set<AiPolicyDimension>();
    const carried = new Set<string>(record.pins);
    let unknown = false;
    for (const earlier of record.runs) {
      if (earlier.userTurn > userTurn) continue;
      for (const rule of earlier.restricted ?? []) inherited.add(rule);
      for (const source of earlier.manifest?.sources ?? []) {
        carried.add(source.path);
        if (!source.image) continue;
        // A picture belongs to the notes that show it (ADR 0018 §10).
        const embedders = vault.embedders ? await vault.embedders(source.path).catch(() => null) : null;
        if (embedders === null) unknown = true;
        else for (const path of embedders) carried.add(path);
      }
    }
    for (const path of carried) {
      const effective = await (/\.md$/i.test(path) ? vault.policy.policyOf(path) : vault.policy.policyOf(path, "")).catch(() => null);
      for (const dimension of AI_POLICY_DIMENSIONS) if (!effective || effective.policy[dimension] === "deny") inherited.add(dimension);
    }
    if (unknown) for (const dimension of AI_POLICY_DIMENSIONS) inherited.add(dimension);

    const provider = providerById(run.providerId, this.state.settings.custom);
    // Named `t`: the locale guard finds keys by their `t(` call (localeParity.test.ts).
    const t = (key: string, vars?: Record<string, string>) => this.host.label?.(key, vars) ?? key;
    // A conversation a skill started opens with the skill's own request, the same words every time: such a note is
    // called after the skill and the note that was open — or the day —, never after a sentence the user did not write.
    const bound = record.instructions?.skill;
    let named: string | undefined;
    if (bound && userTurn === Math.min(...record.runs.map((other) => other.userTurn))) {
      const app = appSkillOf(bound.id);
      const skill = app ? t(`ai.skills.${app.key}.title`) : bound.name;
      const open = (run.manifest?.sources ?? []).find((source) => source.reasons.includes("active") && !source.image && source.audioBytes === undefined);
      named = `${skill} – ${open ? open.title : captureStamp(this.host.now()).slice(0, 10)}`;
    }
    const note = captureNote(
      {
        question,
        ...(named ? { title: named } : {}),
        answer: text,
        model: run.model,
        now: this.host.now(),
        pages: (run.web?.pages ?? []).filter((page) => page.read).map((page) => ({ url: page.url, title: page.title, at: page.at })),
        searches: (run.web?.searches ?? []).map((search) => ({ query: search.query, at: search.at })),
        searchProvider: provider?.label ?? run.providerId,
        notes: [...notes].map(([path, noteTitle]) => ({ path, title: noteTitle })),
      },
      t,
    );

    this.capturing = true;
    try {
      const folder = await vault.capture.folder();
      if (vault.encrypted?.()) {
        // Members of the workspace read what lands in it: that is asked, here and each time.
        const asked = new AbortController();
        const answerTo = await this.askEffect({ id: `capture-${this.host.newId()}`, kind: "write", audience: "members", title: note.title, folder }, asked.signal);
        // A yes counts for the conversation it was given in, in the vault it was given for.
        if (answerTo === "deny" || this.vault !== vault || this.state.active?.id !== record.id) return refused("cancelled");
      }
      // Written into the note only where the place it lands in would allow more than its sources do.
      const place = await vault.policy.policyOf(capturedNotePath(folder, note.stem), "").catch(() => null);
      const rules = AI_POLICY_DIMENSIONS.filter((dimension) => inherited.has(dimension) && place?.policy[dimension] !== "deny");
      const path = await vault.capture.write(folder, note.stem, withInheritedRules(note.content, rules));
      return { kind: "captured", path, title: note.title, ...(rules.length ? { inherited: rules } : {}) };
    } catch (error) {
      return refused("failed", error instanceof Error ? error.message : String(error));
    } finally {
      this.capturing = false;
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
    // A new conversation shows what it would start with: the catalog, AGENTS.md, the tools — the internet's too, where it is chosen.
    const recipient = recipientOf(provider, choice.model);
    const start = record
      ? null
      : this.conversationStart(
          (await this.instructionEntries(vault)).entries,
          this.offeredTools(vault, provider, recipient, this.state.draftWeb && this.state.web.enabled),
          undefined,
          await this.furtherTools(vault, provider, recipient, true),
        );
    const tools = record ? record.conversation.tools : (start?.tools ?? []);
    const context = await this.contextOf(question, vault, choice, provider, record ? record.pins : this.state.draftPins, record ? record.conversation.turns : [], {
      tools,
      more: record ? (record.conversation.more ?? []) : (start?.more ?? []),
      instructions: manifestInstructionsOf(record ? record.instructions : (start?.instructions ?? undefined)),
      web: hasWebTools(tools),
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
    conversation: { tools: readonly string[]; more?: readonly string[]; instructions?: ManifestInstructions; withoutActive?: boolean; web?: boolean },
  ) {
    const recipient: EgressRecipient = recipientOf(provider, choice.model);
    // The system's own model takes no tools, and a small window a smaller package (plan P2c).
    const platform = provider.endpoint.api === "platform";
    // A conversation that carries the internet's tools (plan P4): notes whose rules say `web: deny` stay out of it.
    const web = !platform && conversation.web === true;
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
          ...(web ? { webTools: true } : {}),
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
        // What the tool search reaches is said with the tools: it is in the conversation's reach, though each kind asks first.
        ...(!platform && conversation.more?.length ? { more: conversation.more } : {}),
        questionChars: message.length,
        // Shown as allowed only while the vault's switch is on: switched off since, the tools answer that it is off.
        ...(web && this.state.web.enabled ? { web: true, webHosts: this.state.web.allow } : {}),
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
    this.settleEffect("deny");
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

  private askConsent(manifest: EgressManifest, growth: ScopeGrowth[], pictures: { images: readonly ImagePart[]; blind?: boolean } | null = null): Promise<ConsentAnswer> {
    this.settleConsent("cancel");
    return new Promise((resolve) => {
      this.consentAnswer = resolve;
      this.set({ consent: { manifest, growth, ...(pictures?.images.length ? { images: pictures.images, ...(pictures.blind ? { blind: true } : {}) } : {}) } });
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
      // The internet is chosen for one conversation, in the composer, where the vault allows it — never by a door,
      // a regression run or a run bound to a skill. Fixed like every tool: a conversation that began without it
      // may already carry notes that must never meet the internet.
      const entries = skills?.entries ?? (await this.instructionEntries(vault)).entries;
      // One exception, and it is the user's own choice too (plan P4-6): a skill the user starts that names the internet's
      // tools brings them along where the vault allows the internet — starting "Research" is choosing it for this one
      // conversation, and the overview says so. No other skill reaches the internet, and a regression run never does.
      const boundSkill = skills?.bind ? entries.find((entry) => entry.source.id === skills.bind && entry.status === "active")?.source.skill : undefined;
      const skillWeb = Boolean(boundSkill && skillNamesWeb(boundSkill));
      const withWeb = !apart && this.state.web.enabled && (skills?.bind ? skillWeb : this.state.draftWeb);
      // A door answers where it was asked: it reads the vault, it does not move the app — and it looks for no further tool.
      const offered = this.offeredTools(vault, provider, recipient, withWeb).filter((name) => !door || name !== "run_command");
      const further = door ? [] : await this.furtherTools(vault, provider, recipient, !detached && !skills?.bind);
      // A door runs without skills (plan P3-6): the vault's standing instructions still apply, the catalog does not.
      const start = this.conversationStart(door ? entries.filter((e) => e.source.kind === "agents") : entries, offered, skills?.bind, further);
      const id = this.host.newId();
      record = {
        version: 1 as const,
        id,
        title: apart?.title ?? conversationTitleFrom(message, message),
        createdAt: now,
        updatedAt: now,
        providerId: choice.providerId,
        model: choice.model,
        conversation: startConversation(id, assistantSystemPrompt({ language: this.host.language(), today: this.host.today(), tools: start.tools, more: start.more, ...start.prompt }), start.tools, start.more),
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
    // A conversation that carries the internet's tools (plan P4): its vault tools and its context leave `web: deny` notes out.
    const web = hasWebTools(toolNames);
    const webLog = web ? newRunWeb() : null;
    // The conversation's further tools (ADR 0019), as fixed as its own.
    const moreNames = platform ? [] : (record.conversation.more ?? []);
    // What passes the tools here although a rule restricts it elsewhere (plan P4-6) — a note kept from the cloud read by a
    // model on this device, a note kept from the internet in a conversation without it: the run's record keeps the rule,
    // never the path, and a note made of its answer inherits it.
    const restricted = new Set<AiPolicyDimension>();
    // The notes this run's tools read, by path (plan P4.5): a foreign server gets a call only when everything the
    // conversation has read lies where the user allowed it. More than the record keeps is remembered as "more".
    const reads = { paths: new Set<string>(), more: false };
    const scope: ToolScope = {
      ...skillScope(bound?.folders, skillState),
      passed: (path, rules) => {
        for (const rule of rules) restricted.add(rule);
        if (reads.paths.size < RUN_READ_CAP) reads.paths.add(path);
        else if (!reads.paths.has(path)) reads.more = true;
      },
    };
    // The tools of foreign servers this run may find (plan P4.5): of the names its conversation was started with, the
    // ones that are offered NOW — a server that was switched off or blocked since brings none. A door and a
    // regression run reach none at all.
    const foreign = !apart && moreNames.some(isMcpExposedToolName) ? await this.mcp.manifests(moreNames) : [];
    const mcpLog = foreign.length ? newRunMcp() : null;
    /** What this message's own context carries, known once it is built. */
    const sending: { sources: { path: string; image?: unknown }[] } = { sources: [] };
    // The writing tools (plan P5): what this run lays down is signed with its model, asked about above the composer and
    // recorded with the run. A door and a regression run bring none of it — a proposal nobody asked for is no test.
    const writesLog: RunWrites = { rounds: [], drafts: [], plans: [] };
    const writer = { id: assistantAuthorId(choice.model), displayName: this.host.label?.("ai.suggestionAuthor", { model: choice.model }) ?? choice.model };
    const inherited = () => this.inheritedBy(vault, record, sending.sources, reads, restricted);
    const writing: WriteRun | undefined =
      !apart && [...toolNames, ...moreNames].some(isWriteToolName)
        ? {
            author: writer,
            userTexts: () => [message, ...userTextsOf(record.conversation)],
            inherited,
            draft: async (input: { title: string; body: WriteDraftBody; defused: number }) => {
              const carried = await this.carriedBy(vault, record, sending.sources, reads).catch(() => ({ paths: [] as string[], more: false }));
              return this.leaveDraft(vault, {
                id: `d-${this.host.newId()}`,
                createdAt: this.host.now().toISOString(),
                author: { id: writer.id, label: writer.displayName },
                conversationId: record.id,
                title: input.title,
                body: input.body,
                inherited: [...(await inherited())],
                // What the draft rests on, from the run's record — never from the model's own words.
                sources: input.body.kind === "note" || input.body.kind === "entry" ? carried.paths.filter((path) => /\.md$/i.test(path)).slice(0, 50).map((path) => ({ resource: path })) : [],
                defused: input.defused,
              });
            },
            ask: (question: PlanQuestion, callId?: string) => this.askPlan(question, callId),
            writes: writesLog,
            today: () => this.host.today(),
            clock: () => clockOf(this.host.now()),
          }
        : undefined;
    const base = toolNames.length ? vault.tools(recipient, scope, redact, web, () => skillState.loaded?.tools ?? null, () => foreign, writing) : null;
    // Mail and the descriptions of appointments (plan P4-4): a kind of data no overview named asks first, and raw text goes to a reader without tools.
    const reading = newRunReading();
    const guarded = base
      ? createPrivateDataExecutor(
          base.executor,
          {
            egress: this.host.egress,
            reader: () => this.quarantineReader(provider, choice),
            // A regression run has nobody to ask: what this session has not allowed yet does not happen in it.
            approve: (dataClass, tool, call, signal) => this.approveData(dataClass, tool, call, { provider, choice, recipient, signal, ...(detached ? { silent: true } : {}) }),
            newRequestId: () => `ai-${this.host.newId()}`,
            now: () => this.host.now().toISOString(),
          },
          reading,
        )
      : null;
    // The web tools sit under the skills' wrapper: a loaded skill that does not use them narrows them away like any tool.
    const inner =
      guarded && webLog
        ? createWebExecutor(
            guarded,
            {
              fetcher: this.host.web ?? null,
              egress: this.host.egress,
              endpoint: provider.endpoint,
              model: choice.model,
              providerLabel: provider.label,
              enabled: () => this.vault === vault && this.state.web.enabled,
              newRequestId: () => `ai-${this.host.newId()}`,
              now: () => this.host.now().toISOString(),
            },
            webLog,
          )
        : guarded;
    // The tools of foreign servers sit under the skills' wrapper as well: while a skill is loaded they are not among what it leaves.
    const startedWith = record;
    const outer =
      inner && mcpLog
        ? createMcpExecutor(
            inner,
            {
              servers: () => this.mcp.servers(),
              check: (serverId, signal) => this.mcp.check(serverId, signal),
              carried: () => this.carriedBy(vault, startedWith, sending.sources, reads),
              keptFromCloud: (serverId, paths) => this.keptFromCloud(vault, serverId, paths),
              ask: (question, signal) => this.askMcp(question, signal),
              call: (serverId, tool, args, inputSchema, signal) => this.mcp.call(serverId, tool, args, inputSchema, signal),
              log: (entry) => this.mcp.log({ ...entry, at: this.host.now().toISOString(), conversation: startedWith.id }),
            },
            mcpLog,
          )
        : inner;
    const tools = outer ? { names: toolNames, executor: createSkillExecutor(outer, this.skillRuntime(vault, record), toolNames, skillState, moreNames) } : null;
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
      more: moreNames,
      instructions: manifestInstructionsOf(record.instructions),
      // A regression run measures the skill, not whatever note happens to be open.
      ...(detached ? { withoutActive: true } : {}),
      web,
    });
    const { seen } = context;
    // Should no answer come back: the notes that match the question best, as the sources proposed them (plan §19.4).
    const related = rankCandidates(mergeCandidates(context.candidates))
      .slice(0, RELATED_ON_FAILURE)
      .map((candidate) => ({ path: candidate.path, title: candidate.title }));
    // What a door brings goes into the overview with everything else: the user sees it before it is sent.
    const build = async (out: ReadonlySet<string>, red: ReadonlySet<string>) => {
      const built = await context.build(out, red);
      return door ? { pack: built.pack, manifest: door.disclose(built.manifest) } : built;
    };
    const leaveOut = new Set<string>(apart ? [] : this.state.leaveOutNext);
    let { pack, manifest } = await build(leaveOut, redact);
    // A picture the door brings is shown in the overview as it would go (plan P4-5).
    const pictures = door ? { images: imagesOf(door.lead), ...(door.blind ? { blind: true } : {}) } : null;
    // The send overview as the scope approval (E25): on the first request, when the scope grows, or always for the strict.
    // Once the user reviews the overview, it stays until they send or cancel:
    // leaving a note out never sends on its own.
    let reviewing = false;
    for (;;) {
      const growth = scopeGrowth(manifest, this.scope);
      if (!reviewing && growth.length === 0 && !(this.state.settings.confirmEveryRequest && !manifest.local)) break;
      const answer = await this.askConsent(manifest, growth, pictures);
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
    // What this message carries counts as read from here on: a call to a foreign server in this very run looks at it too.
    sending.sources = manifest.sources.map((source) => ({ path: source.path, ...(source.image ? { image: true } : {}) }));
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
      ...(webLog ? { web: webLog } : {}),
      ...(guarded ? { reading } : {}),
      ...(base ? { restricted, reads } : {}),
      ...(mcpLog ? { foreign, mcp: mcpLog } : {}),
      ...(writing ? { writes: writesLog } : {}),
      ...(related.length ? { related } : {}),
    });
  }

  /**
   * The notes a conversation has read so far, by path (plan P4.5): what its context carried, what was pinned to it,
   * what its tools read — in the runs before this one and in this one. `more` when not all of it is known by path:
   * a run that read more than its record keeps, a picture whose notes cannot be looked up.
   */
  private async carriedBy(
    vault: AiVaultHost,
    record: ConversationRecord,
    sending: readonly { path: string; image?: unknown }[],
    reads: { paths: ReadonlySet<string>; more: boolean },
  ): Promise<{ paths: string[]; more: boolean }> {
    const paths = new Set<string>(record.pins);
    let more = reads.more;
    const sources: { path: string; image?: unknown }[] = [...sending];
    for (const run of record.runs) {
      for (const path of run.sent) paths.add(path);
      for (const path of run.read ?? []) paths.add(path);
      if (run.readMore) more = true;
      sources.push(...(run.manifest?.sources ?? []));
    }
    for (const source of sources) {
      paths.add(source.path);
      if (!source.image) continue;
      // A picture belongs to the notes that show it (ADR 0018 §10).
      const embedders = vault.embedders ? await vault.embedders(source.path).catch(() => null) : null;
      if (embedders === null) more = true;
      else for (const path of embedders) paths.add(path);
    }
    for (const path of reads.paths) paths.add(path);
    return { paths: [...paths], more };
  }

  /**
   * The rules of everything a conversation rests on (plan P5): what its context carried, what was pinned to it and what
   * its tools read, in the runs before this one and in this one. What such a conversation proposes may only go where
   * these rules already hold — a round inherits nothing —, and a draft of it takes them along. A rule that cannot be
   * looked up counts as one that says no, and so does a read that is not known by path.
   */
  private async inheritedBy(
    vault: AiVaultHost,
    record: ConversationRecord,
    sending: readonly { path: string; image?: unknown }[],
    reads: { paths: ReadonlySet<string>; more: boolean },
    restricted: ReadonlySet<AiPolicyDimension>,
  ): Promise<AiPolicyDimension[]> {
    const inherited = new Set<AiPolicyDimension>(restricted);
    for (const run of record.runs) for (const rule of run.restricted ?? []) inherited.add(rule);
    const carried = await this.carriedBy(vault, record, sending, reads);
    if (carried.more) return [...AI_POLICY_DIMENSIONS];
    for (const path of carried.paths) {
      if (inherited.size === AI_POLICY_DIMENSIONS.length) break;
      const effective = await (/\.md$/i.test(path) ? vault.policy.policyOf(path) : vault.policy.policyOf(path, "")).catch(() => null);
      for (const dimension of AI_POLICY_DIMENSIONS) if (!effective || effective.policy[dimension] === "deny") inherited.add(dimension);
    }
    return AI_POLICY_DIMENSIONS.filter((dimension) => inherited.has(dimension));
  }

  /** Whether one of these notes must not reach a foreign server — a cloud recipient, wherever it runs. A rule that cannot be read says no. */
  private async keptFromCloud(vault: AiVaultHost, serverId: string, paths: readonly string[]): Promise<boolean> {
    const run: GateRun = { recipient: mcpRecipient(serverId), webTools: false };
    for (const path of paths) {
      const effective = await (/\.md$/i.test(path) ? vault.policy.policyOf(path) : vault.policy.policyOf(path, "")).catch(() => null);
      if (!effective || !gateDecision(effective, run).allowed) return true;
    }
    return false;
  }

  /** One call to a foreign server, shown before it goes: the server, the tool, the arguments in full. Asked every time. */
  private async askMcp(question: McpCallQuestion, signal?: AbortSignal): Promise<boolean> {
    let args: string;
    try {
      args = JSON.stringify(question.args, null, 2);
    } catch {
      return false;
    }
    // Under the call's own id, like every question about a call: while it stands, no step claims to be running.
    const request: EffectRequest = { id: question.callId, kind: "mcp", serverId: question.serverId, server: question.serverLabel, tool: question.tool, title: question.title, args, effect: question.effect };
    return (await this.askEffect(request, signal ?? new AbortController().signal)) !== "deny";
  }

  /** The tools a new conversation with this model is offered: the vault's, and the internet's where it was chosen for it. */
  private offeredTools(vault: AiVaultHost, provider: ProviderInfo, recipient: EgressRecipient, web: boolean): string[] {
    // The system's own model takes no tools (plan P2c).
    if (provider.endpoint.api === "platform") return [];
    const names = [...(vault.tools(recipient)?.names ?? [])];
    return web && names.length ? [...names, ...webToolNames(this.host.web ?? null, provider.endpoint)] : names;
  }

  /**
   * The further tools a new conversation with this model reaches through its tool search (ADR 0019): the vault's own,
   * and — where `services` — the tools of the foreign servers this vault uses (plan P4.5), under the names the app gives
   * them. A door, a regression run and a conversation bound to a skill get none of those: nobody chose a service for them.
   */
  private async furtherTools(vault: AiVaultHost, provider: ProviderInfo, recipient: EgressRecipient, services: boolean): Promise<string[]> {
    if (provider.endpoint.api === "platform") return [];
    const own = [...(vault.tools(recipient)?.more ?? [])];
    return services ? [...own, ...(await this.mcp.offeredNames())] : own;
  }

  /** A model that runs on this device: the profile "Local" while it names a server on this computer or the system's own model. */
  private deviceModel(): { provider: ProviderInfo; model: string } | null {
    const choice = this.state.settings.profiles.local;
    const provider = choice ? providerById(choice.providerId, this.state.settings.custom) : null;
    return choice && provider && (provider.kind === "local" || provider.kind === "platform-device") ? { provider, model: choice.model } : null;
  }

  /**
   * Who reads a mail's body or an appointment's description for a run (plan
   * P4-4, §13.4). They are private as well as a stranger's words, so a model
   * on this device reads them where there is one — the conversation's own,
   * when it runs here, otherwise the one of the profile "Local" — and the
   * text itself does not leave the device. Without one, the conversation's
   * provider reads it, in a second call without tools.
   */
  private quarantineReader(provider: ProviderInfo, choice: ModelChoice): QuarantineReader {
    const here = provider.kind === "local" || provider.kind === "platform-device" ? { provider, model: choice.model } : this.deviceModel();
    if (!here) return { endpoint: provider.endpoint, model: choice.model, label: provider.label, onDevice: false };
    const window = here.provider.endpoint.api === "platform" ? (this.windowOf(here.provider, here.model) ?? PLATFORM_CONTEXT_DEFAULT) : undefined;
    return { endpoint: here.provider.endpoint, model: here.model, label: `${here.provider.label} · ${here.model}`, onDevice: true, ...(window ? { contextTokens: window } : {}) };
  }

  /**
   * Whether a tool that brings a kind of data no send overview named may run
   * (plan P4-4): mail, reached through the tool search. Asked in the
   * conversation at its first call — once for a recipient, until the app
   * closes; another model or provider is another question. Nothing leaves
   * the device for a model that runs on it, so nothing is asked there.
   */
  private async approveData(
    dataClass: "mail",
    tool: ToolManifest,
    call: ToolCallPart,
    run: { provider: ProviderInfo; choice: ModelChoice; recipient: EgressRecipient; signal?: AbortSignal; silent?: boolean },
  ): Promise<boolean> {
    if (!isCloudRecipient(run.recipient)) return true;
    const key = `${run.choice.providerId}/${run.choice.model}`;
    if (toolDataApproved(this.scope, dataClass, key)) return true;
    const reader = this.quarantineReader(run.provider, run.choice);
    const request: EffectRequest = { id: call.id, kind: "data", dataClass, tool: tool.name, provider: run.provider.label, reader: reader.onDevice ? "device" : "provider", readerLabel: reader.label };
    // A run that nobody can stop is not asked a question nobody could withdraw — and neither is one nobody watches.
    if (!run.signal || run.silent) return false;
    if ((await this.askEffect(request, run.signal)) === "deny") return false;
    this.scope = approveToolData(this.scope, dataClass, key);
    return true;
  }

  /**
   * Whether a call that reaches the internet may go out (plan KI-Harness P4,
   * the Rule of Two): asked for each such call while private data is in the
   * run. What would not go out anyway needs no question — the tool says why.
   * A page of a site the user allowed goes without asking when its address
   * stood in front of the model; an address the model composed always asks,
   * because it is the one that could carry something out of the notes.
   */
  private async approveWebCall(
    call: ToolCallPart,
    tool: ToolManifest,
    run: { provider: ProviderInfo; signal: AbortSignal; conversation(): ConversationRecord["conversation"]; skillState?: SkillRunState },
  ): Promise<boolean> {
    if (!this.state.web.enabled) return true;
    const loaded = run.skillState?.loaded;
    if (loaded && !loaded.tools.includes(tool.name)) return true;
    const args = (call.args ?? {}) as { url?: unknown; question?: unknown; query?: unknown };
    if (tool.name === "fetch_url") {
      const checked = checkWebUrl(typeof args.url === "string" ? args.url : "");
      if (!checked.ok || !this.host.web) return true;
      const { url, host } = checked.target;
      const origin = addressOrigin(url, knownAddresses(run.conversation()));
      if (origin !== "model" && hostAllowed(host, this.state.web.allow)) return true;
      const answer = await this.askEffect({ id: call.id, kind: "fetch", url, host, question: typeof args.question === "string" ? args.question : "", origin }, run.signal);
      if (answer === "always" && origin !== "model") await this.allowWebHost(host).catch(() => false);
      return answer !== "deny";
    }
    if (tool.name === "web_search") {
      const query = searchQuery(typeof args.query === "string" ? args.query : "");
      if (!query || !searchSupported(run.provider.endpoint)) return true;
      return (await this.askEffect({ id: call.id, kind: "search", query, provider: run.provider.label }, run.signal)) !== "deny";
    }
    // No other tool has an outside effect yet (the writes come with plan P5): nobody could be asked, so it does not happen.
    return false;
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
    /** The conversation carries the internet's tools (plan P4): what they asked for is gathered here, and each call may need the user. */
    web?: RunWeb;
    /** What the run's tools read of mail and appointments (plan P4-4), gathered while it runs. */
    reading?: RunReading;
    /** The rules of notes that passed the run's tools although they restrict them elsewhere (plan P4-6), gathered while it runs. */
    restricted?: ReadonlySet<AiPolicyDimension>;
    /** The notes the run's tools read, by path (plan P4.5), gathered while it runs. */
    reads?: { paths: ReadonlySet<string>; more: boolean };
    /** The tools of foreign servers this run may find, and what it asked of them (plan P4.5). */
    foreign?: readonly ToolManifest[];
    mcp?: RunMcp;
    /** What the run's writing tools lay down (plan P5), gathered while it runs; present where the run may write. */
    writes?: RunWrites;
    /** The notes that match the question best, shown when no answer comes back (plan §19.4). */
    related?: { path: string; title: string }[];
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
    const drafts = input.usedDrafts ? { draftPins: [], draftRedact: [], draftChoice: null, draftWeb: false, excludeActive: false, leaveOutNext: [], originalsNext: [] } : {};
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
      ...(input.foreign?.length ? { foreign: input.foreign } : {}),
      // Asked by the run for each call with an outside effect while private data is in it (the Rule of Two).
      ...(input.web || input.foreign?.length || input.writes
        ? {
            approveEffect: (call: ToolCallPart, tool: ToolManifest) => {
              // A call to a foreign server asks its own question — every time, with the arguments in full, and after
              // the rules that may keep it back (plan P4.5). The run's gate lets it through to there.
              if (tool.foreign) return Promise.resolve(true);
              // A proposal and a draft change nothing: accepting them is the approval, part by part. A plan asks its own
              // question, every time and whatever else is in the run, with what it would do (plan P5).
              if (isWriteToolName(tool.name)) return Promise.resolve(Boolean(input.writes));
              if (!input.web) return Promise.resolve(false);
              return this.approveWebCall(call, tool, { provider, signal: controller.signal, conversation: () => record.conversation, ...(input.skillState ? { skillState: input.skillState } : {}) });
            },
          }
        : {}),
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
          const state = !event.outcome.isError ? ("done" as const) : event.outcome.content === EFFECT_DECLINED ? ("declined" as const) : ("failed" as const);
          this.set({ live: { ...live, tools: live.tools.map((t) => (t.id === event.call.id ? { ...t, state } : t)) } });
        } else if (event.type === "turn") {
          record = { ...record, conversation: event.conversation };
          this.set({ active: this.state.active?.id === record.id ? record : this.state.active, live: { ...live, text: "", steps: live.steps + 1 } });
        }
      },
    });
    if (this.abort === controller) this.abort = null;
    // Whatever still waits for an answer belongs to a run that is over.
    this.settleEffect("deny");

    // The calls that read pages and searched are part of what the run cost.
    const web = input.web && (input.web.pages.length || input.web.searches.length) ? input.web : null;
    // So are the calls that read a message or a description — where the conversation's provider read them; a model on this device costs nothing.
    const reading = input.reading && readSomething(input.reading) ? input.reading : null;
    const readByProvider = reading && reading.reader === "provider" ? reading : null;
    const usage = {
      inputTokens: result.usage.inputTokens + (web?.inputTokens ?? 0) + (readByProvider?.inputTokens ?? 0),
      outputTokens: result.usage.outputTokens + (web?.outputTokens ?? 0) + (readByProvider?.outputTokens ?? 0),
      cacheReadTokens: result.usage.cacheReadTokens,
      cacheWriteTokens: result.usage.cacheWriteTokens,
    };
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
      ...(web ? { web } : {}),
      ...(reading ? { reading } : {}),
      ...(input.restricted?.size ? { restricted: AI_POLICY_DIMENSIONS.filter((dimension) => input.restricted!.has(dimension)) } : {}),
      ...(input.reads?.paths.size ? { read: [...input.reads.paths] } : {}),
      ...(input.reads?.more ? { readMore: true } : {}),
      ...(input.mcp?.calls.length ? { mcp: input.mcp } : {}),
      ...(input.writes && (input.writes.rounds.length || input.writes.drafts.length || input.writes.plans.length) ? { writes: input.writes } : {}),
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
          // Numbers only: which pages and which words is the conversation's to say, never the audit's.
          ...(web ? { web: { pages: web.pages.length, searches: web.searches.length, inputTokens: web.inputTokens, outputTokens: web.outputTokens } } : {}),
          ...(reading
            ? { reading: { mailSearches: reading.mailSearches, messages: reading.messages, descriptions: reading.descriptions, onDevice: reading.reader === "device", inputTokens: reading.inputTokens, outputTokens: reading.outputTokens } }
            : {}),
          // How many pictures the message brought — never which.
          ...(imagesOf(input.parts).length ? { images: imagesOf(input.parts).length } : {}),
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
      // No answer from the model is never a dead end (plan §19.4): the notes that match the question best go with the notice.
      notice:
        result.stop.kind === "answered" ? null : { conversationId: record.id, stop: result.stop, ...(result.stop.kind === "failed" && input.related?.length ? { related: input.related } : {}) },
      summaries: sortSummaries([conversationSummaryOf(record), ...this.state.summaries.filter((s) => s.id !== record.id)]),
    });
    return { stop: result.stop, record, answer };
  }

  private priceOf(choice: ModelChoice): { input: number; output: number } | undefined {
    return this.state.settings.prices[`${choice.providerId}/${choice.model}`] ?? this.state.tests[choice.providerId]?.models?.find((m) => m.id === choice.model)?.price;
  }
}
