import type { LedgerEntry } from "../history.js";
import { AI_LEDGER_LIMIT } from "../history.js";
import { isMcpExposedToolName } from "../mcp/names.js";
import type { MemoryEntry } from "../memory/memoryFile.js";
import { observedRunOf } from "../skills/approvals.js";
import type { InstructionEntry } from "../skills/catalog.js";
import { SKILL_FILE } from "../skills/skillFile.js";
import { toolByName } from "../tools.js";

/**
 * Upkeep without a model (plan KI-Harness P6-3, ADR 0029): what a device can
 * tell by itself about skills and a memory that have grown — two that say
 * almost the same, a skill nobody ran for a season, a tool that does not
 * exist, a check that fails, a way the user went by hand three times.
 *
 * Everything here is arithmetic over what the device already holds: the
 * skills and their approvals, the run ledger (numbers and names, no content),
 * the results of the regression runs, the entries of the memory. Nothing is
 * sent, nothing is written, and no hint is a finding: the measures are coarse
 * on purpose, and each one ends in a question the user answers with one step
 * of their own — or with "don't show this again".
 */

export const UPKEEP = {
  /** How alike two texts must be to be asked about, between 0 and 1 (`alike`). */
  alikeDescription: 0.6,
  alikeBody: 0.75,
  alikeEntry: 0.7,
  /** Shorter texts say too little to be compared. */
  minDescription: 24,
  minBody: 200,
  minEntry: 20,
  /** A skill that did not run for this long is asked about. */
  unusedDays: 90,
  /** An entry older than this is asked about. */
  oldEntryDays: 365,
  /** Of a skill's newest runs, this many — and this many of them failed — make a hint. */
  failingWindow: 5,
  failingRuns: 2,
  /** The same way in this many conversations, of at least this many tools and calls, within this many days. */
  repeatedTimes: 3,
  repeatedTools: 3,
  repeatedCalls: 4,
  repeatedDays: 30,
  /** Hints of one kind that are shown at once: the rest waits behind them. */
  perKind: 3,
  /** Dismissed hints a device remembers. */
  dismissedMax: 300,
} as const;

const DAY_MS = 86_400_000;

export type UpkeepHint =
  /** Two active skills whose descriptions or instructions say almost the same: the model picks one or the other. */
  | { kind: "skills-alike"; key: string; a: string; b: string }
  /** A skill of the vault's own that no run used for a season. `last`: its newest run the ledger knows, if any. */
  | { kind: "skill-unused"; key: string; id: string; last: string | null; approved: string }
  /** A skill lists tools Plainva does not have: it runs without them. */
  | { kind: "skill-unknown-tool"; key: string; id: string; tools: string[] }
  /** The newest regression run of the skill as it is, with the model chosen now, failed scenarios. */
  | { kind: "skill-test-failing"; key: string; id: string; failed: number; ran: number; model: string }
  /** Runs of the skill ended without an answer. `conversationId`: the newest of them a review could learn from; null where none can. */
  | { kind: "skill-failing"; key: string; id: string; failed: number; runs: number; conversationId: string | null }
  /** The same tools in the same order, in several conversations, without a skill. */
  | { kind: "steps-repeated"; key: string; tools: string[]; times: number; conversationId: string }
  /** Two entries of the memory that say almost the same — or the opposite in almost the same words. */
  | { kind: "entries-alike"; key: string; a: string; b: string }
  /** An entry that was added more than a year ago. */
  | { kind: "entry-old"; key: string; id: string; added: string }
  /** "Always included" holds more than fits: this many entries go along with no conversation. */
  | { kind: "active-overflow"; key: string; left: number };

export type UpkeepKind = UpkeepHint["kind"];

/** The order hints are shown in: what fails first, what only grew last. */
export const SKILL_UPKEEP_KINDS: readonly UpkeepKind[] = ["skill-failing", "skill-test-failing", "skill-unknown-tool", "skills-alike", "skill-unused", "steps-repeated"];
export const MEMORY_UPKEEP_KINDS: readonly UpkeepKind[] = ["active-overflow", "entries-alike", "entry-old"];

// --------------------------------------------------------------- alikeness

/**
 * The letters and digits of a text, of any script, in threes. Everything else
 * — case, punctuation, markup, how words are joined — is no difference:
 * "Kundenbrief" and "Brief an Kunden" share most of what they are made of.
 */
function grams(text: string): Set<string> {
  const letters = Array.from(text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim());
  const out = new Set<string>();
  if (letters.length === 0) return out;
  if (letters.length < 3) {
    out.add(letters.join(""));
    return out;
  }
  for (let index = 0; index + 3 <= letters.length; index++) out.add(letters[index]! + letters[index + 1]! + letters[index + 2]!);
  return out;
}

