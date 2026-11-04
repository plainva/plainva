import { describe, expect, it } from "vitest";
import { CARD_CHARS, cardText, contextCard, isProtected, sentencesOf } from "./cards.js";

const OFFER = [
  "## Costs",
  "",
  "We talked about the offer for a while. The rate stays at 95 EUR per hour until 31.12.2026. Travel is not included.",
  "Everyone liked the coffee. See [[Framework contract 2025]] for the old terms.",
  "- [ ] Send the offer 📅 2026-10-02",
  "- [x] Ask Tom",
  "",
  "A nice afternoon overall.",
].join("\n");

/** Plan KI-Harness P2b-2: context cards are verbatim — every protected fact stands as in the note. */
describe("context cards", () => {
  it("splits a line into sentences, not numbers", () => {
    expect(sentencesOf("The rate is 1.850 EUR. It stays! Really? 会议记录。第二句")).toEqual(["The rate is 1.850 EUR.", "It stays!", "Really?", "会议记录。", "第二句"]);
  });

  it("knows what a summary must never change, in the app's languages", () => {
    for (const s of ["Budget 1.850 €", "Frist: 02.10.", "Travel is not included", "Das ist nicht verhandelbar", "Ce n'est pas inclus", "No se incluye", "Non è incluso", "Não está incluído", "Dat is niet inbegrepen", "To nie jest wliczone", "含まれていない", "不包括差旅", "see https://example.org", "call @tom", "ask [[Tom]]", "run `npm test`"]) {
      expect(isProtected(s), s).toBe(true);
    }
    for (const s of ["Everyone liked the coffee.", "Alle mochten den Kaffee.", "A nice afternoon overall.", "Nothingness is a word."]) {
      expect(isProtected(s), s).toBe(false);
    }
  });

  it("keeps the first sentence and every protected sentence and task, verbatim and in order", () => {
    const card = contextCard(OFFER, "Offer > Costs");
    expect(card.lines).toEqual([
      "We talked about the offer for a while.",
      "The rate stays at 95 EUR per hour until 31.12.2026.",
      "Travel is not included.",
      "See [[Framework contract 2025]] for the old terms.",
      "- [ ] Send the offer 📅 2026-10-02",
      "- [x] Ask Tom",
    ]);
    // Every line is a verbatim span of the note: nothing paraphrased, nothing shortened.
    for (const line of card.lines) expect(OFFER).toContain(line);
    expect(card.sourceChars).toBe(OFFER.length);
  });

  it("leaves out whole sentences past its budget, and says how many", () => {
    const card = contextCard(OFFER, "Offer > Costs", 100);
    expect(card.lines).toEqual(["We talked about the offer for a while.", "The rate stays at 95 EUR per hour until 31.12.2026."]);
    expect(card.omitted).toBe(4);
    expect(cardText(card)).toBe("We talked about the offer for a while. The rate stays at 95 EUR per hour until 31.12.2026. […4 more in read_note]");
  });

  it("sends a long first sentence whole rather than cutting it", () => {
    const long = `${"word ".repeat(80).trim()}.`;
    expect(contextCard(long, "", CARD_CHARS).lines).toEqual([long]);
  });

  it("keeps code as it is", () => {
    const card = contextCard("Run this:\n```\nnpm run build\n```\nThen smile.", "");
    expect(card.lines).toEqual(["Run this:", "npm run build"]);
  });
});
