import { describe, expect, it } from "vitest";
import { measureStyle, STYLE_ADDRESS_WORDS, STYLE_FEATURE_KEYS, STYLE_MIN_WORDS, styleFeaturesWithout, styleLine, type StyleFeature } from "./writingStyle.js";

/** A note of the user's: properties, headings, short paragraphs, lists, "du" — and what never counts: code and a quote. */
const WEEKLY = [
  "---",
  "tags: [projekt]",
  "mood: müde",
  "---",
  "# Wochennotiz 41",
  "",
  "Ich habe heute mit dem Studio gesprochen. Du kannst die Termine morgen prüfen.",
  "",
  "Das Budget steht noch nicht fest. Wir warten auf die Zahlen vom Verleih.",
  "",
  "## Offen",
  "- Termine für den zweiten Block klären",
  "- Budget mit dir abstimmen",
  "- Tonmischung: wer bezahlt das?",
  "- Drehplan für den Winter schreiben",
  "",
  "Ich schicke dir die Liste am Abend. Dann sehen wir weiter, z. B. am 3. März im Büro.",
  "",
  "Kannst du mir sagen, ob das passt? Ich brauche die Antwort bis Freitag.",
  "",
  "## Notizen",
  "Der Kunde will mehr Bilder vom Hafen. Das ist gut für uns. Wir haben genug Material.",
  "",
  "Die Kamera ist noch beim Verleih. Ich hole sie morgen ab, wenn du Zeit hast.",
  "",
  "- Kamera abholen",
  "- Akkus laden",
  "- Speicherkarten prüfen",
  "",
  "```js",
  "const secret = 'Quokka Quokka Quokka Quokka Quokka Quokka';",
  "```",
  "> Ein Zitat zählt nicht: Sie sind herzlich eingeladen, Quokka.",
  "",
  "| Spalte | Quokka |",
  "| --- | --- |",
  "",
  "Am Ende des Tages ist alles fertig. Ich bin zufrieden mit dem Stand. Du auch?",
].join("\n");

const repeat = (paragraph: string, times: number) => Array.from({ length: times }, () => paragraph).join("\n\n");
const feature = (features: readonly StyleFeature[], key: StyleFeature["key"]) => features.find((candidate) => candidate.key === key);

