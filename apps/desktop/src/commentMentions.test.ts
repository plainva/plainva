import { describe, it, expect } from "vitest";
import {
  applyMention,
  mentionQuery,
  mentionedMemberIds,
  mentionsMember,
  parseCommentMentions,
} from "@plainva/ui";

/**
 * What `@Name` in a comment must not get wrong (Stufe D, D8).
 *
 * Mentions are derived from the body, never stored - so every rule below is a
 * rule about reading TEXT, and each assertion stands for something that would
 * fail quietly: a name that lights up inside a longer one addresses the wrong
 * person, an e-mail address read as a mention notifies a stranger, and an
 * ambiguous name resolved to exactly one member reaches one of two people while
 * looking like it reached the right one.
 */

const anna = "1111111111111111";
const annabelle = "2222222222222222";
const annaFull = "3333333333333333";
const bo = "4444444444444444";

const names = (entries: Array<[string, string]>) => new Map(entries);

const TEAM = names([
  [anna, "Anna"],
  [annabelle, "Annabelle"],
  [bo, "Bo"],
]);

/** Every segment concatenated must be the body again - byte for byte. */
function roundTrip(body: string, map: ReadonlyMap<string, string>): string {
  return parseCommentMentions(body, map)
    .map((s) => s.text)
    .join("");
}

describe("parseCommentMentions", () => {
  it("splits a mention out of the surrounding text", () => {
    const segments = parseCommentMentions("Bitte @Anna schauen", TEAM);
    expect(segments).toEqual([
      { kind: "text", text: "Bitte " },
      { kind: "mention", text: "@Anna", memberId: anna },
      { kind: "text", text: " schauen" },
    ]);
  });

  it("never loses a character, whatever the body looks like", () => {
    for (const body of [
      "",
      "kein Name hier",
      "@Anna",
      "@Anna @Bo",
      "  @Anna, @Bo!  ",
      "mail@anna.example @Bo",
      "@Unbekannt bleibt Text",
    ]) {
      expect(roundTrip(body, TEAM)).toBe(body);
    }
  });

  it("does not light up inside a longer name", () => {
    // "Anna" is a member and so is "Annabelle": reading the short one inside the
    // long one would address the wrong person on every single mention.
    const segments = parseCommentMentions("@Annabelle bitte", TEAM);
    expect(segments[0]).toEqual({ kind: "mention", text: "@Annabelle", memberId: annabelle });
  });

  it("does not light up inside a longer word that is nobody", () => {
    // Only "Anna" is a member here, so nothing longer can win the match - the
    // guard that the name has to END the word is the only thing keeping this
    // from addressing a person the writer never named.
    const map = names([[anna, "Anna"]]);
    expect(parseCommentMentions("@Annabelle bitte", map)).toEqual([
      { kind: "text", text: "@Annabelle bitte" },
    ]);
    expect(mentionedMemberIds("@Annabelle", map).size).toBe(0);
  });

  it("prefers the longer name when one is a prefix of the other", () => {
    const map = names([
      [anna, "Anna"],
      [annaFull, "Anna Beispiel"],
    ]);
    expect(parseCommentMentions("@Anna Beispiel bitte", map)[0]).toEqual({
      kind: "mention",
      text: "@Anna Beispiel",
      memberId: annaFull,
    });
    // ...and the short one still works on its own.
    expect(parseCommentMentions("@Anna bitte", map)[0]).toEqual({
      kind: "mention",
      text: "@Anna",
      memberId: anna,
    });
  });

  it("keeps the spelling that was typed", () => {
    // The column shows what is in the file. A difference in case is not an error
    // worth correcting behind somebody's back.
    expect(parseCommentMentions("@anna", TEAM)[0]).toEqual({
      kind: "mention",
      text: "@anna",
      memberId: anna,
    });
  });

  it("ignores an @ that is not at a word boundary", () => {
    // An address is not a mention - otherwise writing down a contact notifies a
    // colleague who was never meant to hear about it.
    expect(parseCommentMentions("schreib an bo@anna.example", TEAM)).toEqual([
      { kind: "text", text: "schreib an bo@anna.example" },
    ]);
  });

  it("leaves an unknown name as plain text", () => {
    // Remove somebody from the policy and the highlight falls away - the typed
    // text stays exactly as written.
    expect(parseCommentMentions("@Ehemalig bitte", TEAM)).toEqual([
      { kind: "text", text: "@Ehemalig bitte" },
    ]);
  });

  it("never offers a name that could not be typed back as one mention", () => {
    const map = names([
      [anna, "Anna\nZweite Zeile"],
      [bo, "Bo@Example"],
    ]);
    expect(parseCommentMentions("@Anna und @Bo", map)).toEqual([{ kind: "text", text: "@Anna und @Bo" }]);
  });

  it("renders an ambiguous name deterministically", () => {
    const map = names([
      [anna, "Anna"],
      [annaFull, "Anna"],
    ]);
    expect(parseCommentMentions("@Anna", map)[0]).toEqual({
      kind: "mention",
      text: "@Anna",
      memberId: anna,
    });
  });
});