function shared(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let both = 0;
  for (const gram of small) if (large.has(gram)) both++;
  return both / (a.size + b.size - both);
}

/**
 * How much two texts are made of the same: 0 for nothing in common, 1 for the
 * same letters in the same order. A coarse measure that knows no language and
 * no meaning — two sentences that differ in one word, also in the word "not",
 * are close. That is why a hint asks and never concludes.
 */
export function alike(a: string, b: string): number {
  return shared(grams(a), grams(b));
}

// ------------------------------------------------------------------ skills

/** What the newest regression run of a skill found — only one that still speaks for the skill and the model as they are now. */
export interface UpkeepTestResult {
  id: string;
  /** When it ran (ISO 8601). */
  at: string;
  model: string;
  failed: number;
  /** Scenarios that ran: passed and failed. */
  ran: number;
}

export interface SkillUpkeepInput {
  entries: readonly InstructionEntry[];
  /** The run ledger, oldest first. */
  ledger: readonly LedgerEntry[];
  tests: readonly UpkeepTestResult[];
  now: Date;
  /** The conversations the history still holds: a hint never leads to one that is gone. */
  conversations: ReadonlySet<string>;
}

const mainHash = (entry: InstructionEntry): string => (entry.source.files.find((file) => file.path === SKILL_FILE)?.sha256 ?? "").slice(0, 12);
const isSkill = (entry: InstructionEntry): boolean => entry.source.kind === "skill" && entry.source.skill !== null;
/** A run somebody asked for in the composer or started as a skill — not a door's answer, not a regression run. */
const ownRun = (run: LedgerEntry): boolean => !run.aside;
/** A run that read text of strangers teaches no skill (ADR 0028, decision 6): a review of it is not offered. */
const readStrangers = (run: LedgerEntry): boolean =>
  Boolean(run.web && (run.web.pages || run.web.searches)) || Boolean(run.reading && (run.reading.mailSearches || run.reading.messages || run.reading.descriptions)) || run.tools.some((tool) => isMcpExposedToolName(tool.name));
const time = (iso: string): number => {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? 0 : at;
};

function skillsAlike(entries: readonly InstructionEntry[]): UpkeepHint[] {
  // Only skills a model chooses between: both in force. And one of them the vault's own — the app's are told apart by the app.
  const active = entries.filter((entry) => isSkill(entry) && entry.status === "active");
  const texts = active.map((entry) => {
    const skill = entry.source.skill!;
    return {
      entry,
      description: skill.description.length >= UPKEEP.minDescription ? grams(skill.description) : null,
      body: skill.body.length >= UPKEEP.minBody ? grams(skill.body) : null,
    };
  });
  const hints: UpkeepHint[] = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i]!;
      const b = texts[j]!;
      if (a.entry.source.origin !== "vault" && b.entry.source.origin !== "vault") continue;
      const sameWords = a.description && b.description ? shared(a.description, b.description) >= UPKEEP.alikeDescription : false;
      const sameSteps = a.body && b.body ? shared(a.body, b.body) >= UPKEEP.alikeBody : false;
      if (!sameWords && !sameSteps) continue;
      const [first, second] = a.entry.source.id <= b.entry.source.id ? [a.entry, b.entry] : [b.entry, a.entry];
      hints.push({ kind: "skills-alike", key: `skills-alike:${first.source.id}|${second.source.id}:${mainHash(first)}|${mainHash(second)}`, a: first.source.id, b: second.source.id });
    }
  }
  return hints;
}

function skillsUnused(input: SkillUpkeepInput): UpkeepHint[] {
  const now = input.now.getTime();
  const since = now - UPKEEP.unusedDays * DAY_MS;
  // What the ledger cannot know it does not claim: it holds the newest runs only, and "not for 90 days" needs it to
  // reach back that far — or to be the whole of what ever ran here.
  const oldest = input.ledger[0];
  const reaches = input.ledger.length < AI_LEDGER_LIMIT || (oldest !== undefined && time(oldest.at) <= since);
  if (!reaches) return [];
  const hints: UpkeepHint[] = [];
  for (const entry of input.entries) {
    if (!isSkill(entry) || entry.source.origin !== "vault" || entry.status !== "active" || !entry.approval) continue;
    // In force on this device for the whole time: a skill approved last week has had no chance to be used.
    if (!(time(entry.approval.at) > 0 && time(entry.approval.at) <= since)) continue;
    // Used means: somebody ran it. A regression run measures the skill and is no use of it.
    let last: string | null = null;
    for (const run of input.ledger) if (ownRun(run) && run.skills?.includes(entry.source.id)) last = run.at;
    if (last !== null && time(last) > since) continue;
    hints.push({ kind: "skill-unused", key: `skill-unused:${entry.source.id}:${entry.approval.at}`, id: entry.source.id, last, approved: entry.approval.at });
  }
  return hints;
}

