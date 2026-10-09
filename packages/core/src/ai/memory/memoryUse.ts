import { isCloudRecipient, type EgressRecipient } from "../egressGate.js";
import type { AiPolicyDimension } from "../policy.js";
import { searchWords, wordScore } from "../tools.js";
import { MEMORY_LIMITS, type MemoryEntry } from "./memoryFile.js";

/**
 * What of the memory a conversation gets (plan KI-Harness P6, ADR 0027).
 *
 * Two questions, asked in this order. The gate: which entries may this
 * recipient have at all — an entry carries the rules of what it was made
 * from, and one whose rules cannot be read goes nowhere. The budget: of
 * "always with it", what fits — in the order of the file, so the user decides
 * what comes first by where it stands, and an entry that does not fit is
 * shown as one that does not, never dropped in silence.
 */

export interface MemoryGate {
  /** The rules that keep an entry from this recipient: `cloud` for a cloud, `web` in a conversation with the internet. */
  denied: ReadonlySet<AiPolicyDimension>;
}

/** The gate's rules for one conversation: a cloud is kept out by `cloud`, a conversation that carries the internet by `web`. */
export function memoryDeniedFor(recipient: EgressRecipient, web: boolean): Set<AiPolicyDimension> {
  const denied = new Set<AiPolicyDimension>();
  if (isCloudRecipient(recipient)) denied.add("cloud");
  if (web) denied.add("web");
  return denied;
}

/** Whether an entry may reach a recipient under these rules. */
export function memoryEntryAllowed(entry: Pick<MemoryEntry, "deny" | "unreadable" | "tooLong">, gate: MemoryGate): boolean {
  if (entry.unreadable || entry.tooLong) return false;
  return !entry.deny.some((rule) => gate.denied.has(rule));
}

export interface ActiveMemory {
  /** The entries that go along, in the order of the file. */
  entries: MemoryEntry[];
  /** Kept back by a rule, or unreadable. */
  withheld: number;
  /** Did not fit any more, or are too long to be an entry. */
  left: number;
  /** The characters of entry text that go along. */
  chars: number;
}

/**
 * "Always with it" for one conversation. The budget is spent in the order of
 * the file over ALL its entries, whoever may read them: what a cloud gets is
 * what the device's own model gets, without what is kept from a cloud — never
 * an entry that slipped in because a kept one made room.
 */
export function activeMemoryFor(entries: readonly MemoryEntry[], gate: MemoryGate): ActiveMemory {
  const out: ActiveMemory = { entries: [], withheld: 0, left: 0, chars: 0 };
  let spent = 0;
  for (const entry of entries) {
    if (entry.tooLong) {
      out.left += 1;
      continue;
    }
    if (spent + entry.text.length > MEMORY_LIMITS.activeChars) {
      out.left += 1;
      continue;
    }
    spent += entry.text.length;
    if (!memoryEntryAllowed(entry, gate)) {
      out.withheld += 1;
      continue;
    }
    out.entries.push(entry);
    out.chars += entry.text.length;
  }
  return out;
}

/** How much of the budget the entries of "always with it" use, and which of them no longer fit. */
export function activeMemoryBudget(entries: readonly MemoryEntry[]): { used: number; limit: number; over: string[] } {
  let used = 0;
  const over: string[] = [];
  for (const entry of entries) {
    if (entry.tooLong || used + entry.text.length > MEMORY_LIMITS.activeChars) over.push(entry.id);
    else used += entry.text.length;
  }
  return { used, limit: MEMORY_LIMITS.activeChars, over };
}

/**
 * Entries as the text a model reads: a Markdown list, a heading where the
 * entries of a section begin. Only text the user can see in the list.
 */
export function memoryText(entries: readonly MemoryEntry[]): string {
  const lines: string[] = [];
  let section: string | null | undefined;
  for (const entry of entries) {
    if (entry.section !== section) {
      section = entry.section;
      if (section) lines.push(`## ${section}`);
    }
    lines.push(`- ${entry.text}`);
  }
  return lines.join("\n");
}

export const MEMORY_SEARCH_LIMIT = 8;

/**
 * The entries that match a question, best first: by the words they share
 * with it (the section's heading counts), then the newer one, then the order
 * of the files. A question without a word that says something lists the
 * newest entries. Only entries the recipient may have.
 */
export function searchMemory(entries: readonly MemoryEntry[], query: string, gate: MemoryGate, limit = MEMORY_SEARCH_LIMIT): { entries: MemoryEntry[]; withheld: number } {
  const words = searchWords(query);
  let withheld = 0;
  const hits: { entry: MemoryEntry; score: number; order: number }[] = [];
  entries.forEach((entry, order) => {
    const score = words.length ? wordScore(words, `${entry.text} ${entry.section ?? ""}`) : 1;
    if (score === 0) return;
    if (!memoryEntryAllowed(entry, gate)) {
      withheld += 1;
      return;
    }
    hits.push({ entry, score, order });
  });
  hits.sort((a, b) => b.score - a.score || (b.entry.added ?? "").localeCompare(a.entry.added ?? "") || a.order - b.order);
  return { entries: hits.slice(0, Math.max(1, limit)).map((hit) => hit.entry), withheld };
}

/** Text compared as a reader would: letter case and spacing do not make two entries. */
export function memoryKey(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** The entry a text names — what a model quotes when it wants one replaced or forgotten: the same words, whatever their case. */
export function findMemoryEntry(entries: readonly MemoryEntry[], text: string): MemoryEntry | null {
  const key = memoryKey(text);
  if (!key) return null;
  const same = entries.filter((entry) => memoryKey(entry.text) === key);
  // Two entries that read the same: nobody can say which is meant.
  return same.length === 1 ? same[0]! : null;
}
