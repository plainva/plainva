import type { Conversation } from "./conversation.js";
import type { EgressManifest } from "./context/manifest.js";
import { isSensitiveKind, type SensitiveKind } from "./context/sensitiveHints.js";
import { AI_POLICY_DIMENSIONS, type AiPolicyDimension } from "./policy.js";
import { checkWebUrl } from "./web/rules.js";
import { parseMissingLinks } from "./writes/links.js";

/**
 * Conversation history and the run ledger (§16 of the plan).
 *
 * Both live in the app's data folder, per vault — never in the vault: a
 * transcript holds excerpts that were sent to a cloud provider and would
 * otherwise be synced past the privacy policy. The ledger is the technical
 * audit (tools, tokens, provider, errors) and never holds content.
 */

export interface ConversationUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * What a run did on the internet (plan KI-Harness P4): the pages it asked for
 * and the searches it made — addresses, titles, queries and numbers, never a
 * page's text. `read` is false for a page that was asked for and gave no
 * report (an error, no text, a redirect to another site).
 */
export interface RunWeb {
  pages: { url: string; title: string; at: string; read: boolean }[];
  searches: { query: string; at: string; hits: number }[];
  /** Tokens of the calls that read pages and searched; they are part of the run's usage. */
  inputTokens: number;
  outputTokens: number;
}

/**
 * What a run read through its tools of the texts other people wrote for the
 * user (plan KI-Harness P4-4) — mail, the descriptions of appointments — in
 * numbers, and who read the raw text: a model on this device, or the
 * conversation's own provider. Never a subject, a sender or a word of it.
 */
export interface RunReading {
  mailSearches: number;
  /** Messages a reader reported on. */
  messages: number;
  /** Descriptions of appointments a reader reported on. */
  descriptions: number;
  /** Where the raw text was read. */
  reader: "device" | "provider";
  /** The reader's model as the settings name it, when it read on this device. */
  readerModel?: string;
  /** Tokens of the reader's calls; part of the run's usage only when the provider read. */
  inputTokens: number;
  outputTokens: number;
}

/** What one run sent and cost — the line under its answer, and the audit's source. */
export interface RunMeta {
  /** Index of the user turn that started the run. */
  userTurn: number;
  providerId: string;
  model: string;
  /** Notes the context carried to the recipient, by path. */
  sent: string[];
  /** Notes a privacy rule kept back, by path — never their content. */
  kept: string[];
  usage: ConversationUsage;
  steps: number;
  /** How the run ended (`RunStop.kind`). */
  stop: string;
  /** The failure's kind when it failed; the provider's own words are not stored. */
  failure?: string;
  costUsd?: number;
  /** The send overview of this run: what went where, by path and section — never content. */
  manifest?: EgressManifest;
  /** Skills the run used: the one the conversation runs ("bound") and the ones the model loaded, with their tokens (plan KI-Harness P3). */
  skills?: { id: string; how: "bound" | "loaded"; tokens: number }[];
  /** The catalog the request carried: how many skills, how many tokens. */
  skillCatalog?: { count: number; tokens: number };
  /** What the run asked of the internet; absent when it asked nothing. */
  web?: RunWeb;
  /** What the run read of mail and appointments; absent when it read none. */
  reading?: RunReading;
  /**
   * Rules that notes carried which passed this run's tools although the rule
   * restricts them elsewhere (plan KI-Harness P4-6): a note kept from the
   * cloud that a model on this device read (`cloud`), a note kept from the
   * internet in a conversation without it (`web`). The rule, never a path:
   * what is made of this run's answer — a note — inherits it. Absent when
   * nothing of the kind passed.
   */
  restricted?: AiPolicyDimension[];
  /**
   * Notes the run's tools read, by path (plan KI-Harness P4.5), beside the
   * ones its context carried (`sent`). A foreign server gets a call only when
   * everything a conversation has read lies in the folders the user allowed
   * for it — so what was read has to be known later. At most `RUN_READ_CAP`
   * paths; `readMore` says that there were more, and then nothing is assumed
   * about where they lie.
   */
  read?: string[];
  readMore?: boolean;
  /** What the run asked of foreign servers; absent when it asked nothing. */
  mcp?: RunMcp;
  /** What the run laid down for the user to decide (plan KI-Harness P5); absent when it laid down nothing. */
  writes?: RunWrites;
  /** The scripts the run started; absent when it started none. */
  scripts?: RunScripts;
}

