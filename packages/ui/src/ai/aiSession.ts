import { withoutReadCursor, type ToolScope } from "./vaultTools";
import { APP_SKILL_SOURCES, appSkillOf, appSkillScenarios } from "./appSkills";
import type { InstructionApprovalStore, SkillTestStore, UpkeepPrefStore, WebSettingsStore } from "./aiStores";
import { createWebExecutor, newRunWeb, webToolNames } from "./webTools";
import { createPrivateDataExecutor, newRunReading, readSomething, type QuarantineReader } from "./privateData";
import type { PreparedImage, PrepareFailure } from "./aiImage";
import { capturedNotePath, captureNote, captureStamp, withInheritedRules } from "./aiCapture";
import { createSkillExecutor, newSkillRunState, serverSkillCeiling, serversLoadedIn, skillFileReadable, skillRunTools, skillScope, type SkillRunState } from "./skillRuntime";
import { replayRequest, replaySources, type RunSnapshotStates } from "./runReplay";
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
import { draftedEntryContent, draftedNoteContent, EMPTY_WRITE_DRAFTS, namedNoteContent, type DraftCreator, type OpenProposal, type WriteDraftState, type WriteDraftStore } from "./aiWrites";
import { isWriteToolName, type PlanQuestion, type WriteRun } from "./writeTools";
import { bringsAddress, FILL_INSTRUCTION, FILL_LIMITS, fillColumnLine, isFillColumn, parseFillAnswer, type FillColumn } from "./aiFill";
import { FILTER_INSTRUCTION, FILTER_WORDS_LIMITS, filterSchemaLines, parseFilterAnswer, type FilterSchemaColumn } from "./aiBaseFilter";
import type { PropertyFilterRule } from "../base/filterExpr";
import { safeFileStem } from "../lib/fileStem";
import type { SuggestionChunk } from "../components/suggestMode";
import {
  approvalSeen,
  MCP_SKILL_LIMITS,
  mcpSkillRegistration,
  mcpSkillRegistrationKey,
  stripInvisible,
  pruneServerSkillApprovals,
  checkMcpSkillFile,
  checkMcpSkillMain,
  mcpSkillSource,
  readMcpSkillSourceId,
  sameSeen,
  type SkillDefinition,
  appendLearnLog,
  approvalOf,
  countObservedRun,
  endObservation,
  grantChanges,
  LEARN_LIMITS,
  LEARN_LOG_FILE,
  learnInstruction,
  learnLogLine,
  learnLogTime,
  learnParts,
  learnTranscript,
  nameOf,
  observedRunOf,
  observeInstruction,
  parseLearnings,
  rewriteSkillBody,
  sameGrant,
  SKILL_FILE,
  SKILL_MAIN_MAX_BYTES,
  skillDraftTarget,
  TOOL_MANIFESTS,
  type LearnKind,
  type LearnLogEvent,
  activeMemoryFor,
  addMemoryEntry,
  addRuleLine,
  AGENTS_FILE,
  findMemoryEntry,
  MEMORY_DRAFT_KINDS,
  MEMORY_SEARCH_TOOL,
  memoryDeniedFor,
  memoryEntryAllowed,
  memoryFileOf,
  memoryMetaOf,
  memoryPlaceOfId,
  memoryText,
  parseMemory,
  removeMemoryEntry,
  replaceMemoryEntry,
  type ConversationMemory,
  type ManifestMemory,
  measureStyle,
  styleFeaturesWithout,
  styleLine,
  STYLE_EXAMPLES_MAX,
  type ConversationStyle,
  type EffectivePolicy,
  type ManifestStyle,
  type StyleFeatureKey,
  type MemoryChange,
  type MemoryEntry,
  type MemoryPlace,
  type MemoryWriter,
  addressOrigin,
  addUsage,
  AI_POLICY_DIMENSIONS,
  assistantAuthorId,
  withoutWriteDraft,
  withWriteDraft,
  withWriteDraftOutcome,
  WRITE_DRAFT_LIMITS,
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
  skillTestState,
  skillTestSummary,
  skillTestVersion,
  dismissUpkeep,
  EMPTY_UPKEEP_PREFS,
  memoryUpkeep,
  shownUpkeep,
  skillUpkeep,
  sameStoredValue,
  type UpkeepHint,
  type UpkeepTestResult,
  switchInstruction,
  aiMonthlySavings,
  aiMonthlyTotals,
  allProviders,
  appendAiLedgerEntry,
  appendTurn,
  assistantSystemPrompt,
  buildContextPackage,
  contextBudgetFor,
  contextSavingsOf,
  PLATFORM_CONTEXT_DEFAULT,
  conversationMatches,
  conversationSummaryOf,
  conversationTitleFrom,
  EMPTY_USAGE,
  editorTextOf,
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
  imageNoteLead,
  imageRoute,
  imagesOf,
  imageTokens,
  isAiHiddenPath,
  TRANSCRIPTION_MAX_BYTES,
  TRANSCRIPT_SUMMARY_INSTRUCTION,
  TRANSCRIPT_SUMMARY_MIN,
  checkTranscriptSummary,
  transcriptBlock,
  transcriptionRequest,
  transcriptionRoute,
  transcriptionUsage,
  transcriptOf,
  expiredConversations,
  fetchProviderJson,
  initialModelChoice,
  localOnlyEgress,
  runsOnDevice,
  choiceOnDevice,
  utf8Length,
  statedModelFacts,
  estimateRequestTokens,
  WINDOW_BUDGET_ROOM,
  type LocalOnlyEgress,
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
  noteHash,
  RUN_READ_CAP,
  snapshotState,
  type GateRun,
  type ReplayOf,
  type SnapshotState,
  type McpToolEffect,
  type McpElicitation,
  type McpElicitMode,
  type McpElicitResult,
  type McpQuestions,
  type RunMcp,
  instructionStatus,
  isScriptToolName,
  parseScriptManifest,
  SCRIPT_MAIN_FILE,
  SCRIPT_MANIFEST_FILE,
  SCRIPTS_FOLDER,
  scriptAuthorId,
  scriptToolManifest,
  scriptWrites,
  serializeScriptManifest,
  type RunScripts,
  type ScriptDefinition,
  type ScriptOutcome,
  type ScriptProblem,
  dueMoment,
  FOLDER_LOG_FIRST_LOOK_MS,
  FOLDER_LOG_LIMITS,
  FOLDER_LOG_NOTES_MAX,
  FOLDER_LOG_REQUEST_TOKENS,
  folderLogPath,
  localStamp,
  logFolder,
  MAIL_TOOL_NAMES,
  ROUTINE_RUN_LIMITS,
  routineDays,
  routineDraftProblems,
  routineFailureOf,
  routineNoteTitle,
  routineSkillFits,
  routineSkillHash,
  routineTools,
  noteHints,
  todoLines,
  type NoteHint,
  type PimEventRow,
  type Routine,
  type RoutineDraft,
  type RoutineNeed,
  type RoutineRun,
} from "@plainva/core";
import { skillView } from "./aiSkills";
import { logEntryText, logMaterial, type FolderLogHost, type LogMaterial } from "./folderLogRun";
import type { NoteHintsHost } from "./noteHintsHost";
import { EMPTY_NOTE_HINTS_PREFS, type NoteHintsPrefs, type NoteHintsStore } from "./noteHintsStore";
import type { BrokenLinkToCreate } from "../services/graphActions";
import { AiRoutines, type AiRoutinesState, type RoutineStore } from "./routineSession";
import { AiAcp, type AcpDrafts, type AcpVaultSide, type AiAcpHost, type AiAcpState } from "./acpSession";
import { AiMcp, type AiMcpHost, type AiMcpServer, type AiMcpState, type McpPromptReview, type McpPromptStart } from "./mcpSession";
import type { McpCheck, McpPromptLook, McpSkillAdd } from "./mcpRuntime";
import type { McpVaultStore } from "./mcpStores";
import { createMcpExecutor, newRunMcp, type McpCallQuestion, type McpQuestionSource } from "./mcpTools";
import { AiScripts, type AiScriptsHost, type AiScriptsState, type ScriptApprovalRefusal } from "./scriptSession";
import { createScriptExecutor, newRunScripts, type ActiveScript } from "./scriptTools";
import { EMPTY_MEMORY_STATE, readMemory, type AiMemoryHost, type AiMemoryState } from "./aiMemory";
import { EMPTY_STYLE_PREFS, EMPTY_STYLE_STATE, type AiStyleState, type StyleExample, type StyleOutcome, type StylePrefs, type StylePrefStore, type StyleRefusal } from "./aiStyle";
import { canRewriteSkill, draftsFromLearnings, learnTargets, readStrangersText, skillsUsedBy, takenSkillNames, type LearnLimit, type LearnOutcome, type LearnPlanOutcome, type LearnRefusal, type LearnTarget } from "./aiLearn";
import type { MemoryProblem } from "./memoryView";

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
  /**
   * Scripts (plan KI-Harness P5.5): the sandbox a script runs in — the script
   * worker — and the keychain slot of the key this device signs its script
   * approvals with. Absent, this shell shows scripts and runs none.
   */
  scripts?: AiScriptsHost;
  /**
   * The shell's native side is told whether the device is fully local (plan
   * KI-Harness P7, ADR 0030): it holds the same rule once more behind the
   * session, at the places where it sends something itself. Absent, the
   * session's egress is the one place the rule holds.
   */
  localOnly?(on: boolean): Promise<void>;
}

export interface AiVaultHost {
  /**
   * What this vault's data in the app is filed under on this device
   * (`aiVaultKey`). A script's approval is signed for this vault: one copied
   * into another vault's data holds for nothing there. Absent, no script of
   * this vault is ever active.
   */
  key?: string;
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
  /** Note sizes in bytes, as the index knows them (plan P2b-5); absent, the lens leaves the naive comparison out. */
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
   * they answer that this vault takes no changes here. `scripts`: the
   * vault's scripts this run may find in the tool search (plan P5.5).
   */
  tools(
    recipient: EgressRecipient,
    scope?: ToolScope,
    redact?: ReadonlySet<string>,
    web?: boolean,
    narrowed?: () => readonly string[] | null,
    foreign?: () => readonly ToolManifest[],
    writing?: WriteRun,
    scripts?: () => readonly ToolManifest[],
  ): { names: readonly string[]; more?: readonly string[]; executor: ToolExecutor } | null;
  /** Whether the AI may use the internet in this vault, and the sites it need not ask for (plan P4); absent, it may not. */
  web?: WebSettingsStore;
  /** This vault's choices about foreign MCP servers (plan P4.5): which it uses, and what each may be called with. Absent, it uses none. */
  mcp?: McpVaultStore;
  /**
   * What an external agent's session needs of this vault (plan P4.6): its folder, its files under its rules, its
   * margin. Absent, no agent is started here. Where a note of an agent waits is the session's own list of drafts.
   */
  agents?: Omit<AcpVaultSide, "drafts">;
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
   * The `type` of a note created in this vault — the setting "type for new notes", asked where each shell names it
   * (finding 2026-10-09): a note kept from an answer or made from a draft carries it like every other new note.
   * Absent, or unanswered: the setting's default.
   */
  noteType?(): Promise<string>;
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
  /** The upkeep hints this device was told not to show again (plan P6-3); absent, every hint comes back. */
  upkeep?: UpkeepPrefStore;
  /** The routines of this vault on this device (plan KI-Harness P8, ADR 0033); absent, this vault keeps none here. */
  routines?: RoutineStore;
  /**
   * Whether a note changed on disk since an instant — other than the ones
   * named (plan P8, a routine's "only when something changed"). Asked of this
   * device's index. Absent where there is none: nobody can tell then, which
   * is not "nothing changed".
   */
  changedSince?(since: number, except: readonly string[]): Promise<boolean>;
  /**
   * A folder's log (plan KI-Harness P8-2): which notes of a folder changed,
   * what a note said before, and the one file such a routine writes. Absent
   * where this shell keeps none.
   */
  log?: FolderLogHost;
  /**
   * Calm hints at the open note (plan KI-Harness P8-3): the shell's index,
   * calendar and steps. Absent where this shell offers none.
   */
  hints?: NoteHintsHost;
  /** What is hidden and paused of those hints, in the app's data for this vault on this device. */
  hintPrefs?: NoteHintsStore;
  /**
   * The vault's own instructions — skills in `.agent/skills/` and a root
   * `AGENTS.md` — and their approvals on this device (plan KI-Harness P3);
   * absent where the shell cannot read them.
   */
  instructions?: AiInstructionsHost;
  /**
   * The vault's memory for assistants (plan KI-Harness P6, ADR 0032): its
   * two files, and this device's switch for it. Absent where the shell cannot
   * read the hidden agent area.
   */
  memory?: AiMemoryHost;
  /**
   * The user's writing style for this vault on this device (plan KI-Harness
   * P9-3, ADR 0035): which notes are its examples and which features the user
   * took out, in the app's data. Absent where the shell keeps none.
   */
  style?: StylePrefStore;
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
  /** Writes one NEW file into the vault, its folder created — synced and backed up like any edit (the workshop's skills, plan P3-5). */
  write?(path: string, bytes: Uint8Array): Promise<void>;
  /** Changes a text file of the agent area where it lies, through the chain's one entry (`InstructionWriter.update`). */
  update?(path: string, change: (text: string | null) => string | null): Promise<string | null>;
  /** Removes a folder of the vault after the user confirmed it: through the adapters, so it is backed up and goes to the trash. */
  remove?(path: string): Promise<void>;
  /** One text file of the agent area as it is now — the learning log (plan P6); null where there is none. */
  readText?(path: string): Promise<string | null>;
  /** The vault's version history for the files of its instructions (plan P6); absent where the vault keeps none. */
  versions?: InstructionVersions;
}

/**
 * The vault's version history as the instructions use it (plan P6): the
 * version a skill had before it is rewritten, and the way back to one.
 */
export interface InstructionVersions {
  /** Keeps the file as it is now as a version — unless the newest one already holds exactly this text. Throws where it cannot. */
  snapshot(path: string): Promise<void>;
  /** The versions kept of a file, newest first. `id` names one for `read`. */
  list(path: string): Promise<{ id: string; at: number; size: number }[]>;
  /** One version's text; null where it cannot be read. */
  read(id: string): Promise<string | null>;
}

/** How writing a skill from the workshop ended. */
export type SkillWriteOutcome =
  | { ok: true; id: string; path: string }
  | { ok: false; reason: "no-vault" | "invalid" | "exists" | "write-failed" | "changed"; problems?: SkillProblem[] };

/** A script as the workshop's form hands it over (plan KI-Harness P5.5): what its manifest says, and its code. */
export interface ScriptDraft extends Pick<ScriptDefinition, "name" | "description" | "tools"> {
  title?: string;
  parameters?: ScriptDefinition["parameters"];
  limits?: ScriptDefinition["limits"];
  code: string;
}

/**
 * How writing a script ended. `syntax`: the engine does not read the code;
 * `message` says where. `approved`: false where the keychain gave no key to
 * sign with — the script is written and waits.
 */
export type ScriptWriteOutcome =
  | { ok: true; id: string; approved: boolean }
  | { ok: false; reason: "no-vault" | "invalid" | "exists" | "write-failed" | "changed" | "syntax"; problems?: ScriptProblem[]; message?: string };

/**
 * The scripts that are active on this device, each as the tool a conversation
 * can call it by. `reach`: the tools the conversation itself can reach — a
 * script that names one beyond them is not offered there (a script that
 * proposes changes in a conversation that was given no writing tools would
 * only fail at its first call).
 */
export function activeScriptTools(entries: readonly InstructionEntry[], reach?: ReadonlySet<string>): ToolManifest[] {
  return entries.flatMap((entry) => {
    const script = entry.status === "active" && entry.source.kind === "script" ? entry.source.script : null;
    if (!script || (reach && !script.tools.every((name) => reach.has(name)))) return [];
    return [scriptToolManifest(entry.source.id, script)];
  });
}

/** Skills and vault instructions as the workshop and the entry points show them (plan KI-Harness P3). */
export interface AiSkillsState {
  /** Every source with its state on this device: the app's skills first, then the vault's. */
  entries: InstructionEntry[];
  /** Active skills the catalog had no room for — still startable by hand. */
  omitted: string[];
  /**
   * The skills connected servers serve (plan P9-4b), one group per server
   * this vault uses — apart from `entries` on purpose: what reads the
   * vault's and the app's skills (routines, doors, regression runs, learning,
   * the hints, the chips and the palette) never sees a server's.
   */
  servers: AiServerSkills[];
}

/** The skills one connected server serves, as this vault and this device stand to them (plan P9-4b). */
export interface AiServerSkills {
  serverId: string;
  /** The user's name for the server. */
  label: string;
  /** Where it is reached, for the review: the host of its address, or a program on this device. */
  place: { kind: "http"; host: string } | { kind: "program" };
  /** It can be used in this vault now; otherwise its skills wait — blocked, registered anew, or the device fully local. */
  ready: boolean;
  /** When its list was read last (ISO 8601); whether that failed; whether it lists more than is kept. */
  at: string;
  failed: boolean;
  clipped: boolean;
  /** Addresses the user added by hand. */
  added: number;
  entries: InstructionEntry[];
}

/** One file of a server skill as its review shows it on request: its text, or why it is not shown. */
export interface ServerSkillFileView {
  path: string;
  text: string | null;
  /**
   * `large`: larger than a file of a skill is read; `digest`: other bytes
   * than the manifest names; `text`: no UTF-8; `unavailable`: the server
   * could not be asked for it now; `more`: beyond what one look shows
   * (`SERVER_SKILL_REVIEW_LIMITS`).
   */
  problem?: "large" | "digest" | "text" | "unavailable" | "more";
}

/**
 * What one look at a server skill's files reads and shows, at most: so many
 * files, so many bytes of them together. A skill may carry 512 files and
 * 16 MiB; one click reads no more than a person reads at once.
 */
export const SERVER_SKILL_REVIEW_LIMITS = { files: 20, bytes: 1_048_576 } as const;

/**
 * What a review shows of a server skill when the user asks for it (plan
 * P9-4b): its instructions and each file a model may read of it, every one
 * checked; `invisible` counts the hidden characters in all of them.
 */
export type ServerSkillText =
  | { ok: true; text: string; invisible: number; files: ServerSkillFileView[] }
  /**
   * `digest`, `text`, `frontmatter`, `invalid`: what the server sent is not
   * what its manifest names, so it is not shown (`checkMcpSkillMain`);
   * `changed`: the skill is no longer the one the review shows — it is
   * looked at anew; `unavailable`: the server cannot be asked now.
   */
  | { ok: false; reason: "digest" | "text" | "frontmatter" | "invalid" | "unavailable" | "changed" };

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
  /**
   * What is asked about the picture: an explanation, or a note of it (plan P7) — the same door with another task.
   * The answer is the note; it comes into the vault when the user keeps it.
   */
  purpose?: "explain" | "note";
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
 * A question a foreign server puts to the user during a call or before a
 * prompt (plan KI-Harness P9-4a), shown above the composer as Plainva's own
 * card. `question` is what the server wrote, read and cleaned; the card
 * shows it as the server's words, never as a title or a button. The answer
 * goes to that server alone.
 *
 * `opened`: the page of a question that asks to open one was opened, and
 * the card waits for "Continue". `opening`: it is being opened right now.
 * `openFailed`: it could not be opened.
 */
export interface McpQuestionRequest {
  id: string;
  serverId: string;
  /** The user's name for the server. */
  server: string;
  /** What the server is in the middle of: a call of one of its tools, or a prompt the user started. */
  during: { kind: "tool"; tool: string; title: string } | { kind: "prompt"; name: string };
  question: McpElicitation;
  opened: boolean;
  opening?: boolean;
  openFailed?: boolean;
}

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
  /** A question of a foreign server waiting for the user's answer (plan P9-4a). */
  question: McpQuestionRequest | null;
  /** The foreign MCP servers of this device as they stand for this vault (plan P4.5): what the settings show. */
  mcp: AiMcpState;
  /** The external agents of this device and the session one of them has in this vault (plan P4.6). */
  agents: AiAcpState;
  /** The drafts that wait in this vault on this device, and what became of earlier ones (plan P5). */
  drafts: WriteDraftState;
  /** A column of a database being filled right now (plan P5-4): which, and how far the run is. */
  fill: FillProgress | null;
  /** Scripts on this device (plan P5.5): whether it can run them, and the run the workshop started. */
  scripts: AiScriptsState;
  /** The vault's memory for assistants (plan P6): its entries as its two files hold them, and this device's switch. */
  memory: AiMemoryState;
  /** The user's writing style on this device (plan P9-3): its examples and what this device measured in them. */
  style: AiStyleState;
  /** The next new conversation carries the writing style. Chosen per conversation in the composer, never kept as a default. */
  draftStyle: boolean;
  /** The conversation a review is learning from right now (plan P6-2), by its id; null while none runs. */
  learning: string | null;
  /** The vault has a learning log (plan P6-2): something was taken over from a proposal, and the workshop offers the file. */
  learnLog: boolean;
  /** What this device noticed by itself about the skills and the memory (plan P6-3) — without the hints it was told not to show again. */
  upkeep: AiUpkeepState;
  /** The routines of this vault on this device (plan P8): the list, the one that runs right now, and the note a run left. */
  routines: AiRoutinesState;
  /** Calm hints at the open note (plan P8-3): what is hidden and paused on this device; `version` makes the views ask again. */
  hints: AiNoteHintsState;
}

/**
 * Upkeep hints as the views show them (plan KI-Harness P6-3, ADR 0029):
 * computed on this device from what it already holds — no model, no request.
 */
export interface AiUpkeepState {
  skills: UpkeepHint[];
  memory: UpkeepHint[];
}

export const EMPTY_UPKEEP_STATE: AiUpkeepState = { skills: [], memory: [] };

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
   * An e-mail or an appointment: the app's own composer or event editor is open with it. Nothing was sent or saved,
   * and the draft waits on until the user sends or saves there.
   */
  | { kind: "opened" }
  /**
   * An entry of the memory was written, or taken out, or a rule was added to the vault's instructions (plan P6):
   * done, and nothing to open. `waits`: the rule is in a file this device has not approved yet — it counts once
   * the user reviewed that file. A skill (plan P6-2) was written, or given the instructions of the draft, and is
   * approved on this device as the user saw it: `id` names it for the workshop.
   */
  | { kind: "kept"; what: "memory" | "forget" | "rule" | "skill"; waits?: boolean; id?: string }
  /**
   * `unavailable`: this shell cannot make that kind of thing. `gone`: the draft is not there any more.
   * `changed`: the skill a draft would rewrite is not what the proposal read any more — it changed, or it waits for a review.
   * `invalid`: what would be written is no skill's instructions — nothing, or too much.
   * `no-entry-folder`: the database an entry was drafted for has no folder for new entries (yet, or any more).
   * `exists`: the draft names its own file, and a file of that name is there by now — nothing is written over.
   * `editor-open`: the shell's mail composer could not take the mail, and the draft stays. Neither shell says so any more:
   *   both composers take a drafted mail like every request to write one, and ask before a changed draft goes.
   * `no-calendar`: no calendar takes an appointment right now — the event editor would have nowhere to save to.
   */
  | { kind: "refused"; reason: "off" | "unavailable" | "gone" | "busy" | "failed" | "no-entry-folder" | "exists" | "editor-open" | "no-calendar" | "changed" | "invalid"; message?: string };

/**
 * How going back to an earlier version of a skill ended (plan P6-2). `gone`:
 * the skill, or the version, is not there any more. `changed`: the skill is
 * not as the workshop showed it — or the version is not the text that was
 * shown. `invalid`: the version is no skill as the format defines it.
 * `no-history`: the vault could not keep the current version first, so
 * nothing was written over it.
 */
export type SkillRestoreOutcome = { ok: true } | { ok: false; reason: "unavailable" | "gone" | "changed" | "invalid" | "no-history" | "failed" };

/** How a change to the vault's memory ended (plan P6): written, or why not. */
export type MemoryOutcome = { ok: true } | { ok: false; reason: MemoryProblem };

type Listener = () => void;

/** What the user typed in a conversation so far: their own words, without the context the app put beside them. */
function userTextsOf(conversation: ConversationRecord["conversation"]): string[] {
  return conversation.turns.flatMap((turn) => (turn.role === "user" ? turn.parts.flatMap((part) => (part.type === "text" && !part.context ? [part.text] : [])) : []));
}

/** The vault's type for new notes as its shell names it; undefined where the shell names none or cannot answer. */
async function noteTypeOf(vault: AiVaultHost): Promise<string | undefined> {
  return (await vault.noteType?.().catch(() => null))?.trim() || undefined;
}

/** The time of day as the journal writes it: HH:mm. */
function clockOf(now: Date): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/** What of a conversation is the user's to choose (strand 6, step 8): the rest is what its runs bring. */
type ConversationChoices = Pick<ConversationRecord, "title" | "pins" | "providerId" | "model" | "redact">;

/** The user's choices of a conversation, as they travel with a run (strand 6, step 8). */
function choicesOf(record: ConversationChoices): ConversationChoices {
  return { title: record.title, pins: record.pins, providerId: record.providerId, model: record.model, ...(record.redact ? { redact: record.redact } : {}) };
}

/**
 * `record` with the user's choices of `from` (strand 6, step 8): its title,
 * its pins, what goes redacted and the model of its next message. Everything
 * else — the turns, the usage, the runs — stays `record`'s.
 */
function withChoicesOf(record: ConversationRecord, from: ConversationChoices): ConversationRecord {
  const next: ConversationRecord = { ...record, title: from.title, pins: from.pins, providerId: from.providerId, model: from.model };
  if (from.redact) next.redact = from.redact;
  else delete next.redact;
  return next;
}

/**
 * Whether a conversation a run of the app made is still that alone (strand 6,
 * step 9): its one run, under the title the app gave it (`appTitle`; for one
 * made before that was kept, `title`, the one the app gives it now), on the
 * run's model, nothing pinned, and redacted only what the run itself sent
 * redacted. One the user went on with — a message, a title, a pin, a
 * redaction, another model — is the user's; and so is one that cannot be read
 * (`null`): nothing tells it is the app's alone.
 */
function onlyItsOwnRun(stored: ConversationRecord | null, title: string): boolean {
  if (!stored) return false;
  const run = stored.runs[0];
  return (
    stored.runs.length <= 1 &&
    stored.title === (stored.appTitle ?? title) &&
    stored.pins.length === 0 &&
    sameEntries(stored.redact, run?.redact) &&
    (!run || stored.providerId === run.providerId) &&
    (!run || stored.model === run.model)
  );
}

/** Whether two lists hold the same entries, in whatever order. */
function sameEntries(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = new Set(a ?? []);
  const right = new Set(b ?? []);
  return left.size === right.size && [...left].every((entry) => right.has(entry));
}

/** What a run on its way holds of its conversation (strand 6, step 8; `running`). */
interface RunEntry {
  vault: AiVaultHost;
  stored: ConversationRecord | null;
  choices: ConversationChoices | null;
}

/**
 * Which vault's data a host stands for (strand 6, step 8): its data key where
 * it has one — a shell hands a new host for the same vault when what it is
 * made of changes —, else the host itself.
 */
function vaultOf(vault: AiVaultHost): unknown {
  return vault.key ?? vault;
}

/** What the send overview shows of a conversation's instructions (plan KI-Harness P3). */
function manifestInstructionsOf(instructions: ConversationInstructions | undefined): ManifestInstructions | undefined {
  if (!instructions) return undefined;
  const out: ManifestInstructions = {};
  const skill = instructions.skill;
  if (skill) out.skill = { id: skill.id, name: skill.name, origin: skill.origin, tokens: instructions.skillTokens ?? 0, ...(skill.localPreferred ? { localPreferred: true } : {}) };
  if (instructions.catalog?.length) {
    const servers = instructions.catalog.filter((e) => e.origin === "server").length;
    out.catalog = { count: instructions.catalog.length, vault: instructions.catalog.filter((e) => e.origin === "vault").map((e) => e.id), tokens: instructions.catalogTokens ?? 0, ...(servers ? { servers } : {}) };
  }
  if (instructions.vaultTokens) out.vault = { tokens: instructions.vaultTokens };
  return Object.keys(out).length ? out : undefined;
}

/** What the overview says of the memory a conversation was started with (plan P6): counts, never an entry. */
function manifestMemoryOf(instructions: ConversationInstructions | undefined): ManifestMemory | undefined {
  const memory = instructions?.memory;
  return memory ? { entries: memory.entries, withheld: memory.withheld, tokens: memory.tokens, lookup: memory.lookup } : undefined;
}

