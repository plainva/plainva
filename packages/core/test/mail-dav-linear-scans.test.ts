import { describe, expect, it } from "vitest";
import { hasEmlWikiLink, nameBeforeAngle } from "../src/mailText.js";
import { splitAtWordTags, tagAttributeWords, wordTagContent } from "../src/pim/davTagScan.js";
import { parsePimErrorBody } from "../src/pim/requestError.js";

/**
 * Mail headers and CalDAV answers are read in linear time (plan Befunde 24.09.,
 * E6). Both come from servers nobody here controls, and each hostile case below
 * is what an old pattern needed quadratic or cubic time for: a long run it
 * could split several ways, then something that made the match fail. The
 * readers' behaviour is pinned by their own tests (pim-caldav, threading,
 * the mail views), which ran unchanged; the pins here name the quirks the
 * scans keep on purpose.
 */
const N = 100_000;
const within = (budgetMs: number, run: () => void) => {
  const start = performance.now();
  run();
  expect(performance.now() - start).toBeLessThan(budgetMs);
};

describe("nameBeforeAngle", () => {
  it("reads the display name in front of an angle address", () => {
    expect(nameBeforeAngle('"Ada Lovelace" <ada@example.org>', true)).toBe("Ada Lovelace");
    expect(nameBeforeAngle("Ada <ada@example.org>  ", true)).toBe("Ada");
    expect(nameBeforeAngle("\u00a0Ada\u00a0<a@b>", true)).toBe("Ada");
    expect(nameBeforeAngle("ada@example.org")).toBeUndefined();
  });

  it("with `whole`, the address has to close and end the value", () => {
    expect(nameBeforeAngle("Ada <ada@x> and more", true)).toBeUndefined();
    expect(nameBeforeAngle("Ada <ada@x", true)).toBeUndefined();
    expect(nameBeforeAngle("Ada <ada@x> and more")).toBe("Ada");
    expect(nameBeforeAngle("Ada <ada@x")).toBe("Ada");
  });

  it("keeps the lazy group's quirks: blanks alone give the last blank, quotes stay out", () => {
    expect(nameBeforeAngle("   <a@b>", true)).toBe(" ");
    expect(nameBeforeAngle(' \t"<a@b>')).toBe("\t");
    expect(nameBeforeAngle('"" <a@b>')).toBeUndefined();
    expect(nameBeforeAngle('Ada "L" <a@b>')).toBeUndefined();
    expect(nameBeforeAngle('"Ada" x <a@b>')).toBeUndefined();
    expect(nameBeforeAngle("<a@b>")).toBeUndefined();
  });

  it("stays linear on a long run of blanks", () => {
    const blanks = " ".repeat(N);
    within(1_000, () => expect(nameBeforeAngle(blanks + "!", true)).toBeUndefined());
    within(1_000, () => expect(nameBeforeAngle(blanks + "!")).toBeUndefined());
    within(1_000, () => expect(nameBeforeAngle(`a${blanks}"${blanks}<b> x`, true)).toBeUndefined());
    within(1_000, () => expect(nameBeforeAngle(`"${blanks}a${blanks}"${blanks}<b>${blanks}`, true)).toBe(`${blanks}a${blanks}`));
  });
});

describe("hasEmlWikiLink", () => {
  it("finds a wiki link to a raw message copy", () => {
    expect(hasEmlWikiLink("Body\n\n[[Mail/2026-09-24 Offer.eml]]\n")).toBe(true);
    expect(hasEmlWikiLink("[[a.EmL]]")).toBe(true);
    expect(hasEmlWikiLink("[[[x.eml]]")).toBe(true);
    expect(hasEmlWikiLink("[[.eml]]")).toBe(false);
    expect(hasEmlWikiLink("[[a]b.eml]]")).toBe(false);
    expect(hasEmlWikiLink("[[x.eml]")).toBe(false);
    expect(hasEmlWikiLink("[[x.emls]]")).toBe(false);
  });

  it("stays linear on a long run of brackets", () => {
    within(1_000, () => expect(hasEmlWikiLink("[".repeat(N))).toBe(false));
    within(1_000, () => expect(hasEmlWikiLink(`[[${"a".repeat(N)}.eml]`)).toBe(false));
    within(1_000, () => expect(hasEmlWikiLink(`${"[".repeat(N)}x.eml]]`)).toBe(true));
  });
});

describe("CalDAV tag scans", () => {
  it("splits at response tags only", () => {
    expect(splitAtWordTags("a<d:response>b</D:RESPONSE>c", "response")).toEqual(["a", "b", "c"]);
    expect(splitAtWordTags("<d:responsedescription>x</d:responsedescription>", "response")).toEqual(["<d:responsedescription>x</d:responsedescription>"]);
    expect(splitAtWordTags("<<d:response>x", "response")).toEqual(["", "x"]);
  });

  it("reads the first href's content, lazily", () => {
    expect(wordTagContent("<d:href> /cal/a/ </d:href><d:href>/b/</d:href>", "href")).toBe(" /cal/a/ ");
    expect(wordTagContent("<d:href>/cal/a/", "href")).toBeUndefined();
    expect(wordTagContent("<href>a<href>b</href>", "href")).toBe("a<href>b");
  });

  it("reads component names in either quoting, the last name attribute of a tag winning", () => {
    expect(tagAttributeWords(`<c:comp name="VEVENT"/><C:comp name='vtodo'/>`, "comp", "name")).toEqual(["VEVENT", "vtodo"]);
    expect(tagAttributeWords("<c:comp name='A' name='B'/>", "comp", "name")).toEqual(["B"]);
    expect(tagAttributeWords("<c:comp\nname = VJOURNAL", "comp", "name")).toEqual(["VJOURNAL"]);
    expect(tagAttributeWords("<c:x name='A'/><c:comps name='B'/>", "comp", "name")).toEqual([]);
  });

  it("stays linear on a long run of angle brackets", () => {
    within(1_000, () => expect(splitAtWordTags(`${"<".repeat(N)}>`, "response")).toHaveLength(1));
    within(1_000, () => expect(wordTagContent(`${"<".repeat(N)}>`, "href")).toBeUndefined());
    within(1_000, () => expect(wordTagContent(`<href>${"</".repeat(N)}>`, "href")).toBeUndefined());
    within(1_000, () => expect(tagAttributeWords("<".repeat(N), "comp", "name")).toEqual([]));
    within(1_000, () => expect(tagAttributeWords(`<comp${" name".repeat(N / 5)}`, "comp", "name")).toEqual([]));
  });
});

describe("parsePimErrorBody", () => {
  it("strips markup from a plain answer; an empty <> stays", () => {
    expect(parsePimErrorBody("<html><body><h1>403 Forbidden</h1></body></html>")).toEqual({ code: null, message: "403 Forbidden" });
    expect(parsePimErrorBody("a <> b")).toEqual({ code: null, message: "a <> b" });
  });

  it("stays linear on a long run of angle brackets", () => {
    within(1_000, () => expect(parsePimErrorBody("<".repeat(N)).message).toHaveLength(300));
  });
});