/**
 * What a run did with the vault's scripts (plan KI-Harness P5.5): which
 * script, how it ended (`done`, or why not), how many tool calls it made —
 * never what it was handed or a word of what it returned.
 */
export interface RunScripts {
  runs: { script: string; outcome: string; calls: number }[];
}

/**
 * What a run laid down (plan KI-Harness P5): the notes it put a suggestion
 * round on, the drafts it left, the plans it asked about and how each ended.
 * Paths, counts, a draft's title — never a proposed text. The line under an
 * answer is drawn from this, and a later conversation can see what an
 * earlier one already proposed.
 */
export interface RunWrites {
  /**
   * Suggestion rounds by note: how many passages, how many properties — and, where the added text links to notes
   * that were not in the vault when it was laid down, their names (the source check, plan P5-7). `withheld` are
   * links to notes that are there and that the rules kept from the run: said to the user, on this device, and
   * never part of anything a model is sent — they are names of notes the rules keep back.
   */
  rounds: { path: string; blocks: number; properties: number; missing?: string[]; withheld?: string[] }[];
  /** Drafts by id, with the kind and the title they were laid down with. */
  drafts: { id: string; kind: string; title: string }[];
  /** Plans the user was asked about: `done`, `declined` or `failed`. */
  plans: { kind: string; path: string; outcome: string }[];
}

export const RUN_WRITES_CAP = 64;

/** Paths of notes a run's tools read that its record keeps. */
export const RUN_READ_CAP = 200;

/**
 * What a run asked of foreign MCP servers (plan KI-Harness P4.5): which
 * server, which tool, how it ended — never an argument or a word of a result.
 */
export interface RunMcp {
  calls: { server: string; tool: string; outcome: string }[];
}

/** The skill a conversation runs, bound when it started (plan KI-Harness P3). */
export interface ConversationSkill {
  id: string;
  name: string;
  origin: "plainva" | "vault";
  /** SHA-256 of its main file as it was bound. */
  sha256: string;
  /** Tools and context only inside these folders. */
  folders?: string[];
  /** Output tokens of a run, at most. */
  maxOutputTokens?: number;
  /** Meant for a model on this device (a hint). */
  localPreferred?: boolean;
}

/** What a conversation's system prompt carries besides the app's own rules — fixed when it started. */
export interface ConversationInstructions {
  skill?: ConversationSkill;
  /** The catalog's entries: the name the model calls, the source's id and its origin. */
  catalog?: { key: string; id: string; origin: "plainva" | "vault" }[];
  catalogTokens?: number;
  skillTokens?: number;
  /** The vault owner's AGENTS.md went in, this many tokens. */
  vaultTokens?: number;
}

export interface ConversationRecord {
  version: 1;
  /** Equals `conversation.id`. */
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** The provider and model the next message goes to. */
  providerId: string;
  model: string;
  conversation: Conversation;
  usage: ConversationUsage;
  /** One entry per run, in order. */
  runs: RunMeta[];
  /** Notes pinned to this conversation's context, by path. */
  pins: string[];
  /**
   * Sources whose numbers and secrets this conversation sends redacted (plan
   * P2b-6): note paths, and `SITUATION_SOURCE` for tasks and appointments.
   * Kept with the conversation, so a reopened one sends what it sent before.
   */
  redact?: string[];
  /** The skill, the catalog and AGENTS.md its system prompt carries (plan KI-Harness P3). */
  instructions?: ConversationInstructions;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  providerId: string;
  model: string;
}

