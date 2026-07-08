import { describe, expect, it } from "vitest";
import {
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
    expect(parseSearchQuery("日本語").match).toBe('"日本語"*');
  });

  it("exposes the char(1)/char(2) sentinels for snippet rendering", () => {
    expect(SNIPPET_MARK_START.length).toBe(1);
    expect(SNIPPET_MARK_START.charCodeAt(0)).toBe(1);
    expect(SNIPPET_MARK_END.length).toBe(1);
    expect(SNIPPET_MARK_END.charCodeAt(0)).toBe(2);
  });
});