describe("measureStyle", () => {
  it("measures how a note is built: sentences, paragraphs, lists, headings, address, and what it does not use", () => {
    const measure = measureStyle([WEEKLY, WEEKLY.replace("41", "42")]);
    expect(measure.tooShort).toBe(false);
    const { features } = measure;
    expect(feature(features, "sentences")).toMatchObject({ value: "short", unit: "words" });
    expect(feature(features, "paragraphs")).toMatchObject({ value: "short" });
    expect(feature(features, "lists")).toMatchObject({ value: "lists" });
    expect(feature(features, "headings")).toMatchObject({ value: "headings" });
    // "du", "dir", "Du" — six in each note; the quoted "Sie" is not the user's.
    expect(feature(features, "address")).toEqual({ key: "address", value: "informal", language: "de", informal: 12, formal: 0 });
    expect(feature(features, "emphasis")).toMatchObject({ value: "none" });
    expect(feature(features, "emoji")).toMatchObject({ value: "none" });
    expect(feature(features, "exclamations")).toMatchObject({ value: "rare", count: 0 });
    expect(feature(features, "dashes")).toMatchObject({ value: "none" });
    // In the order a view lists them.
    expect(features.map((f) => f.key)).toEqual(STYLE_FEATURE_KEYS.filter((key) => features.some((f) => f.key === key)));
  });

  it("keeps nothing of the text: no feature and no line carries a word of a note", () => {
    const { features } = measureStyle([WEEKLY, WEEKLY]);
    const said = JSON.stringify(features) + features.map(styleLine).join("\n");
    for (const word of ["Quokka", "Studio", "Budget", "Kamera", "Hafen", "Wochennotiz", "projekt", "müde"]) expect(said).not.toContain(word);
  });

  it("measures nothing in too little text, and code, quotes, tables and properties are no text", () => {
    expect(measureStyle(["Ein kurzer Satz. Noch einer."])).toEqual({ features: [], words: 5, tooShort: true });
    const code = ["---", `about: ${"word ".repeat(200)}`, "---", "```", "word ".repeat(300), "```", `> ${"quoted ".repeat(200)}`, `| ${"cell ".repeat(200)} |`, "Kurz."].join("\n");
    const measure = measureStyle([code]);
    expect(measure.tooShort).toBe(true);
    expect(measure.words).toBeLessThan(STYLE_MIN_WORDS);
  });

  it("does not end a sentence at an abbreviation, a single letter or a day's number", () => {
    const text = repeat("Wir treffen uns z. B. am 3. März im Büro, ca. zehn Leute bzw. mehr. Das reicht uns.", 10);
    // Two sentences a paragraph, not six: "z.", "B.", "3." and "ca." end none.
    expect(feature(measureStyle([text]).features, "paragraphs")).toEqual({ key: "paragraphs", value: "short", sentences: 2 });
  });

  it("tells running text from lists, and long sentences from short ones", () => {
    const prose = repeat(
      "Wir haben heute lange über den Ablauf der Arbeiten gesprochen, und am Ende waren wir uns einig, dass der zweite Block noch vor dem Winter fertig werden muss. Danach kommt die Mischung, für die wir noch ein Studio suchen und für die wir ein eigenes Budget brauchen werden.",
      8,
    );
    const { features } = measureStyle([prose]);
    expect(feature(features, "sentences")).toMatchObject({ value: "long", unit: "words" });
    expect(feature(features, "lists")).toBeUndefined();
    const lines = [prose, ...Array.from({ length: 16 }, (_, i) => `Zeile ${i}: wir arbeiten weiter und sehen dann, was noch fehlt.`)].join("\n");
    expect(feature(measureStyle([lines]).features, "lists")).toEqual({ key: "lists", value: "prose", share: 0 });
    expect(feature(measureStyle([lines]).features, "headings")).toMatchObject({ value: "none" });
  });

  it("counts bold, emojis, exclamation marks and dashes", () => {
    const loud = repeat("Heute war ein guter Tag 🎉 und wir haben viel geschafft! Morgen geht es weiter mit **Block zwei** und dem Rest 😊.", 10);
    const { features } = measureStyle([loud]);
    expect(feature(features, "emphasis")).toEqual({ key: "emphasis", value: "often", count: 10, words: 200 });
    expect(feature(features, "emoji")).toEqual({ key: "emoji", value: "often", count: 20, words: 200 });
    expect(feature(features, "exclamations")).toMatchObject({ value: "often", count: 10 });
    const asides = repeat("Das Studio ist gut — nur etwas teuer. Wir nehmen es trotzdem – vielleicht. Mal sehen - es wird schon.", 5);
    expect(feature(measureStyle([asides, WEEKLY]).features, "dashes")).toMatchObject({ value: "dashes", count: 15 });
    // One emoji in a long text is rare; a family of people joined into one is one emoji; © is none.
    const quiet = `${repeat("Wir arbeiten weiter an dem Plan und schauen dann, was noch fehlt.", 30)}\n\nDanke 👨‍👩‍👧 und © 2026.`;
    expect(feature(measureStyle([quiet]).features, "emoji")).toMatchObject({ value: "rare", count: 1 });
  });
});