/** Storage of one vault's conversations; the shells back it with files in app data. */
export interface ConversationRepository {
  list(): Promise<ConversationSummary[]>;
  load(id: string): Promise<ConversationRecord | null>;
  save(record: ConversationRecord): Promise<void>;
  remove(id: string): Promise<void>;
  removeAll(): Promise<void>;
}

export const EMPTY_USAGE: ConversationUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export function addUsage(a: ConversationUsage, b: Partial<ConversationUsage>): ConversationUsage {
  return {
    inputTokens: a.inputTokens + (b.inputTokens ?? 0),
    outputTokens: a.outputTokens + (b.outputTokens ?? 0),
    cacheReadTokens: a.cacheReadTokens + (b.cacheReadTokens ?? 0),
    cacheWriteTokens: a.cacheWriteTokens + (b.cacheWriteTokens ?? 0),
  };
}

/** The first line of the first user message, shortened — the title until the user renames it. */
export function conversationTitleFrom(text: string, fallback: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return fallback;
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}

/** A stored record, checked field by field; null when it is not one. */
export function readConversationRecord(raw: unknown): ConversationRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ConversationRecord>;
  const c = r.conversation as Partial<Conversation> | undefined;
  if (r.version !== 1 || typeof r.id !== "string" || typeof r.title !== "string") return null;
  if (typeof r.createdAt !== "string" || typeof r.updatedAt !== "string") return null;
  if (typeof r.providerId !== "string" || typeof r.model !== "string") return null;
  if (!c || c.id !== r.id || typeof c.system !== "string" || !Array.isArray(c.tools) || !Array.isArray(c.turns)) return null;
  return {
    version: 1,
    id: r.id,
    title: r.title,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    providerId: r.providerId,
    model: r.model,
    conversation: c as Conversation,
    usage: readUsage(r.usage),
    runs: Array.isArray(r.runs) ? r.runs.flatMap((run) => readRun(run)) : [],
    pins: Array.isArray(r.pins) ? r.pins.filter((p): p is string => typeof p === "string") : [],
    ...(Array.isArray(r.redact) ? { redact: r.redact.filter((p): p is string => typeof p === "string") } : {}),
    ...(readInstructions(r.instructions) ? { instructions: readInstructions(r.instructions)! } : {}),
  };
}

const ORIGINS = ["plainva", "vault"] as const;
const originOf = (v: unknown): "plainva" | "vault" | null => (ORIGINS as readonly unknown[]).includes(v) ? (v as "plainva" | "vault") : null;

/** A conversation's instructions, field by field; what does not read is left out. */
function readInstructions(raw: unknown): ConversationInstructions | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: ConversationInstructions = {};
  const s = r.skill as Record<string, unknown> | undefined;
  if (s && typeof s === "object" && typeof s.id === "string" && typeof s.name === "string" && originOf(s.origin) && typeof s.sha256 === "string") {
    out.skill = {
      id: s.id,
      name: s.name,
      origin: originOf(s.origin)!,
      sha256: s.sha256,
      ...(Array.isArray(s.folders) ? { folders: s.folders.filter((f): f is string => typeof f === "string") } : {}),
      ...(count(s.maxOutputTokens) ? { maxOutputTokens: count(s.maxOutputTokens) } : {}),
      ...(s.localPreferred === true ? { localPreferred: true } : {}),
    };
  }
  if (Array.isArray(r.catalog)) {
    out.catalog = r.catalog.flatMap((e) => {
      const x = e as Record<string, unknown> | null;
      return x && typeof x.key === "string" && typeof x.id === "string" && originOf(x.origin) ? [{ key: x.key, id: x.id, origin: originOf(x.origin)! }] : [];
    });
  }
  if (count(r.catalogTokens)) out.catalogTokens = count(r.catalogTokens);
  if (count(r.skillTokens)) out.skillTokens = count(r.skillTokens);
  if (count(r.vaultTokens)) out.vaultTokens = count(r.vaultTokens);
  return Object.keys(out).length ? out : null;
}