describe("mentionedMemberIds", () => {
  it("returns every member an ambiguous name could mean", () => {
    // Rendering has to pick one. Notifying must not: reaching one of two people
    // while looking like it reached the right one is the worse failure.
    const map = names([
      [anna, "Anna"],
      [annaFull, "Anna"],
    ]);
    expect([...mentionedMemberIds("@Anna", map)].sort()).toEqual([anna, annaFull].sort());
  });

  it("collects several mentions in one body", () => {
    expect([...mentionedMemberIds("@Anna und @Bo", TEAM)].sort()).toEqual([anna, bo].sort());
  });
});

describe("mentionsMember", () => {
  it("finds the member in any body of a thread", () => {
    expect(mentionsMember(["Frage?", "ja, @Bo weiss das"], bo, TEAM)).toBe(true);
    expect(mentionsMember(["Frage?", "ja, @Bo weiss das"], anna, TEAM)).toBe(false);
  });

  it("is false without an own id", () => {
    // A device that cannot say who it is must not claim every mention is for it.
    expect(mentionsMember(["@Anna"], null, TEAM)).toBe(false);
  });
});

describe("mentionQuery", () => {
  const at = (body: string, map = TEAM) => mentionQuery(body, body.length, map);

  it("offers the members after a bare @", () => {
    expect(at("Bitte @")?.matches.map((m) => m.name)).toEqual(["Anna", "Annabelle", "Bo"]);
  });

  it("narrows as the name is typed", () => {
    expect(at("Bitte @An")?.matches.map((m) => m.name)).toEqual(["Anna", "Annabelle"]);
    expect(at("Bitte @Anna")?.matches.map((m) => m.name)).toEqual(["Anna", "Annabelle"]);
  });

  it("matches a later word of a name after the full-name matches", () => {
    const map = names([
      [annaFull, "Anna Beispiel"],
      [bo, "Bo Beispiel"],
    ]);
    expect(at("@Beispiel", map)?.matches.map((m) => m.name)).toEqual(["Anna Beispiel", "Bo Beispiel"]);
  });

  it("spans as many words as the longest known name has", () => {
    const map = names([[annaFull, "Anna Maria Beispiel"]]);
    expect(at("@Anna Maria", map)?.matches.map((m) => m.name)).toEqual(["Anna Maria Beispiel"]);
    // One word past the longest name nothing could match any more, so the picker
    // gets out of the way instead of hanging over a whole sentence.
    expect(at("@Anna Maria Beispiel hat", map)).toBeNull();
  });

  it("stops at a line break", () => {
    expect(at("@Anna\nnaechste Zeile")).toBeNull();
  });

  it("stops at a second @", () => {
    expect(at("@Anna @")?.query).toBe("");
    expect(at("@Anna@Bo")).toBeNull();
  });

  it("says nothing without members", () => {
    expect(at("@An", new Map())).toBeNull();
  });

  it("says nothing when no name matches", () => {
    expect(at("@Zzz")).toBeNull();
  });

  it("reports the range the @ occupies", () => {
    const q = at("Bitte @An");
    expect(q?.from).toBe(6);
    expect(q?.to).toBe(9);
    expect(q?.query).toBe("An");
  });
});

describe("applyMention", () => {
  it("writes the name and leaves the caret behind it", () => {
    const body = "Bitte @An";
    const range = mentionQuery(body, body.length, TEAM)!;
    expect(applyMention(body, range, "Annabelle")).toEqual({
      body: "Bitte @Annabelle ",
      caret: "Bitte @Annabelle ".length,
    });
  });

  it("does not add a second space", () => {
    const body = "Bitte @An schauen";
    const range = mentionQuery(body, 9, TEAM)!;
    expect(applyMention(body, range, "Anna").body).toBe("Bitte @Anna schauen");
  });

  it("produces a body the parser reads back as that mention", () => {
    // The round trip is the point: what the picker writes must be what the
    // column highlights, or picking a name would silently produce plain text.
    const body = "Bitte @An";
    const range = mentionQuery(body, body.length, TEAM)!;
    const next = applyMention(body, range, "Annabelle");
    expect(mentionedMemberIds(next.body, TEAM)).toEqual(new Set([annabelle]));
  });
});
