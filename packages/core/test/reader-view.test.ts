import { describe, expect, it } from "vitest";
import { ReaderView, diffHunks, rawChangeOf, redactDeniedLinks, redactDeniedLinksIn } from "../src/ai/index.ts";
import { withholdPlaces, withholdPlacesIn } from "../src/ai/context/sensitive.ts";
import { redactSensitive, redactSensitiveIn, sensitiveFindings } from "../src/ai/context/sensitiveHints.ts";
import { excludedSearchTermSpecs, viewMatchesSearch, viewSearchSnippet, withoutExcludedSearchTerms } from "../src/vault/searchOccurrences.ts";

/**
 * One view per reader (decision A of 2026-11-13, review of R19, wave 2): what a reader with a narrower view sees of a
 * note, and where each part of it stands in the raw text.
 */
const RAW = "# Pay\n\n## Pay talk with [[Private/Salary 2026]]\n\nSee [[Private/Salary 2026|Kowalski]] for the numbers.\n📍 52.5200, 13.4050\nIBAN DE89 3704 0044 0532 0130 00\n";
const denied = (target: string) => target.startsWith("Private/");

const viewOf = (raw: string) => {
  const places = withholdPlacesIn(ReaderView.of(raw)).view;
  const links = redactDeniedLinksIn(places, denied).view;
  return redactSensitiveIn(links, sensitiveFindings(links.text)).view;
};

describe("a reader's view of a note", () => {
  it("is what the three ways of withholding make of the text, step by step as before", () => {
    const places = withholdPlaces(RAW).text;
    const links = redactDeniedLinks(places, denied).text;
    const all = redactSensitive(links, sensitiveFindings(links)).text;
    expect(viewOf(RAW).text).toBe(all);
    expect(viewOf(RAW).text).not.toMatch(/Kowalski|Salary|52\.52|DE89/);
    expect(viewOf(RAW).withheldCount).toBe(4);
    expect(ReaderView.of(RAW).text).toBe(RAW);
    expect(ReaderView.of(RAW).withholds).toBe(false);
  });

  it("maps every part it shows back to the raw text, and no part it withholds", () => {
    const view = viewOf(RAW);
    const at = view.text.indexOf("for the numbers.");
    expect(view.toRaw(at, at + "for the numbers.".length)).toEqual({ from: RAW.indexOf("for the numbers."), to: RAW.indexOf("for the numbers.") + "for the numbers.".length });
    const placeholder = view.text.indexOf("⟦withheld note⟧");
    expect(view.toRaw(placeholder, placeholder + 3)).toBeNull();
    expect(view.toRaw(placeholder - 4, placeholder + 1)).toBeNull();
    // An empty range at a placeholder's edge touches nothing; one inside it does.
    expect(view.toRaw(placeholder, placeholder)).toEqual({ from: RAW.indexOf("[[Private/Salary 2026]]"), to: RAW.indexOf("[[Private/Salary 2026]]") });
    expect(view.toRaw(placeholder + 2, placeholder + 2)).toBeNull();
  });

  it("takes a change made on the view back to the raw text, and refuses one that touches a withheld part", () => {
    const view = viewOf(RAW);
    const changed = view.text.replace("for the numbers.", "for all numbers.").replace("# Pay\n", "# Pay 2026\n");
    expect(rawChangeOf(view, changed)).toBe(RAW.replace("for the numbers.", "for all numbers.").replace("# Pay\n", "# Pay 2026\n"));
    // The hidden parts stay as they were.
    expect(rawChangeOf(view, changed)).toContain("[[Private/Salary 2026|Kowalski]]");
    // Touching one — taking it away, editing next to and into it — is refused.
    expect(rawChangeOf(view, view.text.replace("See ⟦withheld note⟧ for", "See for"))).toBeNull();
    expect(rawChangeOf(view, view.text.replace("⟦withheld note⟧ for", "⟦withheld note⟧, for"))).not.toBeNull();
    expect(rawChangeOf(view, view.text.replace("withheld note⟧ for", "withheld note!⟧ for"))).toBeNull();
    // A placeholder never reaches the raw text, wherever it is put.
    expect(rawChangeOf(view, `${view.text}Copy: ⟦withheld note⟧\n`)).toBeNull();
    expect(rawChangeOf(view, view.text)).toBe(RAW);
  });

  it("keeps changes far apart apart, so a withheld part between them is not taken for touched", () => {
    const before = "a\nb ⟦withheld note⟧\nc\n";
    expect(diffHunks(before, "A\nb ⟦withheld note⟧\nC\n")).toEqual([
      { from: 0, to: 1, with: "A" },
      { from: before.indexOf("c"), to: before.indexOf("c") + 1, with: "C" },
    ]);
    const view = viewOf("a\nb [[Private/X]]\nc\n");
    expect(rawChangeOf(view, view.text.replace("a\n", "A\n").replace("c\n", "C\n"))).toBe("A\nb [[Private/X]]\nc\n".replace("c\n", "C\n"));
  });

  it("widens a replacement that reaches into a placeholder to the whole of it, and never cuts one", () => {
    const view = withholdPlacesIn(ReaderView.of("x\n📍 52.5, 13.4\ny\n")).view;
    const at = view.text.indexOf("place");
    const wider = view.replaceRanges([{ from: at, to: at + 2, with: "⟦other⟧" }]);
    expect(wider.text).toBe("x\n⟦other⟧\ny\n");
    expect(wider.toRaw(0, 1)).toEqual({ from: 0, to: 1 });
  });
});

describe("a search answered by a view", () => {
  const seen = "Pay\nProjects/Pay.md\n## Pay talk with ⟦withheld note⟧\nSee ⟦withheld note⟧ for the numbers.";
  it("finds a term only where the view holds it, and a term it excludes only there too", () => {
    expect(viewMatchesSearch(seen, "numbers")).toBe(true);
    expect(viewMatchesSearch(seen, "Kowalski")).toBe(false);
    expect(viewMatchesSearch(seen, "numbers -Kowalski")).toBe(true);
    expect(viewMatchesSearch(seen, "numbers -talk")).toBe(false);
    expect(viewMatchesSearch(seen, '"the numbers"')).toBe(true);
    expect(viewSearchSnippet(seen, "numbers")).toContain("numbers");
  });

  it("sends the index the query without the terms it excludes, and keeps path and tag", () => {
    expect(withoutExcludedSearchTerms('numbers -Kowalski -"a b" path:Projects -path:Archive tag:x -tag:y')).toBe("numbers path:Projects -path:Archive tag:x -tag:y");
    expect(excludedSearchTermSpecs("numbers -Kowalski").map((term) => term.text)).toEqual(["Kowalski"]);
  });
});