/** Kinds of a sensitivity hint, read defensively. */
function kinds(v: unknown): SensitiveKind[] {
  return Array.isArray(v) ? v.filter(isSensitiveKind) : [];
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

function readUsage(raw: unknown): ConversationUsage {
  const u = (raw ?? {}) as Partial<ConversationUsage>;
  return { inputTokens: count(u.inputTokens), outputTokens: count(u.outputTokens), cacheReadTokens: count(u.cacheReadTokens), cacheWriteTokens: count(u.cacheWriteTokens) };
}

function readRun(raw: unknown): RunMeta[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as Partial<RunMeta>;
  if (typeof r.providerId !== "string" || typeof r.model !== "string" || typeof r.stop !== "string") return [];
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
  return [
    {
      userTurn: count(r.userTurn),
      providerId: r.providerId,
      model: r.model,
      sent: strings(r.sent),
      kept: strings(r.kept),
      usage: readUsage(r.usage),
      steps: count(r.steps),
      stop: r.stop,
      ...(typeof r.failure === "string" ? { failure: r.failure } : {}),
      ...(typeof r.costUsd === "number" && Number.isFinite(r.costUsd) && r.costUsd >= 0 ? { costUsd: r.costUsd } : {}),
      ...(readManifest(r.manifest) ? { manifest: readManifest(r.manifest)! } : {}),
      ...(Array.isArray(r.skills)
        ? {
            skills: r.skills.flatMap((x) =>
              x && typeof x === "object" && typeof x.id === "string" && (x.how === "bound" || x.how === "loaded") ? [{ id: x.id, how: x.how, tokens: count(x.tokens) }] : [],
            ),
          }
        : {}),
      ...(r.skillCatalog && typeof r.skillCatalog === "object" ? { skillCatalog: { count: count(r.skillCatalog.count), tokens: count(r.skillCatalog.tokens) } } : {}),
      ...(readRunWeb(r.web) ? { web: readRunWeb(r.web)! } : {}),
      ...(readRunReading(r.reading) ? { reading: readRunReading(r.reading)! } : {}),
      ...(readRestricted(r.restricted).length ? { restricted: readRestricted(r.restricted) } : {}),
      ...(strings(r.read).length ? { read: strings(r.read).slice(0, RUN_READ_CAP) } : {}),
      // More than the record keeps — or more than it may keep: either way not everything is known by path.
      ...(r.readMore === true || strings(r.read).length > RUN_READ_CAP ? { readMore: true } : {}),
      ...(readRunMcp(r.mcp) ? { mcp: readRunMcp(r.mcp)! } : {}),
      ...(readRunWrites(r.writes) ? { writes: readRunWrites(r.writes)! } : {}),
      ...(readRunScripts(r.scripts) ? { scripts: readRunScripts(r.scripts)! } : {}),
    },
  ];
}

/** A run's record of the scripts it started, read defensively: names, outcomes and counts, bounded. */
function readRunScripts(raw: unknown): RunScripts | null {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { runs?: unknown }).runs)) return null;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const runs = ((raw as { runs: unknown[] }).runs as unknown[])
    .flatMap((r) => (r && typeof r === "object" ? [{ script: text((r as { script?: unknown }).script, 64), outcome: text((r as { outcome?: unknown }).outcome, 16), calls: Math.floor(count((r as { calls?: unknown }).calls)) }] : []))
    .filter((r) => r.script && r.outcome)
    .slice(0, 64);
  return runs.length ? { runs } : null;
}

