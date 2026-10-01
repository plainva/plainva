import type { Conversation } from "./conversation.js";
import type { EgressManifest } from "./context/manifest.js";
import { isSensitiveKind, type SensitiveKind } from "./context/sensitiveHints.js";

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
  };
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
    },
  ];
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
              // What the run's overview showed for it: the passage, the recording, the gist, the hint.
              ...(s.selection ? { selection: true } : {}),
              ...(typeof s.audioBytes === "number" && s.audioBytes >= 0 ? { audioBytes: s.audioBytes } : {}),
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
    web: m.web === true,
  };
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
