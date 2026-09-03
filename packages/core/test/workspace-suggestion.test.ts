import { describe, it, expect } from "vitest";

import { assertWorkspaceSuggestion, assertWorkspaceSuggestionBatch } from "../src/workspace/collaboration.js";
import type { WorkspaceCommentAnchor } from "../src/workspace/commentAnchor.js";

/**
 * The rules that keep a suggestion applicable.
 *
 * A suggestion is a promise that one passage can be swapped for another. Every
 * assertion below stands for a way that promise could quietly become
 * unkeepable: a proposal with nothing to replace, an outcome with no proposal
 * behind it, or a replacement so large it would never survive the round trip.
 */
const ANCHOR: WorkspaceCommentAnchor = {
  markerId: "7f3a",
  quote: "bis Ende des Jahres",
  before: "Der Vertrag laeuft ",
  after: ".",
  approximateOffset: 19,
};

describe("workspace suggestion rules", () => {
  it("accepts a proposal that names the passage it replaces", () => {
    expect(() => assertWorkspaceSuggestion({ replacement: "bis 31.12.2027" }, ANCHOR, null, null)).not.toThrow();
  });

  it("accepts an empty replacement, because deleting a passage is a proposal too", () => {
    expect(() => assertWorkspaceSuggestion({ replacement: "" }, ANCHOR, null, null)).not.toThrow();
  });

  it("refuses a proposal without an anchored passage", () => {
    // Without a range the accepting device would have to guess where to write.
    expect(() => assertWorkspaceSuggestion({ replacement: "x" }, null, null, null)).toThrow(/anchored passage/);
  });

  it("refuses a proposal that also closes another thread", () => {
    // A resolve marker carries no text of its own; a proposal is nothing but
    // text. One object cannot honestly be both.
    expect(() => assertWorkspaceSuggestion({ replacement: "x" }, ANCHOR, null, "aa".repeat(16))).toThrow(/cannot also resolve/);
  });

  it("refuses a replacement larger than a comment body may be", () => {
    expect(() => assertWorkspaceSuggestion({ replacement: "a".repeat(64 * 1024 + 1) }, ANCHOR, null, null)).toThrow(/replacement is invalid/);
  });

  it("refuses an outcome that names no suggestion", () => {
    // "applied" without a target would claim a note was changed on behalf of a
    // proposal nobody can find.
    expect(() => assertWorkspaceSuggestion(null, null, "applied", null)).toThrow(/the suggestion it closes/);
    expect(() => assertWorkspaceSuggestion(null, null, "declined", null)).toThrow(/the suggestion it closes/);
  });

  it("accepts both outcomes on a marker that closes a suggestion", () => {
    for (const outcome of ["applied", "declined"] as const) {
      expect(() => assertWorkspaceSuggestion(null, null, outcome, "aa".repeat(16))).not.toThrow();
    }
  });

  it("refuses an outcome word it does not know", () => {
    expect(() => assertWorkspaceSuggestion(null, null, "maybe" as "applied", "aa".repeat(16))).toThrow(/outcome is invalid/);
  });

  it("leaves a comment written before suggestions existed alone", () => {
    // undefined is what an older comment parses to. It must pass every rule
    // untouched - that is what makes the field additive.
    expect(() => assertWorkspaceSuggestion(undefined, undefined, undefined, null)).not.toThrow();
  });
});

describe("insertion points and rounds (Vorschlagsmodus, V1)", () => {
  const POINT: WorkspaceCommentAnchor = { markerId: "7f3a", quote: "", before: "the year.", after: " It renews", approximateOffset: 44 };

  it("lets an insertion point carry only a proposal that adds text", () => {
    expect(() => assertWorkspaceSuggestion({ replacement: "Please confirm." }, POINT, null, null)).not.toThrow();
    expect(() => assertWorkspaceSuggestion({ replacement: "" }, POINT, null, null)).toThrow(/needs text to insert/);
    expect(() => assertWorkspaceSuggestion(null, POINT, null, null)).toThrow(/anchors only a proposal/);
  });

  it("keeps a round's three fields together and on a proposal", () => {
    const id = "ab".repeat(16);
    expect(() => assertWorkspaceSuggestionBatch({ suggestionBatchId: id, batchIndex: 0, batchNote: null }, { replacement: "x" })).not.toThrow();
    expect(() => assertWorkspaceSuggestionBatch({ suggestionBatchId: id, batchIndex: 2, batchNote: "Datum aus dem PDF" }, { replacement: "x" })).not.toThrow();
    expect(() => assertWorkspaceSuggestionBatch({}, null)).not.toThrow();
    expect(() => assertWorkspaceSuggestionBatch({ suggestionBatchId: id, batchIndex: 0 }, null)).toThrow(/belongs to a proposal/);
    expect(() => assertWorkspaceSuggestionBatch({ suggestionBatchId: "nope", batchIndex: 0 }, { replacement: "x" })).toThrow(/round id is invalid/);
    expect(() => assertWorkspaceSuggestionBatch({ suggestionBatchId: id, batchIndex: -1 }, { replacement: "x" })).toThrow(/round index is invalid/);
    expect(() => assertWorkspaceSuggestionBatch({ suggestionBatchId: id, batchIndex: 0, batchNote: "n".repeat(1025) }, { replacement: "x" })).toThrow(/note is too large/);
  });
});