/** A run's record of what it laid down, read defensively: paths, counts and titles, bounded. */
function readRunWrites(raw: unknown): RunWrites | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Record<keyof RunWrites, unknown>>;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const list = (v: unknown) => (Array.isArray(v) ? (v.filter((item) => item && typeof item === "object") as Record<string, unknown>[]).slice(0, RUN_WRITES_CAP) : []);
  const rounds = list(r.rounds)
    .map((item) => {
      const missing = parseMissingLinks(item.missing);
      const withheld = parseMissingLinks(item.withheld);
      return { path: text(item.path, 1024), blocks: Math.floor(count(item.blocks)), properties: Math.floor(count(item.properties)), ...(missing.length ? { missing } : {}), ...(withheld.length ? { withheld } : {}) };
    })
    .filter((item) => item.path && item.blocks + item.properties > 0);
  const drafts = list(r.drafts)
    .map((item) => ({ id: text(item.id, 64), kind: text(item.kind, 16), title: text(item.title, 200) }))
    .filter((item) => item.id && item.kind);
  const plans = list(r.plans)
    .map((item) => ({ kind: text(item.kind, 16), path: text(item.path, 1024), outcome: text(item.outcome, 16) }))
    .filter((item) => item.kind && item.path);
  return rounds.length || drafts.length || plans.length ? { rounds, drafts, plans } : null;
}

/** A run's record of its calls to foreign servers, read defensively: names and outcomes, bounded. */
function readRunMcp(raw: unknown): RunMcp | null {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { calls?: unknown }).calls)) return null;
  const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 128) : "");
  const calls = ((raw as { calls: unknown[] }).calls as unknown[])
    .flatMap((c) => (c && typeof c === "object" ? [{ server: text((c as { server?: unknown }).server), tool: text((c as { tool?: unknown }).tool), outcome: text((c as { outcome?: unknown }).outcome) }] : []))
    .filter((c) => c.server && c.tool)
    .slice(0, 64);
  return calls.length ? { calls } : null;
}

/** The rules a run's notes carried, read defensively: only the dimensions there are, each once, in their order. */
function readRestricted(raw: unknown): AiPolicyDimension[] {
  return Array.isArray(raw) ? AI_POLICY_DIMENSIONS.filter((dimension) => raw.includes(dimension)) : [];
}

/** A run's record of what it read of mail and appointments, read defensively: numbers, and who read. */
function readRunReading(raw: unknown): RunReading | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Record<keyof RunReading, unknown>>;
  const reading: RunReading = {
    mailSearches: count(r.mailSearches),
    messages: count(r.messages),
    descriptions: count(r.descriptions),
    reader: r.reader === "device" ? "device" : "provider",
    ...(typeof r.readerModel === "string" && r.readerModel ? { readerModel: r.readerModel.slice(0, 120) } : {}),
    inputTokens: count(r.inputTokens),
    outputTokens: count(r.outputTokens),
  };
  return reading.mailSearches || reading.messages || reading.descriptions ? reading : null;
}

const WEB_RECORD_MAX = 64;

/**
 * A run's web record, read defensively. An address is kept only as the public
 * https address it is: the record is shown as links, and a stored file is not
 * a reason to open anything else.
 */
function readRunWeb(raw: unknown): RunWeb | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as { pages?: unknown; searches?: unknown; inputTokens?: unknown; outputTokens?: unknown };
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const pages: RunWeb["pages"] = [];
  for (const item of Array.isArray(w.pages) ? w.pages.slice(0, WEB_RECORD_MAX) : []) {
    const p = item as { url?: unknown; title?: unknown; at?: unknown; read?: unknown } | null;
    const checked = p && typeof p.url === "string" ? checkWebUrl(p.url) : null;
    if (checked?.ok) pages.push({ url: checked.target.url, title: text(p!.title, 200), at: text(p!.at, 40), read: p!.read === true });
  }
  const searches: RunWeb["searches"] = [];
  for (const item of Array.isArray(w.searches) ? w.searches.slice(0, WEB_RECORD_MAX) : []) {
    const s = item as { query?: unknown; at?: unknown; hits?: unknown } | null;
    if (s && typeof s.query === "string" && s.query) searches.push({ query: text(s.query, 200), at: text(s.at, 40), hits: count(s.hits) });
  }
  if (!pages.length && !searches.length) return null;
  return { pages, searches, inputTokens: count(w.inputTokens), outputTokens: count(w.outputTokens) };
}