function skillsUnknownTools(entries: readonly InstructionEntry[]): UpkeepHint[] {
  const hints: UpkeepHint[] = [];
  for (const entry of entries) {
    if (!isSkill(entry) || entry.source.origin !== "vault" || entry.status !== "active") continue;
    // The same reading as the grant's (`skillGrant().unknownTools`): a name that is no tool of Plainva's.
    const tools = [...new Set((entry.source.skill!.allowedTools ?? []).filter((name) => !toolByName(name)))];
    if (tools.length) hints.push({ kind: "skill-unknown-tool", key: `skill-unknown-tool:${entry.source.id}:${mainHash(entry)}`, id: entry.source.id, tools });
  }
  return hints;
}

function skillsTestFailing(input: SkillUpkeepInput): UpkeepHint[] {
  const hints: UpkeepHint[] = [];
  for (const entry of input.entries) {
    if (!isSkill(entry) || entry.status !== "active") continue;
    const result = input.tests.find((candidate) => candidate.id === entry.source.id);
    if (!result || result.failed <= 0 || result.ran <= 0) continue;
    hints.push({ kind: "skill-test-failing", key: `skill-test-failing:${entry.source.id}:${result.at}`, id: entry.source.id, failed: result.failed, ran: result.ran, model: result.model });
  }
  return hints;
}

function skillsFailing(input: SkillUpkeepInput): UpkeepHint[] {
  const hints: UpkeepHint[] = [];
  for (const entry of input.entries) {
    if (!isSkill(entry) || entry.source.origin !== "vault" || entry.status !== "active" || !entry.approval) continue;
    // A version that is watched and failed has its own card with the way back (ADR 0028): one thing, said once.
    if (entry.approval.observe && entry.approval.observe.failed > 0) continue;
    // Runs of this version only: what an earlier one did says nothing about the instructions in force.
    const from = time(entry.approval.at);
    const runs = input.ledger.filter((run) => ownRun(run) && run.skills?.includes(entry.source.id) && time(run.at) >= from && observedRunOf(run.stop) !== null).slice(-UPKEEP.failingWindow);
    const failed = runs.filter((run) => observedRunOf(run.stop) === "failed");
    if (failed.length < UPKEEP.failingRuns) continue;
    const newest = failed[failed.length - 1]!;
    const teaching = [...failed].reverse().find((run) => input.conversations.has(run.conversationId) && !readStrangers(run));
    hints.push({ kind: "skill-failing", key: `skill-failing:${entry.source.id}:${newest.at}`, id: entry.source.id, failed: failed.length, runs: runs.length, conversationId: teaching?.conversationId ?? null });
  }
  return hints;
}

function stepsRepeated(input: SkillUpkeepInput): UpkeepHint[] {
  const since = input.now.getTime() - UPKEEP.repeatedDays * DAY_MS;
  const ways = new Map<string, { tools: string[]; conversations: string[] }>();
  for (const run of input.ledger) {
    // By hand: a run of the user's own, without a skill, that answered and whose every step worked.
    if (!ownRun(run) || run.skills?.length || run.stop !== "answered" || time(run.at) < since) continue;
    if (run.tools.length < UPKEEP.repeatedCalls || run.tools.some((tool) => !tool.ok) || readStrangers(run)) continue;
    if (!input.conversations.has(run.conversationId)) continue;
    // The way: its tools in the order each was first used. How often a note was read in between is no difference.
    const tools = [...new Set(run.tools.map((tool) => tool.name))];
    if (tools.length < UPKEEP.repeatedTools) continue;
    const key = tools.join(">");
    const way = ways.get(key) ?? { tools, conversations: [] };
    // One conversation counts once, and the newest stands last.
    const seen = way.conversations.indexOf(run.conversationId);
    if (seen >= 0) way.conversations.splice(seen, 1);
    way.conversations.push(run.conversationId);
    ways.set(key, way);
  }
  // The way that was gone most often first.
  return [...ways.entries()]
    .filter(([, way]) => way.conversations.length >= UPKEEP.repeatedTimes)
    .sort((a, b) => b[1].conversations.length - a[1].conversations.length)
    .map(([key, way]) => ({ kind: "steps-repeated" as const, key: `steps-repeated:${key}`, tools: way.tools, times: way.conversations.length, conversationId: way.conversations[way.conversations.length - 1]! }));
}

