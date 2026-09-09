import { describe, expect, it } from "vitest";
import {
  isCommentDecisionProof, legacySuggestionDecision, resolveSuggestionDecisions,
  type CommentDecisionProof, type SuggestionDecisionFact,
} from "../src/comments/commentDecisions.js";

const id = (n: number) => n.toString(16).padStart(32, "0");
const at = "2026-09-09T10:00:00.000Z";
function proof(refs: string[]): CommentDecisionProof {
  return { operationId: id(100), supersedes: refs,
    text: { beforeHash: "a".repeat(64), intendedHash: "b".repeat(64), confirmedHash: "c".repeat(64), confirmedAt: at } };
}
function fact(n: number, outcome: "applied" | "declined", supersedes?: string[]): SuggestionDecisionFact {
  return { id: id(n), outcome, createdAt: at, by: `writer-${n}`, ...(supersedes ? { proof: proof(supersedes) } : {}) };
}
function permutations<T>(values: T[]): T[][] {
  return values.length <= 1 ? [values] : values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map((rest) => [value, ...rest]));
}

describe("causal suggestion decisions", () => {
  it("retains an independent apply/decline conflict in either arrival order, regardless of timestamps", () => {
    const a = fact(1, "applied"), b = { ...fact(2, "declined"), createdAt: "2025-01-01T00:00:00.000Z" };
    for (const order of permutations([a, b])) {
      expect(resolveSuggestionDecisions(order)).toEqual({ status: "conflict", decisions: [a, b], knownIds: [a.id, b.id] });
    }
  });
  it("keeps equal independent decisions without inventing a conflict or arrival-order winner", () => {
    const input = [fact(1, "applied"), fact(2, "applied"), fact(3, "applied")];
    for (const order of permutations(input)) expect(resolveSuggestionDecisions(order)).toEqual({ status: "applied", decisions: input, knownIds: input.map((entry) => entry.id) });
  });
  it("an explicit reviewed decision replaces exactly its known predecessors in every order", () => {
    const input = [fact(1, "applied"), fact(2, "declined"), fact(3, "applied", [id(1), id(2)])];
    for (const order of permutations(input)) expect(resolveSuggestionDecisions(order)).toEqual({ status: "applied", decisions: [input[2]], knownIds: input.map((entry) => entry.id) });
  });
  it("a later unknown counterdecision stays visible even when its clock is older", () => {
    const input = [fact(1, "applied"), fact(2, "declined"), fact(3, "applied", [id(1), id(2)]),
      { ...fact(4, "declined"), createdAt: "2024-01-01T00:00:00.000Z" }];
    for (const order of permutations(input)) {
      const result = resolveSuggestionDecisions(order);
      expect(result.status).toBe("conflict");
      expect(result.decisions.map((entry) => entry.id)).toEqual([id(3), id(4)]);
    }
  });
  it("partial review does not silently dispose of a known opposite decision", () => {
    const result = resolveSuggestionDecisions([fact(1, "applied"), fact(2, "declined"), fact(3, "applied", [id(1)])]);
    expect(result.status).toBe("conflict");
    expect(result.decisions.map((entry) => entry.id)).toEqual([id(2), id(3)]);
  });
  it("transitive replacement follows the explicit history rather than the clock", () => {
    const input = [fact(1, "applied"), fact(2, "declined", [id(1)]), fact(3, "applied", [id(2)]), fact(4, "declined", [id(3)])];
    for (const order of permutations(input)) expect(resolveSuggestionDecisions(order).decisions).toEqual([input[3]]);
  });
  it("a missing or malformed text proof cannot suppress another decision", () => {
    const a = fact(1, "applied"), b = fact(2, "declined", [a.id]);
    b.proof = { ...b.proof!, text: { ...b.proof!.text, confirmedHash: "not a hash" } };
    expect(isCommentDecisionProof(b.proof)).toBe(false);
    expect(resolveSuggestionDecisions([a, b]).status).toBe("conflict");
  });
  it("unseen and unrelated references never remove an observed counterdecision", () => {
    const result = resolveSuggestionDecisions([fact(1, "declined"), fact(2, "applied", [id(99)])]);
    expect(result.status).toBe("conflict");
    expect(result.decisions).toHaveLength(2);
  });
  it("cycles cannot erase all decisions", () => {
    const input = [fact(1, "applied", [id(2)]), fact(2, "declined", [id(3)]), fact(3, "applied", [id(1)])];
    for (const order of permutations(input)) {
      expect(resolveSuggestionDecisions(order).status).toBe("conflict");
      expect(resolveSuggestionDecisions(order).decisions).toEqual(input);
    }
  });
  it("a later explicit review can resolve every member of a broken cycle", () => {
    const a = fact(1, "applied", [id(2)]), b = fact(2, "declined", [id(1)]), c = fact(3, "declined", [id(1), id(2)]);
    for (const order of permutations([a, b, c])) expect(resolveSuggestionDecisions(order).decisions).toEqual([c]);
  });
  it("superseding just one cycle member does not erase its unreviewed peer", () => {
    const result = resolveSuggestionDecisions([fact(1, "applied", [id(2)]), fact(2, "declined", [id(1)]), fact(3, "applied", [id(1)])]);
    expect(result.status).toBe("conflict");
    expect(result.decisions.map((entry) => entry.id)).toEqual([id(2), id(3)]);
  });
  it("a self-reference cannot remove its own decision", () => {
    const a = fact(1, "applied", [id(1)]);
    expect(resolveSuggestionDecisions([a]).decisions).toEqual([a]);
  });
  it("old derived database decisions stay explicitly distinguishable from signed facts", () => {
    const a = legacySuggestionDecision(id(88), "applied", at, "old member");
    const b = legacySuggestionDecision(id(88), "declined", at, "");
    expect(a.legacy).toBe(true);
    expect(a.id).toMatch(/^legacy:[a-f0-9]{64}$/);
    expect(legacySuggestionDecision(id(88), "applied", at, "old member")).toEqual(a);
    expect(legacySuggestionDecision(id(89), "applied", at, "old member").id).not.toBe(a.id);
    expect(resolveSuggestionDecisions([a, b]).status).toBe("conflict");
    const c = fact(3, "applied", [a.id, b.id]);
    expect(isCommentDecisionProof(c.proof)).toBe(true);
    expect(resolveSuggestionDecisions([a, b, c]).decisions).toEqual([c]);
  });
  it("does not overflow the call stack on a long causal history", () => {
    const input = Array.from({ length: 6000 }, (_, index) => fact(index + 1, index % 2 ? "declined" : "applied", index ? [id(index)] : []));
    const result = resolveSuggestionDecisions(input.reverse());
    expect(result.decisions.map((entry) => entry.id)).toEqual([id(6000)]);
    expect(result.knownIds).toHaveLength(6000);
  });
});