/** A stored send overview, read defensively: anything malformed drops the overview, never the run. */
function readManifest(raw: unknown): EgressManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<EgressManifest>;
  if (typeof m.providerId !== "string" || typeof m.model !== "string" || !Array.isArray(m.sources)) return null;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
  const withheld = (m.withheld ?? {}) as Partial<EgressManifest["withheld"]>;
  return {
    providerId: m.providerId,
    providerLabel: typeof m.providerLabel === "string" ? m.providerLabel : m.providerId,
    model: m.model,
    local: m.local === true,
    sources: m.sources.flatMap((s) =>
      s && typeof s === "object" && typeof s.path === "string" && typeof s.title === "string" && (s.tier === "evidence" || s.tier === "card" || s.tier === "map")
        ? [
            {
              path: s.path,
              title: s.title,
              tier: s.tier,
              ...(typeof s.section === "string" ? { section: s.section } : {}),
              chars: count(s.chars),
              ...(s.unchanged ? { unchanged: true } : {}),
              reasons: strings(s.reasons) as EgressManifest["sources"][number]["reasons"],
              // What the run's overview showed for it: the passage, the recording, the thread, the gist, the hint.
              ...(s.selection ? { selection: true } : {}),
              ...(typeof s.audioBytes === "number" && s.audioBytes >= 0 ? { audioBytes: s.audioBytes } : {}),
              ...(typeof s.comments === "number" && s.comments >= 0 ? { comments: Math.floor(s.comments) } : {}),
              ...(s.image && typeof s.image === "object" && count(s.image.width) && count(s.image.height)
                ? { image: { width: count(s.image.width), height: count(s.image.height), bytes: count(s.image.bytes) } }
                : {}),
              ...(s.gist ? { gist: true } : {}),
              ...(kinds(s.sensitive).length ? { sensitive: kinds(s.sensitive) } : {}),
              ...(count(s.redacted) ? { redacted: count(s.redacted) } : {}),
            },
          ]
        : [],
    ),
    dataClasses: strings(m.dataClasses) as EgressManifest["dataClasses"],
    folders: strings(m.folders),
    withheld: {
      notes: count(withheld.notes),
      links: count(withheld.links),
      places: count(withheld.places),
      moodProperties: count(withheld.moodProperties),
      ...(count(withheld.sensitive) ? { sensitive: count(withheld.sensitive) } : {}),
    },
    ...(kinds(m.sensitive).length ? { sensitive: kinds(m.sensitive) } : {}),
    ...(m.situationHint && kinds(m.situationHint.sensitive).length
      ? { situationHint: { sensitive: kinds(m.situationHint.sensitive), ...(count(m.situationHint.redacted) ? { redacted: count(m.situationHint.redacted) } : {}) } }
      : {}),
    excluded: Array.isArray(m.excluded) ? m.excluded.flatMap((e) => (e && typeof e.path === "string" && (e.reason === "cloud-denied" || e.reason === "web-denied") ? [{ path: e.path, reason: e.reason }] : [])) : [],
    estimatedTokens: count(m.estimatedTokens),
    ...(typeof m.estimatedCostUsd === "number" && m.estimatedCostUsd >= 0 ? { estimatedCostUsd: m.estimatedCostUsd } : {}),
    tools: strings(m.tools),
    ...(strings(m.more).length ? { more: strings(m.more) } : {}),
    web: m.web === true,
    ...(m.web === true && strings(m.webHosts).length ? { webHosts: strings(m.webHosts) } : {}),
    ...(readManifestInstructions(m.instructions) ? { instructions: readManifestInstructions(m.instructions)! } : {}),
  };
}

function readManifestInstructions(raw: unknown): EgressManifest["instructions"] | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: NonNullable<EgressManifest["instructions"]> = {};
  const s = r.skill as Record<string, unknown> | undefined;
  if (s && typeof s.id === "string" && typeof s.name === "string" && originOf(s.origin)) {
    out.skill = { id: s.id, name: s.name, origin: originOf(s.origin)!, tokens: count(s.tokens), ...(s.localPreferred === true ? { localPreferred: true } : {}) };
  }
  const c = r.catalog as Record<string, unknown> | undefined;
  if (c && typeof c === "object") out.catalog = { count: count(c.count), vault: Array.isArray(c.vault) ? c.vault.filter((v): v is string => typeof v === "string") : [], tokens: count(c.tokens) };
  const v = r.vault as Record<string, unknown> | undefined;
  if (v && typeof v === "object") out.vault = { tokens: count(v.tokens) };
  return Object.keys(out).length ? out : null;
}

