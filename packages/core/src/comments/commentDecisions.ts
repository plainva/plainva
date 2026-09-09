import { sha256Hex, utf8Encode } from "../workspace/encoding.js";
import { canonicalJson } from "../settingsSync/canonicalJson.js";

export interface CommentDecisionProof {
  operationId: string;
  /** Exact decisions reviewed by this author. Unknown later facts survive. */
  supersedes: string[];
  text: { beforeHash: string; intendedHash: string; confirmedHash: string; confirmedAt: string };
}
export interface SuggestionDecisionFact {
  id: string;
  outcome: "applied" | "declined";
  createdAt: string;
  by: string;
  /** An old derived database column, not a recovered signed marker. */
  legacy?: boolean;
  proof?: CommentDecisionProof | null;
}
export interface SuggestionDecisionState {
  status: "open" | "applied" | "declined" | "conflict";
  /** The unresolved causal frontier; equal decisions may have several facts. */
  decisions: SuggestionDecisionFact[];
  /** All observed facts, including older facts already superseded. */
  knownIds: string[];
}
const idPattern = /^[a-f0-9]{32}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const refPattern = /^(?:[a-f0-9]{32}|legacy:[a-f0-9]{64})$/;

export const isCommentDecisionReference = (id: unknown): id is string => typeof id === "string" && refPattern.test(id);

export function isCommentDecisionProof(value: unknown): value is CommentDecisionProof {
  if (!value || typeof value !== "object") return false;
  const proof = value as CommentDecisionProof;
  const receipt = proof.text;
  return typeof proof.operationId === "string" && idPattern.test(proof.operationId)
    && Array.isArray(proof.supersedes) && proof.supersedes.every(isCommentDecisionReference)
    && new Set(proof.supersedes).size === proof.supersedes.length && !!receipt
    && [receipt.beforeHash, receipt.intendedHash, receipt.confirmedHash].every((hash) => typeof hash === "string" && hashPattern.test(hash))
    && typeof receipt.confirmedAt === "string" && Number.isFinite(Date.parse(receipt.confirmedAt))
    && new Date(receipt.confirmedAt).toISOString() === receipt.confirmedAt;
}

/** Stable and explicitly marked: an old column must never impersonate a marker ID. */
export function legacySuggestionDecision(targetId: string, outcome: "applied" | "declined", createdAt: string, by: string): SuggestionDecisionFact {
  return { id: `legacy:${sha256Hex(utf8Encode(canonicalJson({ targetId, outcome, createdAt, by })))}`, outcome, createdAt, by, legacy: true };
}

/**
 * Facts are never ordered by arrival or wall-clock time. A newer decision
 * replaces ONLY the exact reviewed facts named in its persisted text proof.
 * Edges inside a cycle are ignored so bad references cannot erase all facts.
 */
export function resolveSuggestionDecisions(input: readonly SuggestionDecisionFact[]): SuggestionDecisionState {
  const facts = new Map<string, SuggestionDecisionFact>();
  for (const fact of [...input].sort((a, b) => a.id.localeCompare(b.id) || canonicalJson(a).localeCompare(canonicalJson(b)))) {
    if (!facts.has(fact.id)) facts.set(fact.id, fact);
  }
  const ids = [...facts.keys()].sort();
  const edges = new Map<string, string[]>();
  const reverse = new Map(ids.map((id) => [id, [] as string[]]));
  for (const id of ids) {
    const proof = facts.get(id)!.proof;
    const targets = isCommentDecisionProof(proof) ? proof.supersedes.filter((target) => facts.has(target) && target !== id) : [];
    edges.set(id, targets);
    for (const target of targets) reverse.get(target)!.push(id);
  }
  // Iterative Kosaraju: large comment histories must not overflow the stack.
  const visited = new Set<string>();
  const finish: string[] = [];
  for (const start of ids) {
    const stack: Array<[string, boolean]> = [[start, false]];
    while (stack.length) {
      const [id, exiting] = stack.pop()!;
      if (exiting) { finish.push(id); continue; }
      if (visited.has(id)) continue;
      visited.add(id);
      stack.push([id, true]);
      for (const target of edges.get(id)!) if (!visited.has(target)) stack.push([target, false]);
    }
  }
  const component = new Map<string, number>();
  let componentId = 0;
  for (const start of finish.reverse()) {
    if (component.has(start)) continue;
    const stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      if (component.has(id)) continue;
      component.set(id, componentId);
      for (const source of reverse.get(id)!) if (!component.has(source)) stack.push(source);
    }
    componentId += 1;
  }
  const superseded = new Set<string>();
  for (const [source, targets] of edges) for (const target of targets) {
    if (component.get(source) !== component.get(target)) superseded.add(target);
  }
  const decisions = ids.filter((id) => !superseded.has(id)).map((id) => facts.get(id)!);
  const outcomes = new Set(decisions.map((fact) => fact.outcome));
  return { status: outcomes.size > 1 ? "conflict" : outcomes.has("applied") ? "applied" : outcomes.has("declined") ? "declined" : "open", decisions, knownIds: ids };
}
