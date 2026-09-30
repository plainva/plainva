import { describe, expect, it } from "vitest";
import {
  ftsExactTerm,
  isEmptySearchQuery,
  parseSearchQuery,
  SNIPPET_MARK_END,
  SNIPPET_MARK_START,
} from "../src/vault/ftsQuery.ts";

describe("parseSearchQuery", () => {
  it("turns a bare token into a quoted prefix term (search-as-you-type)", () => {
    const q = parseSearchQuery("projek");
    expect(q.match).toBe('"projek"*');
    expect(q.terms).toEqual(["projek"]);
    expect(q.notMatch).toBeNull();
  });

  it("joins multiple tokens with AND", () => {
    expect(parseSearchQuery("foo bar").match).toBe('"foo"* AND "bar"*');
  });

  it("neutralizes FTS5 operator characters instead of erroring", () => {
    // Every chunk is quoted, so `- ( ) : *` lose their FTS5 meaning.
    const q = parseSearchQuery("e-mail (test: c++*");
    expect(q.match).toBe('"e-mail"* AND "(test:"* AND "c++*"*');
  });

  it("treats uppercase AND/OR/NOT as literal words", () => {
    expect(parseSearchQuery("AND").match).toBe('"AND"*');
  });

  it("drops chunks the unicode61 tokenizer would empty out", () => {
    // An empty quoted phrase would itself be an FTS5 syntax error.
    const q = parseSearchQuery("- ((( !!! \"...\"");
    expect(q.match).toBeNull();
    expect(isEmptySearchQuery(q)).toBe(true);
  });

  it("keeps a closed phrase exact (whole-word escape hatch)", () => {
    const q = parseSearchQuery('"foo bar"');
    expect(q.match).toBe('"foo bar"');
    expect(q.terms).toEqual(["foo bar"]);
  });

  it("prefixes an unclosed trailing phrase (still being typed)", () => {
    expect(parseSearchQuery('"foo ba').match).toBe('"foo ba"*');
  });

  it("splits a stray quote into safe separate terms", () => {
    expect(parseSearchQuery('foo"bar').match).toBe('"foo"* AND "bar"*');
  });

  it("collects -term exclusions separately (OR-joined), not in the match", () => {
    const q = parseSearchQuery("projekt -review -alt");
    expect(q.match).toBe('"projekt"*');
    expect(q.notMatch).toBe('"review"* OR "alt"*');
    expect(q.terms).toEqual(["projekt"]);
  });

  it("keeps an excluded closed phrase exact", () => {
    expect(parseSearchQuery('-"foo bar"').notMatch).toBe('"foo bar"');
  });

  it("parses path: filters lowercased, with quoting and negation", () => {
    const q = parseSearchQuery('path:Notes/Archiv -path:"Mein Ordner" foo');
    expect(q.paths).toEqual(["notes/archiv"]);
    expect(q.notPaths).toEqual(["mein ordner"]);
    expect(q.match).toBe('"foo"*');
    expect(q.terms).toEqual(["foo"]);
  });

  it("parses tag: filters, stripping a leading #", () => {
    const q = parseSearchQuery("tag:#Projekt/intern -tag:archiv");
    expect(q.tags).toEqual(["Projekt/intern"]);
    expect(q.notTags).toEqual(["archiv"]);
    expect(q.match).toBeNull();
    expect(isEmptySearchQuery(q)).toBe(false);
  });

  it("reports empty input as empty", () => {
    expect(isEmptySearchQuery(parseSearchQuery(""))).toBe(true);
    expect(isEmptySearchQuery(parseSearchQuery("   "))).toBe(true);
  });

  it("passes non-ASCII terms through untouched (FTS folds diacritics itself)", () => {
    expect(parseSearchQuery("Müller").match).toBe('"Müller"*');
    expect(parseSearchQuery("회의록").match).toBe('"회의록"*');
  });

  /**
   * Scripts written without spaces (finding 2026-09-30): a term becomes a pair
   * phrase in the segmented columns, which finds it anywhere in a run — quotes
   * change nothing there, and the raw term still drives the UI.
   */
  it("searches spaceless terms as pair phrases in the segmented columns", () => {
    const q = parseSearchQuery("日本語 Plainva");
    expect(q.match).toBe('{seg_content seg_title} : "日本 本語" AND "Plainva"*');
    expect(q.terms).toEqual(["日本語", "Plainva"]);
    expect(parseSearchQuery('"議事録"').match).toBe('{seg_content seg_title} : "議事 事録"');
    expect(parseSearchQuery("会議 -議事録").notMatch).toBe('{seg_content seg_title} : "議事 事録"');
  });

  it("drops a spaceless chunk without a word, like any other", () => {
    expect(parseSearchQuery("。、").match).toBeNull();
  });

  it("gives the mention scan an exact condition for every title", () => {
    expect(ftsExactTerm("Projekt X")).toBe('"Projekt X"');
    expect(ftsExactTerm("会議")).toBe('{seg_content seg_title} : "会議"');
    expect(ftsExactTerm("。")).toBeNull();
  });

  it("exposes the char(1)/char(2) sentinels for snippet rendering", () => {
    expect(SNIPPET_MARK_START.length).toBe(1);
    expect(SNIPPET_MARK_START.charCodeAt(0)).toBe(1);
    expect(SNIPPET_MARK_END.length).toBe(1);
    expect(SNIPPET_MARK_END.charCodeAt(0)).toBe(2);
  });
});