export function conversationSummaryOf(record: ConversationRecord): ConversationSummary {
  return { id: record.id, title: record.title, updatedAt: record.updatedAt, providerId: record.providerId, model: record.model };
}

/** Conversations whose last message is older than the retention; `days` 0 keeps everything. */
export function expiredConversations(summaries: readonly ConversationSummary[], days: number, now: Date): string[] {
  if (days <= 0) return [];
  const limit = now.getTime() - days * 24 * 60 * 60 * 1000;
  return summaries.filter((s) => Date.parse(s.updatedAt) < limit).map((s) => s.id);
}

/** Case-insensitive search over titles and message text (history search, §16). */
export function conversationMatches(record: ConversationRecord, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (record.title.toLowerCase().includes(q)) return true;
  return record.conversation.turns.some((turn) => turn.parts.some((p) => p.type === "text" && p.text.toLowerCase().includes(q)));
}

// ----------------------------------------------------------------- ledger

/** One run in the technical audit — pointers and numbers, no content. */
export interface LedgerEntry {
  at: string;
  conversationId: string;
  providerId: string;
  model: string;
  stop: string;
  steps: number;
  tools: { name: string; ok: boolean; ms: number }[];
  usage: ConversationUsage;
  /** US dollars, when a price is known. */
  costUsd?: number;
  /** A failure's kind — never the provider's text, which may quote content. */
  failure?: string;
  /** The skills the run used, by id (plan KI-Harness P3). */
  skills?: string[];
  /** Tokens of the instructions it carried: the skill, the ones the model loaded, the catalog. */
  skillTokens?: number;
  /** What it asked of the internet, in numbers: pages, searches, and the tokens of the calls that read and searched (part of `usage`). */
  web?: { pages: number; searches: number; inputTokens: number; outputTokens: number };
  /** What it read of mail and appointments, in numbers, and whether a model on this device read the raw text. */
  reading?: { mailSearches: number; messages: number; descriptions: number; onDevice: boolean; inputTokens: number; outputTokens: number };
  /** Pictures the message of this run brought (plan P4-5): how many — never which. */
  images?: number;
}

export const AI_LEDGER_LIMIT = 500;

/** Appends and keeps the newest `AI_LEDGER_LIMIT` entries. */
export function appendAiLedgerEntry(entries: readonly LedgerEntry[], entry: LedgerEntry): LedgerEntry[] {
  const next = [...entries, entry];
  return next.length > AI_LEDGER_LIMIT ? next.slice(next.length - AI_LEDGER_LIMIT) : next;
}

/** Token and cost totals per provider and model for one calendar month (§11.5). */
export function aiMonthlyTotals(entries: readonly LedgerEntry[], month: string): { key: string; providerId: string; model: string; usage: ConversationUsage; costUsd?: number }[] {
  const byKey = new Map<string, { key: string; providerId: string; model: string; usage: ConversationUsage; costUsd?: number }>();
  for (const e of entries) {
    if (!e.at.startsWith(month)) continue;
    const key = `${e.providerId}/${e.model}`;
    const current = byKey.get(key) ?? { key, providerId: e.providerId, model: e.model, usage: EMPTY_USAGE };
    current.usage = addUsage(current.usage, e.usage);
    if (e.costUsd !== undefined) current.costUsd = (current.costUsd ?? 0) + e.costUsd;
    byKey.set(key, current);
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Cost of a usage at a price in US dollars per million tokens; cached input counts as input. */
export function usageCostUsd(usage: ConversationUsage, price: { input: number; output: number } | undefined): number | undefined {
  if (!price) return undefined;
  const input = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  return (input * price.input + usage.outputTokens * price.output) / 1_000_000;
}