/** Everything the device can say about its skills, in the order of `SKILL_UPKEEP_KINDS`. */
export function skillUpkeep(input: SkillUpkeepInput): UpkeepHint[] {
  return [...skillsFailing(input), ...skillsTestFailing(input), ...skillsUnknownTools(input.entries), ...skillsAlike(input.entries), ...skillsUnused(input), ...stepsRepeated(input)];
}

// ------------------------------------------------------------------ memory

export interface MemoryUpkeepInput {
  active: readonly MemoryEntry[];
  long: readonly MemoryEntry[];
  /** The ids of the entries of "always included" that no longer fit. */
  over: readonly string[];
  now: Date;
}

/** Everything the device can say about its memory, in the order of `MEMORY_UPKEEP_KINDS`. */
export function memoryUpkeep(input: MemoryUpkeepInput): UpkeepHint[] {
  const hints: UpkeepHint[] = [];
  if (input.over.length) hints.push({ kind: "active-overflow", key: `active-overflow:${input.over.length}`, left: input.over.length });
  // What goes into every conversation first: there a stale or doubled entry costs each time.
  const entries = [...input.active, ...input.long].filter((entry) => !entry.unreadable);
  const texts = entries.map((entry) => (entry.text.length >= UPKEEP.minEntry ? grams(entry.text) : null));
  for (let i = 0; i < entries.length; i++) {
    if (!texts[i]) continue;
    for (let j = i + 1; j < entries.length; j++) {
      if (!texts[j] || shared(texts[i]!, texts[j]!) < UPKEEP.alikeEntry) continue;
      const [first, second] = entries[i]!.id <= entries[j]!.id ? [entries[i]!, entries[j]!] : [entries[j]!, entries[i]!];
      hints.push({ kind: "entries-alike", key: `entries-alike:${first.id}|${second.id}`, a: first.id, b: second.id });
    }
  }
  const before = input.now.getTime() - UPKEEP.oldEntryDays * DAY_MS;
  for (const entry of entries) {
    if (!entry.added) continue;
    const added = time(entry.added);
    if (added > 0 && added <= before) hints.push({ kind: "entry-old", key: `entry-old:${entry.id}`, id: entry.id, added: entry.added });
  }
  return hints;
}

// --------------------------------------------------------------- dismissed

/** What a device was told not to show again — in the app's data, never in the vault. */
export interface UpkeepPrefs {
  dismissed: string[];
}

export const EMPTY_UPKEEP_PREFS: UpkeepPrefs = { dismissed: [] };

/** A file that does not read dismisses nothing: the hints simply come back. */
export function readUpkeepPrefs(raw: string | null): UpkeepPrefs {
  if (!raw) return EMPTY_UPKEEP_PREFS;
  try {
    const parsed: unknown = JSON.parse(raw);
    const list = parsed && typeof parsed === "object" ? (parsed as { dismissed?: unknown }).dismissed : null;
    if (!Array.isArray(list)) return EMPTY_UPKEEP_PREFS;
    const dismissed = [...new Set(list.filter((key): key is string => typeof key === "string" && key.length > 0 && key.length <= 400))];
    return { dismissed: dismissed.slice(-UPKEEP.dismissedMax) };
  } catch {
    return EMPTY_UPKEEP_PREFS;
  }
}

export function serializeUpkeepPrefs(prefs: UpkeepPrefs): string {
  return `${JSON.stringify({ version: 1, dismissed: prefs.dismissed }, null, 2)}\n`;
}

/** The newest stand last; past the bound the oldest are forgotten, and their hints may come back. */
export function dismissUpkeep(prefs: UpkeepPrefs, key: string): UpkeepPrefs {
  if (!key || prefs.dismissed.includes(key)) return prefs;
  return { dismissed: [...prefs.dismissed, key].slice(-UPKEEP.dismissedMax) };
}

/**
 * The hints a view shows: without the dismissed ones, and of each kind only
 * the first few — the next one takes a place once one is settled. A key holds
 * the state it was about (a file's hash, an approval's time, a run's), so a
 * dismissed hint returns when the matter itself has changed.
 */
export function shownUpkeep(hints: readonly UpkeepHint[], prefs: UpkeepPrefs): UpkeepHint[] {
  const gone = new Set(prefs.dismissed);
  const count = new Map<UpkeepKind, number>();
  const shown: UpkeepHint[] = [];
  for (const hint of hints) {
    if (gone.has(hint.key)) continue;
    const have = count.get(hint.kind) ?? 0;
    if (have >= UPKEEP.perKind) continue;
    count.set(hint.kind, have + 1);
    shown.push(hint);
  }
  return shown;
}
