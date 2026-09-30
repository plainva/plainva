/**
 * Ranking v1 of the context package (plan §8.2). The candidates reach this
 * module already through the hard gate: a note the policy keeps from the
 * recipient is not scored low here, it does not exist here.
 *
 * score = Σ weight(signal) · value(signal), every value in 0..1. The weights
 * are an eval hypothesis, not a truth (§8.2), so they are one table.
 */

export type CandidateSignal =
  /** The note open in front of the user. */
  | "active"
  /** Pinned to the conversation by the user. */
  | "pinned"
  /** Full-text match with the question, relative to the best match. */
  | "lexical"
  /** Close in meaning to the question (search by meaning, plan P2b), relative to the best hit. */
  | "semantic"
  /** Link proximity to the open note: linked either way, or shared neighbours. */
  | "graph"
  /** Opened recently on this device (decays). */
  | "opened"
  /** Changed recently (decays; the file time, so a sync counts too). */
  | "edited"
  /** A task or appointment that is due: overdue and today count most. */
  | "urgency"
  /** Today's daily note. */
  | "daily"
  /** Open in a tab or pane. */
  | "tab";

export const CANDIDATE_SIGNALS: readonly CandidateSignal[] = ["active", "pinned", "lexical", "semantic", "graph", "opened", "edited", "urgency", "daily", "tab"];

export const DEFAULT_RANK_WEIGHTS: Readonly<Record<CandidateSignal, number>> = {
  active: 4,
  pinned: 3.5,
  lexical: 2.5,
  // Below the words: meaning finds what the words miss, the words stay the sharper evidence (an eval hypothesis, P2b-7).
  semantic: 2,
  graph: 1.2,
  urgency: 1,
  edited: 0.8,
  opened: 0.6,
  daily: 0.6,
  tab: 0.5,
};

export interface Candidate {
  path: string;
  title: string;
  signals: Partial<Record<CandidateSignal, number>>;
  /** A query-focused excerpt from the search index, markers removed. */
  snippet?: string;
  /** The closest section of a note found by meaning (plan P2b): its evidence is that section. */
  chunk?: { ordinal: number; hash: string };
}

export interface RankedCandidate extends Candidate {
  score: number;
  /** The signals that carried the score, strongest first — the "why" of the context view. */
  reasons: CandidateSignal[];
}

const DAY_MS = 86_400_000;

/** Exponential decay with a half-life: 1 now, 0.5 after one half-life. */
export function recencySignal(ageMs: number, halfLifeMs: number): number {
  if (!Number.isFinite(ageMs) || ageMs < 0) return ageMs < 0 ? 1 : 0;
  return Math.pow(2, -ageMs / halfLifeMs);
}

/** Views decay faster than edits: opening is cheap, changing is a commitment (§8.3). */
export const OPENED_HALF_LIFE_MS = 2 * DAY_MS;
export const EDITED_HALF_LIFE_MS = 7 * DAY_MS;

/**
 * How pressing a due date is on `today` (both `YYYY-MM-DD`): overdue and
 * today count fully, the next two weeks fade out; no date is no urgency.
 */
export function urgencySignal(due: string | null | undefined, today: string): number {
  if (!due) return 0;
  const days = Math.round((Date.parse(`${due.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  if (!Number.isFinite(days)) return 0;
  if (days <= 0) return 1;
  if (days > 14) return 0;
  return 1 - days / 15;
}

/** Merges the lists of the candidate sources: one entry per path, the strongest value per signal. */
export function mergeCandidates(lists: readonly (readonly Candidate[])[]): Candidate[] {
  const byPath = new Map<string, Candidate>();
  for (const list of lists) {
    for (const candidate of list) {
      const known = byPath.get(candidate.path);
      if (!known) {
        byPath.set(candidate.path, { ...candidate, signals: { ...candidate.signals } });
        continue;
      }
      for (const [signal, value] of Object.entries(candidate.signals) as [CandidateSignal, number][]) {
        known.signals[signal] = Math.max(known.signals[signal] ?? 0, value);
      }
      if (!known.snippet && candidate.snippet) known.snippet = candidate.snippet;
      if (!known.chunk && candidate.chunk) known.chunk = candidate.chunk;
    }
  }
  return [...byPath.values()];
}

export function folderOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

function scored(candidate: Candidate, weights: Readonly<Record<CandidateSignal, number>>): RankedCandidate {
  const parts: [CandidateSignal, number][] = [];
  for (const signal of CANDIDATE_SIGNALS) {
    const value = candidate.signals[signal];
    if (value === undefined || value <= 0) continue;
    parts.push([signal, weights[signal] * Math.min(1, value)]);
  }
  parts.sort((a, b) => b[1] - a[1]);
  return { ...candidate, score: parts.reduce((sum, [, v]) => sum + v, 0), reasons: parts.map(([signal]) => signal) };
}

/**
 * Orders the (gated) candidates. Diversified: at most `perFolder` notes of
 * one folder among the leading ones, so ten near-identical hits from one
 * folder do not push everything else out (§8.3); the open note and pinned
 * notes are exempt. The rest follows by score, for the work map.
 */
export function rankCandidates(
  candidates: readonly Candidate[],
  options: { weights?: Readonly<Record<CandidateSignal, number>>; perFolder?: number } = {},
): RankedCandidate[] {
  const weights = options.weights ?? DEFAULT_RANK_WEIGHTS;
  const perFolder = options.perFolder ?? 3;
  const all = candidates.map((c) => scored(c, weights)).filter((c) => c.score > 0);
  all.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const lead: RankedCandidate[] = [];
  const rest: RankedCandidate[] = [];
  const perFolderCount = new Map<string, number>();
  for (const candidate of all) {
    const exempt = (candidate.signals.active ?? 0) > 0 || (candidate.signals.pinned ?? 0) > 0;
    const folder = folderOf(candidate.path);
    const count = perFolderCount.get(folder) ?? 0;
    if (exempt || count < perFolder) {
      lead.push(candidate);
      if (!exempt) perFolderCount.set(folder, count + 1);
    } else {
      rest.push(candidate);
    }
  }
  return [...lead, ...rest];
}