describe("the address, in the language the examples are written in", () => {
  it("counts German formal address only where it is formal: capitalised, inside a sentence", () => {
    const formal = repeat(
      "Sehr geehrte Frau Berg, vielen Dank für Ihre Nachricht. Gern sende ich Ihnen das Angebot bis zum Ende der Woche, damit Sie es in Ruhe prüfen können. Sie erreichen mich jederzeit im Büro, und sie (die Kollegen) auch.",
      6,
    );
    // "Ihre", "Ihnen", "Sie" in each paragraph; the "Sie" that opens a sentence and the lower-case "sie" do not count.
    expect(feature(measureStyle([formal]).features, "address")).toEqual({ key: "address", value: "formal", language: "de", informal: 0, formal: 18 });
  });

  it("does not read French \"du\" as German address", () => {
    const french = repeat("Je pense que tu as raison sur ce point. Est-ce que tu peux m'envoyer les chiffres du mois dernier ? Je voudrais du pain et des croissants pour la réunion avec toi, et t'aider.", 5);
    expect(feature(measureStyle([french]).features, "address")).toEqual({ key: "address", value: "informal", language: "fr", informal: 20, formal: 0 });
  });

  it("knows Dutch, Spanish, Italian, Portuguese, Polish and Chinese address", () => {
    const cases: [string, string, "informal" | "formal"][] = [
      ["nl", "Hartelijk dank voor uw bericht van gisteren. Wij hebben het voorstel bekeken en willen u graag een nieuwe offerte sturen. Het is voor ons belangrijk dat alles op tijd klaar is.", "formal"],
      ["es", "Hola, ¿qué tal? Te escribo porque quiero saber si tú tienes tiempo mañana. Hay una reunión con el equipo y me gustaría que vinieras, pero dime algo pronto para que lo sepa.", "informal"],
      ["it", "Gentile signora, La ringrazio per il Suo messaggio di ieri. Le invio il preventivo entro venerdì, così potrà valutarlo con calma. Lei è sempre la benvenuta e lei lo sa bene.", "formal"],
      ["pt", "Muito obrigado pela sua mensagem. O senhor pode enviar os documentos até sexta-feira? Nós já temos tudo pronto, e o senhor vai receber a confirmação ainda hoje. Você também pode ligar.", "formal"],
      ["pl", "Dziękuję bardzo za wiadomość z wczoraj. Czy może Pan przesłać dokumenty do piątku? Wszystko jest już gotowe na spotkanie, a Pan otrzyma potwierdzenie jeszcze dzisiaj.", "formal"],
      ["zh", "感谢您的来信。我们已经收到了您发送的资料，会尽快处理。如果您有任何问题，请随时联系我们。", "formal"],
    ];
    for (const [language, paragraph, value] of cases) {
      const address = feature(measureStyle([repeat(paragraph, 8)]).features, "address");
      expect(address, language).toMatchObject({ key: "address", value, language });
    }
  });

  it("gives English and Japanese no address — they do not show it in such words", () => {
    const english = repeat("I talked to the studio today and they have the dates for the second block. You can check them tomorrow if that works for you, and you can tell me then.", 8);
    expect(feature(measureStyle([english]).features, "address")).toBeUndefined();
    const japanese = repeat("今日はスタジオと打ち合わせをしました。明日の予定を確認してください。予算はまだ決まっていません。", 8);
    const { features } = measureStyle([japanese]);
    expect(feature(features, "address")).toBeUndefined();
    // Japanese and Chinese are measured in characters.
    expect(feature(features, "sentences")).toMatchObject({ unit: "chars" });
  });

  it("names the two words of each language it knows", () => {
    expect(STYLE_ADDRESS_WORDS.de).toEqual({ informal: "du", formal: "Sie", name: "German" });
    expect(Object.keys(STYLE_ADDRESS_WORDS).sort()).toEqual(["de", "es", "fr", "it", "nl", "pl", "pt", "zh"]);
  });
});

describe("what a model is told", () => {
  it("is one plain line per feature, written from the numbers", () => {
    expect(styleLine({ key: "sentences", value: "short", unit: "words", length: 9 })).toBe("Sentences: short, about 9 words each.");
    expect(styleLine({ key: "sentences", value: "medium", unit: "chars", length: 22 })).toBe("Sentences: medium-length, about 22 characters each.");
    expect(styleLine({ key: "paragraphs", value: "short", sentences: 1 })).toBe("Paragraphs: short, about 1 sentence each.");
    expect(styleLine({ key: "lists", value: "lists", share: 38 })).toBe("Prefers lists: about 38% of the lines are list items.");
    expect(styleLine({ key: "headings", value: "none", words: 400 })).toBe("Uses no headings.");
    expect(styleLine({ key: "address", value: "formal", language: "de", informal: 0, formal: 9 })).toBe('Addresses people formally (in German: "Sie", not "du").');
    expect(styleLine({ key: "address", value: "informal", language: "fr", informal: 9, formal: 0 })).toBe('Addresses people informally (in French: "tu", not "vous").');
    expect(styleLine({ key: "dashes", value: "none", count: 0, sentences: 30 })).toBe("Uses no dashes (— or –) for asides.");
  });

  it("leaves out what the user took out", () => {
    const { features } = measureStyle([WEEKLY, WEEKLY]);
    const kept = styleFeaturesWithout(features, ["address", "lists"]);
    expect(kept.map((f) => f.key)).not.toContain("address");
    expect(kept.map((f) => f.key)).not.toContain("lists");
    expect(kept).toHaveLength(features.length - 2);
  });
});