/** The writing style a conversation was started with, as the overview names it (plan P9-3). */
function manifestStyleOf(style: ConversationStyle | undefined): ManifestStyle | undefined {
  return style ? { features: style.features, examples: style.examples, withheld: style.withheld, tokens: style.tokens } : undefined;
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

/**
 * A run asked again of another model (plan KI-Harness P9-2, ADR 0034): a
 * conversation of its own, begun as the user would begin it — the vault's
 * memory, its tools, the skill the original was bound to —, with the
 * original run's sources pinned and nothing a search would find besides
 * them, and without the note that happens to be open. The gate holds as it
 * holds now; the send overview asks as for every request.
 */
interface ReplayStart {
  title: string;
  /** The original run's notes: they go along, and nothing else of the vault does by itself. */
  pins: string[];
  of: ReplayOf;
  /** The original conversation carried the internet's tools: the replay does where the vault allows it now. */
  web: boolean;
  /** The user chose the writing style for the original (plan P9-3): the replay carries it, measured for its own reader. */
  style: boolean;
}

/**
 * A run nobody watches (plan KI-Harness P8, ADR 0033): a routine. A
 * conversation of its own, bound to its skill, with the tools that read and
 * nothing else — and no question on the way. Where a person's run would show
 * the send overview, this one compares what it would bring along with what
 * was confirmed for the routine (`scope`): within it, it goes; beyond it,
 * nothing is sent and the run ends with what it needs. `preview`: put
 * together what a run would send and stop there — the confirmation shows it.
 */
interface RoutineStart {
  title: string;
  limits: RunLimits;
  /** What was confirmed to go to the routine's model; null where nothing was — a model on this device needs none. */
  scope: ApprovedScope | null;
  preview?: boolean;
  /**
   * A folder's log (plan P8-2): the run brings its own material — the notes
   * that changed, with what to write — and names it in the overview. It has
   * no tools, no skill, no memory and nothing else of the vault.
   */
  log?: { lead: TextPart; disclose(manifest: EgressManifest): EgressManifest };
}

/** How a run ended; with the conversation it left and the answer's text once a request went out. */
interface RunOutcome {
  stop: RunStop;
  record?: ConversationRecord;
  answer?: string;
  /** A routine's run that ended without sending: what it needs from its user. */
  need?: RoutineNeed;
  /** A routine's preview: what a run would send, and what it may spend. */
  manifest?: EgressManifest;
  limits?: RunLimits;
}

/**
 * What the confirmation of a routine shows (plan KI-Harness P8): put
 * together like a run, and never sent.
 */
export interface RoutinePreview {
  /** The skill, and what it is right now (`routineSkillHash`): the routine is confirmed for this. */
  skill: { id: string; hash: string };
  /** Who would read: the provider's name and the model. */
  provider: string;
  model: string;
  /** The model runs on this device: nothing leaves it, and nothing has to be confirmed about what goes. */
  here: boolean;
  /** What a run would bring along today. */
  manifest: EgressManifest;
  /** On a second look: what would go now beyond what was confirmed for this routine. */
  growth: ScopeGrowth[];
  limits: RunLimits;
  /** The folder its note goes to ("" for the top of the vault), and what today's would be called. */
  folder: string;
  noteTitle: string;
  /** A shared workspace: others read what the routine writes. */
  shared: boolean;
  /** The device asks before every request and the model is not on it: this routine would rest. */
  everyRequest: boolean;
  /** Its skill names tools that read e-mails and the model is not on this device: a routine does not read them there. */
  noMail: boolean;
  /** A folder's log instead of a skill (plan P8-2): the folder, its file, how many notes today's entry would name, and how many one entry names at most. */
  log?: { folder: string; file: string; notes: number; max: number };
}

/**
 * Why no confirmation could be shown: the AI is off or the vault keeps no routines, or the skill, the model or the
 * device stands in the way; `rules`: the user's rules keep the folder of a log from its model.
 */
export type RoutinePreviewRefusal = "off" | "skill" | "model" | "local" | "rules" | "failed";
export type RoutinePreviewOutcome = { kind: "preview"; preview: RoutinePreview } | { kind: "refused"; reason: RoutinePreviewRefusal };
/** Whether a confirmed routine is stored now; `full`: the device keeps no more of them. */
export type RoutineSaved = "saved" | "full" | "failed";
/** A run of a routine, or why none began. */
export type RoutineRunOutcome = { kind: "ran"; run: RoutineRun } | { kind: "refused"; reason: "off" | "busy" | "gone" | "not-due" };

/** One hint at the open note as the views show it (plan KI-Harness P8-3), with what its step needs. */
export interface NoteHintItem extends NoteHint {
  /** A link that leads nowhere: what creating its note needs. */
  link?: BrokenLinkToCreate;
  /** A TODO line as it stood when the hint was found: the step changes it only while it still stands so. */
  raw?: string;
  /** Tomorrow's appointment without a note. */
  event?: PimEventRow;
}
/** `off`: the AI or the hints are off on this device, or the shell offers none. */
export type NoteHintsAnswer = { kind: "off" } | { kind: "vaultPaused" } | { kind: "paused" } | { kind: "hints"; items: NoteHintItem[] };
/** How a hint's step ended: done where it stands, a note to open, the line no longer that line, the template's questions cancelled (nothing written), or failed. */
export type NoteHintOutcome = { kind: "done" } | { kind: "opened"; path: string } | { kind: "gone" } | { kind: "cancelled" } | { kind: "failed" };
/** The hints' bookkeeping on this device for the open vault; `version` moves with every change, so the views ask again. */
export interface AiNoteHintsState {
  available: boolean;
  prefs: NoteHintsPrefs;
  version: number;
}
export const EMPTY_NOTE_HINTS_STATE: AiNoteHintsState = { available: false, prefs: EMPTY_NOTE_HINTS_PREFS, version: 0 };
/** How one run of a routine ended, with the conversation it left in the history. */
/** `coveredAt`: for a folder's log, the instant its changes were read — the next entry looks from there. */
type RoutineEnd = Omit<RoutineRun, "scheduledFor" | "at"> & { conversationId?: string; coveredAt?: string };

const sameChoice = (a: ModelChoice, b: ModelChoice) => a.providerId === b.providerId && a.model === b.model;

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

/** The skills of the servers that can be used now (plan P9-4b): what a conversation's catalog may list of them. */
export function readyServerSkills(servers: readonly AiServerSkills[]): InstructionEntry[] {
  return servers.filter((group) => group.ready).flatMap((group) => group.entries);
}

/** Where a server is reached, for the review of its skills: the host of its address, or a program on this device. */
/** The byte order mark, which a decoder drops from the front of a text it reads. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

function serverPlace(server: Pick<AiMcpServer, "registered">): AiServerSkills["place"] {
  if (server.registered.kind !== "http") return { kind: "program" };
  try {
    return { kind: "http", host: new URL(server.registered.url ?? "").host };
  } catch {
    return { kind: "http", host: "" };
  }
}

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
  /**
   * What a run and the user write of a conversation (strand 6, step 8): the
   * run its turns, its usage and its record, when it ends; the user its title,
   * its pins, what goes redacted and its model, whenever they choose. While a
   * run is on its way, a choice goes onto the conversation as it was stored
   * before the run (`stored`; `null` where the run began it and it is in
   * no storage yet), never onto the run's unfinished turns, and the latest one
   * travels with the run (`choices`) — also where its conversation is on no
   * screen by the time the run ends. From the run's end until its end is
   * decided, `stored` is the conversation with the run's turns and record in
   * it, so that a choice then goes onto those — whatever the screen shows
   * meanwhile. A run that broke wrote nothing: its entry stays until the
   * conversation's next run, and a choice still goes onto the conversation as
   * it was stored. `vault`: the vault the run belongs to.
   */
  private readonly running = new Map<string, RunEntry>();
  /**
   * The listing of the vault's conversations the last attaching began (strand
   * 6, step 10): what a run that attaching stopped still writes enters the
   * history once that listing is through.
   */
  private listing: Promise<void> = Promise.resolve();
  /**
   * Each conversation's writes and its deletions, one after the other, with
   * the vault they go to: a later one is never overtaken by an earlier one.
   */
  private readonly writing = new Map<string, { vault: AiVaultHost; done: Promise<void> }>();
  /** How many writes and deletions of each conversation were asked for: a read knows whether one came while it read. */
  private readonly changes = new Map<string, number>();
  /** A "Delete all" on its way, per vault (`vaultOf`): every write and read of that vault's conversations waits for it. */
  private readonly clearings = new Map<unknown, Promise<void>>();
  /** How many times "Delete all" was asked for, per vault: a read knows whether one came while it read. */
  private readonly clears = new Map<unknown, number>();
  /**
   * The deletions of each conversation on their way (strand 6, step 8): one
   * that fails takes back only itself, never another of the same
   * conversation. Asked for — done or not yet —, a conversation comes on
   * screen through no run's end; an opening reads it once the deletion is
   * through.
   */
  private readonly deleting = new Map<string, number>();
  /** Conversations whose deletion is done: no write that comes afterwards writes them back. */
  private readonly deleted = new Set<string>();
  /** Renames on their way, per conversation (step 9): the user's step, which the app's own deletion leaves alone. */
  private readonly renaming = new Map<string, number>();
  /**
   * Counts on whenever the user leaves what a message of the composer is put
   * together for — another conversation opened, a new one begun, the one on
   * screen deleted, a vault attached (strand 6, step 8): such a message goes
   * nowhere. A "Delete all" is counted apart (`clears`); a message whose vault
   * went goes nowhere by that alone.
   */
  private screens = 0;
  /** Counts on whenever a run begins on screen (step 8): an opening that comes back after one does not take the screen. */
  private started = 0;
  /** The send overview that is open asks about a message of the composer. */
  private composerConsent = false;
  /** Set synchronously on send: two quick presses never start two runs. */
  private sending = false;
  /** Recordings being transcribed now: one run per file. */
  private transcribing = new Set<string>();
  /** Ends the run that fills a column, between two of its entries. */
  private fillAbort: AbortController | null = null;
  /** The review that is learning from a conversation right now (plan P6-2). */
  private learnAbort: AbortController | null = null;
  /** A sentence is on its way to become filter rules. */
  private filtering = false;
  /** An answer is being kept as a note right now. */
  private capturing = false;
  /** What the user approved in this app session (E25); a server on this computer needs none. */
  private scope: ApprovedScope | null = null;
  private consentAnswer: ((answer: ConsentAnswer) => void) | null = null;
  /** The request to the internet that waits for an answer, if one does. */
  private effectAnswer: ((answer: EffectAnswer) => void) | null = null;
  /** The question of a foreign server that waits for an answer, if one does (plan P9-4a). */
  private questionAnswer: ((answer: McpElicitResult) => void) | null = null;
  /** Questions of servers come one at a time: the next one waits here until the one before is answered. */
  private questionLane: Promise<unknown> = Promise.resolve();
  /** Ends the prompt of a server that is being started, with whatever it waits for (plan P9-4a). */
  private promptAbort: AbortController | null = null;
  /** The lane of changes to the list of drafts (plan P5). */
  private draftLane: Promise<unknown> = Promise.resolve();
  private creatingDraft = false;
  /** Each vault's list of drafts as an agent's session was handed it: one per vault, told apart by identity. */
  private readonly agentDraftPorts = new WeakMap<AiVaultHost, AcpDrafts>();
  /** Conversations on screen right now: the places where the send overview can be answered. */
  private surfaces = 0;
  /** How the shell puts a conversation on screen (the companion, the AI sheet). */
  private reveal: (() => void) | null = null;
  /** Foreign MCP servers (plan P4.5): what the settings drive, and what a run asks before it calls one. */
  readonly mcp: AiMcp;
  /** External agents (plan P4.6): the agents of this device, and the session one has in the open vault. */
  readonly agents: AiAcp;
  /** Scripts (plan P5.5): this device's key for their approvals, and the run the workshop started. */
  readonly scripts: AiScripts;
  /** Routines (plan P8): the list this device keeps for the open vault, and which of them runs. */
  private readonly routines: AiRoutines;

  /**
   * The one egress of this session (plan P7, ADR 0030): whatever it sends to
   * a model passes here, and while the device is fully local a request for
   * anyone but this device is answered here and handed to nobody. Until the
   * settings are read nothing leaves either — what the switch says is not
   * known yet.
   */
  private readonly out: LocalOnlyEgress;

  constructor(private readonly host: AiSessionHost) {
    this.out = localOnlyEgress(host.egress, {
      on: () => !this.state.loaded || this.state.settings.localOnly,
      onDevice: (endpointId) => runsOnDevice(providerById(endpointId, this.state.settings.custom)),
    });
    // Foreign servers and external agents rest while the device is fully local: each has a way out of its own.
    const resting = () => this.state.settings.localOnly;
    this.mcp = new AiMcp(
      host.mcp,
      { now: () => host.now(), newId: () => host.newId() },
      (mcp) => {
        this.set({ mcp });
        // What the settings did to a server — approved, switched, blocked — shows in the workshop's groups too.
        this.refreshServerGroups();
      },
      resting,
      (id) => this.forgetServerSkills(id),
    );
    this.agents = new AiAcp(host.acp, { now: () => host.now() }, (key, vars) => host.label?.(key, vars) ?? key, (agents) => this.set({ agents }), resting);
    this.scripts = new AiScripts(host.scripts, (scripts) => this.set({ scripts }));
    this.routines = new AiRoutines((routines) => this.set({ routines }));
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
      skills: { entries: APP_ENTRIES(), omitted: [], servers: [] },
      skillTests: { records: [], running: null },
      web: DEFAULT_WEB_SETTINGS,
      draftWeb: false,
      effect: null,
      question: null,
      mcp: this.mcp.state,
      agents: this.agents.state,
      drafts: EMPTY_WRITE_DRAFTS,
      fill: null,
      scripts: this.scripts.state,
      memory: EMPTY_MEMORY_STATE,
      style: EMPTY_STYLE_STATE,
      draftStyle: false,
      learning: null,
      learnLog: false,
      upkeep: EMPTY_UPKEEP_STATE,
      routines: this.routines.state,
      hints: EMPTY_NOTE_HINTS_STATE,
    };
  }

  readonly getState = (): AiState => this.state;

  /** The native egress, for search by meaning's own provider (plan P2a-5): the keys stay native. */
  get egress(): AiEgress {
    return this.out;
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
    const settings = readAiAppSettings(raw, this.host.defaults);
    // The native side learns what the switch says before the first request can pass this side's own check.
    await this.tellNative(settings.localOnly);
    this.set({ settings, loaded: true });
    await this.refreshKeys();
  }

  async updateSettings(change: (current: AiAppSettings) => AiAppSettings): Promise<void> {
    const before = this.state.settings;
    const settings = change(before);
    this.set({ settings });
    if (settings.localOnly !== before.localOnly) {
      // Switched on: this side's check holds from the line above on, and what rests ends before the choice is even stored.
      if (settings.localOnly) this.restForLocalOnly();
      this.refreshServerGroups();
      await this.tellNative(settings.localOnly);
    }
    await this.host.saveSettings(settings);
  }

  /** Tells the shell's native side what the switch says. A side that cannot be told leaves this side's check as the one that holds. */
  private async tellNative(on: boolean): Promise<void> {
    await this.host.localOnly?.(on).catch(() => undefined);
  }

  /**
   * "Fully local" was switched on (plan P7, ADR 0030): whatever is under way
   * to anyone but this device ends now — a request to a provider, a page or
   * a search that waits for its answer, the connections to foreign servers
   * and the programs behind them, an agent's session. What is set up stays
   * set up; it rests.
   */
  private restForLocalOnly(): void {
    this.out.rest();
    this.settleEffect("deny");
    this.promptAbort?.abort();
    this.settleQuestion({ action: "cancel" });
    this.answerConsent(false);
    const draft = this.state.draftChoice;
    this.set({ draftWeb: false, ...(draft && !choiceOnDevice(this.state.settings, draft) ? { draftChoice: null } : {}) });
    this.mcp.rest();
    this.agents.rest();
  }

  /**
   * The window of the chosen model where it is known: what its user stated
   * (plan P7 — a server on this device tells nobody), else what the
   * provider's model list reported, else what a platform model has (plan P2c).
   */
  private windowOf(provider: ProviderInfo, model: string): number | undefined {
    return statedModelFacts(this.state.settings, provider.id, model).contextTokens ?? this.state.tests[provider.id]?.models?.find((m) => m.id === model)?.contextTokens ?? provider.contextTokens;
  }

  /** A model that is given no tools: the system's own (plan P2c), and one on this device whose user said so (plan P7). */
  private toolless(provider: ProviderInfo, model: string): boolean {
    return provider.endpoint.api === "platform" || statedModelFacts(this.state.settings, provider.id, model).tools === false;
  }

  /**
   * What a request to this model is told about it. The system's own model:
   * its window, to which the request is cut (plan P2c). A model on this
   * device as its user described it (plan P7): that it takes no tools, and
   * the window a request has to fit — one that cannot is not sent.
   */
  private modelLimits(provider: ProviderInfo, model: string): { contextTokens?: number; toolless?: true; window?: number } {
    if (provider.endpoint.api === "platform") return { contextTokens: this.windowOf(provider, model) ?? PLATFORM_CONTEXT_DEFAULT };
    const stated = statedModelFacts(this.state.settings, provider.id, model);
    return { ...(stated.tools === false ? { toolless: true as const } : {}), ...(stated.contextTokens ? { window: stated.contextTokens } : {}) };
  }

  /**
   * The tokens a request of this conversation takes before a message's own
   * notes (plan P7): what the context package of a small window is made
   * smaller by. Undefined where no window is known, and for the system's own
   * model, whose request is put together anew each time.
   */
  private carriedTokens(provider: ProviderInfo, model: string, conversation: ConversationRecord["conversation"]): number | undefined {
    if (provider.endpoint.api === "platform" || this.windowOf(provider, model) === undefined) return undefined;
    const tools = this.toolless(provider, model) ? [] : conversation.tools.map((name) => toolByName(name)).filter((tool): tool is ToolManifest => Boolean(tool));
    return estimateRequestTokens(conversation, tools) + WINDOW_BUDGET_ROOM;
  }

  /**
   * Fully local (plan P7, ADR 0030): a model that is not on this device is
   * not asked. A door checks this before it reads, asks or builds anything —
   * a question about sending what cannot be sent would be no question — and
   * reports it as the failure it is, in the words every surface has for it.
   */
  private notThisDevice(provider: ProviderInfo): { failure: ModelFailure; text: string } | null {
    if (!this.state.settings.localOnly || runsOnDevice(provider)) return null;
    return { failure: { kind: "local_only" }, text: this.host.label?.("ai.error.localOnly", { provider: provider.label }) ?? "local_only" };
  }

  providers(): ProviderInfo[] {
    return allProviders(this.state.settings.custom);
  }

  async refreshKeys(): Promise<void> {
    const keys: Record<string, boolean> = {};
    for (const provider of this.providers()) {
      if (!provider.endpoint.needsKey) continue;
      try {
        keys[provider.id] = await this.out.hasKey(provider.id);
      } catch {
        keys[provider.id] = false;
      }
    }
    this.set({ keys });
  }

  async setKey(providerId: string, key: string): Promise<void> {
    await this.out.setKey(providerId, key.trim());
    this.set({ keys: { ...this.state.keys, [providerId]: true } });
  }

  async deleteKey(providerId: string): Promise<void> {
    await this.out.deleteKey(providerId);
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

  /** What choosing and shortening the notes saved in one month (`YYYY-MM`) of this vault's run ledger (plan P9-6). */
  async savings(month: string): Promise<ReturnType<typeof aiMonthlySavings>> {
    const vault = this.vault;
    if (!vault) return { savedTokens: 0, runs: 0 };
    return aiMonthlySavings(await vault.ledger.load().catch(() => []), month);
  }

  /** Adds an OpenAI-compatible server after the shell's native confirmation. */
  async addCustom(label: string, baseUrl: string, id: string, local: boolean): Promise<boolean> {
    const added = await this.out.addEndpoint(id, baseUrl);
    if (!added) return false;
    await this.updateSettings((s) => ({ ...s, custom: [...s.custom.filter((c) => c.id !== id), { id, label, baseUrl, api: "openai-chat", local }] }));
    return true;
  }

  async removeCustom(id: string): Promise<void> {
    await this.out.removeEndpoint(id);
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
      const answer = await fetchProviderJson(this.out, modelListSpec(provider.endpoint), `test-${this.host.newId()}`);
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
    // The screen begins anew: a message of the composer goes nowhere, also where the vault is the same.
    this.leaveComposerMessage();
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
      skills: { entries: APP_ENTRIES(), omitted: [], servers: [] },
      skillTests: { records: [], running: null },
      // Another vault's switch says nothing about this one: off until its own settings are read.
      web: DEFAULT_WEB_SETTINGS,
      draftWeb: false,
      // Another vault's drafts are not this one's.
      drafts: EMPTY_WRITE_DRAFTS,
      // A column that was being filled belongs to the vault that is gone; its run ends with its next entry.
      fill: null,
      // Another vault's memory is not this one's: empty until this vault's own files are read.
      memory: EMPTY_MEMORY_STATE,
      // Nor its writing style: this vault's examples are read from this device's data for it.
      style: { ...EMPTY_STYLE_STATE, available: Boolean(vault?.style) },
      draftStyle: false,
      // A review that was learning from a conversation of the vault that is gone ends with it.
      learning: null,
      learnLog: false,
      upkeep: EMPTY_UPKEEP_STATE,
      // Another vault's hidden and paused hints are not this one's: none until its own are read.
      hints: { available: Boolean(vault?.hints && vault.hintPrefs), prefs: EMPTY_NOTE_HINTS_PREFS, version: this.state.hints.version + 1 },
    });
    this.upkeepPlan = null;
    this.fillAbort?.abort();
    this.learnAbort?.abort();
    // A script the workshop started ran on the vault that is gone: it ends here, and what it showed goes with it.
    this.scripts.clear();
    // Another vault's routines are not this one's: its own list is read from this device's data. A routine that was
    // running ran on the vault that is gone — the stop above ended it.
    this.routines.attach(vault?.routines ?? null);
    // The same for foreign servers: which this vault uses is its own choice, and the connections of the last one end here.
    this.mcp.attach(vault?.mcp ?? null);
    // And for an external agent: its session belongs to the vault it was started in, and ends with it. A note it
    // writes waits in that vault's list of drafts.
    this.agents.attach(vault?.agents ? { ...vault.agents, drafts: this.agentDrafts(vault) } : null);
    if (!vault) return;
    void this.refreshSkills();
    void this.loadWebSettings(vault);
    void this.loadDrafts(vault);
    void this.refreshMemory();
    void this.refreshStyle();
    void this.loadHintPrefs(vault);
    this.listing = this.listConversations(vault);
    await this.listing;
  }

  /**
   * The history of a vault attached: what a "Delete all" of this vault leaves
   * (step 8), read once such a clearing is through, and again where a Delete
   * all came meanwhile.
   */
  private async listConversations(vault: AiVaultHost): Promise<void> {
    let listed: ConversationSummary[];
    for (;;) {
      const clears = this.clearsOf(vault);
      await this.clearings.get(vaultOf(vault));
      // What is in use as the list is read, and how often each conversation was written by then: one written since may
      // be newer than the list says, and waits for the next attaching.
      const used = new Set([...this.writing.keys(), ...this.running.keys()]);
      const writes = new Map(this.changes);
      listed = await vault.conversations.list().catch(() => [] as ConversationSummary[]);
      // Expired ones go like any deletion, after their writes — none in use when the list was read (being written or
      // run), none on screen now, and none written since — a run that began since is on screen until its end writes it.
      for (const id of expiredConversations(listed, this.state.settings.historyDays, this.host.now())) {
        const inUse = used.has(id) || this.state.active?.id === id;
        if (!inUse && (this.changes.get(id) ?? 0) === (writes.get(id) ?? 0)) await this.deleteStored(vault, id).catch(() => undefined);
      }
      if (this.vault !== vault) return;
      if (this.clearsOf(vault) === clears) break;
    }
    // Nothing whose deletion is done; one whose deletion is still on its way stays listed — the deletion takes it off
    // once it is through, and one that fails leaves it.
    this.set({ summaries: sortSummaries(listed.filter((s) => !this.deleted.has(s.id))) });
  }

  /**
   * What a run still wrote after a new host of its vault stopped it (strand 6,
   * step 10): its conversation enters the history once the attaching's listing
   * is through — as the vault now stores it. The reading is the rule: a
   * conversation deleted meanwhile, cleared by a Delete all, never written, or
   * not this vault's reads as nothing (`loaded` waits for each of them). One
   * more attaching since the reading lists its own vault anew.
   */
  private async listStopped(id: string): Promise<void> {
    const host = this.vault;
    if (!host) return;
    const stored = await this.loaded(host, id);
    if (!stored || this.vault !== host) return;
    this.set({ summaries: sortSummaries([conversationSummaryOf(stored), ...this.state.summaries.filter((s) => s.id !== id)]) });
  }

  async open(id: string): Promise<void> {
    const vault = this.vault;
    if (!vault || this.state.live) return;
    this.dropWriteQuestion();
    if (this.state.active?.id !== id) this.leaveComposerMessage();
    const screen = this.screens;
    const started = this.started;
    // Read again where a write of it came while the reading came back (strand 6, step 10): the end of a run that a new
    // host stopped can land between the reading's check and this step, off screen, and nothing would take it back.
    let record: ConversationRecord | null;
    for (;;) {
      const changes = this.changes.get(id) ?? 0;
      record = await this.loaded(vault, id);
      if ((this.changes.get(id) ?? 0) === changes) break;
    }
    // A later step on screen — another conversation, a new one, a deletion of the one on screen — wins over a reading
    // that comes late, and so does a run that began since; one deleted meanwhile is read as gone (`loaded`).
    if (!record || this.vault !== vault || this.screens !== screen || this.started !== started) return;
    // The screen changes only now: a message of the composer begun since the click goes nowhere either.
    if (this.state.active?.id !== id) this.leaveComposerMessage();
    this.set({ active: record, excludeActive: false, notice: null });
  }

  newConversation(): void {
    if (this.state.live) return;
    this.dropWriteQuestion();
    // Its drafts begin anew: a message of the composer that waits in its overview goes nowhere.
    this.leaveComposerMessage();
    this.set({ active: null, excludeActive: false, draftPins: [], draftRedact: [], draftChoice: null, draftWeb: false, draftStyle: false, notice: null });
  }

  /**
   * Leaving what a message of the composer is put together for (strand 6,
   * step 8) — another conversation opened, a new one begun, the one on screen
   * deleted, a vault attached — is a no to that message, as Cancel is: it
   * would go with what the screen no longer is. Its words come back to the
   * field. Its overview, where one is open, closes at once; a message still
   * being put together finds the screen changed before it goes. A "Delete
   * all" says no to it by its own count (`clears`).
   */
  private leaveComposerMessage(): void {
    this.screens++;
    if (this.composerConsent) this.answerConsent(false);
  }

  /**
   * A conversation as it is stored, once every write of it and a "Delete
   * all" asked for before have landed (strand 6, step 8) — read again where
   * one more was asked for while it was read.
   */
  private async loaded(vault: AiVaultHost, id: string): Promise<ConversationRecord | null> {
    for (;;) {
      const changes = this.changes.get(id) ?? 0;
      const clears = this.clears.get(vaultOf(vault)) ?? 0;
      await this.writing.get(id)?.done;
      await this.clearings.get(vaultOf(vault));
      const record = await vault.conversations.load(id);
      if ((this.changes.get(id) ?? 0) === changes && (this.clears.get(vaultOf(vault)) ?? 0) === clears) return record;
    }
  }

  /** How many times "Delete all" was asked for of this vault: an action that began before one goes nowhere (step 8). */
  private clearsOf(vault: AiVaultHost): number {
    return this.clears.get(vaultOf(vault)) ?? 0;
  }

  /** Whether a conversation's deletion was asked for — done, or still on its way (strand 6, step 8). */
  private gone(id: string): boolean {
    return this.deleted.has(id) || this.deleting.has(id);
  }

  /** One more deletion of a conversation on its way. */
  private askDeletion(id: string): void {
    this.deleting.set(id, (this.deleting.get(id) ?? 0) + 1);
  }

  /** A deletion of a conversation through: done — or failed, and then it takes back only itself. */
  private settleDeletion(id: string, done: boolean): void {
    const left = (this.deleting.get(id) ?? 1) - 1;
    if (left > 0) this.deleting.set(id, left);
    else this.deleting.delete(id);
    if (done) this.deleted.add(id);
  }

  /**
   * Deletes a conversation from storage (strand 6, step 8): after every write
   * of it, counted. Once it is deleted, it leaves the history and the screen —
   * an id names one conversation on this device —, also where an attaching
   * listed it while the deletion was on its way, or the shell made a new host
   * meanwhile; a notice about it goes with it. One that cannot be deleted
   * stays where it is.
   *
   * `ownOnly`: the app's own deletion (step 9). It is asked of the
   * conversation as it is stored, in its turn after every write of it, and
   * only then marked as on its way: one the user renames meanwhile, one that
   * cannot be read and one `ownOnly` refuses stay, and nothing about them
   * changes meanwhile.
   */
  private async deleteStored(vault: AiVaultHost, id: string, ownOnly?: (stored: ConversationRecord | null) => boolean): Promise<void> {
    // The user's deletion is on its way at once, and cuts a review of the conversation off at once.
    if (!ownOnly) {
      if (this.state.learning === id) this.learnAbort?.abort();
      this.askDeletion(id);
    }
    // How often it was written or deleted once this step was asked for: one more since is a step of the user's.
    let asked = 0;
    const step = this.queued(vault, id, async () => {
      if (ownOnly) {
        // One that cannot be read stays: the step ends here, and nothing about the conversation changed.
        const stored = await vault.conversations.load(id);
        if (this.renaming.has(id) || (this.changes.get(id) ?? 0) !== asked || !ownOnly(stored)) return;
        this.askDeletion(id);
      }
      try {
        await vault.conversations.remove(id);
      } catch (error) {
        // Not deleted after all: what was or is written of it lands as before.
        this.settleDeletion(id, false);
        throw error;
      }
      this.settleDeletion(id, true);
      this.set({
        summaries: this.state.summaries.filter((s) => s.id !== id),
        ...(this.state.active?.id === id ? { active: null } : {}),
        ...(this.state.notice?.conversationId === id ? { notice: null } : {}),
      });
    });
    asked = this.changes.get(id) ?? 0;
    await step;
  }

  /**
   * The question before an answer is kept where others read (plan P4-6) is
   * about the conversation on screen. Leaving that conversation is a no: the
   * card does not stay behind over another one.
   */
  private dropWriteQuestion(): void {
    if (this.state.effect?.kind === "write") this.settleEffect("deny");
    // A prompt of a server the user started here belongs to this conversation, and its questions with it (plan P9-4a).
    this.promptAbort?.abort();
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
        // An agent's session hears what became of the notes it left (plan P5-6), wherever the user decided about them.
        const port = this.agentDraftPorts.get(vault);
        if (port) {
          this.agents.draftsChanged(port, {
            waiting: new Set(next.drafts.map((draft) => draft.id)),
            // A note an agent wrote is created or thrown away; the other ends are those of a mail or an appointment.
            ended: new Map(next.done.flatMap((outcome) => (outcome.outcome === "created" || outcome.outcome === "discarded" ? [[outcome.id, outcome.outcome] as const] : []))),
          });
        }
        return next;
      });
    this.draftLane = work;
    return work;
  }

  /**
   * A vault's list of drafts as an external agent's session reaches it (plan
   * P5-6). A note an agent wrote names its own file, so its draft is one of a
   * kind per writer and path: written again, it takes the place of the one
   * before and keeps its id — the card the user is looking at stays the same
   * card. It inherits no rule: an agent is handed no note that carries one
   * (`acpGate`). One port per vault, so the session can tell whose drafts
   * changed.
   */
  private agentDrafts(vault: AiVaultHost): AcpDrafts {
    const known = this.agentDraftPorts.get(vault);
    if (known) return known;
    const mine = (draft: WriteDraft, authorId: string, path: string) => draft.author.id === authorId && draft.body.kind === "note" && draft.body.path === path;
    const port: AcpDrafts = {
      room: async (authorId, path) => {
        if (!vault.drafts) return false;
        const { drafts } = await vault.drafts.load();
        return drafts.length < WRITE_DRAFT_LIMITS.drafts || drafts.some((draft) => mine(draft, authorId, path));
      },
      leave: async (note) => {
        let problem: "full" | "invalid" = "invalid";
        let id = "";
        const next = await this.changeDrafts(vault, (state) => {
          const before = state.drafts.find((draft) => mine(draft, note.author.id, note.path));
          const draft: WriteDraft = {
            id: before?.id ?? `d-${this.host.newId()}`,
            createdAt: this.host.now().toISOString(),
            author: note.author,
            conversationId: null,
            title: note.path.slice(note.path.lastIndexOf("/") + 1).replace(/\.md$/i, "").slice(0, WRITE_DRAFT_LIMITS.title).trim() || "Note",
            body: { kind: "note", path: note.path, folder: null, content: note.content },
            inherited: [],
            sources: [],
            defused: note.defused,
          };
          const added = withWriteDraft(before ? withoutWriteDraft(state.drafts, before.id) : state.drafts, draft);
          if (!added.ok) {
            problem = added.problem === "full" ? "full" : "invalid";
            return null;
          }
          id = draft.id;
          return { ...state, drafts: added.drafts };
        }).catch(() => null);
        return next ? { ok: true, id } : { ok: false, problem };
      },
    };
    this.agentDraftPorts.set(vault, port);
    return port;
  }

  /**
   * Leaves a draft in a vault's list (plan KI-Harness P5): something an
   * assistant wants to exist. Nothing is created; the list never drops a
   * waiting draft to make room, so the writer hears when it is full.
   * `unless` is asked where the list is read (strand 6, step 8): where it
   * says the draft's reason went while it waited its turn, none is laid down.
   */
  leaveDraft(vault: AiVaultHost, draft: WriteDraft): Promise<{ ok: true; id: string } | { ok: false; problem: "full" | "invalid" }>;
  leaveDraft(vault: AiVaultHost, draft: WriteDraft, unless: () => boolean): Promise<{ ok: true; id: string } | { ok: false; problem: "full" | "invalid" | "gone" }>;
  async leaveDraft(vault: AiVaultHost, draft: WriteDraft, unless?: () => boolean): Promise<{ ok: true; id: string } | { ok: false; problem: "full" | "invalid" | "gone" }> {
    let problem: "full" | "invalid" | "gone" = "invalid";
    const next = await this.changeDrafts(vault, (state) => {
      if (unless?.()) {
        problem = "gone";
        return null;
      }
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
          ...(input.missing?.length ? { missing: [...input.missing] } : {}),
          ...(input.withheld?.length ? { withheld: [...input.withheld] } : {}),
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
  async createDraft(id: string, choice: { atProvider?: boolean; place?: MemoryPlace; body?: string } = {}): Promise<DraftOutcome> {
    const refused = (reason: Extract<DraftOutcome, { kind: "refused" }>["reason"], message?: string): DraftOutcome => ({ kind: "refused", reason, ...(message ? { message } : {}) });
    const vault = this.vault;
    if (!this.state.settings.enabled || !vault) return refused("off");
    // The memory's own drafts (plan P6) are made by the memory's own writer, not by the shell's way of making notes.
    const waiting = this.state.drafts.drafts.find((candidate) => candidate.id === id);
    if (waiting && MEMORY_DRAFT_KINDS.includes(waiting.body.kind)) return this.keepMemoryDraft(vault, waiting, choice.place);
    // A skill's draft (plan P6-2) is written by the workshop's own writer — `body`: its instructions as the user reworked them in the review.
    if (waiting && waiting.body.kind === "skill") return this.keepSkillDraft(vault, waiting, waiting.body, choice.body);
    const creates = vault.creates;
    if (!creates || !vault.drafts) return refused("unavailable");
    if (this.creatingDraft) return refused("busy");
    const draft = this.state.drafts.drafts.find((candidate) => candidate.id === id);
    if (!draft) return refused("gone");
    const body = draft.body;
    this.creatingDraft = true;
    try {
      let path: string;
      // Handled above, by the memory's own writer and the workshop's.
      if (body.kind === "memory" || body.kind === "forget" || body.kind === "rule" || body.kind === "skill") return refused("unavailable");
      if (body.kind === "mail" || body.kind === "event") {
        // An e-mail and an appointment are never made here (plan P5-6): the draft is handed to the app's own composer
        // or event editor, filled in. It stays in the list while that is open, and leaves it only when the user took
        // the step there — sent the mail, saved it or the appointment. An editor that is just closed changes nothing.
        const taken = (outcome: "sent" | "saved" | "opened") =>
          void this.changeDrafts(vault, (state) =>
            state.drafts.some((candidate) => candidate.id === id)
              ? { drafts: withoutWriteDraft(state.drafts, id), done: withWriteDraftOutcome(state.done, { id, kind: body.kind, title: draft.title, outcome, at: this.host.now().toISOString() }) }
              : null,
          ).catch(() => null);
        if (body.kind === "mail") {
          if (!creates.mail) return refused("unavailable");
          // The shell's composer takes it like every request to write a mail, and asks before a changed draft goes. A
          // shell that cannot take it says so, and this draft stays where it is.
          if (!(await creates.mail({ to: body.to, cc: body.cc, bcc: body.bcc, subject: body.subject, body: body.body }, taken))) return refused("editor-open");
        } else {
          if (!creates.event) return refused("unavailable");
          const seed = { title: body.title, allDay: body.allDay, day: body.day, endDay: body.endDay, start: body.start, end: body.end, location: body.location, description: body.description, attendees: body.attendees };
          // No calendar takes an appointment any more: the editor would have nowhere to save to.
          if (!(await creates.event(seed, () => taken("saved")))) return refused("no-calendar");
        }
        return { kind: "opened" };
      }
      if (body.kind === "note" && body.path) {
        // A draft that names its own file is another writer's (an agent, plan P5-6): the note is made exactly there,
        // or not at all — with the writer's whole text and the stamp that says who wrote it (ADR 0023 §3).
        if (!creates.noteAt) return refused("unavailable");
        const made = await creates.noteAt({ path: body.path, content: namedNoteContent(draft, this.host.now()) });
        if (made === null) return refused("exists");
        path = made;
      } else if (body.kind === "note") {
        const stem = safeFileStem(draft.title) ?? "Note";
        const denied = creates.placeDenies ? await creates.placeDenies(body.folder, stem).catch(() => []) : [];
        const rules = draft.inherited.filter((dimension) => !denied.includes(dimension));
        path = await creates.note({ folder: body.folder, stem, content: draftedNoteContent(draft, this.host.now(), rules, await noteTypeOf(vault)) });
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

  /**
   * "Remember", "Remove" and "Add as a rule" on a draft of the memory (plan
   * P6): the user's own step, as "Create" is on every other draft. An entry
   * is written with the rules its conversation rested on — it goes to no
   * model those notes may not go to. `place`: where the user wants it, where
   * that differs from what the writer proposed. A rule goes into the vault's
   * instructions, and never from a conversation that carries a restricted
   * note: a rule is sent to every model.
   */
  private async keepMemoryDraft(vault: AiVaultHost, draft: WriteDraft, place?: MemoryPlace): Promise<DraftOutcome> {
    const refused = (reason: Extract<DraftOutcome, { kind: "refused" }>["reason"]): DraftOutcome => ({ kind: "refused", reason, message: this.host.label?.("ai.memory.problem.failed") ?? "" });
    if (this.creatingDraft) return { kind: "refused", reason: "busy" };
    const body = draft.body;
    this.creatingDraft = true;
    try {
      let outcome: DraftOutcome;
      if (body.kind === "memory") {
        const source = draft.conversationId ? (this.state.summaries.find((summary) => summary.id === draft.conversationId)?.title ?? null) : null;
        // The entry it rewords, as the files hold it now: gone since, the new wording is simply an entry.
        const held = body.replaces ? await this.memoryEntryNamed(vault, body.replaces) : null;
        const result = held
          ? // A reworded entry keeps the rules it had and takes those of this conversation as well.
            await this.editMemory(held.id, body.text, { deny: AI_POLICY_DIMENSIONS.filter((dimension) => held.deny.includes(dimension) || draft.inherited.includes(dimension)) })
          : await this.addMemory({ text: body.text, place: place ?? body.place, deny: draft.inherited, by: "assistant", source });
        // The memory holds these words already: that is what was asked for.
        if (!result.ok && result.reason !== "duplicate") return refused(result.reason === "unavailable" || result.reason === "no-vault" ? "unavailable" : "failed");
        outcome = { kind: "kept", what: "memory" };
      } else if (body.kind === "forget") {
        const held = await this.memoryEntryNamed(vault, body.entry);
        if (held) {
          const result = await this.removeMemory(held.id);
          if (!result.ok && result.reason !== "gone") return refused(result.reason === "unavailable" || result.reason === "no-vault" ? "unavailable" : "failed");
        }
        outcome = { kind: "kept", what: "forget" };
      } else if (body.kind === "rule") {
        if (draft.inherited.length > 0) return refused("unavailable");
        const result = await this.addRule(body.text);
        if (!result.ok && result.reason !== "duplicate") return refused(result.reason === "unavailable" || result.reason === "no-vault" ? "unavailable" : "failed");
        // What changed in the vault's instructions through a proposal is said in the vault's learning log (plan P6-2).
        if (result.ok) await this.logLearning(vault, { what: "rule-added", conversation: this.conversationTitle(draft.conversationId) });
        outcome = { kind: "kept", what: "rule", ...(result.ok && !result.approved ? { waits: true } : {}) };
      } else return refused("unavailable");
      const at = this.host.now().toISOString();
      await this.changeDrafts(vault, (state) => ({
        drafts: withoutWriteDraft(state.drafts, draft.id),
        done: withWriteDraftOutcome(state.done, { id: draft.id, kind: body.kind, title: draft.title, outcome: "created", at }),
      })).catch(() => null);
      return outcome;
    } finally {
      this.creatingDraft = false;
    }
  }

  /** The entry of the memory a text names, read from the files as they are now; null where none, or more than one, reads so. */
  private async memoryEntryNamed(vault: AiVaultHost, text: string): Promise<MemoryEntry | null> {
    const host = vault.memory;
    if (!host) return null;
    const read = await readMemory(host).catch(() => null);
    return read ? findMemoryEntry([...read.active, ...read.long], text) : null;
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
    // Fully local (plan P7): no server is asked for anything.
    if (!vault || this.state.live || !this.state.settings.enabled || this.state.settings.localOnly) return { kind: "unavailable" };
    // The prompt belongs to the conversation it is started in, from its first step: STOP, another conversation, another
    // vault or the device turning fully local end it, and then nothing of it is sent anywhere (plan P9-4a).
    this.promptAbort?.abort();
    const stop = new AbortController();
    this.promptAbort = stop;
    const conversation = this.state.active?.id ?? null;
    const left = () => stop.signal.aborted || this.vault !== vault || (this.state.active?.id ?? null) !== conversation;
    try {
      const server = (await this.mcp.servers().catch(() => [])).find((entry) => entry.id === serverId);
      if (left()) return { kind: "cancelled" };
      if (!server || mcpServerStanding(server) !== "ready" || !server.snapshot?.prompts.some((prompt) => prompt.name === name)) return { kind: "unavailable" };
      // The listing again before the server is asked for a text: a server that changed is blocked here already.
      const check = await this.mcp.check(serverId, stop.signal);
      if (left()) return { kind: "cancelled" };
      if (!check.ok) return check.reason === "failed" ? { kind: "failed", failure: check.failure } : { kind: check.reason === "blocked" ? "blocked" : "unavailable" };
      // A server the vault lets ask may ask the user before its prompt expands. A stop of the user ends the prompt; after
      // a no, its expansion is read before it goes, never sent unread.
      let stopped = false;
      let declined = false;
      const questions: McpQuestions | undefined = server.grant.questions
        ? {
            modes: this.questionModes(),
            ask: async (question, signal) => {
              const answer = await this.askQuestion({ id: this.host.newId(), serverId, server: server.label, during: { kind: "prompt", name }, question }, signal);
              if (question.kind !== "refused" && answer.action === "cancel") stopped = true;
              if (question.kind !== "refused" && answer.action === "decline") declined = true;
              return answer;
            },
          }
        : undefined;
      let look: McpPromptLook;
      try {
        look = await this.mcp.prompt(serverId, name, args, stop.signal, questions);
      } catch (error) {
        const failure = asMcpError(error).failure;
        return stopped || left() || failure.kind === "cancelled" ? { kind: "cancelled" } : { kind: "failed", failure };
      }
      if (stopped || left()) return { kind: "cancelled" };
      if (look.standing === "changed") return { kind: "blocked" };
      const { text, dropped, truncated } = mcpPromptText(look.body);
      if (!text) return { kind: "empty" };
      if (look.standing === "unpinned" || declined) return { kind: "review", review: { serverId, server: server.label, name, key: look.key, body: look.body, text, dropped, truncated } };
      await this.send(text);
      return { kind: "sent" };
    } finally {
      if (this.promptAbort === stop) this.promptAbort = null;
    }
  }

  /** The user read what a server's prompt expanded to, and sends it: from now on this expansion is the approved one. */
  async sendMcpPrompt(review: McpPromptReview): Promise<void> {
    const vault = this.vault;
    if (!vault || this.state.live) return;
    // From where Send was pressed (step 8): a step on screen — another vault attached is one — or a Delete all while the
    // prompt is kept sends nothing.
    const screen = this.screens;
    const since = this.clearsOf(vault);
    await this.mcp.pinPrompt(review.serverId, review.key, review.body);
    if (this.screens !== screen || this.clearsOf(vault) !== since) return;
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
    // Fully local (plan P7): the internet rests. And a model that takes no tools has none to reach it with.
    if (!this.vault || !this.state.web.enabled || this.state.settings.localOnly || !choice || !provider || this.toolless(provider, choice.model)) return null;
    const names = webToolNames(this.host.web ?? null, provider.endpoint);
    return names.length ? { fetch: names.includes("fetch_url"), search: names.includes("web_search") } : null;
  }

  /** Starts the next new conversation with the internet, or without. An open conversation keeps what it started with. */
  setDraftWeb(on: boolean): void {
    if (this.state.active) return;
    this.set({ draftWeb: on && this.state.web.enabled && !this.state.settings.localOnly });
  }

  /** The user's answer to a page or a search that waits. */
  answerEffect(answer: EffectAnswer): void {
    this.settleEffect(answer);
  }

  /**
   * The user's answer to a server's question (plan P9-4a): what they filled
   * in, a no, or a stop. The client checks a form's answer once more before
   * it goes; an answer to a page carries nothing.
   */
  answerQuestion(id: string, answer: McpElicitResult): void {
    const current = this.state.question;
    // An answer is for the card it was given on: one that arrives after its card made way for another goes nowhere.
    if (!current || current.id !== id) return;
    // A page is said yes to only once it was opened.
    if (answer.action === "accept" && current.question.kind === "url" && !current.opened) return;
    this.settleQuestion(answer);
  }

  /**
   * Opens the page a server asked the user to open — on their click, in the
   * system's browser. The card then waits for "Continue", which answers yes;
   * nothing is sent to the server before.
   */
  async openQuestionPage(id: string): Promise<void> {
    const current = this.state.question;
    const open = this.mcp.openPage;
    // Opened once at a time: a second click while the browser comes up opens nothing more.
    if (!current || current.id !== id || current.question.kind !== "url" || current.opening || !open) return;
    this.set({ question: { ...current, opening: true } });
    const opened = await open(current.question.url).then(
      () => true,
      () => false,
    );
    const now = this.state.question;
    if (now?.id !== id) return;
    this.set({ question: { ...now, opening: false, opened: opened || now.opened, openFailed: !opened } });
  }

  private settleQuestion(answer: McpElicitResult): void {
    const settle = this.questionAnswer;
    this.questionAnswer = null;
    if (this.state.question) this.set({ question: null });
    settle?.(answer);
  }

  /**
   * One question of a server, shown and waited for. A question Plainva
   * refused is shown as well — the user hears that the server asked and why
   * it got no answer —, and whatever comes back for it, the server gets no.
   */
  private askQuestion(request: Omit<McpQuestionRequest, "opened" | "opening" | "openFailed">, signal?: AbortSignal): Promise<McpElicitResult> {
    // One question at a time: a second one waits until the first is answered — it never takes the first one's place.
    const turn = this.questionLane.then(() => this.showQuestion(request, signal));
    this.questionLane = turn.catch(() => undefined);
    return turn;
  }

  private showQuestion(request: Omit<McpQuestionRequest, "opened" | "opening" | "openFailed">, signal?: AbortSignal): Promise<McpElicitResult> {
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve({ action: "cancel" });
      // STOP is a stop of whatever waits — of this card, not of one that came after it.
      const onAbort = () => {
        if (this.state.question?.id === request.id) this.settleQuestion({ action: "cancel" });
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.questionAnswer = (answer) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(answer);
      };
      this.set({ question: { ...request, opened: false } });
      // Asked while no conversation is on screen: the shell shows one, or nobody could answer.
      if (this.surfaces === 0) this.reveal?.();
    });
  }

  /** The kinds of question this shell can show: a form always, a page where it can open one in the system's browser. */
  private questionModes(): McpElicitMode[] {
    return this.mcp.openPage ? ["form", "url"] : ["form"];
  }

  /** Where a server may ask the user during a call of one of its tools (plan P9-4a): Plainva's card. */
  private mcpToolQuestions(source: McpQuestionSource): McpQuestions {
    return {
      modes: this.questionModes(),
      ask: (question, signal) =>
        this.askQuestion({ id: this.host.newId(), serverId: source.serverId, server: source.serverLabel, during: { kind: "tool", tool: source.tool, title: source.title }, question }, signal),
    };
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
    // A script's approval counts only with this device's signature under it (plan P5.5); the keychain is asked only where there is a script.
    const signed = sources.some((source) => source.kind === "script") ? await this.scripts.signedCheck(vault.key) : undefined;
    return { entries: resolveInstructions([...APP_SKILL_SOURCES, ...sources], approvals, signed), approvals };
  }

  /** One source of the vault as it stands now on this device; null when it is gone. */
  private async instructionEntry(vault: AiVaultHost, id: string): Promise<InstructionEntry | null> {
    const host = vault.instructions;
    if (!host) return null;
    const [source, approvals] = await Promise.all([host.scanOne(id).catch(() => null), host.approvals.load().catch(() => EMPTY_INSTRUCTION_APPROVALS)]);
    if (!source) return null;
    const signed = source.kind === "script" ? await this.scripts.signedCheck(vault.key) : undefined;
    return resolveInstructions([source], approvals, signed)[0] ?? null;
  }

  /** Reads the instructions again: the workshop and the entry points show what is there now. */
  async refreshSkills(): Promise<InstructionEntry[]> {
    const vault = this.vault;
    if (!vault) return this.state.skills.entries;
    const [{ entries }, servers] = await Promise.all([this.instructionEntries(vault), this.serverSkills(vault)]);
    // What the regression runs found goes with the list: the workshop shows both.
    const tests = vault.skillTests ? await vault.skillTests.load().catch(() => EMPTY_SKILL_TESTS) : EMPTY_SKILL_TESTS;
    // Whether there is a learning log to offer: the file, not a guess from the approvals — a rule leaves a line too.
    const learnLog = vault.instructions?.readText ? (await vault.instructions.readText(LEARN_LOG_FILE).catch(() => null)) !== null : false;
    if (this.vault === vault) this.set({ skills: this.skillsState(entries, servers), skillTests: { ...this.state.skillTests, records: tests.records }, learnLog });
    return entries;
  }

  /** The skills slice: what the catalog has no room for is measured as a conversation would carry it, the servers' skills included. */
  private skillsState(entries: InstructionEntry[], servers: AiServerSkills[]): AiSkillsState {
    return { entries, omitted: skillCatalog(entries, readyServerSkills(servers)).omitted, servers };
  }

  /**
   * The skills connected servers serve (plan P9-4b), for this vault: one
   * group per server it uses whose approval belongs to what is registered
   * now, read from what this device kept of each listing — no server is
   * asked for it. Each skill's state comes from this vault's approvals on
   * this device, as an own skill's does.
   */
  private async serverSkills(vault: AiVaultHost): Promise<AiServerSkills[]> {
    const host = vault.instructions;
    if (!host || !this.mcp.state.available) return [];
    const [servers, approvals] = await Promise.all([this.mcp.servers().catch(() => [] as AiMcpServer[]), host.approvals.load().catch(() => EMPTY_INSTRUCTION_APPROVALS)]);
    const resting = this.state.settings.localOnly;
    return servers
      .filter((server) => server.enabled && server.skills && (server.skills.entries.length > 0 || server.skills.added.length > 0) && server.target !== null && server.target === server.reviewedTarget)
      .map((server) => {
        const skills = server.skills!;
        const registration = mcpSkillRegistration(server.target!, server.addedAt);
        const sources = skills.entries.map((entry) => mcpSkillSource({ id: server.id, label: server.label, registration }, entry));
        return {
          serverId: server.id,
          label: server.label,
          place: serverPlace(server),
          ready: mcpServerStanding(server) === "ready" && !resting,
          at: skills.at,
          failed: skills.failed,
          clipped: skills.clipped,
          added: skills.added.length,
          entries: resolveInstructions(sources, approvals),
        };
      });
  }

  /** One server skill as it stands now, with its group; null where it is gone. */
  private async serverSkill(vault: AiVaultHost, id: string): Promise<{ group: AiServerSkills; entry: InstructionEntry } | null> {
    for (const group of await this.serverSkills(vault)) {
      const entry = group.entries.find((candidate) => candidate.source.id === id);
      if (entry) return { group, entry };
    }
    return null;
  }

  /**
   * A server skill with its instructions (plan P9-4b): its `SKILL.md` read
   * from its server and checked — the bytes its manifest names, a skill the
   * format accepts, a frontmatter that says what the server listed. What
   * fails is not used; where the bytes were not the manifest's, the entry
   * was read again and the workshop shows what changed.
   */
  private async readServerSkill(entry: InstructionEntry, signal?: AbortSignal): Promise<{ ok: true; text: string; skill: SkillDefinition; invisible: number } | { ok: false; reason: Exclude<ServerSkillText, { ok: true }>["reason"] }> {
    const origin = entry.source.server;
    const main = entry.source.files.find((file) => file.path === "SKILL.md");
    if (!origin || !main || !entry.source.skill) return { ok: false, reason: "unavailable" };
    const read = await this.mcp.readSkillFile(origin.serverId, origin.uri, { uri: origin.uri, bytes: main.bytes, sha256: main.sha256 }, signal);
    if (!read.ok) {
      if (read.reason === "digest") void this.refreshSkills();
      return { ok: false, reason: read.reason === "digest" ? "digest" : "unavailable" };
    }
    const checked = checkMcpSkillMain({ files: entry.source.files, server: origin, name: entry.source.skill.name }, read.bytes);
    return checked.ok ? checked : { ok: false, reason: checked.reason };
  }

  /**
   * A server skill for its review, read when the user asks for it and checked
   * like a load: its instructions and each file a model may read of it.
   * `expected` is what the review shows (`approvalSeen`): a skill that is no
   * longer that one is not read; and since reading looks at the server again,
   * what it lists is read anew afterwards — a skill that changed meanwhile is
   * not shown as the one the review shows.
   */
  async serverSkillText(id: string, expected?: Readonly<Record<string, string>>): Promise<ServerSkillText> {
    const vault = this.vault;
    const found = vault ? await this.serverSkill(vault, id) : null;
    if (!vault || !found) return { ok: false, reason: "unavailable" };
    if (expected && !sameSeen(found.entry.source, expected)) {
      await this.refreshSkills();
      return { ok: false, reason: "changed" };
    }
    const read = await this.readServerSkill(found.entry);
    if (!read.ok) return read;
    const files: ServerSkillFileView[] = [];
    let invisible = read.invisible;
    let shown = 0;
    let bytes = 0;
    for (const file of found.entry.source.files) {
      if (!skillFileReadable(file.path)) continue;
      if (file.bytes > MCP_SKILL_LIMITS.readable) {
        files.push({ path: file.path, text: null, problem: "large" });
        continue;
      }
      if (shown >= SERVER_SKILL_REVIEW_LIMITS.files || bytes + file.bytes > SERVER_SKILL_REVIEW_LIMITS.bytes) {
        files.push({ path: file.path, text: null, problem: "more" });
        continue;
      }
      shown += 1;
      bytes += file.bytes;
      const got = await this.serverSkillFileRead(found.entry, file.path);
      if (!got.ok) files.push({ path: file.path, text: null, problem: got.problem });
      else {
        invisible += stripInvisible(got.text).removed;
        files.push({ path: file.path, text: got.text });
      }
    }
    await this.refreshSkills();
    const now = this.vault === vault ? await this.serverSkill(vault, id) : null;
    if (!now || !sameSeen(now.entry.source, approvalSeen(found.entry.source))) return { ok: false, reason: "changed" };
    return { ok: true, text: read.text, invisible, files };
  }

  /**
   * The servers' groups read again — when the settings changed a server, a
   * look at a server read its skills, or the device turned fully local or
   * back. Nothing is asked of a server for it.
   */
  private refreshServerGroups(): void {
    const vault = this.vault;
    if (!vault) return;
    void this.serverSkills(vault).then(
      (servers) => {
        if (this.vault === vault) this.set({ skills: this.skillsState(this.state.skills.entries, servers) });
      },
      () => undefined,
    );
  }

  /** A server left this device: the approvals and switches of its skills in the open vault go with it. */
  private async forgetServerSkills(serverId: string): Promise<void> {
    const host = this.vault?.instructions;
    if (!host) return;
    await host.approvals.save(pruneServerSkillApprovals(await host.approvals.load().catch(() => EMPTY_INSTRUCTION_APPROVALS), serverId));
    await this.refreshSkills();
  }

  /** Reads one server's skills again, now. */
  async refreshServerSkills(serverId: string): Promise<McpCheck> {
    const result = await this.mcp.refreshSkills(serverId);
    await this.refreshSkills();
    return result;
  }

  /** A skill of a server by its address (`skills/get`), kept with the server on this device. */
  async addServerSkill(serverId: string, uri: string): Promise<McpSkillAdd> {
    const result = await this.mcp.addSkill(serverId, uri);
    await this.refreshSkills();
    return result;
  }

  /**
   * Approves a source exactly as the user saw it — `seen` maps every file the
   * dialog showed to its SHA-256 (ADR 0020). When the files changed in the
   * meantime nothing is approved, and the state is read again.
   */
  async approveInstruction(id: string, seen: Readonly<Record<string, string>>): Promise<boolean> {
    return (await this.approveSource(id, seen)) === null;
  }

  /**
   * The approval itself, with why it did not happen: `changed` — the files
   * are no longer the ones the dialog showed; `no-key` — a script, and this
   * device's keychain gave no key to sign its approval with (plan P5.5).
   * Null when it is approved.
   */
  async approveSource(id: string, seen: Readonly<Record<string, string>>, viewed?: string): Promise<ScriptApprovalRefusal | null> {
    const vault = this.vault;
    const host = vault?.instructions;
    if (!vault || !host) return "unavailable";
    // A server's skill (plan P9-4b): approved as the review showed it — every file of its manifest and the frontmatter it lists.
    if (readMcpSkillSourceId(id)) {
      const found = await this.serverSkill(vault, id);
      if (!found || !sameSeen(found.entry.source, seen)) {
        await this.refreshSkills();
        return "changed";
      }
      if (found.entry.status !== "new" && found.entry.status !== "changed") {
        await this.refreshSkills();
        return "unavailable";
      }
      // The instructions the user read, where they are exactly the approved SKILL.md: kept with the approval, so that a
      // later version can be held against them.
      const main = seen["SKILL.md"];
      const matches = viewed !== undefined && main !== undefined && [viewed, `${BYTE_ORDER_MARK}${viewed}`].some((candidate) => instructionFileHash(utf8Encode(candidate)) === main);
      const text = matches ? viewed! : null;
      const approvals = await host.approvals.load().catch(() => EMPTY_INSTRUCTION_APPROVALS);
      await host.approvals.save(approveInstruction(approvals, { ...found.entry.source, text }, this.host.now().toISOString(), "review"));
      await this.refreshSkills();
      return null;
    }
    const source = await host.scanOne(id).catch(() => null);
    const same = Boolean(source) && source!.files.length === Object.keys(seen).length && source!.files.every((f) => seen[f.path] === f.sha256);
    let refusal: ScriptApprovalRefusal | null = same ? null : "changed";
    if (same) {
      let signature: string | undefined;
      if (source!.kind === "script") {
        // A script is approved with this device's signature — and only one that could run at all.
        const runnable = instructionStatus(source!, EMPTY_INSTRUCTION_APPROVALS) === "new";
        signature = runnable ? ((await this.scripts.sign(vault.key, source!)) ?? undefined) : undefined;
        if (!runnable) refusal = "unavailable";
        else if (!signature) refusal = "no-key";
      }
      if (!refusal) {
        const approvals = await host.approvals.load().catch(() => EMPTY_INSTRUCTION_APPROVALS);
        await host.approvals.save(approveInstruction(approvals, source!, this.host.now().toISOString(), "review", undefined, signature));
      }
    }
    await this.refreshSkills();
    return refusal;
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

  /**
   * A new skill from the workshop's form: name, description, instructions — written and approved here. `how`: "learned"
   * where the three came from a proposal the user took over (plan P6-2); everything else of the skill is the app's default.
   */
  async createSkill(input: { name: string; description: string; body: string }, how: Extract<ApprovalHow, "created" | "learned"> = "created"): Promise<SkillWriteOutcome> {
    const name = input.name.trim();
    const text = serializeSkillFile({ name, description: input.description.trim(), body: input.body, metadata: { "plainva.version": "1" } });
    const parsed = parseSkillFile(text, name);
    const problems = blockingProblems(parsed.problems);
    if (!input.body.trim()) problems.push({ code: "description-missing", detail: "body" });
    if (problems.length) return { ok: false, reason: "invalid", problems };
    return this.writeSkill(name, [{ path: "SKILL.md", bytes: utf8Encode(text) }], how);
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

  // --------------------------------------------------------------- learning

  /** What a conversation is called, for a line that says where something came from; null where it is not known any more. */
  private conversationTitle(id: string | null): string | null {
    return id ? (this.state.summaries.find((summary) => summary.id === id)?.title ?? null) : null;
  }

  /**
   * Everything a review of a conversation rests on (plan P6-2): which model,
   * which kinds of proposal, which skills it is told about, and the texts
   * that would go. Put together the same way for the question before the
   * request and for the request itself, so what the user is shown is what is
   * sent.
   *
   * The model is the one that led the conversation — its last run's —, and
   * no other: the conversation goes nowhere it has not been. A conversation
   * that ran on this device stays here; one that rests on a note which may
   * not go to this model today does not go, whatever held when it ran.
   */
  private async learnInput(conversationId: string) {
    const no = (reason: LearnRefusal, why: { failure?: ModelFailure; provider?: string } = {}) => ({ ok: false as const, reason, ...why });
    const vault = this.vault;
    if (!this.state.settings.enabled) return no("off");
    if (!vault) return no("no-vault");
    // Read as it is stored once its writes have landed; nothing is learnt from a conversation being deleted (step 8).
    if (this.gone(conversationId)) return no("gone");
    const record = this.state.active?.id === conversationId ? this.state.active : await this.loaded(vault, conversationId).catch(() => null);
    if (!record) return no("gone");
    const last = record.runs[record.runs.length - 1];
    const transcript = learnTranscript(record);
    if (!last || transcript.messages === 0) return no("empty");
    const choice: ModelChoice = { providerId: last.providerId, model: last.model };
    const provider = providerById(choice.providerId, this.state.settings.custom);
    if (!provider) return no("no-model");
    // Fully local (plan P7): a review goes to the model that led the conversation, or to none.
    const rests = this.notThisDevice(provider);
    if (rests) return no("failed", { failure: rests.failure, provider: provider.label });
    const recipient: EgressRecipient = recipientOf(provider, choice.model);
    const cloud = isCloudRecipient(recipient);
    if (this.keptOnDevice(record, recipient)) return no("kept");
    const inherited = await this.inheritedBy(vault, record, [], { paths: new Set(), more: false }, new Set());
    if (cloud && inherited.includes("cloud")) return no("denied");

    const limits: LearnLimit[] = [];
    const foreign = readStrangersText(record);
    if (foreign) limits.push("foreign");
    if (inherited.length > 0) limits.push("restricted");
    const memoryOn = vault.memory ? (await vault.memory.prefs.load().catch(() => ({ on: false }))).on : false;
    if (!memoryOn) limits.push("memory-off");
    // What nobody could take over is not proposed: an entry where the shell cannot write the memory, a rule or a skill where it cannot write the instructions.
    const remembers = memoryOn && Boolean(vault.memory?.update);
    const writes = Boolean(vault.instructions?.write);
    if (!writes || (memoryOn && !remembers)) limits.push("read-only");
    // What assistants do — a rule, a skill's instructions — goes to every model, and is no stranger's to say.
    const instructs = writes && !foreign && inherited.length === 0;
    const kinds: LearnKind[] = [...(remembers ? (["memory"] as const) : []), ...(instructs ? (["rule", "skill"] as const) : [])];
    if (kinds.length === 0) return no("nothing");
    const entries = instructs ? (await this.instructionEntries(vault)).entries : [];
    const targets: LearnTarget[] = instructs ? learnTargets(entries, skillsUsedBy(record)) : [];
    const instruction = learnInstruction(kinds);
    const parts = learnParts({ conversationId: record.id, transcript: transcript.text, skills: targets });
    return { ok: true as const, vault, record, choice, provider, cloud, inherited, limits, kinds, targets, transcript, instruction, parts };
  }

  /**
   * "Learn from this conversation", before it is asked (plan P6-2, mockup
   * chapter 22): to which model the conversation would go once more, how
   * much of it, and what may come back. Nothing is sent by looking.
   */
  async learnPlan(conversationId: string): Promise<LearnPlanOutcome> {
    const input = await this.learnInput(conversationId).catch(() => ({ ok: false as const, reason: "failed" as const }));
    if (!input.ok) return input;
    const tokens = estimateTokens(`${input.instruction}\n${input.parts.join("\n")}`);
    const price = input.cloud ? this.priceOf(input.choice) : undefined;
    return {
      ok: true,
      plan: {
        conversationId,
        title: input.record.title,
        provider: input.provider.label,
        model: input.choice.model,
        local: !input.cloud,
        kinds: input.kinds,
        limits: input.limits,
        messages: input.transcript.messages,
        omitted: input.transcript.omitted,
        skills: input.targets.map((target) => target.title),
        tokens,
        ...(price ? { costUsd: (tokens / 1_000_000) * price.input } : {}),
      },
    };
  }

  /**
   * "Learn from this conversation" (plan P6-2, §15 "proposal first"): the
   * conversation goes once more to the model that led it — the user's words,
   * the answers, the names of the tools; without a tool, so the answer can
   * only be words —, and what comes back is laid down as drafts: entries for
   * the memory, rules, a skill or other instructions for one. Nothing of it
   * counts before the user takes it, one by one.
   *
   * The dialog that starts this names the model and what goes: asking there
   * is the question before this request, each time. It approves nothing for
   * a later one.
   */
  async learnFrom(conversationId: string): Promise<LearnOutcome> {
    const refused = (reason: LearnRefusal): LearnOutcome => ({ kind: "refused", reason });
    if (this.learnAbort || this.filtering || this.fillAbort || this.state.live || this.sending) return refused("busy");
    const since = this.vault ? this.clearsOf(this.vault) : 0;
    // Deleted — the conversation, or the whole history — since the review began: nothing more of it goes or is laid down (step 8).
    const forgotten = (vault: AiVaultHost) => this.gone(conversationId) || this.clearsOf(vault) !== since;
    const controller = new AbortController();
    this.learnAbort = controller;
    this.set({ learning: conversationId });
    try {
      const input = await this.learnInput(conversationId);
      if (!input.ok) return { kind: "refused", reason: input.reason, ...(input.failure ? { failure: input.failure, ...(input.provider ? { provider: input.provider } : {}) } : {}) };
      if (controller.signal.aborted) return refused("cancelled");
      const { vault, record, choice, provider } = input;
      const asked = await this.askOnce(
        provider,
        choice,
        input.instruction,
        input.parts.map((text): TextPart => ({ type: "text", text })),
        LEARN_LIMITS.outputTokens,
        controller.signal,
      );
      await this.recordRequests(vault, choice, {
        id: `learn-${this.host.newId()}`,
        usage: asked.usage,
        steps: 1,
        stop: asked.stop.kind,
        ...(asked.stop.kind === "failed" ? { failure: asked.stop.failure.kind } : {}),
      });
      if (asked.stop.kind === "cancelled") return refused("cancelled");
      if (asked.stop.kind === "failed") return { kind: "refused", reason: "failed", failure: asked.stop.failure, provider: provider.label, model: choice.model };
      if (asked.stop.kind !== "answered") return refused("invalid");
      const read = parseLearnings(asked.answer, input.kinds);
      if (!read) return refused("invalid");
      if (this.vault !== vault) return refused("cancelled");

      // The vault as it is now: the review took its time, and an entry or a skill's name may have come since.
      const memory = input.kinds.includes("memory") && vault.memory ? await readMemory(vault.memory).then((held) => [...held.active, ...held.long]).catch(() => null) : null;
      const taken = input.kinds.includes("skill") ? takenSkillNames((await this.instructionEntries(vault)).entries) : [];
      const made = draftsFromLearnings({ proposals: read.proposals, memory, targets: input.targets, taken, userTexts: userTextsOf(record.conversation) });
      const author = { id: assistantAuthorId(choice.model), label: this.host.label?.("ai.suggestionAuthor", { model: choice.model }) ?? choice.model };
      const drafts: string[] = [];
      let full = false;
      for (const draft of made.drafts) {
        const next: WriteDraft = {
          id: `d-${this.host.newId()}`,
          createdAt: this.host.now().toISOString(),
          author,
          conversationId: record.id,
          title: draft.title,
          body: draft.body,
          // An entry takes the rules of what its conversation rested on with it; a rule and a skill are proposed only where there are none.
          inherited: draft.body.kind === "memory" ? [...input.inherited] : [],
          sources: [],
          defused: draft.defused,
          ...(draft.why ? { why: draft.why } : {}),
        };
        // Laid down only where neither its conversation nor the whole history went meanwhile — asked where the list of
        // drafts is read, so that a draft waiting its turn there lays nothing down either (step 8).
        const left = await this.leaveDraft(vault, next, () => forgotten(vault));
        if (left.ok) drafts.push(left.id);
        else if (left.problem === "gone") return refused("gone");
        else if (left.problem === "full") {
          full = true;
          break;
        }
      }
      const costUsd = input.cloud ? usageCostUsd(asked.usage, this.priceOf(choice)) : undefined;
      return {
        kind: "learned",
        conversationId,
        drafts,
        dropped: read.dropped + made.dropped + (full ? made.drafts.length - drafts.length : 0),
        known: made.known,
        full,
        provider: provider.label,
        model: choice.model,
        local: !input.cloud,
        kinds: input.kinds,
        limits: input.limits,
        usage: { inputTokens: asked.usage.inputTokens, outputTokens: asked.usage.outputTokens },
        ...(costUsd !== undefined ? { costUsd } : {}),
      };
    } catch {
      return refused("failed");
    } finally {
      if (this.learnAbort === controller) this.learnAbort = null;
      this.set({ learning: null });
    }
  }

  /** Stops the review that is running: its request is cut off, and nothing is laid down. */
  stopLearning(): void {
    this.learnAbort?.abort();
  }

  /**
   * One line for the vault's learning log (plan P6-2: "history in the
   * vault"): what was taken over from a proposal, for whoever shares the
   * vault — a device that finds a skill changed can read why. A courtesy:
   * what was taken over holds without it, so a log that cannot be written
   * stops nothing.
   */
  private async logLearning(vault: AiVaultHost, event: LearnLogEvent): Promise<void> {
    const host = vault.instructions;
    if (!host?.update) return;
    try {
      const line = learnLogLine(learnLogTime(this.host.now()), event);
      // Appended to the log as it lies there (the chain's one entry): a line another device added meanwhile stays.
      await host.update(LEARN_LOG_FILE, (existing) => appendLearnLog(existing, line));
      if (this.vault === vault && !this.state.learnLog) this.set({ learnLog: true });
    } catch {
      // Said above.
    }
  }

  /**
   * Puts another text in the place of a skill's main file and approves
   * exactly what was written (plan P6-2): the one way a skill's text changes
   * here without the user typing it — a proposal they took over, a version
   * they went back to. The version it replaces is kept in the vault's
   * history first, and where the vault keeps one, nothing is written without
   * that. `previous`: the text to go back to while the new version is
   * watched; null for a version that is not watched.
   */
  private async replaceSkillFile(
    vault: AiVaultHost,
    before: InstructionSource,
    next: string,
    how: Extract<ApprovalHow, "learned" | "restored">,
    previous: string | null,
  ): Promise<{ ok: true } | { ok: false; reason: "unavailable" | "changed" | "invalid" | "no-history" | "failed" }> {
    const host = vault.instructions;
    if (!host?.update) return { ok: false, reason: "unavailable" };
    const folder = before.root.slice(before.root.lastIndexOf("/") + 1);
    const bytes = utf8Encode(next);
    // What would be written has to be a skill of this folder, as the format defines it — and no larger than one may be.
    const parsed = parseSkillFile(next, folder);
    if (!parsed.skill || blockingProblems(parsed.problems).length > 0 || !parsed.skill.body.trim() || bytes.length > SKILL_MAIN_MAX_BYTES) return { ok: false, reason: "invalid" };
    const path = `${before.id}/${SKILL_FILE}`;
    if (host.versions) {
      try {
        await host.versions.snapshot(path);
      } catch {
        return { ok: false, reason: "no-history" };
      }
    }
    // Through the chain's one entry, and only over the text the proposal or the version was made for: a main file that
    // changed meanwhile — on another device — keeps its text, and the user decides again (`changed`).
    const moved = { since: false };
    try {
      await host.update(path, (file) => {
        if (file === null || before.text === null || editorTextOf(file) !== editorTextOf(before.text)) {
          moved.since = true;
          return null;
        }
        return next;
      });
    } catch {
      await this.refreshSkills();
      return { ok: false, reason: "failed" };
    }
    if (moved.since) {
      await this.refreshSkills();
      return { ok: false, reason: "changed" };
    }
    const written = await host.scanOne(before.id).catch(() => null);
    // Every other file as it was, the main file as it was written: anything else is not what the user saw.
    const expected = { ...Object.fromEntries(before.files.map((file) => [file.path, file.sha256])), [SKILL_FILE]: instructionFileHash(bytes) };
    if (!written || !sameFiles(expected, written.files)) {
      await this.refreshSkills();
      return { ok: false, reason: "changed" };
    }
    const at = this.host.now().toISOString();
    let approvals = approveInstruction(await host.approvals.load().catch(() => EMPTY_INSTRUCTION_APPROVALS), written, at, how);
    if (previous !== null) approvals = observeInstruction(approvals, before.id, at, previous);
    await host.approvals.save(approvals);
    await this.refreshSkills();
    return { ok: true };
  }

  /**
   * "Take over" on a skill's draft (plan P6-2, mockup chapter 22): the
   * user's own step, in the review that showed them the text. A new skill is
   * written like one from the workshop's form — its name, what it is for and
   * its instructions from the draft, everything else the app's default: no
   * tool that writes, no folder, no limit of its own. Other instructions for
   * a skill replace what follows its head and nothing of the head: the
   * tools, folders, limits and tests of a skill are the same before and
   * after, which is checked once more on what would be written.
   *
   * The skill has to be what the proposal read — the same main file —, one
   * of the vault's own, approved on this device, and not an imported one. A
   * skill that changed since, or waits for a review, is not written over:
   * the draft stays, and the user decides what to do with it.
   */
  private async keepSkillDraft(vault: AiVaultHost, draft: WriteDraft, body: Extract<WriteDraftBody, { kind: "skill" }>, edited?: string): Promise<DraftOutcome> {
    const refused = (reason: Extract<DraftOutcome, { kind: "refused" }>["reason"]): DraftOutcome => ({ kind: "refused", reason });
    const host = vault.instructions;
    // Instructions go to every model: none are made from a conversation that carries a note kept from one.
    if (!host?.write || draft.inherited.length > 0) return refused("unavailable");
    if (this.creatingDraft) return refused("busy");
    this.creatingDraft = true;
    try {
      const text = (edited ?? body.body).trim();
      if (!text || text.length > WRITE_DRAFT_LIMITS.skillBody) return refused("invalid");
      const conversation = this.conversationTitle(draft.conversationId);
      let id: string;
      if (body.change === null) {
        const made = await this.createSkill({ name: body.name, description: body.description, body: text }, "learned");
        if (!made.ok) return refused(made.reason === "exists" ? "exists" : made.reason === "no-vault" ? "unavailable" : made.reason === "invalid" ? "invalid" : "failed");
        id = made.id;
        await this.logLearning(vault, { what: "skill-created", skill: body.name, conversation });
      } else {
        const entry = await this.instructionEntry(vault, body.change.id);
        if (!entry) return refused("gone");
        const main = entry.source.files.find((file) => file.path === SKILL_FILE);
        if (!canRewriteSkill(entry) || main?.sha256 !== body.change.base) return refused("changed");
        const current = entry.source.text!;
        const next = rewriteSkillBody(current, text);
        if (next === null) return refused("invalid");
        // By construction the head is the same bytes. Held against what the tools would grant all the same: a rewrite that changed it is not written.
        const after = parseSkillFile(next).skill;
        const every = TOOL_MANIFESTS.map((tool) => tool.name);
        if (!after || !sameGrant(grantChanges(skillGrant(entry.source.skill!, every), skillGrant(after, every)))) return refused("invalid");
        const outcome = await this.replaceSkillFile(vault, entry.source, next, "learned", current);
        if (!outcome.ok) return refused(outcome.reason === "no-history" ? "failed" : outcome.reason);
        id = body.change.id;
        await this.logLearning(vault, { what: "skill-rewritten", skill: nameOf(entry.source), conversation });
      }
      const at = this.host.now().toISOString();
      await this.changeDrafts(vault, (state) => ({
        drafts: withoutWriteDraft(state.drafts, draft.id),
        done: withWriteDraftOutcome(state.done, { id: draft.id, kind: "skill", title: draft.title, outcome: "created", path: `${id}/${SKILL_FILE}`, at }),
      })).catch(() => null);
      return { kind: "kept", what: "skill", id };
    } finally {
      this.creatingDraft = false;
    }
  }

  /**
   * What a run says about the versions it used that are watched (plan P6-2):
   * counted, never acted on. A conversation that was bound to a skill before
   * it changed still runs the old instructions — it says nothing about the
   * new ones.
   */
  private async countObserved(vault: AiVaultHost, record: ConversationRecord, used: readonly { id: string; how: "bound" | "loaded" }[], stop: string): Promise<void> {
    const host = vault.instructions;
    const said = observedRunOf(stop);
    if (!host || !said || used.length === 0) return;
    const approvals = await host.approvals.load().catch(() => null);
    if (!approvals) return;
    let next = approvals;
    const counted = new Set<string>();
    for (const skill of used) {
      const approval = approvalOf(next, skill.id);
      if (!approval?.observe || counted.has(skill.id)) continue;
      if (skill.how === "bound" && record.instructions?.skill?.sha256 !== approval.files[SKILL_FILE]) continue;
      counted.add(skill.id);
      next = countObservedRun(next, skill.id, said);
    }
    if (next === approvals) return;
    await host.approvals.save(next);
    if (this.vault === vault) await this.refreshSkills();
  }

  /** "Keep" on a version that is watched (plan P6-2): the watch ends, and with it the copy of the version before. */
  async keepObservedSkill(id: string): Promise<void> {
    const host = this.vault?.instructions;
    if (!host) return;
    const approvals = await host.approvals.load().catch(() => null);
    if (!approvals) return;
    await host.approvals.save(endObservation(approvals, id));
    await this.refreshSkills();
  }

  /**
   * "Back to the version before" on a version that is watched (plan P6-2):
   * the text the skill had before the proposal was taken over is written
   * back, and approved — it is the version this device had approved until
   * then. Never by itself: a failed run only makes the workshop offer this.
   * A skill that changed since the proposal is not written over.
   */
  async revertObservedSkill(id: string): Promise<SkillRestoreOutcome> {
    const vault = this.vault;
    if (!vault?.instructions?.write) return { ok: false, reason: "unavailable" };
    const entry = await this.instructionEntry(vault, id);
    if (!entry) return { ok: false, reason: "gone" };
    const previous = entry.approval?.observe?.previous;
    if (previous === undefined || !canRewriteSkill(entry)) return { ok: false, reason: "changed" };
    const outcome = await this.replaceSkillFile(vault, entry.source, previous, "restored", null);
    if (!outcome.ok) return outcome;
    await this.logLearning(vault, { what: "skill-restored", skill: nameOf(entry.source), version: null });
    return { ok: true };
  }

  /** The earlier versions the vault keeps of a skill's main file, newest first; null where it keeps none, or the skill is none of the vault's own. */
  async skillVersions(id: string): Promise<{ id: string; at: number }[] | null> {
    const versions = this.vault?.instructions?.versions;
    if (!versions || !skillDraftTarget(id)) return null;
    return (await versions.list(`${id}/${SKILL_FILE}`).catch(() => [])).map((version) => ({ id: version.id, at: version.at }));
  }

  /** One of those versions as text — only one the history lists for this skill; null where it cannot be read. */
  async readSkillVersion(id: string, version: string): Promise<string | null> {
    const versions = this.vault?.instructions?.versions;
    if (!versions || !skillDraftTarget(id)) return null;
    const listed = await versions.list(`${id}/${SKILL_FILE}`).catch(() => []);
    if (!listed.some((candidate) => candidate.id === version)) return null;
    const text = await versions.read(version).catch(() => null);
    return text !== null && text.length <= SKILL_MAIN_MAX_BYTES ? text : null;
  }

  /**
   * "Restore this version" (plan P6-2, mockup chapter 22): an earlier
   * version of a skill's main file is written back and approved on this
   * device — the dialog showed its text against the current one, and what it
   * may do against what the current one may. `shown`: that text; a version
   * that reads otherwise now is not written. The current version is kept in
   * the history first.
   */
  async restoreSkillVersion(id: string, version: string, shown: string): Promise<SkillRestoreOutcome> {
    const vault = this.vault;
    if (!vault?.instructions?.write) return { ok: false, reason: "unavailable" };
    const entry = await this.instructionEntry(vault, id);
    if (!entry || entry.source.kind !== "skill" || entry.source.origin !== "vault") return { ok: false, reason: "gone" };
    const listed = (await this.skillVersions(id)) ?? [];
    const meant = listed.find((candidate) => candidate.id === version);
    const text = meant ? await this.readSkillVersion(id, version) : null;
    if (!meant || text === null) return { ok: false, reason: "gone" };
    if (text !== shown) return { ok: false, reason: "changed" };
    if (entry.source.tooLarge) return { ok: false, reason: "invalid" };
    const outcome = await this.replaceSkillFile(vault, entry.source, text, "restored", null);
    if (!outcome.ok) return outcome;
    await this.logLearning(vault, { what: "skill-restored", skill: nameOf(entry.source), version: learnLogTime(new Date(meant.at)) });
    return { ok: true };
  }

  // ----------------------------------------------------------------- upkeep

  /** The regression plan the workshop last showed: what a hint about a test is measured against. */
  private upkeepPlan: SkillTestPlan | null = null;

  /** The newest regression result of each skill, where it still speaks for the skill and the model as they are now. */
  private upkeepTests(plan: SkillTestPlan): UpkeepTestResult[] {
    return this.state.skillTests.records.flatMap((record) => {
      const target = plan.targets.find((candidate) => candidate.id === record.id);
      if (!target || skillTestState(record, { version: target.version, providerId: plan.choice.providerId, model: plan.choice.model }) !== "current") return [];
      const summary = skillTestSummary(record.scenarios);
      return [{ id: record.id, at: record.at, model: record.model, failed: summary.failed, ran: summary.passed + summary.failed }];
    });
  }

  /**
   * What this device can say by itself about the skills and the memory (plan
   * KI-Harness P6-3, ADR 0029): arithmetic over the instructions and their
   * approvals, the run ledger, the regression results and the memory's
   * entries as the state holds them. No model is asked, nothing is sent, and
   * nothing is written — a hint ends in a step the user takes, or in "don't
   * show again". The views call this when they open and when what it reads
   * changed. `plan`: the regression plan a view holds (null: none); left out,
   * the last one given still counts.
   */
  async refreshUpkeep(plan?: SkillTestPlan | null): Promise<void> {
    const vault = this.vault;
    if (!vault) return;
    if (plan !== undefined) this.upkeepPlan = plan;
    const [ledger, prefs] = await Promise.all([vault.ledger.load().catch((): LedgerEntry[] => []), vault.upkeep ? vault.upkeep.load().catch(() => EMPTY_UPKEEP_PREFS) : Promise.resolve(EMPTY_UPKEEP_PREFS)]);
    if (this.vault !== vault) return;
    const now = this.host.now();
    const conversations = new Set(this.state.summaries.map((summary) => summary.id));
    const tests = this.upkeepPlan ? this.upkeepTests(this.upkeepPlan) : [];
    const skills = shownUpkeep(skillUpkeep({ entries: this.state.skills.entries, ledger, tests, now, conversations }), prefs);
    // A memory that is switched off on this device goes nowhere from here: there is nothing to tidy for it.
    const kept = this.state.memory;
    const memory = kept.available && kept.on ? shownUpkeep(memoryUpkeep({ active: kept.active, long: kept.long, over: kept.budget.over, now }), prefs) : [];
    // Nothing new to show: the views keep what they have. Compared by content, never as JSON text.
    if (sameStoredValue(skills, this.state.upkeep.skills) && sameStoredValue(memory, this.state.upkeep.memory)) return;
    this.set({ upkeep: { skills, memory } });
  }

  /**
   * "Don't show again" on a hint (plan P6-3): remembered on this device, for
   * this vault. A hint's key holds the state it was about, so it returns when
   * the matter itself has changed.
   */
  async dismissUpkeepHint(key: string): Promise<void> {
    const vault = this.vault;
    if (!vault?.upkeep) return;
    const prefs = await vault.upkeep.load().catch(() => EMPTY_UPKEEP_PREFS);
    await vault.upkeep.save(dismissUpkeep(prefs, key)).catch(() => undefined);
    if (this.vault === vault) await this.refreshUpkeep();
  }

  // ----------------------------------------------------------------- memory

  /** One lane for the memory files: a change reads the file it changes at that moment, and no two of them cross. */
  private memoryLane: Promise<unknown> = Promise.resolve();
  private inMemoryLane<T>(work: () => Promise<T>): Promise<T> {
    const run = this.memoryLane.catch(() => undefined).then(work);
    this.memoryLane = run;
    return run;
  }

  /** Reads the vault's memory — both files and this device's switch — into the state (plan KI-Harness P6). */
  async refreshMemory(): Promise<void> {
    const vault = this.vault;
    const host = vault?.memory;
    if (!vault || !host) {
      if (this.vault === vault) this.set({ memory: { ...EMPTY_MEMORY_STATE, loaded: true } });
      return;
    }
    // A switch that cannot be read is off: nothing of the memory goes anywhere on a guess.
    const [read, prefs] = await Promise.all([readMemory(host).catch(() => null), host.prefs.load().catch(() => ({ on: false }))]);
    if (this.vault !== vault) return;
    this.set({
      memory: {
        loaded: true,
        available: read !== null,
        writable: read !== null && Boolean(host.update),
        on: prefs.on,
        active: read?.active ?? [],
        long: read?.long ?? [],
        budget: read?.budget ?? EMPTY_MEMORY_STATE.budget,
        cut: read?.cut ?? [],
        files: read?.files ?? [],
      },
    });
  }

  /** This device's switch for the memory: off, nothing of it goes to a model from here, and no tool reads or proposes into it. */
  async switchMemory(on: boolean): Promise<void> {
    const host = this.vault?.memory;
    if (!host) return;
    await host.prefs.save({ on }).catch(() => undefined);
    await this.refreshMemory();
  }

  // ---------------------------------------------------------- writing style

  /** One lane for the style's file: two choices in quick succession never write over each other. */
  private styleLane: Promise<unknown> = Promise.resolve();
  private inStyleLane<T>(work: () => Promise<T>): Promise<T> {
    const run = this.styleLane.catch(() => undefined).then(work);
    this.styleLane = run;
    return run;
  }

  /**
   * The examples as they are now: each note's title and text, and its rules;
   * a note that is gone has no text. A rule that cannot be looked up is null
   * — which keeps the note from every reader.
   */
  private async readStyleExamples(vault: AiVaultHost, prefs: StylePrefs): Promise<{ example: StyleExample; text: string | null; effective: EffectivePolicy | null }[]> {
    return Promise.all(
      prefs.examples.map(async (path) => {
        const note = isAiHiddenPath(path) ? null : await vault.readNote(path).catch(() => null);
        const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
        if (!note) return { example: { path, title: name, missing: true, deny: [] }, text: null, effective: null };
        const effective = await vault.policy.policyOf(path, note.text).catch(() => null);
        const deny = effective ? AI_POLICY_DIMENSIONS.filter((dimension) => effective.policy[dimension] === "deny") : [...AI_POLICY_DIMENSIONS];
        return { example: { path, title: note.title || name, missing: false, deny }, text: note.text, effective };
      }),
    );
  }

  /**
   * Reads the writing style into the state (plan KI-Harness P9-3, ADR 0035):
   * this device's examples for the vault, and what this device measures in
   * them now — without a model; nothing is sent, nothing of a note is kept.
   */
  async refreshStyle(): Promise<void> {
    const vault = this.vault;
    const store = vault?.style;
    if (!vault || !store) {
      if (this.vault === vault) this.set({ style: EMPTY_STYLE_STATE, draftStyle: false });
      return;
    }
    const prefs = await store.load().catch(() => EMPTY_STYLE_PREFS);
    const read = await this.readStyleExamples(vault, prefs);
    if (this.vault !== vault) return;
    const measure = measureStyle(read.flatMap((entry) => (entry.text === null ? [] : [entry.text])));
    const features = styleFeaturesWithout(measure.features, prefs.removed);
    this.set({
      style: { available: true, examples: read.map((entry) => entry.example), measured: measure.features, removed: prefs.removed, features, tooShort: measure.tooShort, words: measure.words },
      // A choice for the next conversation holds while there is something to carry.
      draftStyle: this.state.draftStyle && features.length > 0,
    });
  }

  /** Changes this device's choices for the style, through its one lane, and reads the style again. */
  private async changeStyle(change: (prefs: StylePrefs) => StylePrefs | StyleRefusal): Promise<StyleOutcome> {
    const store = this.vault?.style;
    if (!store) return { ok: false, reason: "no-vault" };
    const outcome = await this.inStyleLane(async (): Promise<StyleOutcome> => {
      const prefs = await store.load().catch(() => EMPTY_STYLE_PREFS);
      const next = change(prefs);
      if (typeof next === "string") return { ok: false, reason: next };
      await store.save(next);
      return { ok: true };
    }).catch((): StyleOutcome => ({ ok: false, reason: "failed" }));
    await this.refreshStyle();
    return outcome;
  }

  /** Chooses a note as an example of the writing style: a note of the vault that is there, at most `STYLE_EXAMPLES_MAX` of them. */
  async addStyleExample(path: string): Promise<StyleOutcome> {
    const vault = this.vault;
    if (!vault) return { ok: false, reason: "no-vault" };
    if (!/\.md$/i.test(path) || isAiHiddenPath(path) || !(await vault.readNote(path).catch(() => null))) return { ok: false, reason: "not-note" };
    return this.changeStyle((prefs) =>
      prefs.examples.includes(path) ? "duplicate" : prefs.examples.length >= STYLE_EXAMPLES_MAX ? "full" : { ...prefs, examples: [...prefs.examples, path] },
    );
  }

  removeStyleExample(path: string): Promise<StyleOutcome> {
    return this.changeStyle((prefs) => ({ ...prefs, examples: prefs.examples.filter((example) => example !== path) }));
  }

  /** Takes one feature out: it goes into no conversation until the user brings it back. */
  removeStyleFeature(key: StyleFeatureKey): Promise<StyleOutcome> {
    return this.changeStyle((prefs) => (prefs.removed.includes(key) ? prefs : { ...prefs, removed: [...prefs.removed, key] }));
  }

  /** Brings back every feature the user took out. */
  restoreStyleFeatures(): Promise<StyleOutcome> {
    return this.changeStyle((prefs) => ({ ...prefs, removed: [] }));
  }

  /** Starts the next new conversation with the writing style, or without. An open conversation keeps what it started with. */
  setDraftStyle(on: boolean): void {
    if (this.state.active) return;
    this.set({ draftStyle: on && this.state.style.features.length > 0 });
  }

  /**
   * What a conversation carries of the writing style (plan P9-3, ADR 0035):
   * the features of the examples this recipient may have — in a conversation
   * with the internet, of those the internet may meet —, measured now, as the
   * lines the app writes; and the rules of the examples that went, for what is
   * made of it. An example a rule keeps from this recipient gives it nothing.
   * Null where the user keeps no examples on this device.
   */
  private async styleStart(vault: AiVaultHost, recipient: EgressRecipient, web: boolean): Promise<{ lines: string[]; record: ConversationStyle } | null> {
    const store = vault.style;
    if (!store) return null;
    const prefs = await store.load().catch(() => EMPTY_STYLE_PREFS);
    if (!prefs.examples.length) return null;
    const run: GateRun = { recipient, webTools: web };
    const texts: string[] = [];
    const rules = new Set<AiPolicyDimension>();
    let withheld = 0;
    for (const entry of await this.readStyleExamples(vault, prefs)) {
      if (entry.text === null) continue;
      // A rule that cannot be looked up says no.
      if (!entry.effective || !gateDecision(entry.effective, run).allowed) {
        withheld += 1;
        continue;
      }
      for (const dimension of AI_POLICY_DIMENSIONS) if (entry.effective.policy[dimension] === "deny") rules.add(dimension);
      texts.push(entry.text);
    }
    const features = styleFeaturesWithout(measureStyle(texts).features, prefs.removed);
    const lines = features.map(styleLine);
    return {
      lines,
      record: {
        features: features.length,
        examples: features.length ? texts.length : 0,
        withheld,
        tokens: lines.length ? estimateTokens(lines.join("\n")) : 0,
        // What went although a rule restricts it elsewhere: what is made of the conversation inherits it, as it does a note's.
        restricted: features.length ? AI_POLICY_DIMENSIONS.filter((dimension) => rules.has(dimension)) : [],
      },
    };
  }

  /**
   * Changes one of the two memory files: the file is read at this moment,
   * changed as text and written back as a whole — through the vault's own
   * adapters, so the file that was there is backed up first. Nothing is
   * written where the change does not apply.
   */
  private changeMemory(place: MemoryPlace, change: (file: string | null) => MemoryChange): Promise<MemoryOutcome> {
    const vault = this.vault;
    const host = vault?.memory;
    if (!vault) return Promise.resolve({ ok: false, reason: "no-vault" });
    if (!host?.update) return Promise.resolve({ ok: false, reason: "unavailable" });
    const update = host.update;
    return this.inMemoryLane(async (): Promise<MemoryOutcome> => {
      try {
        const read = await host.read(place);
        // A file that is too large to be read is none this app writes over.
        if (read.tooLarge) return { ok: false, reason: "unavailable" };
        // The change runs on the file as the chain reads it at the moment of writing — not on what was read above.
        const refused: { problem?: Extract<MemoryChange, { ok: false }>["problem"] } = {};
        await update(place, (file) => {
          const changed = change(file);
          if (!changed.ok) {
            refused.problem = changed.problem;
            return null;
          }
          return changed.text === file ? null : changed.text;
        });
        if (refused.problem) return { ok: false, reason: refused.problem };
        return { ok: true };
      } catch {
        return { ok: false, reason: "write-failed" };
      } finally {
        await this.refreshMemory();
      }
    });
  }

  /**
   * A new entry of the memory, as the user wrote it here — or as a draft of
   * an assistant they accepted (`by`, `source`). `deny`: the rules it carries.
   */
  addMemory(input: { text: string; place: MemoryPlace; deny?: readonly AiPolicyDimension[]; by?: MemoryWriter; source?: string | null }): Promise<MemoryOutcome> {
    const meta = { added: this.host.today(), by: input.by ?? ("user" as const), source: input.source ?? null, deny: [...(input.deny ?? [])] };
    return this.changeMemory(input.place, (file) => addMemoryEntry(file, input.place, input.text, meta));
  }

  /** Rewords an entry. What the app knows about it stays; `deny` sets its rules anew where the form could read them. */
  editMemory(id: string, text: string, options: { deny?: readonly AiPolicyDimension[] } = {}): Promise<MemoryOutcome> {
    const place = memoryPlaceOfId(id);
    if (!place) return Promise.resolve({ ok: false, reason: "gone" });
    return this.changeMemory(place, (file) => (file === null ? { ok: false, problem: "gone" } : replaceMemoryEntry(file, place, id, text, options.deny ? { deny: [...options.deny] } : {})));
  }

  removeMemory(id: string): Promise<MemoryOutcome> {
    const place = memoryPlaceOfId(id);
    if (!place) return Promise.resolve({ ok: false, reason: "gone" });
    return this.changeMemory(place, (file) => (file === null ? { ok: false, problem: "gone" } : removeMemoryEntry(file, place, id)));
  }

  /**
   * Moves an entry into the other file — "always included" or "on demand" —
   * with everything the app knows about it. It is written into the file it
   * goes to first and taken out of its own after: an entry is never in
   * neither. Where the other file holds the same words already, it only goes
   * from this one.
   */
  moveMemory(id: string, to: MemoryPlace): Promise<MemoryOutcome> {
    const vault = this.vault;
    const host = vault?.memory;
    const from = memoryPlaceOfId(id);
    if (!vault) return Promise.resolve({ ok: false, reason: "no-vault" });
    if (!host?.update) return Promise.resolve({ ok: false, reason: "unavailable" });
    if (!from || from === to) return Promise.resolve({ ok: false, reason: "gone" });
    const update = host.update;
    return this.inMemoryLane(async (): Promise<MemoryOutcome> => {
      try {
        const [source, target] = await Promise.all([host.read(from), host.read(to)]);
        if (source.tooLarge || target.tooLarge || source.text === null) return { ok: false, reason: source.text === null ? "gone" : "unavailable" };
        const entry = parseMemory(source.text, from).entries.find((candidate) => candidate.id === id);
        if (!entry) return { ok: false, reason: "gone" };
        // Each file changed as it lies there at the moment of writing (the chain's one entry).
        const refused: { problem?: Extract<MemoryChange, { ok: false }>["problem"] } = {};
        await update(to, (file) => {
          const added = addMemoryEntry(file, to, entry.text, memoryMetaOf(entry));
          if (!added.ok && added.problem !== "duplicate") refused.problem = added.problem;
          return added.ok ? added.text : null;
        });
        if (refused.problem) return { ok: false, reason: refused.problem };
        await update(from, (file) => {
          if (file === null) return null;
          const removed = removeMemoryEntry(file, from, id);
          return removed.ok ? removed.text : null;
        });
        return { ok: true };
      } catch {
        return { ok: false, reason: "write-failed" };
      } finally {
        await this.refreshMemory();
      }
    });
  }

  /**
   * A rule for assistants (plan P6): one more line of the vault's standing
   * instructions, `AGENTS.md`. A rule is no memory — it says what to do —, so
   * it goes where instructions go, and counts on a device only once that
   * device approved the file. Written here, into a file this device had
   * approved as it stood (or that was not there), it is approved here with
   * exactly what was written: the user wrote the one line that changed. A
   * file that was waiting for a review keeps waiting — the rule is in it, and
   * the user reads the whole of it first.
   */
  addRule(text: string): Promise<{ ok: true; approved: boolean } | { ok: false; reason: MemoryProblem | "too-large" }> {
    const vault = this.vault;
    const host = vault?.instructions;
    if (!vault) return Promise.resolve({ ok: false, reason: "no-vault" });
    if (!host?.update) return Promise.resolve({ ok: false, reason: "unavailable" });
    const update = host.update;
    return this.inMemoryLane(async () => {
      try {
        const [before, approvals] = await Promise.all([host.scanOne(AGENTS_FILE).catch(() => null), host.approvals.load().catch(() => EMPTY_INSTRUCTION_APPROVALS)]);
        if (before?.tooLarge) return { ok: false as const, reason: "too-large" as const };
        const status = before ? instructionStatus(before, approvals) : null;
        // Asked once of what the scan read, for the answer; the line itself goes into the file as the chain reads it.
        const asked = addRuleLine(before?.text ?? null, text);
        if (!asked.ok) return { ok: false as const, reason: asked.problem === "too-large" ? ("too-large" as const) : asked.problem };
        // Through the chain's one entry, and only into the file this device's approval was decided on: what another
        // device left in it meanwhile is nothing this device approves without the user reading it — the rule waits.
        const asScanned = (file: string | null) =>
          file === null || before === null || before.text === null ? file === null && (before === null || before.text === null) : editorTextOf(file) === editorTextOf(before.text);
        const written = await update(AGENTS_FILE, (file) => {
          if (!asScanned(file)) return null;
          const changed = addRuleLine(file, text);
          return changed.ok ? changed.text : null;
        });
        if (written === null) return { ok: false as const, reason: "write-failed" as const };
        const bytes = new TextEncoder().encode(written);
        const scanned = await host.scanOne(AGENTS_FILE).catch(() => null);
        // Approved only what reads back as written, and only where the file was this device's own before.
        const own = status === null || status === "active" || status === "off";
        const approved = own && scanned !== null && scanned.files.length === 1 && scanned.files[0]!.sha256 === instructionFileHash(bytes);
        if (approved) await host.approvals.save(approveInstruction(await host.approvals.load().catch(() => EMPTY_INSTRUCTION_APPROVALS), scanned, this.host.now().toISOString(), "created"));
        return { ok: true as const, approved };
      } catch {
        return { ok: false as const, reason: "write-failed" as const };
      } finally {
        await this.refreshSkills();
      }
    });
  }

  /**
   * What of the vault's memory a new conversation is started with (plan P6,
   * ADR 0032). Asked once, when the conversation begins: its system prompt
   * is fixed from then on. The file's own rules come first — a folder rule
   * over the agent area, a rule in the file's properties —, then each
   * entry's: an entry goes to no recipient one of its rules keeps out, and
   * one whose rules cannot be read goes nowhere. `lookup`: the long-term
   * memory holds something this recipient may have, so the tool that
   * searches it is worth carrying.
   */
  private async memoryStart(vault: AiVaultHost, recipient: EgressRecipient, web: boolean): Promise<{ text: string; lookup: boolean; record: Omit<ConversationMemory, "lookup"> } | null> {
    const host = vault.memory;
    if (!host) return null;
    const prefs = await host.prefs.load().catch(() => ({ on: false }));
    if (!prefs.on) return null;
    const read = await readMemory(host).catch(() => null);
    if (!read) return null;
    const run: GateRun = { recipient, webTools: web };
    const gate = { denied: memoryDeniedFor(recipient, web) };
    const fileRules = async (place: MemoryPlace): Promise<{ allowed: boolean; denies: AiPolicyDimension[] }> => {
      const text = read.texts[place];
      if (text === null) return { allowed: false, denies: [] };
      const effective = await vault.policy.policyOf(memoryFileOf(place), text).catch(() => null);
      // A rule that cannot be looked up says no.
      if (!effective) return { allowed: false, denies: [...AI_POLICY_DIMENSIONS] };
      return { allowed: gateDecision(effective, run).allowed, denies: AI_POLICY_DIMENSIONS.filter((dimension) => effective.policy[dimension] === "deny") };
    };
    const [activeFile, longFile] = await Promise.all([fileRules("active"), fileRules("long")]);
    const active = activeFile.allowed ? activeMemoryFor(read.active, gate) : { entries: [], withheld: read.active.length, left: 0, chars: 0 };
    const lookup = longFile.allowed && read.long.some((entry) => memoryEntryAllowed(entry, gate));
    if (active.entries.length === 0 && active.withheld === 0 && !lookup) return null;
    const text = memoryText(active.entries);
    // What went although a rule restricts it elsewhere: a conversation without the internet may carry an entry kept from it.
    const restricted = AI_POLICY_DIMENSIONS.filter((dimension) => active.entries.length > 0 && (activeFile.denies.includes(dimension) || active.entries.some((entry) => entry.deny.includes(dimension))));
    return { text, lookup, record: { entries: active.entries.length, withheld: active.withheld, left: active.left, tokens: estimateTokens(text), restricted } };
  }

  // ---------------------------------------------------------------- scripts

  /**
   * Writes a script into `.agent/scripts/<name>/` — its manifest and its code —
   * and approves exactly what was written, with this device's signature: the
   * user wrote it here (plan KI-Harness P5.5). A manifest with a problem, or
   * code the engine does not read, is not written at all. An own script of
   * the same name is only replaced when the user said so (its folder goes to
   * the trash first).
   *
   * `approved: false`: the files are there, but the keychain gave no key to
   * sign with — the script waits like one that arrived.
   */
  async saveScript(input: ScriptDraft, options: { replace?: boolean } = {}): Promise<ScriptWriteOutcome> {
    const vault = this.vault;
    const host = vault?.instructions;
    if (!vault || !host?.write) return { ok: false, reason: "no-vault" };
    const name = input.name.trim();
    const manifest = serializeScriptManifest({ ...input, name, description: input.description.trim(), ...(input.title?.trim() ? { title: input.title.trim() } : {}) });
    const parsed = parseScriptManifest(manifest, name);
    if (!parsed.script || parsed.problems.length) return { ok: false, reason: "invalid", problems: parsed.problems };
    if (!input.code.trim()) return { ok: false, reason: "invalid", problems: [{ code: "main-missing" }] };
    const checked = await this.scripts.check(input.code);
    if (checked && !checked.ok) return { ok: false, reason: "syntax", message: checked.message };
    const id = `${SCRIPTS_FOLDER}/${name}`;
    const files = [
      { path: SCRIPT_MANIFEST_FILE, bytes: utf8Encode(manifest) },
      { path: SCRIPT_MAIN_FILE, bytes: utf8Encode(input.code) },
    ];
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
    const signature = instructionStatus(written, EMPTY_INSTRUCTION_APPROVALS) === "new" ? await this.scripts.sign(vault.key, written) : null;
    if (signature) {
      const approvals = await host.approvals.load().catch(() => EMPTY_INSTRUCTION_APPROVALS);
      await host.approvals.save(approveInstruction(approvals, written, this.host.now().toISOString(), "created", undefined, signature));
    }
    await this.refreshSkills();
    return { ok: true, id, approved: Boolean(signature) };
  }

  /** Whether code is JavaScript the engine reads; null where this device cannot ask. Nothing of it runs. */
  checkScript(code: string): Promise<{ ok: true } | { ok: false; message: string } | null> {
    return this.scripts.check(code);
  }

  /** A script as it stands now on this device: active — its files the approved ones, the approval signed here — or null. */
  private async activeScript(vault: AiVaultHost, id: string): Promise<ActiveScript | null> {
    const entry = await this.instructionEntry(vault, id);
    const source = entry?.source;
    if (!entry || entry.status !== "active" || source?.kind !== "script" || !source.script || typeof source.code !== "string") return null;
    return { definition: source.script, code: source.code };
  }

  /**
   * Runs a script from the workshop (plan KI-Harness P5.5). It reads the
   * vault as a reader on this device does — nothing of the run leaves it, so
   * a note that is only kept from the cloud is there for it. `dry`: what
   * would show or change something is written down, not done. Null when the
   * script is not active here at this moment, or no script can run.
   */
  async runScript(id: string, args: unknown, dry = false): Promise<ScriptOutcome | null> {
    const vault = this.vault;
    if (!vault) return null;
    const active = await this.activeScript(vault, id);
    if (!active || this.vault !== vault) return null;
    const recipient: EgressRecipient = { kind: "local", provider: "script", model: active.definition.name };
    // A script that names a writing tool lays down suggestions and drafts (the second stage): signed with its own
    // name, never with the user's. A dry run brings no writer — it lays nothing down.
    const writing = !dry && scriptWrites(active.definition) ? this.scriptWriting(vault, active.definition, args) : null;
    const tools = writing ? vault.tools(recipient, writing.scope, undefined, false, undefined, undefined, writing.run) : vault.tools(recipient);
    if (!tools) return null;
    return this.scripts.run({ id, script: active.definition, code: active.code, args, dry, tools: tools.executor, ...(writing ? { writes: writing.run.writes } : {}) });
  }

  /**
   * What a script the user started brings to the writing tools (plan
   * KI-Harness P5.5, second stage). It signs with its own id and the words
   * "Script …" — the user started it, but did not write what it proposes.
   *
   * It reads as a reader on this device, so it can have read a note that is
   * kept from the cloud or from the internet: what it lays down inherits the
   * rules of everything this run read (`scope.passed`), and a place that
   * lacks one of them does not take it. The texts the user typed into the
   * run's fields are the user's own words — an address in them stays one.
   * A plan has nobody to ask here, and scripts are given no plans.
   */
  private scriptWriting(vault: AiVaultHost, script: ScriptDefinition, args: unknown): { run: WriteRun; scope: ToolScope } {
    const restricted = new Set<AiPolicyDimension>();
    const read = new Set<string>();
    const scope: ToolScope = {
      inside: () => true,
      passed: (path, rules) => {
        read.add(path);
        for (const rule of rules) restricted.add(rule);
      },
    };
    // Named `t`: the locale guard finds keys by their `t(` call (localeParity.test.ts).
    const t = (key: string, vars?: Record<string, string>) => this.host.label?.(key, vars) ?? key;
    const author = { id: scriptAuthorId(script.name), displayName: t("ai.scripts.author", { name: script.title || script.name }) };
    const typed = args && typeof args === "object" ? Object.values(args as Record<string, unknown>).filter((value): value is string => typeof value === "string") : [];
    const inherited = async () => AI_POLICY_DIMENSIONS.filter((dimension) => restricted.has(dimension));
    const run: WriteRun = {
      author,
      userTexts: () => typed,
      inherited,
      draft: async (input) =>
        this.leaveDraft(vault, {
          id: `d-${this.host.newId()}`,
          createdAt: this.host.now().toISOString(),
          author: { id: author.id, label: author.displayName },
          conversationId: null,
          title: input.title,
          body: input.body,
          inherited: [...(await inherited())],
          // What the draft rests on: the notes this run read, from the gate's own record — never from the script's words.
          sources: input.body.kind === "note" || input.body.kind === "entry" ? [...read].filter((path) => /\.md$/i.test(path)).slice(0, 50).map((path) => ({ resource: path })) : [],
          defused: input.defused,
          ...(input.missing?.length ? { missing: [...input.missing] } : {}),
          ...(input.withheld?.length ? { withheld: [...input.withheld] } : {}),
        }),
      ask: async () => "nobody",
      writes: { rounds: [], drafts: [], plans: [] },
      today: () => this.host.today(),
      clock: () => clockOf(this.host.now()),
    };
    return { run, scope };
  }

  /** Stops the script the workshop started. */
  stopScript(): void {
    this.scripts.stop();
  }

  /** Closes what the last script run showed. */
  clearScriptRun(): void {
    this.scripts.clear();
  }

  /** The active scripts of this vault as tools of a run, under the names a conversation was started with. */
  private async scriptTools(vault: AiVaultHost, names: readonly string[]): Promise<ToolManifest[]> {
    if (!this.scripts.available() || !names.some(isScriptToolName)) return [];
    const { entries } = await this.instructionEntries(vault);
    return activeScriptTools(entries).filter((tool) => names.includes(tool.name));
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
    const screen = this.screens;
    const since = this.clearsOf(vault);
    try {
      const { entries } = await this.instructionEntries(vault);
      // Left while the skill was looked up — a step on screen, another vault, a Delete all (step 8): it starts nothing,
      // and the screen stays as the user made it.
      if (this.screens !== screen || this.clearsOf(vault) !== since) return null;
      this.set({ skills: this.skillsState(entries, this.state.skills.servers) });
      const entry = entries.find((e) => e.source.id === id);
      if (!entry || entry.status !== "active" || !entry.source.skill) return null;
      this.set({ active: null, excludeActive: false, notice: null });
      return (await this.runMessage(message, vault, this.choice() ?? choice, { skills: { entries, bind: id }, since }))?.stop ?? null;
    } catch (error) {
      this.abort = null;
      const stop: RunStop = { kind: "failed", failure: { kind: "offline", message: error instanceof Error ? error.message : String(error) } };
      this.set({ live: null, notice: { conversationId: this.state.active?.id ?? "", stop } });
      return stop;
    } finally {
      this.sending = false;
    }
  }

  // ------------------------------------------------- a run's snapshot and its replay

  /**
   * How a run's sources and skills read now (plan KI-Harness P9-2, ADR 0034):
   * each note its context carried and each one a tool read whole, by the
   * version the run used against its text now; each skill by its `SKILL.md`
   * now. Asked on this device when the snapshot is looked at — nothing is
   * sent, and nothing of a text is kept.
   */
  async snapshotStates(run: RunMeta): Promise<RunSnapshotStates> {
    const vault = this.vault;
    const states: RunSnapshotStates = { sources: {}, read: {}, skills: {} };
    if (!vault) return states;
    const stateOf = async (path: string, hash: string): Promise<SnapshotState> => snapshotState(hash, (await vault.readNote(path).catch(() => null))?.text ?? null);
    for (const source of run.manifest?.sources ?? []) if (source.hash && !(source.path in states.sources)) states.sources[source.path] = await stateOf(source.path, source.hash);
    for (const read of run.readHashes ?? []) states.read[read.path] = await stateOf(read.path, read.hash);
    const versioned = (run.skills ?? []).filter((skill) => skill.sha256);
    if (versioned.length) {
      const { entries: own } = await this.instructionEntries(vault).catch(() => ({ entries: [] as InstructionEntry[] }));
      // A server's skill by the SKILL.md its server lists now (plan P9-4b) — what this device kept, no server asked.
      const entries = [...own, ...(await this.serverSkills(vault).catch(() => [] as AiServerSkills[])).flatMap((group) => group.entries)];
      for (const skill of versioned) {
        const now = entries.find((entry) => entry.source.id === skill.id)?.source.files.find((file) => /^skill\.md$/i.test(file.path))?.sha256;
        states.skills[skill.id] = now === undefined ? "gone" : now === skill.sha256 ? "same" : "changed";
      }
    }
    if (this.vault !== vault) return { sources: {}, read: {}, skills: {} };
    return states;
  }

  /**
   * Asks a run again of another model (plan KI-Harness P9-2, ADR 0034): the
   * same words, the same notes as the run's context read them — pinned, with
   * nothing a search would find besides them —, the skill the conversation
   * was bound to where it is still active, in a new conversation that says
   * where it comes from and how many of those notes changed since. The gate
   * holds as it holds now, and the send overview asks as for every request.
   * Only the first question of a conversation, and only one that brought
   * nothing but its context beside the user's words (`replayRequest`).
   */
  async replay(conversationId: string, userTurn: number, choice: ModelChoice): Promise<RunStop | null> {
    const vault = this.vault;
    if (!vault || this.state.live || this.sending || !this.state.settings.enabled) return null;
    const since = this.clearsOf(vault);
    const screen = this.screens;
    // Nothing is asked again of a conversation being deleted (step 8).
    if (this.gone(conversationId)) return null;
    // Taken at once: a message sent while the conversation is read would be a second run.
    this.sending = true;
    try {
      // One not on screen is read once its writes have landed.
      const record = this.state.active?.id === conversationId ? this.state.active : await this.loaded(vault, conversationId).catch(() => null);
      const run = record?.runs.find((candidate) => candidate.userTurn === userTurn);
      if (!record || !run) return null;
      const request = replayRequest(record, run);
      if (!request.ok) return null;
      const states = await this.snapshotStates(run);
      const { entries } = await this.instructionEntries(vault);
      // Left while it was put together — a step on screen, another vault, a Delete all, its original deleted (step 8):
      // it starts nothing, and the screen stays as the user made it.
      if (this.screens !== screen || this.clearsOf(vault) !== since || this.gone(conversationId)) return null;
      this.set({ skills: this.skillsState(entries, this.state.skills.servers) });
      const bound = record.instructions?.skill;
      const bind = bound && entries.some((entry) => entry.source.id === bound.id && entry.status === "active" && entry.source.skill) ? bound.id : undefined;
      const turn = record.conversation.turns[userTurn];
      const replay: ReplayStart = {
        title: this.host.label?.("ai.replay.title", { title: record.title, model: choice.model }) ?? `${record.title} · ${choice.model}`,
        pins: replaySources(run),
        of: {
          conversationId: record.id,
          userTurn,
          title: record.title,
          at: turn?.at ?? record.createdAt,
          providerId: run.providerId,
          model: run.model,
          changed: Object.values(states.sources).filter((state) => state !== "same").length,
        },
        web: hasWebTools(record.conversation.tools),
        style: Boolean(record.instructions?.style),
      };
      this.set({ active: null, excludeActive: false, notice: null });
      return (await this.runMessage(request.words, vault, choice, { skills: { entries, ...(bind ? { bind } : {}) }, replay, since }))?.stop ?? null;
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
    return this.draftChoice() ?? initialModelChoice(this.state.settings);
  }

  /** The model chosen for the next new conversation — while the device is fully local, only one that runs on it (plan P7). */
  private draftChoice(): ModelChoice | null {
    const draft = this.state.draftChoice;
    return draft && this.state.settings.localOnly && !choiceOnDevice(this.state.settings, draft) ? null : draft;
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
    // One run at a time (step 9): also while a review learns, a column is filled, a note is kept or a routine runs.
    if (this.occupied()) return { kind: "refused", reason: "busy" };
    this.sending = true;
    const since = this.clearsOf(vault);
    const before = this.state.active;
    // A step of the user's on screen while it runs keeps what the screen shows at its end (step 8).
    const screen = this.screens;
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
          // The history keeps one conversation per scenario: the one of its last run makes room — unless it was open
          // when the run began (it comes back at the end, where the user went nowhere else), or the user went on with
          // it since (step 9).
          const named = t("ai.workshop.test.conversation", { skill: title, scenario: scenario.id });
          const old = previous?.scenarios.find((s) => s.id === scenario.id)?.conversationId;
          if (old) await this.dropOwn(vault, old, (stored) => old !== before?.id && onlyItsOwnRun(stored, named));
          this.set({ active: null, notice: null });
          const outcome = await this.runMessage(scenario.message, vault, choice, {
            skills: { entries, bind: target.id },
            detached: { title: named, limits: SKILL_TEST_RUN_LIMITS },
            since,
          });
          // Stopped by the user, the send overview declined, the vault gone — or the request itself failed, which
          // says nothing about the skill: the run ends here, and the unfinished scenario leaves no conversation.
          const broke = outcome?.stop.kind === "failed" ? outcome.stop.failure : null;
          if (this.vault !== vault || !outcome || !outcome.record || outcome.stop.kind === "cancelled" || broke) {
            stopped = broke ? "failed" : "cancelled";
            if (broke) failure = broke;
            if (outcome?.record) await this.dropOwn(vault, outcome.record.id, (stored) => onlyItsOwnRun(stored, named));
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
      if (this.vault === vault) this.set({ notice: null, skillTests: { ...this.state.skillTests, running: null } });
      // The conversation that was open before is open again, as it is now (step 8) — unless the user went elsewhere
      // since; the scenarios' own are in the history. Nothing is sent before it is back.
      const back = before && this.state.summaries.some((s) => s.id === before.id) ? await this.loaded(vault, before.id).catch(() => null) : null;
      if (this.vault === vault && this.screens === screen) this.set({ active: back });
      this.sending = false;
    }
  }

  /**
   * Deletes a conversation a run of the app made itself (step 8) — a
   * regression run's scenario, a routine's previous run —: from the storage of
   * its own vault, and with that from the history and the screen. No step of
   * the user's, so what was open before comes back after a regression run;
   * one that cannot be deleted stays, and what the run is for goes on — the
   * routine keeps its note, the regression run its scenarios. `ownOnly`: as
   * for `deleteStored`.
   */
  private async dropOwn(vault: AiVaultHost, id: string, ownOnly?: (stored: ConversationRecord | null) => boolean): Promise<void> {
    await this.deleteStored(vault, id, ownOnly).catch(() => undefined);
  }

  /**
   * The history keeps one conversation per routine (ADR 0033): the one of its
   * last run makes room for this run's — unless it is on screen when its turn
   * comes, or the user went on with it since (strand 6, step 9); then it is the
   * user's and stays.
   */
  private async dropPrevious(vault: AiVaultHost, routine: Routine, record: ConversationRecord | undefined, title: string): Promise<void> {
    const previous = routine.conversationId;
    if (!record || !previous || previous === record.id) return;
    await this.dropOwn(vault, previous, (stored) => this.state.active?.id !== previous && onlyItsOwnRun(stored, title));
  }

  // ---------------------------------------------------------------- routines

  /** Something else has the session right now: a run, a review that learns, a column being filled, a note being kept, a routine. */
  private occupied(): boolean {
    return Boolean(this.state.live || this.sending || this.learnAbort || this.fillAbort || this.filtering || this.capturing || this.routines.state.running);
  }

  /** What a routine says to its skill: its own sentence, or the skill's own request. */
  private routineRequest(request: string, entry: InstructionEntry): string {
    const own = request.trim();
    if (own) return own;
    return skillView((key, vars) => this.host.label?.(key, vars as Record<string, string> | undefined) ?? key, entry).start;
  }

  /** The skill a routine names, when it can be one right now: active on this device, and one that only reads. */
  private routineSkill(entries: readonly InstructionEntry[], id: string): InstructionEntry | null {
    const entry = entries.find((candidate) => candidate.source.id === id);
    return entry && entry.status === "active" && entry.source.kind === "skill" && entry.source.skill && routineSkillFits(entry.source.skill) ? entry : null;
  }

  /**
   * What the confirmation of a routine shows (plan KI-Harness P8, ADR 0033):
   * who would read, what a run would bring along today — put together exactly
   * as a run puts it together, and never sent —, what it may spend, and where
   * its note goes. For a routine that exists (`id`), `growth` names what would
   * go now beyond what was confirmed: the reason it stopped.
   */
  async routinePreview(draft: RoutineDraft, id?: string): Promise<RoutinePreviewOutcome> {
    const refused = (reason: RoutinePreviewRefusal): RoutinePreviewOutcome => ({ kind: "refused", reason });
    const vault = this.vault;
    const capture = vault?.capture;
    // A routine leaves a note, a folder's log an entry in its file: without the one it needs, this vault keeps none here.
    if (!this.state.settings.enabled || !vault || !this.routines.available() || (draft.log ? !vault.log : !capture)) return refused("off");
    const choice = draft.choice;
    const provider = choice ? providerById(choice.providerId, this.state.settings.custom) : undefined;
    if (!choice || !provider) return refused("model");
    if (this.state.settings.localOnly && !runsOnDevice(provider)) return refused("local");
    if (draft.log) return this.logPreview(draft, vault, choice, provider, id);
    if (!capture) return refused("off");
    try {
      const { entries } = await this.instructionEntries(vault);
      const entry = this.routineSkill(entries, draft.skill);
      if (!entry) return refused("skill");
      const outcome = await this.runMessage(this.routineRequest(draft.request, entry), vault, choice, {
        skills: { entries, bind: draft.skill },
        routine: { title: "", limits: ROUTINE_RUN_LIMITS, scope: null, preview: true },
      });
      const manifest = outcome?.manifest;
      if (!manifest || this.vault !== vault) return refused("failed");
      // What was confirmed before counts for the same skill and the same model only.
      const existing = id ? this.routines.state.list.find((routine) => routine.id === id) : undefined;
      const confirmed = existing && existing.skill === draft.skill && sameChoice(existing.choice, choice) ? existing.scope : null;
      return {
        kind: "preview",
        preview: {
          skill: { id: draft.skill, hash: routineSkillHash(entry.source) },
          provider: provider.label,
          model: choice.model,
          here: manifest.local,
          manifest,
          growth: confirmed ? scopeGrowth(manifest, confirmed) : [],
          limits: outcome.limits ?? ROUTINE_RUN_LIMITS,
          folder: await capture.folder().catch(() => ""),
          noteTitle: routineNoteTitle(draft.name.trim(), this.host.now()),
          shared: Boolean(vault.encrypted?.()),
          everyRequest: this.state.settings.confirmEveryRequest && !manifest.local,
          noMail: !manifest.local && manifest.tools.some((name) => MAIL_TOOL_NAMES.includes(name)),
        },
      };
    } catch {
      return refused("failed");
    }
  }

  /**
   * The yes under a routine's confirmation: from here on it exists — or, for
   * one that existed, it is what was confirmed now. What may go to a provider
   * is what the shown overview named, added to what was confirmed before for
   * the same skill and the same model; another skill or another model starts
   * from nothing. A run that needed its user is answered by this: its moment
   * is open again.
   */
  async saveRoutine(draft: RoutineDraft, preview: RoutinePreview, id?: string): Promise<RoutineSaved> {
    const choice = draft.choice;
    if (!choice || routineDraftProblems(draft).length > 0 || !this.routines.available()) return "failed";
    // A folder's log names no skill: its folder is what it is confirmed for.
    const folder = draft.log ? logFolder(draft.log.folder) : null;
    const skill = draft.log ? "" : draft.skill;
    // What was shown belongs to the draft it was made for.
    if (preview.skill.id !== skill || (preview.log?.folder ?? null) !== folder || preview.manifest.providerId !== choice.providerId || preview.manifest.model !== choice.model) return "failed";
    const existing = id ? await this.routines.fresh(id).catch(() => null) : null;
    if (id && !existing) return "failed";
    const kept = existing && existing.skill === skill && (existing.log?.folder ?? null) === folder && sameChoice(existing.choice, choice) ? existing.scope : null;
    const confirmed = preview.here ? null : widenScope(kept, preview.manifest);
    const routine: Routine = {
      id: existing?.id ?? `r-${this.host.newId()}`,
      name: draft.name.trim(),
      skill,
      skillHash: preview.skill.hash,
      request: draft.log ? "" : draft.request.trim(),
      schedule: { days: routineDays(draft.days), time: draft.time },
      missed: draft.missed,
      onlyWhenChanged: draft.log ? true : draft.onlyWhenChanged,
      choice: { providerId: choice.providerId, model: choice.model },
      // The confirmation of a log covers what one request of it can carry at most: a busy day is no growth.
      scope: confirmed && folder !== null ? { ...confirmed, maxTokens: Math.max(confirmed.maxTokens, FOLDER_LOG_REQUEST_TOKENS) } : confirmed,
      paused: existing?.paused ?? false,
      createdAt: existing?.createdAt ?? this.host.now().toISOString(),
      ...(existing?.resumedAt ? { resumedAt: existing.resumedAt } : {}),
      ...(existing?.answeredAt ? { answeredAt: existing.answeredAt } : {}),
      ...(existing?.conversationId ? { conversationId: existing.conversationId } : {}),
      ...(existing?.last && existing.last.outcome !== "needs-you" ? { last: existing.last } : {}),
      ...(folder !== null ? { log: { folder } } : {}),
    };
    const list = await this.routines.put(routine).catch(() => null);
    return list ? "saved" : existing ? "failed" : "full";
  }

  /** Pauses a routine, or lets it run again — from now on: what was paused is not caught up. */
  async pauseRoutine(id: string, paused: boolean): Promise<void> {
    const now = this.host.now().toISOString();
    await this.routines.patch(id, (routine) => ({ ...routine, paused, ...(paused ? {} : { resumedAt: now }) })).catch(() => null);
  }

  /** Removes a routine. The notes it wrote stay; so does the conversation of its last run, until the history lets it go. */
  async removeRoutine(id: string): Promise<void> {
    await this.routines.remove(id).catch(() => null);
    if (this.routines.state.ready?.id === id) this.routines.setReady(null);
  }

  /** The note a run left was seen. */
  dismissRoutineReady(): void {
    this.routines.setReady(null);
  }

  /**
   * Runs what is due (plan KI-Harness P8): each routine whose moment has
   * come, one after the other, each at most once. Called by the shell's
   * scheduler — shortly after the vault opened, at its tick, and when the app
   * comes back to the front. While something else has the session, a routine
   * waits for the next look.
   */
  async runDueRoutines(): Promise<number> {
    if (!this.state.loaded || !this.state.settings.enabled || !this.vault || !this.routines.available()) return 0;
    // Nothing due by what is on screen: the device's own copy is not read for it.
    const first = this.host.now();
    if (!this.routines.state.list.some((routine) => dueMoment(routine, first))) return 0;
    let ran = 0;
    const tried = new Set<string>();
    for (;;) {
      if (this.occupied()) break;
      const now = this.host.now();
      const next = (await this.routines.reload()).find((routine) => !tried.has(routine.id) && dueMoment(routine, now));
      if (!next) break;
      tried.add(next.id);
      const outcome = await this.runRoutine(next.id, "due");
      if (outcome.kind === "ran") ran += 1;
      else if (outcome.reason === "busy" || outcome.reason === "off") break;
    }
    return ran;
  }

  /**
   * One run of a routine (plan KI-Harness P8, §20; ADR 0033) — at its time
   * (`due`), or because its user said "Run now" (`hand`). Nobody watches it,
   * so it gets less than a run a person starts: the tools that read, a small
   * budget, and no question — where it would need a yes, it ends without
   * sending and says what it needs. It runs beside the conversation on
   * screen and leaves that alone; its result is a note.
   */
  async runRoutine(id: string, how: "hand" | "due" = "hand"): Promise<RoutineRunOutcome> {
    const refused = (reason: Extract<RoutineRunOutcome, { kind: "refused" }>["reason"]): RoutineRunOutcome => ({ kind: "refused", reason });
    const vault = this.vault;
    if (!this.state.loaded || !this.state.settings.enabled || !vault || !this.routines.available()) return refused("off");
    if (this.occupied()) return refused("busy");
    // Set at once: a tick and a click never start two runs.
    this.sending = true;
    const since = this.clearsOf(vault);
    try {
      const routine = await this.routines.fresh(id);
      if (!routine || this.vault !== vault) return refused("gone");
      const started = this.host.now();
      const moment = how === "hand" ? started : dueMoment(routine, started);
      if (!moment) return refused("not-due");
      this.routines.setRunning({ id: routine.id, name: routine.name, ...(routine.log ? { log: true } : {}) });
      const ended = await this.routineRun(vault, routine, since).catch((): RoutineEnd => ({ outcome: "failed", failure: "other" }));
      const { conversationId, coveredAt, ...result } = ended;
      const at = this.host.now().toISOString();
      const run: RoutineRun = { scheduledFor: localStamp(moment), at, ...result };
      await this.routines
        .patch(routine.id, (stored) => ({
          ...stored,
          last: run,
          // A folder's log is written up to the instant its changes were read — also where there were none.
          ...(coveredAt ? { answeredAt: coveredAt } : run.outcome === "answered" ? { answeredAt: at } : {}),
          ...(conversationId ? { conversationId } : {}),
        }))
        .catch(() => null);
      if (run.outcome === "answered" && run.note && this.vault === vault) this.routines.setReady({ id: routine.id, name: routine.name, note: run.note, title: run.noteTitle ?? routine.name });
      return { kind: "ran", run };
    } catch {
      return refused("gone");
    } finally {
      this.abort = null;
      this.sending = false;
      if (this.routines.state.running) this.routines.setRunning(null);
    }
  }

  /** What became of one run: how it ended, and the conversation it left in the history. */
  private async routineRun(vault: AiVaultHost, routine: Routine, since: number): Promise<RoutineEnd> {
    const needs = (need: RoutineNeed): RoutineEnd => ({ outcome: "needs-you", need });
    const settings = this.state.settings;
    const provider = providerById(routine.choice.providerId, settings.custom);
    if (!provider || (provider.endpoint.needsKey && !this.state.keys[provider.id])) return needs("model");
    if (settings.localOnly && !runsOnDevice(provider)) return needs("local");
    if (routine.log) return this.logRun(vault, routine, provider, since);
    const { entries } = await this.instructionEntries(vault);
    const entry = this.routineSkill(entries, routine.skill);
    // Confirmed for the skill as it was: one that changed since rests its routine until somebody looked.
    if (!entry || routineSkillHash(entry.source) !== routine.skillHash) return needs("skill");
    // "Only when something changed": asked of the index on this device. Where it cannot say, the run goes ahead.
    if (routine.onlyWhenChanged && routine.answeredAt && vault.changedSince) {
      const changed = await vault.changedSince(new Date(routine.answeredAt).getTime(), routine.last?.note ? [routine.last.note] : []).catch(() => null);
      if (changed === false) return { outcome: "unchanged" };
    }
    const title = this.host.label?.("ai.routines.conversation", { name: routine.name }) ?? routine.name;
    const outcome = await this.runMessage(this.routineRequest(routine.request, entry), vault, routine.choice, {
      skills: { entries, bind: routine.skill },
      routine: { title, limits: ROUTINE_RUN_LIMITS, scope: routine.scope },
      since,
    });
    // The vault went away under it.
    if (!outcome) return { outcome: "stopped" };
    if (outcome.need) return needs(outcome.need);
    const record = outcome.record;
    const left = record ? { conversationId: record.id } : {};
    await this.dropPrevious(vault, routine, record, title);
    const stop = outcome.stop;
    if (stop.kind === "cancelled") return { outcome: "stopped", ...left };
    // Switched to fully local while it ran: the request was not handed on.
    if (stop.kind === "failed" && stop.failure.kind === "local_only") return { ...needs("local"), ...left };
    if (stop.kind !== "answered" || !record) return { outcome: "failed", failure: routineFailureOf(stop), ...left };
    // The mandatory note: the answer as "Keep as a note" writes it — stamped, with its sources and the rules of what
    // it rests on —, called after the routine and the day. A shared workspace was named when the routine was confirmed.
    const kept = await this.captureFrom(vault, record, record.runs[0]?.userTurn ?? 0, { title: routineNoteTitle(routine.name, this.host.now()), standing: true });
    // Kept by no host where a new one of the vault came since it ran (strand 6, step 10): stopped, the answer in its
    // conversation; the routine's previous conversation went as it would — app data of the same vault, not its notes.
    if (kept.kind !== "captured") return this.vault !== vault ? { outcome: "stopped", ...left } : { outcome: "failed", failure: "note", ...left };
    return { outcome: "answered", note: kept.path, noteTitle: kept.title, ...left };
  }

  // ------------------------------------------------------------ a folder's log

  /** The instant a folder's log looks back to: where its last entry ended — or, before its first, a day before it was set up. */
  private logSince(routine: Pick<Routine, "answeredAt" | "createdAt"> | undefined, now: Date): number {
    const answered = routine?.answeredAt ? new Date(routine.answeredAt).getTime() : Number.NaN;
    if (Number.isFinite(answered)) return answered;
    const made = routine ? new Date(routine.createdAt).getTime() : Number.NaN;
    return (Number.isFinite(made) ? made : now.getTime()) - FOLDER_LOG_FIRST_LOOK_MS;
  }

  /** What a run of a folder's log brings along, as the start of its conversation. */
  private logStart(material: LogMaterial): { lead: TextPart; disclose(manifest: EgressManifest): EgressManifest } {
    return { lead: { type: "text", text: material.request, context: [] }, disclose: material.disclose };
  }

  /** What stands in the user's place in such a run: one sentence; the request's own words follow it. */
  private logAsk(): string {
    return this.host.label?.("ai.routines.log.ask") ?? "Write the entry for this folder's log.";
  }

  /** The notes of a folder that changed since `since`, as far as this recipient and the place of the log allow. */
  private logFound(vault: AiVaultHost, log: FolderLogHost, folder: string, since: number, choice: ModelChoice, provider: ProviderInfo, evenEmpty: boolean) {
    const price = this.priceOf(choice);
    return logMaterial(
      { policy: vault.policy, readNote: (path) => vault.readNote(path), log },
      {
        folder,
        since,
        recipient: recipientOf(provider, choice.model),
        language: this.host.language(),
        now: this.host.now().getTime(),
        ...(price ? { price: price.input } : {}),
        ...(evenEmpty ? { evenEmpty: true } : {}),
      },
    );
  }

  /**
   * The confirmation of a folder's log (plan KI-Harness P8-2): what a run
   * would bring along now — the notes that changed since its last entry —,
   * put together like a run and not sent.
   */
  private async logPreview(draft: RoutineDraft, vault: AiVaultHost, choice: ModelChoice, provider: ProviderInfo, id?: string): Promise<RoutinePreviewOutcome> {
    const refused = (reason: RoutinePreviewRefusal): RoutinePreviewOutcome => ({ kind: "refused", reason });
    const log = vault.log;
    const folder = draft.log ? logFolder(draft.log.folder) : null;
    if (!log || folder === null) return refused("failed");
    try {
      const existing = id ? this.routines.state.list.find((routine) => routine.id === id) : undefined;
      // What was confirmed before, and where the last entry ended, count for the same folder only.
      const same = existing && existing.log?.folder === folder ? existing : undefined;
      const found = await this.logFound(vault, log, folder, this.logSince(same, this.host.now()), choice, provider, true);
      if (found.kind === "rules") return refused("rules");
      if (found.kind !== "material") return refused("failed");
      const outcome = await this.runMessage(this.logAsk(), vault, choice, { routine: { title: "", limits: FOLDER_LOG_LIMITS, scope: null, preview: true, log: this.logStart(found.material) } });
      const manifest = outcome?.manifest;
      if (!manifest || this.vault !== vault) return refused("failed");
      const confirmed = same && sameChoice(same.choice, choice) ? same.scope : null;
      return {
        kind: "preview",
        preview: {
          skill: { id: "", hash: "" },
          provider: provider.label,
          model: choice.model,
          here: manifest.local,
          manifest,
          growth: confirmed ? scopeGrowth(manifest, confirmed) : [],
          limits: outcome.limits ?? FOLDER_LOG_LIMITS,
          folder,
          noteTitle: folderLogPath(folder),
          shared: Boolean(vault.encrypted?.()),
          everyRequest: this.state.settings.confirmEveryRequest && !manifest.local,
          noMail: false,
          log: { folder, file: folderLogPath(folder), notes: found.material.items.length, max: FOLDER_LOG_NOTES_MAX },
        },
      };
    } catch {
      return refused("failed");
    }
  }

  /**
   * One run of a folder's log (plan KI-Harness P8-2): the notes that changed
   * since its last entry are found on this device; a model is shown what each
   * gained and finds one sentence per note — in one request, without a tool —;
   * and the app writes the entry into the folder's `log.md`. Where nothing
   * changed, no model is asked and nothing is written.
   */
  private async logRun(vault: AiVaultHost, routine: Routine, provider: ProviderInfo, since: number): Promise<RoutineEnd> {
    const needs = (need: RoutineNeed): RoutineEnd => ({ outcome: "needs-you", need });
    const log = vault.log;
    const folder = routine.log ? logFolder(routine.log.folder) : null;
    if (!log || folder === null) return { outcome: "failed", failure: "other" };
    const found = await this.logFound(vault, log, folder, this.logSince(routine, this.host.now()), routine.choice, provider, false);
    if (found.kind === "rules") return needs("rules");
    if (found.kind === "nothing") return { outcome: "unchanged", coveredAt: new Date(found.asOf).toISOString() };
    const material = found.material;
    const title = this.host.label?.("ai.routines.conversation", { name: routine.name }) ?? routine.name;
    const outcome = await this.runMessage(this.logAsk(), vault, routine.choice, { routine: { title, limits: FOLDER_LOG_LIMITS, scope: routine.scope, log: this.logStart(material) }, since });
    // The vault went away under it.
    if (!outcome) return { outcome: "stopped" };
    if (outcome.need) return needs(outcome.need);
    const record = outcome.record;
    const left = record ? { conversationId: record.id } : {};
    await this.dropPrevious(vault, routine, record, title);
    const stop = outcome.stop;
    if (stop.kind === "cancelled") return { outcome: "stopped", ...left };
    if (stop.kind === "failed" && stop.failure.kind === "local_only") return { ...needs("local"), ...left };
    if (stop.kind !== "answered") return { outcome: "failed", failure: routineFailureOf(stop), ...left };
    // The entry is the app's to write: each note's link from the index, the day from the clock, and of the model's
    // answer one sentence per note — every other line of it is dropped.
    const path = folderLogPath(folder);
    try {
      // Named `t`: the locale guard finds keys by their `t(` call (localeParity.test.ts).
      const t = (key: string, vars?: Record<string, string>) => this.host.label?.(key, vars) ?? key;
      // Merged into the log as it lies there at the moment of writing: an entry another device wrote meanwhile stays.
      const entry = {
        folder,
        material,
        answer: outcome.answer ?? "",
        day: this.host.now(),
        title: folder ? t("ai.routines.log.fileTitle", { folder: folder.slice(folder.lastIndexOf("/") + 1) }) : t("ai.routines.log.fileTitleVault"),
        words: {
          fresh: t("ai.routines.log.entryNew"),
          changed: t("ai.routines.log.entryChanged"),
          ...(material.more ? { more: t("ai.routines.log.entryMore", { count: String(material.more) }) } : {}),
        },
      };
      // A new host of the vault since it ran (strand 6, step 10) stops the entry: nothing is laid into the vault through
      // the host that was. The answer stays in its conversation, which the history lists.
      if (this.vault !== vault) return { outcome: "stopped", ...left };
      await log.update(path, (current) => logEntryText(current, entry));
    } catch {
      return { outcome: "failed", failure: "note", ...left };
    }
    return { outcome: "answered", note: path, noteTitle: path, coveredAt: new Date(material.asOf).toISOString(), ...left };
  }

  // ------------------------------------------------------------ calm hints at the open note

  /** This vault's hidden and paused hints, read from this device's data. */
  private async loadHintPrefs(vault: AiVaultHost): Promise<void> {
    const prefs = vault.hintPrefs ? await vault.hintPrefs.load().catch(() => EMPTY_NOTE_HINTS_PREFS) : EMPTY_NOTE_HINTS_PREFS;
    if (this.vault !== vault) return;
    this.set({ hints: { ...this.state.hints, prefs, version: this.state.hints.version + 1 } });
  }

  /** One change of what is hidden and paused: from what this device keeps now, written back, and every view asks again. */
  private async changeHintPrefs(change: (prefs: NoteHintsPrefs) => NoteHintsPrefs): Promise<void> {
    const vault = this.vault;
    const store = vault?.hintPrefs;
    if (!vault || !store) return;
    const prefs = change(await store.load().catch(() => this.state.hints.prefs));
    await store.save(prefs).catch(() => undefined);
    if (this.vault === vault) this.set({ hints: { ...this.state.hints, prefs, version: this.state.hints.version + 1 } });
  }

  /**
   * The calm hints at a note (plan KI-Harness P8-3, mockup chapter 25): what
   * this device notices by itself in the note's text as it stands now — a
   * link that leads nowhere, a line that begins with TODO — and, in today's
   * daily note, tomorrow's appointments no note is anchored to. No model is
   * asked and nothing leaves the device. At most three, none that was hidden.
   */
  async noteHints(path: string, content: string): Promise<NoteHintsAnswer> {
    const vault = this.vault;
    const host = vault?.hints;
    if (!this.state.settings.enabled || !this.state.settings.noteHints || !vault || !host || !vault.hintPrefs) return { kind: "off" };
    const prefs = this.state.hints.prefs;
    if (prefs.vaultPaused) return { kind: "vaultPaused" };
    if (prefs.pausedNotes.includes(path)) return { kind: "paused" };
    const todos = todoLines(content);
    const [links, today] = await Promise.all([host.brokenLinks(path, content).catch(() => []), host.isTodaysDailyNote(path).catch(() => false)]);
    const meetings = today ? await host.meetingsTomorrow().catch((): PimEventRow[] => []) : [];
    const hints = noteHints({
      path,
      links: links.map((link) => ({ label: link.label, line: link.line })),
      todos: todos.map((todo) => ({ line: todo.line, rest: todo.todo.rest })),
      meetings: meetings.map((event) => ({ uid: event.uid, title: event.title })),
      dismissed: new Set(prefs.dismissed),
    });
    const items = hints.map((hint): NoteHintItem => {
      if (hint.kind === "link") return { ...hint, link: links.find((link) => link.label === hint.subject)?.link };
      if (hint.kind === "todo") return { ...hint, raw: todos.find((todo) => todo.line === hint.line)?.raw };
      return { ...hint, event: meetings.find((event) => event.title === hint.subject && hint.key.endsWith(`\n${event.uid}`)) };
    });
    return { kind: "hints", items };
  }

  /** The one step of a hint — the app's own way, on the user's click. Every view asks again afterwards. */
  async actOnNoteHint(path: string, item: NoteHintItem): Promise<NoteHintOutcome> {
    const host = this.vault?.hints;
    if (!host) return { kind: "failed" };
    try {
      if (item.kind === "link" && item.link) {
        const made = await host.createLinkTarget(item.link);
        return made ? { kind: "opened", path: made } : { kind: "failed" };
      }
      if (item.kind === "todo" && item.raw !== undefined && item.line !== null) {
        return (await host.todoAsTask(path, item.line, item.raw)) ? { kind: "done" } : { kind: "gone" };
      }
      if (item.kind === "meeting" && item.event) {
        // Null is the template's questions cancelled: nothing was written, and nothing went wrong.
        const note = await host.createMeetingNote(item.event);
        return note ? { kind: "opened", path: note } : { kind: "cancelled" };
      }
      return { kind: "failed" };
    } catch {
      return { kind: "failed" };
    } finally {
      this.set({ hints: { ...this.state.hints, version: this.state.hints.version + 1 } });
    }
  }

  /** "Don't show again": exactly this hint, on this device. */
  dismissNoteHint(key: string): Promise<void> {
    return this.changeHintPrefs((prefs) => ({ ...prefs, dismissed: [...prefs.dismissed.filter((other) => other !== key), key] }));
  }

  pauseNoteHints(path: string): Promise<void> {
    return this.changeHintPrefs((prefs) => ({ ...prefs, pausedNotes: [...prefs.pausedNotes.filter((other) => other !== path), path] }));
  }

  resumeNoteHints(path: string): Promise<void> {
    return this.changeHintPrefs((prefs) => ({ ...prefs, pausedNotes: prefs.pausedNotes.filter((other) => other !== path) }));
  }

  setNoteHintsVaultPaused(paused: boolean): Promise<void> {
    return this.changeHintPrefs((prefs) => ({ ...prefs, vaultPaused: paused }));
  }

  /** Every hint that was hidden comes back. */
  restoreNoteHints(): Promise<void> {
    return this.changeHintPrefs((prefs) => ({ ...prefs, dismissed: [] }));
  }

  /** Every paused note shows its hints again. */
  resumeAllNoteHints(): Promise<void> {
    return this.changeHintPrefs((prefs) => ({ ...prefs, pausedNotes: [] }));
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
  private conversationStart(entries: readonly InstructionEntry[], offered: readonly string[], bind?: string, further: readonly string[] = [], servers: readonly InstructionEntry[] = []): ConversationStart {
    const prompt: ConversationStart["prompt"] = {};
    const instructions: ConversationInstructions = {};
    const agents = entries.find((e) => e.source.kind === "agents" && e.status === "active" && e.source.text);
    if (agents?.source.text) {
      prompt.vaultInstructions = agents.source.text;
      instructions.vaultTokens = estimateTokens(agents.source.text);
    }
    const result = (tools: string[], more: string[] = []): ConversationStart => ({ tools, more, prompt, instructions: Object.keys(instructions).length ? instructions : null });
    const bound = bind ? entries.find((e) => e.source.id === bind && e.status === "active" && e.source.skill && e.source.origin !== "server") : undefined;
    if (bound?.source.skill) {
      const skill = bound.source.skill;
      const grant = skillGrant(skill, [...offered, ...further.filter((name) => !offered.includes(name))], DEFAULT_RUN_LIMITS.maxOutputTokens);
      prompt.skill = { name: skill.name, instructions: skill.body };
      instructions.skill = {
        id: bound.source.id,
        name: skill.name,
        // Never a server's skill (plan P9-4b): its words are not the system prompt's.
        origin: bound.source.origin === "plainva" ? "plainva" : "vault",
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
    // The skills of connected servers (plan P9-4b), where the caller gives them — a conversation the user began — in their own part.
    const catalog = offered.length ? skillCatalog(entries, servers) : null;
    if (catalog?.entries.length) {
      prompt.skillCatalog = catalog.text;
      instructions.catalog = catalog.entries.map((e) => ({ key: e.key, id: e.id, origin: e.origin }));
      instructions.catalogTokens = catalog.tokens;
      return result([...own, "use_skill"], more);
    }
    return result(own, more);
  }

  /** How a run reaches the skills its conversation lists: read again at the moment, hash checked. */
  private skillRuntime(vault: AiVaultHost, record: ConversationRecord) {
    return {
      catalog: record.instructions?.catalog ?? [],
      entry: async (id: string, signal?: AbortSignal): Promise<InstructionEntry | null> => {
        if (id.startsWith("plainva:")) return APP_ENTRIES().find((e) => e.source.id === id) ?? null;
        // A server's skill (plan P9-4b): approved at what its server lists now, the server ready, its SKILL.md read and checked.
        if (readMcpSkillSourceId(id)) {
          const found = await this.serverSkill(vault, id);
          if (!found || !found.group.ready || found.entry.status !== "active") return null;
          const read = await this.readServerSkill(found.entry, signal);
          if (!read.ok) return null;
          return { ...found.entry, source: { ...found.entry.source, text: read.text, skill: read.skill, ...(read.invisible ? { invisible: read.invisible } : {}) } };
        }
        const host = vault.instructions;
        if (!host) return null;
        const [source, approvals] = await Promise.all([host.scanOne(id).catch(() => null), host.approvals.load().catch(() => EMPTY_INSTRUCTION_APPROVALS)]);
        if (!source) return null;
        // The app's switches count for the app's skills too; read them with the vault's approvals.
        return resolveInstructions([source], approvals)[0] ?? null;
      },
      file: async (entry: InstructionEntry, rel: string, signal?: AbortSignal): Promise<string | null> => {
        if (entry.source.origin === "server") return this.serverSkillFile(entry, rel, signal);
        return entry.source.origin === "vault" && vault.instructions ? vault.instructions.readFile(entry.source, rel) : null;
      },
    };
  }

  /** One file of a loaded server skill: only a path of its manifest, from its own server, its bytes the manifest's — as UTF-8 text. */
  private async serverSkillFile(entry: InstructionEntry, rel: string, signal?: AbortSignal): Promise<string | null> {
    const got = await this.serverSkillFileRead(entry, rel, signal);
    return got.ok ? got.text : null;
  }

  /** A file of a server's skill, read from its server and checked — or why it was not: other bytes, no text, no answer now. */
  private async serverSkillFileRead(entry: InstructionEntry, rel: string, signal?: AbortSignal): Promise<{ ok: true; text: string } | { ok: false; problem: "large" | "digest" | "text" | "unavailable" }> {
    const origin = entry.source.server;
    const file = entry.source.files.find((candidate) => candidate.path === rel);
    if (!origin || !file) return { ok: false, problem: "unavailable" };
    if (file.bytes > MCP_SKILL_LIMITS.readable) return { ok: false, problem: "large" };
    const read = await this.mcp.readSkillFile(origin.serverId, origin.uri, { uri: `${entry.source.root}/${rel}`, bytes: file.bytes, sha256: file.sha256 }, signal);
    if (!read.ok) {
      if (read.reason === "digest") void this.refreshSkills();
      return { ok: false, problem: read.reason === "digest" ? "digest" : "unavailable" };
    }
    const checked = checkMcpSkillFile(file, read.bytes);
    return checked.ok ? checked : { ok: false, problem: checked.reason };
  }

  async remove(id: string): Promise<void> {
    const vault = this.vault;
    if (!vault) return;
    if (this.state.live?.conversationId === id) this.stop();
    if (this.state.active?.id === id) {
      this.dropWriteQuestion();
      this.leaveComposerMessage();
    }
    await this.deleteStored(vault, id);
  }

  async removeAll(): Promise<void> {
    const vault = this.vault;
    if (!vault) return;
    this.stop();
    // A review that learns from one of them is cut off (step 8). A message of the composer on its way goes nowhere:
    // it counts this Delete all (`since`).
    this.learnAbort?.abort();
    // Every conversation of this vault goes. Marked as deleted are the ones something could still write — on screen,
    // a run on its way for it, a write of it —: what was written of them lands first, and nothing that comes after
    // writes them back. A read of any other waits for the clearing, and so does what is written meanwhile.
    const key = vaultOf(vault);
    const listed = new Set(this.state.summaries.map((summary) => summary.id));
    const ids = new Set([
      ...(this.state.active ? [this.state.active.id] : []),
      ...[...this.running].filter(([, run]) => vaultOf(run.vault) === key).map(([id]) => id),
      ...[...this.writing].filter(([, entry]) => vaultOf(entry.vault) === key).map(([id]) => id),
    ]);
    for (const id of ids) this.askDeletion(id);
    this.clears.set(key, (this.clears.get(key) ?? 0) + 1);
    const before = [...this.writing.values()].filter((entry) => vaultOf(entry.vault) === key).map((entry) => entry.done);
    const clearing = Promise.all([this.clearings.get(key), ...before]).then(async () => {
      try {
        await vault.conversations.removeAll();
      } catch (error) {
        for (const id of ids) this.settleDeletion(id, false);
        throw error;
      }
      for (const id of ids) this.settleDeletion(id, true);
    });
    const settled = clearing.then(
      () => undefined,
      () => undefined,
    );
    this.clearings.set(key, settled);
    void settled.then(() => {
      if (this.clearings.get(key) === settled) this.clearings.delete(key);
    });
    await clearing;
    // What was deleted leaves the screen — where its vault is still the one on screen —; a conversation begun meanwhile
    // stays on it, and so does a notice about anything else.
    if (!this.vault || vaultOf(this.vault) !== key) return;
    const notice = this.state.notice;
    this.set({
      summaries: [],
      ...(this.state.active && ids.has(this.state.active.id) ? { active: null } : {}),
      ...(notice && (ids.has(notice.conversationId) || listed.has(notice.conversationId)) ? { notice: null } : {}),
    });
  }

  async rename(id: string, title: string): Promise<void> {
    const vault = this.vault;
    const clean = title.trim();
    if (!vault || !clean) return;
    // On its way — read, then written —, a rename is the user's step: the app's own deletion leaves the conversation alone.
    this.renaming.set(id, (this.renaming.get(id) ?? 0) + 1);
    try {
      const record = this.state.active?.id === id ? this.state.active : await this.loaded(vault, id);
      if (!record) return;
      const next = { ...record, title: clean };
      // What is on screen first: a run of this conversation that ends meanwhile takes the title from there.
      this.set({
        active: this.state.active?.id === id ? next : this.state.active,
        summaries: this.state.summaries.map((s) => (s.id === id ? { ...s, title: clean } : s)),
      });
      await this.storeChoice(vault, next);
    } finally {
      const left = (this.renaming.get(id) ?? 1) - 1;
      if (left > 0) this.renaming.set(id, left);
      else this.renaming.delete(id);
    }
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
    const since = this.clearsOf(vault);
    const { range, action } = request;
    if (!range.text.trim()) return { kind: "refused", reason: "empty" };
    if (range.text.length > SELECTION_MAX_CHARS) return { kind: "refused", reason: "too-long" };
    const provider = providerById(choice.providerId, this.state.settings.custom);
    if (!provider) return { kind: "refused", reason: "no-model" };
    // Fully local (plan P7): said before the passage is looked at.
    const rests = this.notThisDevice(provider);
    if (rests) return { kind: "refused", reason: "failed", message: rests.text };
    const recipient: EgressRecipient = recipientOf(provider, choice.model);
    const run = { recipient, webTools: false };
    // The note passes the gate with the text in the editor: an unsaved `cloud: deny` counts.
    if (!gateDecision(await vault.policy.policyOf(range.path, range.doc), run).allowed) return { kind: "refused", reason: "denied" };
    const places = withholdPlaces(range.text);
    const links = isCloudRecipient(recipient)
      ? await withholdDeniedLinks(range.text, range.path, vault.policy, async (path) => gateDecision(await vault.policy.policyOf(path), run).allowed)
      : { text: range.text };
    if (places.withheld > 0 || links.text !== range.text) return { kind: "refused", reason: "withheld" };
    // Something else began while the passage was looked at (step 8): one run at a time.
    if (this.state.live || this.sending) return { kind: "refused", reason: "busy" };
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
        // The reader chose the passage: nothing of it was Plainva's to leave out (no `left` on its source).
        material: { sentChars: range.text.length, sourceChars: range.text.length, sentBytes: utf8Length(range.text), candidateBytes: null },
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
      // A passage whose vault went, or whose history was cleared, while it was looked at goes nowhere (step 8).
      if (this.vault !== vault || this.clearsOf(vault) !== since) return { kind: "refused", reason: "cancelled" };
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
        ...(isCloudRecipient(recipient) ? {} : { onDevice: true as const }),
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
        created: true,
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
      // A new host of the vault since the answer (strand 6, step 10) stops the round: nothing is laid down through the
      // host that was. The answer stays in its conversation.
      if (this.vault !== vault) return { kind: "refused", reason: "cancelled" };
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
    // Fully local (plan P7): said before the note is read or anyone is asked.
    const rests = this.notThisDevice(provider);
    if (rests) return refused("failed", { failure: rests.failure, provider: provider.label, model: choice.model });
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
      const answer = await fetchProviderJson(this.out, spec, `ai-${this.host.newId()}`);
      await this.recordTranscription(vault, choice, answer.ok ? transcriptionUsage(answer.json) : EMPTY_USAGE, answer.ok ? undefined : answer.failure.kind);
      if (!answer.ok) return refused("failed", { failure: answer.failure, provider: provider.label, model: choice.model });
      const transcript = transcriptOf(route, answer.json);
      if (!transcript) return refused("empty");
      // A summary above a long transcript (plan P7), where the user switched it on: written by the model of the
      // profile "Local" on this device — nothing goes to anyone new for it — and checked, or left out. It never
      // holds the transcript back.
      const summary = await this.transcriptSummary(vault, transcript, notePath, note.text, audio.path);
      // The note may have moved on meanwhile: the round is laid on it as it is now, under the one line with the recording.
      const base = (await vault.readNote(notePath))?.text ?? "";
      const at = base.indexOf(target);
      if (at < 0 || base.indexOf(target, at + 1) >= 0) return refused("changed");
      const lineEnd = base.indexOf("\n", at + target.length);
      const end = lineEnd < 0 ? base.length : lineEnd;
      // What was said in a recording is text a model wrote down: an address in it is made inert like any other.
      const linted = defuseNewAddresses(transcript, [base]);
      // The summary names no address the transcript does not hold (its check); what it holds is made inert like the transcript's.
      const above = summary ? defuseNewAddresses(summary.text, [base]) : null;
      const roundNote = summary ? t("ai.transcribe.roundNoteSummary", { name: audio.name, model: summary.model }) : t("ai.transcribe.roundNote", { name: audio.name });
      // A new host of the vault since the request went (strand 6, step 10) stops the round: nothing is laid down through
      // the host that was. The recording stays, to be written down again.
      if (this.vault !== vault) return refused("cancelled");
      await vault.propose({
        path: notePath,
        base,
        chunks: [{ fromA: end, toA: end, replacement: transcriptBlock(linted.text, above ? { label: t("ai.transcribe.summaryLabel"), text: above.text } : undefined) }],
        note: linted.defused || above?.defused ? `${roundNote} ${t("ai.lint.defused")}` : roundNote,
        author: { id: `plainva-ai/${choice.model}`, displayName: t("ai.suggestionAuthor", { model: choice.model }) },
      });
      return { kind: "proposed", model: choice.model };
    } catch (error) {
      return refused("failed", { message: error instanceof Error ? error.message : String(error), provider: provider.label, model: choice.model });
    } finally {
      this.transcribing.delete(audio.path);
    }
  }

  /**
   * A checked summary of a transcript by the model on this device (plan P7), or null: switched off, no such model,
   * a transcript too short to need one, rules that keep the note from that model, a model that failed, or a
   * summary that names something the recording does not.
   */
  private async transcriptSummary(vault: AiVaultHost, transcript: string, notePath: string, noteText: string, audioPath: string): Promise<{ text: string; model: string } | null> {
    if (!this.state.settings.transcriptSummary || transcript.trim().length < TRANSCRIPT_SUMMARY_MIN) return null;
    const local = this.localCompletion();
    const provider = local ? providerById(local.providerId, this.state.settings.custom) : undefined;
    if (!local || !provider) return null;
    try {
      // The note's rules and the recording's own decide for this reader as they did for the one that transcribed.
      const run = { recipient: recipientOf(provider, local.model), webTools: false };
      if (!gateDecision(await vault.policy.policyOf(notePath, noteText), run).allowed) return null;
      if (!gateDecision(await vault.policy.policyOf(audioPath), run).allowed) return null;
      const answer = await local.complete(TRANSCRIPT_SUMMARY_INSTRUCTION, transcript);
      await this.recordRequests(vault, { providerId: local.providerId, model: local.model }, { id: `summary-${this.host.newId()}`, usage: { ...EMPTY_USAGE, ...answer.usage }, steps: 1, stop: "answered" });
      const text = answer.text.replace(/\s+/g, " ").trim();
      return checkTranscriptSummary(transcript, text).ok ? { text, model: local.model } : null;
    } catch {
      return null;
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
      egress: this.out,
      endpoint: provider.endpoint,
      model: choice.model,
      executor: { execute: async () => ({ content: "No tools.", isError: true }) },
      context: { privateContext: true, untrustedContext: true },
      limits: { maxSteps: 1, maxToolCalls: 0, maxOutputTokens },
      ...this.modelLimits(provider, choice.model),
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
    // Fully local (plan P7): said before an entry is read or anyone is asked — a run that proposed nothing, with why.
    const rests = this.notThisDevice(provider);
    if (rests) return { kind: "done", proposed: 0, silent: 0, kept: 0, failed: 0, stopped: false, provider: provider.label, model: choice.model, failure: rests.failure };
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
    // Fully local (plan P7): said before anyone is asked.
    const rests = this.notThisDevice(provider);
    if (rests) return { kind: "refused", reason: "failed", failure: rests.failure, provider: provider.label, model: choice.model };
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
    const since = this.clearsOf(vault);
    // A door starts a conversation of its own: with the model a new one would get, not the open one's.
    const choice = this.newConversationChoice();
    const provider = choice ? providerById(choice.providerId, this.state.settings.custom) : undefined;
    if (!choice || !provider) return refused("no-model");
    // Fully local (plan P7): said before the picture is read.
    const rests = this.notThisDevice(provider);
    if (rests) return refused("failed", { provider: provider.label, message: rests.text });
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
      // "Make a note of it" (plan P7) is the same door with another task: the answer is the note.
      const asNote = request.purpose === "note";
      const place = { path, ...(noteTitle ? { noteTitle } : {}) };
      const lead: TextPart = { type: "text", text: asNote ? imageNoteLead(place) : imageLead(place), context: [] };
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
      // A note is called after the picture, not after its file: the name without its ending.
      const stem = name.replace(/\.[^.]+$/, "") || name;
      const outcome = await this.runMessage(asNote ? t("ai.image.noteAsk") : t("ai.image.ask"), vault, choice, {
        door: { title: asNote ? t("ai.image.noteTitle", { name: stem }) : t("ai.image.title", { name }), pins: [], lead: [lead, picture], disclose, ...(listed === false ? { blind: true } : {}) },
        since,
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
    const refused = (reason: Extract<CaptureOutcome, { kind: "refused" }>["reason"]): CaptureOutcome => ({ kind: "refused", reason });
    const vault = this.vault;
    const record = this.state.active;
    if (!this.state.settings.enabled || !vault) return refused("off");
    if (!vault.capture) return refused("unavailable");
    // One at a time, and not while a run is on: a run that ends answers every open question with no.
    if (this.capturing || this.state.live || this.sending) return refused("busy");
    if (!record) return refused("nothing");
    return this.captureFrom(vault, record, userTurn);
  }

  /**
   * The note of one answer of a conversation — what "Keep as a note" writes
   * for the conversation on screen, and what a routine leaves of its run
   * (plan P8). `title`: the note is called this, whatever the answer or the
   * question says. `standing`: in a shared workspace nobody is asked — that
   * others read the note was said and confirmed where the routine was set
   * up; a person's "Keep as a note" asks each time.
   */
  private async captureFrom(vault: AiVaultHost, record: ConversationRecord, userTurn: number, options: { title?: string; standing?: boolean } = {}): Promise<CaptureOutcome> {
    const refused = (reason: Extract<CaptureOutcome, { kind: "refused" }>["reason"], message?: string): CaptureOutcome => ({ kind: "refused", reason, ...(message ? { message } : {}) });
    const capture = vault.capture;
    if (!capture) return refused("unavailable");
    const run = record.runs.find((candidate) => candidate.userTurn === userTurn);
    if (!run || run.stop !== "answered") return refused("nothing");
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
    // The pictures the question was about (plan P7): a note made of the answer shows them.
    const pictures = (run.manifest?.sources ?? []).filter((source) => Boolean(source.image)).map((source) => ({ path: source.path }));
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
    // The entries of the memory the conversation began with (plan P6) stand behind every answer of it — and so do the
    // examples its writing style was measured from (plan P9-3).
    for (const rule of record.instructions?.memory?.restricted ?? []) inherited.add(rule);
    for (const rule of record.instructions?.style?.restricted ?? []) inherited.add(rule);
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
    let named: string | undefined = options.title;
    if (!named && bound && userTurn === Math.min(...record.runs.map((other) => other.userTurn))) {
      const app = appSkillOf(bound.id);
      const skill = app ? t(`ai.skills.${app.key}.title`) : bound.name;
      const open = (run.manifest?.sources ?? []).find((source) => source.reasons.includes("active") && !source.image && source.audioBytes === undefined);
      named = `${skill} – ${open ? open.title : captureStamp(this.host.now()).slice(0, 10)}`;
    }
    const note = captureNote(
      {
        question,
        ...(named ? { title: named } : {}),
        // A door at a picture opens with the app's own sentence, the same every time: where the answer names nothing
        // itself, such a note is called what its conversation is called — after the picture.
        ...(pictures.length && userTurn === Math.min(...record.runs.map((other) => other.userTurn)) ? { fallback: record.title } : {}),
        ...(pictures.length ? { pictures } : {}),
        answer: text,
        model: run.model,
        now: this.host.now(),
        pages: (run.web?.pages ?? []).filter((page) => page.read).map((page) => ({ url: page.url, title: page.title, at: page.at })),
        searches: (run.web?.searches ?? []).map((search) => ({ query: search.query, at: search.at })),
        searchProvider: provider?.label ?? run.providerId,
        notes: [...notes].map(([path, noteTitle]) => ({ path, title: noteTitle })),
        noteType: await noteTypeOf(vault),
      },
      t,
    );

    this.capturing = true;
    try {
      const folder = await capture.folder();
      if (vault.encrypted?.() && !options.standing) {
        // Members of the workspace read what lands in it: that is asked, here and each time.
        const asked = new AbortController();
        const answerTo = await this.askEffect({ id: `capture-${this.host.newId()}`, kind: "write", audience: "members", title: note.title, folder }, asked.signal);
        // A yes counts for the conversation it was given in, in the vault it was given for.
        if (answerTo === "deny" || this.vault !== vault || this.state.active?.id !== record.id) return refused("cancelled");
      }
      // Written into the note only where the place it lands in would allow more than its sources do.
      const place = await vault.policy.policyOf(capturedNotePath(folder, note.stem), "").catch(() => null);
      const rules = AI_POLICY_DIMENSIONS.filter((dimension) => inherited.has(dimension) && place?.policy[dimension] !== "deny");
      // A new host of the vault since this began (strand 6, step 10) stops it: nothing is laid into the vault through the
      // host that was — a routine's note no more than one the user keeps. The answer stays in its conversation.
      if (this.vault !== vault) return refused("cancelled");
      const path = await capture.write(folder, note.stem, withInheritedRules(note.content, rules));
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
    const since = this.clearsOf(vault);
    const choice = this.choice();
    const provider = choice ? providerById(choice.providerId, this.state.settings.custom) : undefined;
    if (!choice || !provider) return refused("no-model");
    // Fully local (plan P7): said before the note is read.
    const rests = this.notThisDevice(provider);
    if (rests) return refused("failed", { message: rests.text });
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
        return cloud ? (await withholdDeniedLinks(places, request.path, vault.policy, async (path) => gateDecision(await vault.policy.policyOf(path), run).allowed)).text : places;
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
        since,
      });
      if (!outcome) return refused("cancelled");
      conversationId = outcome.record?.id;
      const withId = conversationId ? { conversationId } : {};
      if (outcome.stop.kind !== "answered") return refused(outcome.stop.kind === "cancelled" ? "cancelled" : "failed", withId);
      // What the user's own text already links to stays a link; what the model brought does not become one.
      const reply = defuseNewAddresses((outcome.answer ?? "").trim(), [note?.text ?? "", request.quote ?? "", request.question, ...request.thread.map((remark) => remark.body)]).text;
      if (!reply) return refused("no-answer", withId);
      // A new host of the vault since the question went (strand 6, step 10) stops the reply: nothing is posted through
      // the host that was. The answer stays in its conversation, which the history lists.
      if (this.vault !== vault) return refused("cancelled", withId);
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
          egress: this.out,
          endpoint: provider.endpoint,
          model: choice.model,
          executor: { execute: async () => ({ content: "No tools.", isError: true }) },
          context: { privateContext: true, untrustedContext: true },
          limits: { maxSteps: 1, maxToolCalls: 0, maxOutputTokens: 1_000 },
          ...this.modelLimits(provider, choice.model),
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
    const withWeb = this.state.draftWeb && this.state.web.enabled && !this.state.settings.localOnly;
    const entries = record ? [] : (await this.instructionEntries(vault)).entries;
    // The memory a new conversation would begin with (plan P6): the same reading its first message makes.
    const fresh = record ? null : await this.memoryStart(vault, recipient, withWeb);
    // Put together the way a send does it: the memory's lookup among the tools, the vault's scripts among the further ones.
    const served = record ? [] : this.offeredTools(vault, provider, recipient, withWeb);
    const fromServers = record ? [] : readyServerSkills(await this.serverSkills(vault));
    const start = record ? null : this.conversationStart(entries, fresh?.lookup && served.length ? [...served, MEMORY_SEARCH_TOOL] : served, undefined, await this.furtherTools(vault, provider, recipient, true, entries), fromServers);
    const tools = record ? record.conversation.tools : (start?.tools ?? []);
    const lookup = tools.includes(MEMORY_SEARCH_TOOL);
    const memory = record ? manifestMemoryOf(record.instructions) : fresh ? { entries: fresh.record.entries, withheld: fresh.record.withheld, tokens: fresh.record.tokens, lookup } : undefined;
    // And the writing style, where the user chose it for the next conversation (plan P9-3): measured as its first message would.
    const freshStyle = record || !this.state.draftStyle ? null : await this.styleStart(vault, recipient, withWeb);
    const style = record ? manifestStyleOf(record.instructions?.style) : manifestStyleOf(freshStyle?.record);
    // What the request carries before this message's notes (plan P7): the conversation as it stands, or the one a first message would start.
    const carried = this.carriedTokens(
      provider,
      choice.model,
      record
        ? record.conversation
        : startConversation(
            "preview",
            assistantSystemPrompt({
              language: this.host.language(),
              today: this.host.today(),
              tools: start?.tools ?? [],
              more: start?.more ?? [],
              ...(start?.prompt ?? {}),
              ...(fresh && (fresh.text || lookup) ? { memory: { text: fresh.text, lookup } } : {}),
              ...(freshStyle?.lines.length ? { style: { lines: freshStyle.lines } } : {}),
            }),
            start?.tools ?? [],
            start?.more ?? [],
          ),
    );
    const context = await this.contextOf(question, vault, choice, provider, record ? record.pins : this.state.draftPins, record ? record.conversation.turns : [], {
      tools,
      runs: record ? record.runs : [],
      more: record ? (record.conversation.more ?? []) : (start?.more ?? []),
      instructions: manifestInstructionsOf(record ? record.instructions : (start?.instructions ?? undefined)),
      ...(memory ? { memory } : {}),
      ...(style ? { style } : {}),
      ...(carried !== undefined ? { carried } : {}),
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
    // `carried`: the tokens the request takes before this message's notes, where a window is known (plan P7).
    // `bare`: the request brings its own material (a folder's log, plan P8-2) — no situation and no candidates.
    // `pinsOnly`: the notes pinned to it and nothing a search would find besides them (a replay, plan P9-2).
    conversation: {
      tools: readonly string[];
      /** The runs so far: which versions of each note the model saw (plan P9-6). */
      runs?: readonly RunMeta[];
      more?: readonly string[];
      instructions?: ManifestInstructions;
      memory?: ManifestMemory;
      style?: ManifestStyle;
      withoutActive?: boolean;
      web?: boolean;
      carried?: number;
      bare?: boolean;
      pinsOnly?: boolean;
    },
  ) {
    const recipient: EgressRecipient = recipientOf(provider, choice.model);
    // The system's own model takes no tools, and a small window a smaller package (plan P2c).
    const platform = provider.endpoint.api === "platform";
    // Nor does a model on this device whose user said it takes none (plan P7).
    const toolless = this.toolless(provider, choice.model);
    // A conversation that carries the internet's tools (plan P4): notes whose rules say `web: deny` stay out of it.
    const web = !toolless && conversation.web === true;
    // What the request carries anyway counts against a small window before the notes do (plan P7).
    const budget = contextBudgetFor(this.windowOf(provider, choice.model), platform ? undefined : conversation.carried);
    // The tools the conversation carries — what the model may call, as the overview lists them.
    const tools = toolless ? [] : conversation.tools;
    const situation = conversation.bare ? this.bareSituation() : await vault.situation().catch(() => this.bareSituation());
    const seen = this.state.excludeActive || conversation.withoutActive ? { ...situation, active: null } : situation;
    const candidates =
      conversation.bare || conversation.pinsOnly ? [] : await vault.candidates(message, seen.active?.kind === "note" ? seen.active.path : null, recipient).catch(() => [] as Candidate[][]);
    const gists = vault.gists?.() ?? null;
    const build = async (leaveOut: ReadonlySet<string>, redact: ReadonlySet<string>): Promise<{ pack: ContextPackage; manifest: EgressManifest }> => {
      const pack = await buildContextPackage(
        {
          question: message,
          recipient,
          situation: seen,
          candidates,
          pins: pins.filter((p) => !leaveOut.has(p)),
          // A platform model's request carries only the latest notes (plan P2c): nothing counts as sent before. Any
          // other's: what the turns carry of a note at the version of every view of it since (plan P9-6).
          ...(platform ? {} : { alreadySent: sentStamps(turns, conversation.runs ?? []) }),
          leaveOut,
          originals: new Set(this.state.originalsNext),
          redact,
          ...(budget ? { budget } : {}),
          ...(web ? { webTools: true } : {}),
        },
        {
          policyOf: vault.policy.policyOf,
          resolveLink: vault.policy.resolveLink,
          // Which notes a link could mean: asked by the gate before a note's text goes into the package.
          ...(vault.policy.linkCandidates ? { linkCandidates: vault.policy.linkCandidates } : {}),
          readNote: (path) => vault.readNote(path),
          ...(vault.noteSizes ? { noteSizes: (paths: readonly string[]) => vault.noteSizes!(paths) } : {}),
          ...(gists ? { gists } : {}),
        },
      );
      const manifest = manifestOf(pack, { id: provider.id, label: provider.label, local: !isCloudRecipient(recipient) }, choice.model, {
        tools,
        // What the tool search reaches is said with the tools: it is in the conversation's reach, though each kind asks first.
        ...(!toolless && conversation.more?.length ? { more: conversation.more } : {}),
        questionChars: message.length,
        // Shown as allowed only while the vault's switch is on: switched off since, the tools answer that it is off.
        ...(web && this.state.web.enabled ? { web: true, webHosts: this.state.web.allow } : {}),
        ...(conversation.instructions ? { instructions: conversation.instructions } : {}),
        // A model without tools gets the memory too; what the overview says of the lookup follows the tools it has.
        ...(conversation.memory ? { memory: toolless ? { ...conversation.memory, lookup: false } : conversation.memory } : {}),
        ...(conversation.style ? { style: conversation.style } : {}),
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
    const vault = this.vault;
    if (vault) await this.storeChoice(vault, record);
  }

  /**
   * Stores a choice of the user's — a title, pins, what goes redacted, a
   * model — with its conversation (strand 6, step 8). While a run of it is on
   * its way, onto the conversation as it was stored before the run: the run's
   * unfinished turns are the run's to write, when it ends, and it takes the
   * choice along then — also for a conversation it began, which is stored
   * only then. Whether the conversation was deleted is asked when the write
   * comes.
   */
  private storeChoice(vault: AiVaultHost, record: ConversationRecord): Promise<void> {
    const run = this.running.get(record.id);
    if (!run) return this.write(vault, record);
    run.choices = choicesOf(record);
    if (!run.stored) return Promise.resolve();
    run.stored = withChoicesOf(run.stored, record);
    return this.write(vault, run.stored);
  }

  /**
   * Writes a conversation after every write of it made before — unless its
   * deletion is done by the time the write comes: one whose deletion failed
   * is written as before.
   */
  private write(vault: AiVaultHost, record: ConversationRecord): Promise<void> {
    return this.queued(vault, record.id, async () => {
      if (!this.deleted.has(record.id)) await vault.conversations.save(record);
    });
  }

  /** One write or deletion of a conversation, after every one of it before and after a "Delete all" on its way. */
  private queued(vault: AiVaultHost, id: string, write: () => Promise<void>): Promise<void> {
    this.changes.set(id, (this.changes.get(id) ?? 0) + 1);
    const done = Promise.all([this.writing.get(id)?.done, this.clearings.get(vaultOf(vault))]).then(write);
    const settled = done.then(
      () => undefined,
      () => undefined,
    );
    this.writing.set(id, { vault, done: settled });
    void settled.then(() => {
      if (this.writing.get(id)?.done === settled) this.writing.delete(id);
    });
    return done;
  }

  /**
   * A run's conversation as the user has it now (strand 6, step 8): the run
   * brings its turns, its usage and its record; the title, the pins, what goes
   * redacted and the model of the next message are the user's — also where
   * they were chosen while the run was on its way: the latest choice the
   * run carries. Every choice goes through `storeChoice` the moment it is
   * made, on screen or from the history, so the run carries the latest; one
   * that carries none has them as the user left them when it started.
   */
  private withUserChoices(record: ConversationRecord, run: { choices: ConversationChoices | null } | undefined): ConversationRecord {
    return run?.choices ? withChoicesOf(record, run.choices) : record;
  }

  /**
   * What the user chose on screen while a message was put together and its
   * send overview was open (strand 6, step 8): the message goes as the
   * overview showed it; the conversation goes on with the title, the pins and
   * the model as they are on screen now — the composer's, for a conversation
   * the message begins — and with what goes redacted as the screen has it,
   * with what the overview took in or out on top (`redactFrom`: as the
   * overview began). `begun`: a message of the composer that begins its
   * conversation — the drafts are its choices.
   */
  private withScreenChoices(record: ConversationRecord, redactFrom: readonly string[] | undefined, begun: boolean): ConversationRecord {
    const shown = this.state.active?.id === record.id ? this.state.active : null;
    const { draftPins, draftRedact } = this.state;
    // The model as the next new conversation would take it: under "Fully local", only one on this device (plan P7).
    const draft = this.draftChoice();
    const screen: ConversationChoices | null =
      shown ??
      (begun
        ? {
            title: record.title,
            pins: draftPins,
            providerId: draft?.providerId ?? record.providerId,
            model: draft?.model ?? record.model,
            ...(draftRedact.length ? { redact: draftRedact } : {}),
          }
        : null);
    if (!screen) return record;
    const next = withChoicesOf(record, screen);
    if (!redactFrom) return next;
    const before = new Set(redactFrom);
    const sent = new Set(record.redact ?? []);
    const added = [...sent].filter((path) => !before.has(path));
    const removed = new Set([...before].filter((path) => !sent.has(path)));
    if (!added.length && !removed.size) return next;
    return { ...next, redact: [...new Set([...(next.redact ?? []), ...added])].filter((path) => !removed.has(path)) };
  }

  // -------------------------------------------------------------------- run

  /** The provider and model the next message goes to. */
  choice(): ModelChoice | null {
    const active = this.state.active;
    return active ? { providerId: active.providerId, model: active.model } : (this.draftChoice() ?? initialModelChoice(this.state.settings));
  }

  /** Switches the model of the open conversation, or of the next new one. */
  async setChoice(choice: ModelChoice): Promise<void> {
    const active = this.state.active;
    if (active) await this.saveActive({ ...active, providerId: choice.providerId, model: choice.model });
    else this.set({ draftChoice: choice });
  }

  stop(): void {
    this.abort?.abort();
    this.promptAbort?.abort();
    this.answerConsent(false);
    this.settleEffect("deny");
    this.settleQuestion({ action: "cancel" });
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
    this.composerConsent = false;
    if (this.state.consent) this.set({ consent: null });
    settle?.(answer);
  }

  private askConsent(manifest: EgressManifest, growth: ScopeGrowth[], pictures: { images: readonly ImagePart[]; blind?: boolean } | null = null, composer = false): Promise<ConsentAnswer> {
    this.settleConsent("cancel");
    return new Promise((resolve) => {
      this.consentAnswer = resolve;
      this.composerConsent = composer;
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
    // A conversation whose deletion was asked for takes no more messages (step 8).
    if (this.state.active && this.gone(this.state.active.id)) return null;
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
    // `since`: how many Delete alls of the vault were asked for when the action that sends this began (step 8).
    options: { skills?: { entries: readonly InstructionEntry[]; bind?: string }; door?: DoorStart; detached?: DetachedStart; routine?: RoutineStart; replay?: ReplayStart; since?: number } = {},
  ): Promise<RunOutcome | null> {
    const { skills, door, detached, routine, replay } = options;
    // Started apart from the composer: a conversation of its own, with none of the composer's drafts.
    const apart = door ?? detached ?? routine ?? replay ?? null;
    // A message of the composer goes nowhere once the user left what it is put together for, and a message of any kind
    // once a "Delete all" of its vault was asked for (step 8).
    // A run asked again goes nowhere once its original's deletion was asked for.
    const screen = this.screens;
    const since = options.since ?? this.clearsOf(vault);
    const left = () => (!apart && this.screens !== screen) || this.clearsOf(vault) !== since || Boolean(replay && this.gone(replay.of.conversationId));
    const provider = providerById(choice.providerId, this.state.settings.custom);
    if (!provider) {
      const stop: RunStop = { kind: "failed", failure: { kind: "unknown_endpoint", message: choice.providerId } };
      // A routine runs beside the conversation on screen and puts no notice into it: its own row says how it ended.
      if (!routine) this.set({ notice: { conversationId: this.state.active?.id ?? "", stop } });
      return { stop };
    }
    // Fully local (plan P7, ADR 0030): a model that is not on this device is not asked — said before anything is
    // built, asked or sent. The egress would refuse the request as well; this is the same answer, earlier.
    if (this.state.settings.localOnly && !runsOnDevice(provider)) {
      const stop: RunStop = { kind: "failed", failure: { kind: "local_only" } };
      if (!routine) this.set({ notice: { conversationId: this.state.active?.id ?? "", stop } });
      return { stop };
    }
    const recipient: EgressRecipient = recipientOf(provider, choice.model);
    // A conversation that ran on this device stays here (ADR 0018): before anything is built, asked or sent.
    if (this.state.active && !apart && this.keptOnDevice(this.state.active, recipient)) {
      const stop: RunStop = { kind: "failed", failure: { kind: "kept_on_device" } };
      this.set({ notice: { conversationId: this.state.active.id, stop } });
      return { stop };
    }
    // Redacted for the whole conversation (P2b-6): in its context, and in what the model reads itself through the tools.
    // One set for both: a choice in the overview below reaches the tools of this run too.
    // A door starts a conversation of its own: what the composer's next message was given is not its to use.
    const redact = new Set<string>(apart ? [] : this.state.active ? (this.state.active.redact ?? []) : this.state.draftRedact);
    const redactFrom = [...redact];
    // The system's own model takes no tools (plan P2c), nor does one on this device whose user said so (plan P7).
    const toolless = this.toolless(provider, choice.model);
    // What a request to this model is told about it: a stated window holds for the page it reads as well.
    const told = this.modelLimits(provider, choice.model);
    const now = this.host.now().toISOString();

    let record: ConversationRecord;
    // A message of the composer that begins its conversation (step 8): the drafts on screen are its choices.
    let begun = false;
    // A conversation this run creates: in no storage until the run ends.
    let created = false;
    if (this.state.active && !apart) {
      record = this.state.active;
    } else {
      created = true;
      begun = !apart;
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
      // Fully local (plan P7): the internet rests, whoever chose it. A replay takes the original's choice, where the vault allows it now (plan P9-2).
      const withWeb =
        this.state.web.enabled && !this.state.settings.localOnly && (replay ? replay.web : !apart && (skills?.bind ? skillWeb : this.state.draftWeb));
      // The vault's memory (plan P6, ADR 0032): what this recipient may have of it goes into the system prompt of a
      // conversation the user began — never of a door, which answers one question where it was asked, nor of a
      // regression run, which measures a skill and not what the user happens to have kept. A routine reads it like a
      // conversation its user begins (plan P8): what it is told about them holds at seven in the morning too. It has
      // no tool that writes it.
      const memory = door || detached || routine?.log ? null : await this.memoryStart(vault, recipient, withWeb);
      // A door answers where it was asked: it reads the vault, it does not move the app — and it looks for no further
      // tool. A routine carries the tools that read, and nothing else (ADR 0033): no call of it is an effect.
      const all = this.offeredTools(vault, provider, recipient, withWeb);
      // A folder's log carries no tool at all (plan P8-2): what it is shown, the app found for it.
      const served = routine ? (routine.log ? [] : routineTools(all)) : all.filter((name) => !door || name !== "run_command");
      // The tool that looks into the long-term memory is carried where there is something in it for this recipient — and tools at all.
      const offered = memory?.lookup && served.length ? [...served, MEMORY_SEARCH_TOOL] : served;
      const reachable = door || routine?.log ? [] : await this.furtherTools(vault, provider, recipient, !detached && !routine && !skills?.bind, entries);
      const further = routine ? routineTools(reachable) : reachable;
      // A server's skills (plan P9-4b) only where its tools could be: a conversation the user began, not bound to a skill — never a door, a routine or a regression run.
      const fromServers = !door && !detached && !routine && !skills?.bind ? readyServerSkills(await this.serverSkills(vault)) : [];
      // A door runs without skills (plan P3-6): the vault's standing instructions still apply, the catalog does not.
      const start = this.conversationStart(door || routine?.log ? entries.filter((e) => e.source.kind === "agents") : entries, offered, skills?.bind, further, fromServers);
      // A skill the conversation is bound to may leave the tool out: what the prompt says of it follows the list.
      const lookup = start.tools.includes(MEMORY_SEARCH_TOOL);
      const memoryPrompt = memory && (memory.text || lookup) ? { memory: { text: memory.text, lookup } } : {};
      // The user's writing style (plan P9-3, ADR 0035): only in a conversation the user began after choosing "My style"
      // — never in a door, a regression run or a routine; a replay takes the original's choice. What this reader may
      // have of it, measured now. Recorded also where a rule kept every example back: the overview says why none went.
      const style = (replay ? replay.style : !apart && this.state.draftStyle) ? await this.styleStart(vault, recipient, withWeb) : null;
      const stylePrompt = style?.lines.length ? { style: { lines: style.lines } } : {};
      const withMemory: ConversationInstructions | null = memory ? { ...(start.instructions ?? {}), memory: { ...memory.record, lookup } } : start.instructions;
      const instructions: ConversationInstructions | null = style && (style.record.features > 0 || style.record.withheld > 0) ? { ...(withMemory ?? {}), style: style.record } : withMemory;
      const id = this.host.newId();
      record = {
        version: 1 as const,
        id,
        title: apart?.title ?? conversationTitleFrom(message, message),
        createdAt: now,
        updatedAt: now,
        providerId: choice.providerId,
        model: choice.model,
        conversation: startConversation(
          id,
          assistantSystemPrompt({ language: this.host.language(), today: this.host.today(), tools: start.tools, more: start.more, ...start.prompt, ...memoryPrompt, ...stylePrompt }),
          start.tools,
          start.more,
        ),
        usage: EMPTY_USAGE,
        runs: [],
        pins: door ? door.pins : replay ? replay.pins : detached || routine ? [] : this.state.draftPins,
        ...(instructions ? { instructions } : {}),
        ...(replay ? { replayOf: replay.of } : {}),
        // Made by a run of the app's own (step 9): the title it gave it, by which it knows it is still its own alone.
        ...(detached ? { appTitle: detached.title } : routine ? { appTitle: routine.title } : {}),
        // Begun for a reader on this device: what it is given from the first message on was never checked for a cloud.
        ...(isCloudRecipient(recipient) ? {} : { onDevice: true as const }),
      };
    }
    // A skill narrows the run (plan KI-Harness P3): the bound one's folders from the start, a loaded one's from its load.
    const skillState = newSkillRunState();
    const bound = record.instructions?.skill;
    const toolNames = toolless ? [] : record.conversation.tools;
    // A conversation that carries the internet's tools (plan P4): its vault tools and its context leave `web: deny` notes out.
    const web = hasWebTools(toolNames);
    const webLog = web ? newRunWeb() : null;
    // The conversation's further tools (ADR 0019), as fixed as its own.
    const moreNames = toolless ? [] : (record.conversation.more ?? []);
    // A server's skill that a run of this conversation loaded keeps bounding it (plan P9-4b): its words are still in it.
    // A server registered anew under its id since is another: its tools are none of that skill's.
    const servedBefore = serversLoadedIn(record);
    if (servedBefore.length) {
      const now = new Map((await this.mcp.servers().catch(() => [] as AiMcpServer[])).map((server) => [server.id, server.target ? mcpSkillRegistrationKey(mcpSkillRegistration(server.target, server.addedAt)) : null]));
      const owners = servedBefore.map((loaded) => (loaded.registration !== null && now.get(loaded.serverId) === loaded.registration ? loaded.serverId : null));
      skillState.ceiling = serverSkillCeiling([...toolNames, ...moreNames], owners);
    }
    // What passes the tools here although a rule restricts it elsewhere (plan P4-6) — a note kept from the cloud read by a
    // model on this device, a note kept from the internet in a conversation without it: the run's record keeps the rule,
    // never the path, and a note made of its answer inherits it.
    const restricted = new Set<AiPolicyDimension>();
    // The notes this run's tools read, by path (plan P4.5): a foreign server gets a call only when everything the
    // conversation has read lies where the user allowed it. More than the record keeps is remembered as "more".
    // Of a note a tool was given whole, the version too (plan P9-2): the hash of that text, for the run's snapshot —
    // kept apart from the paths' bound, so a run that listed many notes still knows which texts it read (plan P9-6);
    // a note read at two versions keeps the last one and is marked, and one past the bound says so. And every note whose text a tool gave the
    // model, without a bound (plan P9-6): what this run's saving leaves out.
    const reads = { paths: new Set<string>(), more: false, hashes: new Map<string, string>(), changed: new Set<string>(), unhashed: false, texts: new Set<string>() };
    const scope: ToolScope = {
      ...skillScope(bound?.folders, skillState),
      passed: (path, rules, text) => {
        for (const rule of rules) restricted.add(rule);
        // An entry of the memory (plan P6) is no note that was read: its rules count, its file is no source of anything.
        if (isAiHiddenPath(path)) return;
        if (reads.paths.size < RUN_READ_CAP) reads.paths.add(path);
        else if (!reads.paths.has(path)) reads.more = true;
        if (text === undefined) return;
        const hash = noteHash(text);
        const known = reads.hashes.get(path);
        if (known !== undefined) {
          // Read again at another version: the run's snapshot shows the last one; for "unchanged" it has no one version.
          if (known !== hash) {
            reads.changed.add(path);
            reads.hashes.set(path, hash);
          }
        } else if (reads.hashes.size < RUN_READ_CAP) reads.hashes.set(path, hash);
        else reads.unhashed = true;
      },
      // A note whose text the model was given (plan P9-6): read_note, and nothing that only showed it to the gate.
      gave: (path) => {
        if (!isAiHiddenPath(path)) reads.texts.add(path);
      },
    };
    // The tools of foreign servers this run may find (plan P4.5): of the names its conversation was started with, the
    // ones that are offered NOW — a server that was switched off or blocked since brings none. A door and a
    // regression run reach none at all.
    const foreign = !apart && moreNames.some(isMcpExposedToolName) ? await this.mcp.manifests(moreNames) : [];
    const mcpLog = foreign.length ? newRunMcp() : null;
    // The vault's scripts this run may find (plan P5.5): of the names its conversation was started with, the ones
    // that are active NOW — a script changed or withdrawn since brings none. A door and a regression run reach none.
    const scriptTools = apart ? [] : await this.scriptTools(vault, moreNames);
    const scriptLog = scriptTools.length ? newRunScripts() : null;
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
            draft: async (input: { title: string; body: WriteDraftBody; defused: number; missing?: readonly string[]; withheld?: readonly string[] }) => {
              const carried = await this.carriedBy(vault, record, sending.sources, reads).catch(() => ({ paths: [] as string[], more: false }));
              const next: WriteDraft = {
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
                // What the source check found when the draft was laid down: links to notes the vault did not have,
                // and links to notes the rules kept from this run. Kept with the draft for its card; never sent.
                ...(input.missing?.length ? { missing: [...input.missing] } : {}),
                ...(input.withheld?.length ? { withheld: [...input.withheld] } : {}),
                // Written in a conversation that carried the user's writing style (plan P9-3): the card says so.
                ...(record.instructions?.style?.features ? { style: true as const } : {}),
              };
              // Laid down only while its conversation stands (step 8): one deleted meanwhile — a Delete all marks the
              // run's own as well — gets no draft whose turn in the list comes after; a call on its way is not stopped.
              return this.leaveDraft(vault, next, () => this.gone(record.id));
            },
            ask: (question: PlanQuestion, callId?: string) => this.askPlan(question, callId),
            writes: writesLog,
            today: () => this.host.today(),
            clock: () => clockOf(this.host.now()),
          }
        : undefined;
    const base = toolNames.length ? vault.tools(recipient, scope, redact, web, () => skillRunTools(skillState), () => foreign, writing, () => scriptTools) : null;
    // Mail and the descriptions of appointments (plan P4-4): a kind of data no overview named asks first, and raw text goes to a reader without tools.
    const reading = newRunReading();
    const guarded = base
      ? createPrivateDataExecutor(
          base.executor,
          {
            egress: this.out,
            reader: () => this.quarantineReader(provider, choice),
            // A regression run has nobody to ask: what this session has not allowed yet does not happen in it. A
            // routine has nobody to ask either, and what its user allowed in a conversation of this session is not
            // the routine's (ADR 0033): mail is read for a model on this device, where nothing leaves, and for no other.
            approve: (dataClass, tool, call, signal) =>
              routine ? Promise.resolve(!isCloudRecipient(recipient)) : this.approveData(dataClass, tool, call, { provider, choice, recipient, signal, ...(detached ? { silent: true } : {}) }),
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
              egress: this.out,
              endpoint: provider.endpoint,
              model: choice.model,
              providerLabel: provider.label,
              ...(told.window ? { window: told.window } : {}),
              // Asked at every call: switched off since, or the device fully local since (plan P7), the next call does not go out.
              enabled: () => this.vault === vault && this.state.web.enabled && !this.state.settings.localOnly,
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
              // What no path names (plan P6): an entry of the memory that is kept from every cloud, given to a model
              // on this device. A foreign server is a cloud recipient; such a conversation calls none.
              // The same for an example of the writing style (plan P9-3): its features went to this model and to no cloud.
              keptByRule: () =>
                restricted.has("cloud") ||
                startedWith.runs.some((earlier) => earlier.restricted?.includes("cloud")) ||
                Boolean(startedWith.instructions?.memory?.restricted.includes("cloud")) ||
                Boolean(startedWith.instructions?.style?.restricted.includes("cloud")),
              ask: (question, signal) => this.askMcp(question, signal),
              call: (serverId, tool, args, inputSchema, signal, questions) => this.mcp.call(serverId, tool, args, inputSchema, signal, questions),
              questions: (source) => this.mcpToolQuestions(source),
              log: (entry) => this.mcp.log({ ...entry, at: this.host.now().toISOString(), conversation: startedWith.id }),
            },
            mcpLog,
          )
        : inner;
    // A script sits under the skills' wrapper too. What it calls goes to the conversation's own executor below the
    // internet and the foreign servers — neither is a script's to reach —, behind the same gate and into the same
    // record of what was read as a call the model made itself.
    const sandbox = this.scripts.sandbox;
    const scripted = outer && guarded && scriptLog && sandbox ? createScriptExecutor(outer, guarded, { script: (id) => this.activeScript(vault, id), sandbox }, scriptLog) : outer;
    const tools = scripted ? { names: toolNames, executor: createSkillExecutor(scripted, this.skillRuntime(vault, record), toolNames, skillState, moreNames) } : null;
    // A skill's own budget narrows whatever limits the start brings; it never widens them.
    const own = bound?.maxOutputTokens;
    // A regression run and a routine bring their own, smaller bounds.
    const fixed = detached?.limits ?? routine?.limits;
    const limits: RunLimits | undefined =
      door?.limits ??
      (fixed
        ? { ...fixed, maxOutputTokens: Math.min(fixed.maxOutputTokens, own ?? fixed.maxOutputTokens) }
        : own
          ? { ...DEFAULT_RUN_LIMITS, maxOutputTokens: own }
          : undefined);

    // The context of this message: what "View context" showed, without the notes left out there.
    const carriedMemory = manifestMemoryOf(record.instructions);
    const carriedStyle = manifestStyleOf(record.instructions?.style);
    // What the request carries before this message's notes (plan P7): a small window's package is made smaller by it.
    const carried = this.carriedTokens(provider, choice.model, record.conversation);
    const context = await this.contextOf(message, vault, choice, provider, record.pins, record.conversation.turns, {
      tools: toolNames,
      runs: record.runs,
      more: moreNames,
      instructions: manifestInstructionsOf(record.instructions),
      ...(carriedMemory ? { memory: carriedMemory } : {}),
      ...(carriedStyle ? { style: carriedStyle } : {}),
      ...(carried !== undefined ? { carried } : {}),
      // A regression run measures the skill, not whatever note happens to be open — and a routine runs whatever is open.
      // A replay asks what the original asked, with its sources: the note open now is none of them (plan P9-2).
      ...(detached || routine || replay ? { withoutActive: true } : {}),
      // A folder's log brings its own material: nothing of where the user is, and no note a question would find.
      ...(routine?.log ? { bare: true } : {}),
      // A replay's sources are the original's, pinned: nothing a search would find besides them.
      ...(replay ? { pinsOnly: true } : {}),
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
      const brought = door ?? routine?.log;
      return brought ? { pack: built.pack, manifest: brought.disclose(built.manifest) } : built;
    };
    const leaveOut = new Set<string>(apart ? [] : this.state.leaveOutNext);
    let { pack, manifest } = await build(leaveOut, redact);
    // A picture the door brings is shown in the overview as it would go (plan P4-5).
    const pictures = door ? { images: imagesOf(door.lead), ...(door.blind ? { blind: true } : {}) } : null;
    if (routine) {
      // What a run would send, for the routine's confirmation: put together exactly as a run does it, and not sent.
      if (routine.preview) return { stop: { kind: "cancelled" }, manifest, ...(limits ? { limits } : {}) };
      // Nobody is there to answer an overview (plan P8, ADR 0033). Within what was confirmed for this routine the
      // request goes; where it would bring along more — or where this device asks before every request — nothing is
      // sent, and the run ends with what it needs. A model on this device is sent nothing that leaves.
      if (!manifest.local) {
        if (this.state.settings.confirmEveryRequest) return { stop: { kind: "cancelled" }, need: "confirm" };
        if (scopeGrowth(manifest, routine.scope).length > 0) return { stop: { kind: "cancelled" }, need: "scope" };
      }
    } else {
      // The send overview as the scope approval (E25): on the first request, when the scope grows, or always for the
      // strict. Once the user reviews the overview, it stays until they send or cancel: leaving a note out never
      // sends on its own.
      let reviewing = false;
      for (;;) {
        const growth = scopeGrowth(manifest, this.scope);
        if (!reviewing && growth.length === 0 && !(this.state.settings.confirmEveryRequest && !manifest.local)) break;
        // No overview — first or again — for a message whose vault went, or whose screen the user left, meanwhile.
        if (this.vault !== vault || left()) return null;
        // A message of the composer: leaving its conversation while the overview is open is a no (step 8).
        const answer = await this.askConsent(manifest, growth, pictures, !apart);
        if (this.vault !== vault || answer === "cancel") return null;
        if (answer === "send") break;
        reviewing = true;
        if ("leaveOut" in answer) leaveOut.add(answer.leaveOut);
        else if (redact.has(answer.redact)) redact.delete(answer.redact);
        else redact.add(answer.redact);
        ({ pack, manifest } = await build(leaveOut, redact));
      }
    }
    if (redact.size || record.redact) record = { ...record, redact: [...redact] };
    // Nor is it sent: a message whose vault went, or whose screen the user left while it was put together, goes nowhere.
    if (this.vault !== vault || left()) return null;
    // What the user approved for their conversations grows with what they send — never with what a routine sends:
    // that was confirmed for the routine, and a conversation gains nothing from it.
    if (!manifest.local && !routine) this.scope = widenScope(this.scope, manifest);
    // What this message carries counts as read from here on: a call to a foreign server in this very run looks at it too.
    sending.sources = manifest.sources.map((source) => ({ path: source.path, ...(source.image ? { image: true } : {}) }));
    return this.execute({
      vault,
      choice,
      provider,
      record,
      pack,
      manifest,
      parts: [pack.part, ...(door?.lead ?? (routine?.log ? [routine.log.lead] : [])), { type: "text" as const, text: message }],
      executor: tools?.executor ?? null,
      // Rule of Two (§13.4): vault text is private and untrusted at once.
      carriesVault: Boolean(door) || Boolean(routine?.log) || pack.refs.length > 0 || pack.dataClasses.length > 1 || Boolean(seen.active),
      // A message typed in the composer used the drafts; a door or a regression run leaves them for the next one.
      usedDrafts: !apart,
      begun,
      created,
      redactFrom,
      // A routine runs beside the conversation on screen and takes nothing over (plan P8).
      ...(routine ? { background: true } : {}),
      skillState,
      ...(limits ? { limits } : {}),
      ...(webLog ? { web: webLog } : {}),
      ...(guarded ? { reading } : {}),
      ...(base ? { restricted, reads } : {}),
      ...(mcpLog ? { foreign, mcp: mcpLog } : {}),
      ...(scriptLog ? { scripts: scriptTools, scriptLog } : {}),
      ...(writing ? { writes: writesLog } : {}),
      ...(related.length ? { related } : {}),
    });
  }

  /**
   * Whether a conversation must not go to `recipient` (ADR 0018, decision 13). A conversation is append-only: each
   * request takes all of it along. What a model on this device is given is put together for a reader that may see
   * everything — a note kept from the cloud is read like any other, a link to one keeps its name, nothing is
   * hinted at or redacted for a provider. None of that can be taken back out of a conversation afterwards, and
   * checking it again for a cloud would mean knowing every text it ever carried. So the rule is the simple one: a
   * conversation that was begun here, or had one run here, goes on here. One that only ever went to clouds carries
   * nothing that was not passed for one, and changes its model freely.
   */
  private keptOnDevice(record: ConversationRecord, recipient: EgressRecipient): boolean {
    if (!isCloudRecipient(recipient)) return false;
    return record.onDevice === true || record.runs.some((run) => !this.wentToCloud(run));
  }

  /** Whether a run went to a cloud. One whose provider is no longer known counts as one that ran here. */
  private wentToCloud(run: RunMeta): boolean {
    if (run.manifest) return !run.manifest.local;
    const provider = providerById(run.providerId, this.state.settings.custom);
    return provider ? isCloudRecipient(recipientOf(provider, run.model)) : false;
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
    // The entries of the memory the conversation was started with (plan P6) are part of what it rests on, and the
    // examples of its writing style (plan P9-3).
    for (const rule of record.instructions?.memory?.restricted ?? []) inherited.add(rule);
    for (const rule of record.instructions?.style?.restricted ?? []) inherited.add(rule);
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
    // The system's own model takes no tools (plan P2c), nor does one on this device whose user said so (plan P7).
    if (this.toolless(provider, recipient.model)) return [];
    const names = [...(vault.tools(recipient)?.names ?? [])];
    return web && names.length ? [...names, ...webToolNames(this.host.web ?? null, provider.endpoint)] : names;
  }

  /**
   * The further tools a new conversation with this model reaches through its tool search (ADR 0019): the vault's own,
   * and — where `services` — the tools of the foreign servers this vault uses (plan P4.5), under the names the app gives
   * them. A door, a regression run and a conversation bound to a skill get none of those: nobody chose a service for them.
   * The same goes for the vault's scripts (plan P5.5): the ones active on this device, where it can run scripts at all.
   */
  private async furtherTools(vault: AiVaultHost, provider: ProviderInfo, recipient: EgressRecipient, services: boolean, entries: readonly InstructionEntry[] = []): Promise<string[]> {
    if (this.toolless(provider, recipient.model)) return [];
    const served = vault.tools(recipient);
    const own = [...(served?.more ?? [])];
    if (!services) return own;
    // A script calls the vault's tools: without them there is nothing for it to do, and it is offered only where
    // every tool it names is one this conversation can reach itself.
    const reach = new Set<string>([...(served?.names ?? []), ...own]);
    const scripts = served && this.scripts.available() ? activeScriptTools(entries, reach).map((tool) => tool.name) : [];
    return [...own, ...(await this.mcp.offeredNames()), ...scripts];
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
    const told = this.modelLimits(here.provider, here.model);
    return {
      endpoint: here.provider.endpoint,
      model: here.model,
      label: `${here.provider.label} · ${here.model}`,
      onDevice: true,
      ...(told.contextTokens ? { contextTokens: told.contextTokens } : {}),
      // A window its user stated (plan P7): a text that cannot fit is not sent to be cut without a word.
      ...(told.window ? { window: told.window } : {}),
    };
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
    // Switched off for the vault, or the device fully local (plan P7): nothing goes out, so nobody is asked.
    if (!this.state.web.enabled || this.state.settings.localOnly) return true;
    // What a loaded skill — or a server's skill loaded earlier in the conversation — leaves out is refused, never asked.
    const bound = run.skillState ? skillRunTools(run.skillState) : null;
    if (bound && !bound.includes(tool.name)) return true;
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
    /** What went redacted as the send overview began (step 8): what it changed of that counts for the conversation too. */
    redactFrom?: readonly string[];
    /** A message of the composer that begins its conversation (step 8): the drafts are its choices. */
    begun?: boolean;
    /** The run creates its conversation (step 8): it is in no storage until the run ends. */
    created?: boolean;
    /**
     * The run takes nothing on screen over (plan P8, a routine): the open
     * conversation, the live line and the notice stay as they are. Its record
     * and the ledger are written like any run's.
     */
    background?: boolean;
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
    reads?: { paths: ReadonlySet<string>; more: boolean; hashes?: ReadonlyMap<string, string>; changed?: ReadonlySet<string>; unhashed?: boolean; texts?: ReadonlySet<string> };
    /** The tools of foreign servers this run may find, and what it asked of them (plan P4.5). */
    foreign?: readonly ToolManifest[];
    mcp?: RunMcp;
    /** The vault's scripts this run may find, and which of them it started (plan P5.5). */
    scripts?: readonly ToolManifest[];
    scriptLog?: RunScripts;
    /** What the run's writing tools lay down (plan P5), gathered while it runs; present where the run may write. */
    writes?: RunWrites;
    /** The notes that match the question best, shown when no answer comes back (plan §19.4). */
    related?: { path: string; title: string }[];
  }): Promise<{ stop: RunStop; record: ConversationRecord; answer: string }> {
    const { vault, choice, provider, pack, manifest } = input;
    const now = this.host.now().toISOString();
    let record = input.record;
    // What goes redacted as this run sends it: its context and its tools follow it, whatever is chosen meanwhile (P9-6).
    const sentRedact = record.redact;
    // What the user chose on screen while the message was put together and its overview was open (step 8).
    record = this.withScreenChoices(record, input.redactFrom, input.begun === true);
    // The conversation as it is stored before this run (step 8): a choice made while the run is on its way goes onto it —
    // none where the run creates it.
    this.running.set(record.id, { vault, stored: input.created ? null : record, choices: null });
    const userTurn = record.conversation.turns.length;
    record = { ...record, conversation: appendTurn(record.conversation, { role: "user", parts: input.parts, at: now }), updatedAt: now };

    const controller = new AbortController();
    this.abort = controller;
    const toolLog: LedgerEntry["tools"] = [];
    // A message typed in the composer used the drafts; an action at a selection leaves them for the next one.
    const drafts = input.usedDrafts ? { draftPins: [], draftRedact: [], draftChoice: null, draftWeb: false, draftStyle: false, excludeActive: false, leaveOutNext: [], originalsNext: [] } : {};
    if (!input.background) {
      // An opening that comes back after this does not take the screen from the run (step 8).
      this.started++;
      this.set({ active: record, ...drafts, notice: null, live: { conversationId: record.id, text: "", tools: [], steps: 0 } });
    }

    const carriesVault = input.carriesVault;
    const result = await runAgent({
      conversation: record.conversation,
      egress: this.out,
      endpoint: provider.endpoint,
      model: choice.model,
      executor: input.executor ?? { execute: async () => ({ content: "This conversation has no tools.", isError: true }) },
      // A server's skill the conversation may load is a stranger's words (plan P9-4b), whatever else the run carries.
      context: { privateContext: carriesVault, untrustedContext: carriesVault || Boolean(record.instructions?.catalog?.some((entry) => entry.origin === "server")) },
      signal: controller.signal,
      ...(input.limits ? { limits: input.limits } : {}),
      ...(input.foreign?.length ? { foreign: input.foreign } : {}),
      ...(input.scripts?.length ? { scripts: input.scripts } : {}),
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
              // A script is an effect only through the writing tools it names (plan P5.5): what it lays down is a
              // suggestion or a draft like theirs, and it is offered only to a conversation that has those tools.
              if (tool.script) return Promise.resolve(Boolean(input.writes));
              if (!input.web) return Promise.resolve(false);
              return this.approveWebCall(call, tool, { provider, signal: controller.signal, conversation: () => record.conversation, ...(input.skillState ? { skillState: input.skillState } : {}) });
            },
          }
        : {}),
      cache: true,
      ...this.modelLimits(provider, choice.model),
      newRequestId: () => `ai-${this.host.newId()}`,
      now: () => this.host.now().toISOString(),
      onEvent: (event) => {
        // What the run did is recorded whoever watches: a routine runs beside the conversation on screen (plan P8).
        if (event.type === "tool_done") toolLog.push({ name: event.call.name, ok: !event.outcome.isError, ms: event.ms });
        else if (event.type === "turn") record = { ...record, conversation: event.conversation };
        const live = this.state.live;
        if (!live || live.conversationId !== record.id) return;
        if (event.type === "model" && event.event.type === "text") {
          this.set({ live: { ...live, text: live.text + event.event.text } });
        } else if (event.type === "tool_start") {
          this.set({ live: { ...live, tools: [...live.tools, { id: event.call.id, name: event.call.name, state: "running" }] } });
        } else if (event.type === "tool_done") {
          const state = !event.outcome.isError ? ("done" as const) : event.outcome.content === EFFECT_DECLINED ? ("declined" as const) : ("failed" as const);
          this.set({ live: { ...live, tools: live.tools.map((t) => (t.id === event.call.id ? { ...t, state } : t)) } });
        } else if (event.type === "turn") {
          this.set({ active: this.state.active?.id === record.id ? this.withUserChoices(record, this.running.get(record.id)) : this.state.active, live: { ...live, text: "", steps: live.steps + 1 } });
        }
      },
    });
    if (this.abort === controller) this.abort = null;
    // Whatever still waits for an answer belongs to a run that is over.
    this.settleEffect("deny");
    if (this.state.question?.during.kind === "tool") this.settleQuestion({ action: "cancel" });

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
    const price = this.priceOf(choice);
    const costUsd = usageCostUsd(usage, price);
    // What choosing and shortening the notes saved (plan P9-6): estimated tokens, and at the model's price for input.
    // Only for a request a model received — it said what it took in, or it answered (a system's model says nothing of
    // tokens) —; once per version of a note in a conversation, counted from the turns a model received: had the note
    // gone whole, the next turn would not have sent it again — except to the system's own model, whose request sends
    // every turn's notes anew —; never for a note whose text a tool of the run gave the model anyway; and nothing in
    // dollars for a model on this device.
    const received =
      result.usage.inputTokens + result.usage.cacheReadTokens + result.usage.cacheWriteTokens > 0 ||
      result.conversation.turns.length > userTurn + 1 ||
      // A model that ended its answer had the request — also where it had nothing to say.
      result.stop.kind === "answered" ||
      result.stop.kind === "refusal" ||
      result.stop.kind === "max_tokens";
    const anew = provider.endpoint.api === "platform";
    const counted = anew
      ? new Set<string>()
      : new Set(
          input.record.runs
            .filter((earlier) => !earlier.unreached)
            .flatMap((earlier) => earlier.manifest?.sources ?? [])
            // A version counts as carried where some of its text went: a name repeated unchanged and a card with no
            // sentence went with none.
            .flatMap((source) => (source.hash && source.chars > 0 ? [`${source.path}#${source.hash}`] : [])),
        );
    const saved = received ? contextSavingsOf(pack.refs, (ref) => Boolean(input.reads?.texts?.has(ref.path)) || (ref.hash !== undefined && counted.has(`${ref.path}#${ref.hash}`))) : null;
    const savedUsd = !saved ? undefined : choiceOnDevice(this.state.settings, choice) ? 0 : price ? (saved.savedTokens * price.input) / 1_000_000 : undefined;
    // What the skills cost (gate "token cost of skill selection measurable"): the bound one, the loaded ones, the catalog.
    const instructions = record.instructions;
    const skillsUsed: NonNullable<RunMeta["skills"]> = [
      ...(instructions?.skill
        ? [{ id: instructions.skill.id, how: "bound" as const, tokens: instructions.skillTokens ?? 0, ...(instructions.skill.sha256 ? { sha256: instructions.skill.sha256 } : {}) }]
        : []),
      ...(input.skillState?.loads ?? []).map((load) => ({ id: load.id, how: "loaded" as const, tokens: load.tokens, ...(load.sha256 ? { sha256: load.sha256 } : {}) })),
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
      ...(received ? {} : { unreached: true as const }),
      ...(costUsd !== undefined ? { costUsd } : {}),
      manifest,
      ...(skillsUsed.length ? { skills: skillsUsed } : {}),
      ...(skillCatalogMeta ? { skillCatalog: skillCatalogMeta } : {}),
      ...(web ? { web } : {}),
      ...(reading ? { reading } : {}),
      ...(input.restricted?.size ? { restricted: AI_POLICY_DIMENSIONS.filter((dimension) => input.restricted!.has(dimension)) } : {}),
      ...(input.reads?.paths.size ? { read: [...input.reads.paths] } : {}),
      ...(input.reads?.more ? { readMore: true } : {}),
      ...(input.reads?.hashes?.size ? { readHashes: [...input.reads.hashes].map(([path, hash]) => ({ path, hash })) } : {}),
      // The conversation's choice of what goes redacted, as this run sent it: its context and its tools followed it (P9-6).
      ...(sentRedact?.length ? { redact: [...sentRedact] } : {}),
      ...(input.reads?.changed?.size ? { readChanged: [...input.reads.changed] } : {}),
      ...(input.reads?.unhashed ? { readUnhashed: true as const } : {}),
      ...(input.mcp?.calls.length ? { mcp: input.mcp } : {}),
      ...(input.writes && (input.writes.rounds.length || input.writes.drafts.length || input.writes.plans.length) ? { writes: input.writes } : {}),
      ...(input.scriptLog?.runs.length ? { scripts: input.scriptLog } : {}),
    };
    // The conversation as the user has it now, with what this run brings (step 8). Until its end is decided, a choice
    // goes onto this — with the run's turns and record in it, whatever the screen shows meanwhile.
    const entry = this.running.get(record.id) ?? { vault, stored: null, choices: null };
    record = this.withUserChoices(
      {
        ...record,
        conversation: result.conversation,
        usage: addUsage(record.usage, usage),
        updatedAt: this.host.now().toISOString(),
        runs: [...record.runs, run],
      },
      entry,
    );
    entry.stored = record;
    this.running.set(record.id, entry);
    try {
      // On screen at once — unless its deletion was asked for —: a choice made while it is written goes onto the
      // conversation with this run in it.
      if (!this.gone(record.id) && this.state.active?.id === record.id) this.set({ active: record });
      try {
        // After any deletion asked for before: where that is done by then, nothing is written, and the ledger keeps the run.
        await this.write(vault, record);
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
            // A door's answer, an action at a note, a regression run: nobody typed it, and no habit shows in it (plan P6-3).
            ...(input.usedDrafts ? {} : { aside: true as const }),
            // Numbers only: what the month saved is summed from them (plan P9-6).
            ...(saved ? { context: saved, ...(savedUsd !== undefined ? { savedUsd } : {}) } : {}),
          }),
        );
      } catch {
        // The answer stays on screen even when app data cannot be written.
      }
      // A version of a skill that came from a proposal is watched (plan P6-2): a run of the user's own that used it
      // is counted — a door's run and a regression run are no use of it.
      if (input.usedDrafts && skillsUsed.length) await this.countObserved(vault, record, skillsUsed, result.stop.kind).catch(() => undefined);
      const answer = lastAnswerText(result.conversation);
      // Deleted also while its end was written: nothing of it comes back on screen or into the history. Whether it is
      // gone is known once every deletion asked of it — and a "Delete all" on its way — is through.
      for (;;) {
        await this.writing.get(record.id)?.done;
        await this.clearings.get(vaultOf(vault));
        if (!this.deleting.has(record.id)) break;
        // One on its way where neither waits for it — a Delete all through another host of the vault —: the next turn.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      const gone = this.deleted.has(record.id);
      // Its turns and record, with what the user chose meanwhile.
      const latest = this.withUserChoices(record, entry);
      if (this.vault !== vault || gone) {
        // What this run put on screen as running goes with it.
        if (this.state.live?.conversationId === record.id) this.set({ live: null });
        // A new host the shell made meanwhile — the same vault rebuilt, say (step 10): it stopped this run, but what the
        // run wrote is its vault's. The conversation enters the history once the attaching's listing is through, as
        // the vault then stores it (`listStopped`); the screen it reaches only where the user opened it again (above).
        if (!gone) {
          void this.listing
            .catch(() => undefined)
            .then(() => this.listStopped(record.id))
            .catch(() => undefined);
        }
        return { stop: result.stop, record: latest, answer };
      }
      if (input.background) {
        // The history gains the run's conversation; what is on screen stays as it was.
        this.set({ summaries: sortSummaries([conversationSummaryOf(latest), ...this.state.summaries.filter((s) => s.id !== record.id)]) });
        return { stop: result.stop, record: latest, answer };
      }
      const shown = this.state.active?.id === record.id || !this.state.active;
      this.set({
        active: shown ? latest : this.state.active,
        live: null,
        // No answer from the model is never a dead end (plan §19.4): the notes that match the question best go with the notice.
        notice:
          result.stop.kind === "answered" ? null : { conversationId: record.id, stop: result.stop, ...(result.stop.kind === "failed" && input.related?.length ? { related: input.related } : {}) },
        summaries: sortSummaries([conversationSummaryOf(latest), ...this.state.summaries.filter((s) => s.id !== record.id)]),
      });
      return { stop: result.stop, record: latest, answer };
    } finally {
      // Its end is decided: a choice from here on goes onto the conversation as it is stored.
      if (this.running.get(record.id) === entry) this.running.delete(record.id);
    }
  }

  private priceOf(choice: ModelChoice): { input: number; output: number } | undefined {
    return this.state.settings.prices[`${choice.providerId}/${choice.model}`] ?? this.state.tests[choice.providerId]?.models?.find((m) => m.id === choice.model)?.price;
  }
}
