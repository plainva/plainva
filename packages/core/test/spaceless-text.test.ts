import { describe, expect, it } from "vitest";
import { findSearchOccurrences, markSearchMatches } from "../src/vault/searchOccurrences.js";
import {
  hasSpacelessText,
  segmentedIndexText,
  segmentedMatchExpression,
  wordBoundedPattern,
} from "../src/vault/spacelessText.js";
import { SNIPPET_MARK_END, SNIPPET_MARK_START } from "../src/vault/ftsQuery.js";

/**
 * Scripts written without spaces (finding 2026-09-30, Gesamtplan Volltextsuche
 * CJK): the search found 0 of 8 Japanese and 0 of 8 Chinese questions, because
 * FTS5 took a whole sentence for one word. Inside such text a term now matches
 * anywhere; at the edge of a spaced script it keeps its word boundary.
 */
const quotes = (text: string, query: string) => findSearchOccurrences(text, query).map((hit) => hit.occurrence.quote);

describe("the index form of spaceless text", () => {
  it("cuts runs into overlapping pairs plus the last character, other pieces stay whole", () => {
    expect(segmentedIndexText("2026年9月の会議でPlainvaを使った")).toBe("2026 年 9 月の の会 会議 議で で Plainva を使 使っ った た");
  });

  it("leaves text in spaced scripts alone — Latin and Korean cost nothing", () => {
    expect(segmentedIndexText("Plain English, Müller and 회의록을")).toBe("");
    expect(hasSpacelessText("회의록")).toBe(false);
  });

  it("keeps the prolonged sound mark inside a run and tone marks with their consonant", () => {
    expect(segmentedIndexText("コーヒー")).toBe("コー ーヒ ヒー ー");
    expect(segmentedIndexText("ช่อง")).toBe("ช่อ อง ง");
  });

  it("handles characters outside the basic plane", () => {
    expect(segmentedIndexText("𠮷野家")).toBe("𠮷野 野家 家");
  });
});

describe("the search expression of a spaceless term", () => {
  it("is a pair phrase in the segmented columns", () => {
    expect(segmentedMatchExpression("議事録", true)).toBe('{seg_content seg_title} : "議事 事録"');
  });

  it("lets a single character match as the first half of a pair or a run's end", () => {
    expect(segmentedMatchExpression("議", false)).toBe('{seg_content seg_title} : "議"*');
  });

  it("ends a run before a digit or Latin piece, as the index does", () => {
    expect(segmentedMatchExpression("会議2026", false)).toBe('{seg_content seg_title} : "会議 議 2026"');
    expect(segmentedMatchExpression("9月", true)).toBe('{seg_content seg_title} : "9 月"*');
  });

  it("requires every word of a phrase and leaves their order to the occurrence list", () => {
    expect(segmentedMatchExpression("会議 Plainva", false)).toBe('({seg_content seg_title} : "会議" AND "Plainva")');
  });

  it("has nothing to search without a word", () => {
    expect(segmentedMatchExpression("。、", true)).toBeNull();
  });
});

describe("occurrences inside spaceless text", () => {
  const japanese = "今日は会議の議事録を書いた。来週の打ち合わせも。";

  it("finds a word in the middle of a Japanese sentence", () => {
    expect(quotes(japanese, "議事録")).toEqual(["議事録"]);
    expect(quotes(japanese, "打ち合わせ")).toEqual(["打ち合わせ"]);
  });

  it("finds every occurrence of a single character, also twice in one run", () => {
    expect(quotes(japanese, "議")).toEqual(["議", "議"]);
    expect(quotes("会議会議", "会議")).toEqual(["会議", "会議"]);
  });

  it("finds Chinese and Thai the same way", () => {
    expect(quotes("我们在会议上讨论了全文搜索的问题", "搜索")).toEqual(["搜索"]);
    expect(quotes("ภาษาไทยไม่มีช่องว่างระหว่างคำ", "ช่องว่าง")).toEqual(["ช่องว่าง"]);
  });

  it("matches digits and Latin at their word boundary inside mixed words", () => {
    const text = "2026年9月の会議でPlainvaを使った";
    expect(quotes(text, "9月")).toEqual(["9月"]);
    expect(quotes(text, "2026年")).toEqual(["2026年"]);
    expect(quotes(text, "Plainva")).toEqual(["Plainva"]);
    expect(quotes(text, "lainva")).toEqual([]);
  });

  it("never reaches across a space", () => {
    expect(quotes("東京 大学", "京大")).toEqual([]);
  });

  it("keeps kana distinct — が is not か", () => {
    expect(quotes("がんばる", "か")).toEqual([]);
  });

  it("marks a title found through the pair columns", () => {
    expect(markSearchMatches("会議メモ 2026", "メモ")).toBe(`会議${SNIPPET_MARK_START}メモ${SNIPPET_MARK_END} 2026`);
    expect(markSearchMatches("English title", "メモ")).toBeNull();
  });
});

describe("word boundaries for unlinked mentions", () => {
  const found = (term: string, text: string) => new RegExp(wordBoundedPattern(term), "iu").test(text);

  it("finds a spaceless title anywhere in a run", () => {
    expect(found("議事録", "今日は議事録を書いた")).toBe(true);
    expect(found("東京", "東京大学")).toBe(true);
  });

  it("keeps Latin boundaries, also next to spaceless text", () => {
    expect(found("Plan", "the Plan.")).toBe(true);
    expect(found("Plan", "Planet")).toBe(false);
    expect(found("plan", "replan")).toBe(false);
    expect(found("Plainva", "でPlainvaを使った")).toBe(true);
  });
});
