/**
 * The words of a question that are worth a full-text search: what a person
 * asks in a sentence ("Where did I put the offer for Müller?") becomes the
 * few terms that can find a note ("offer", "müller"). Function words of the
 * ten app languages are dropped; everything else stays, in order, once.
 */

const STOPWORDS = new Set(
  [
    // en
    "the and for are but not you your yours with what when where which who whom why how this that these those there here from into onto about have has had was were been being does did can could would should will shall may might must also just than then them they their our ours out all any some more most other such only own same too very again once over under after before between through during without within want need find show tell give make please note notes",
    // de
    "der die das den dem des ein eine einen einem einer eines und oder aber nicht ist sind war waren wird werden wurde wurden hat haben hatte hatten mit von vom zum zur bei aus auf für über unter nach vor wie was wer wem wen wo wann warum welche welcher welches dies diese dieser dieses dass auch noch schon sehr mein meine meinen meinem meiner dein deine ihr ihre ich du er sie es wir man sich kann können könnte soll sollte muss müssen habe hast gibt zeige finde notiz notizen bitte",
    // es
    "los las una unos unas del que con por para como pero más este esta estos estas ese esa eso cuando donde quien cual cuál qué cómo mis tus sus nuestro nuestra hay tiene tengo puedo nota notas",
    // fr
    "les des une uns aux du au que qui quoi quand comment pour par avec dans sur sous mais plus ces cette cet mon mes ton tes son ses nos vos leur leurs est sont était avoir être fait faire peux peut note notes",
    // it
    "gli degli delle della dello una uno che chi cosa quando dove come perché per con tra fra nel nella negli nelle sul sulla sono era mio mia miei mie tuo tua suo sua nostro questo questa questi queste quello quella nota note",
    // nl
    "het een van voor met niet maar ook als dat die dit deze waar wanneer waarom hoe wat wie zijn was waren heeft hebben had mijn jouw zijn haar ons onze kan kunnen moet moeten notitie notities",
    // pl
    "jest są był była było czy nie tak jak gdzie kiedy dlaczego który która które mój moja moje twój twoja jego jej nasz dla przez przy oraz albo ale też już jeszcze notatka notatki",
    // pt
    "uma umas uns dos das com por para como mas mais este esta estes estas esse essa isso quando onde quem qual que meu minha meus minhas seu sua nossos tem tenho posso nota notas",
  ]
    .join(" ")
    .split(/\s+/),
);

/** Scripts written without spaces: every character run is already a word of its own. */
const SPACELESS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

export function questionTerms(question: string, max = 10): string[] {
  const out: string[] = [];
  for (const match of question.toLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)) {
    const word = match[0].replace(/['’_-]+$/u, "");
    const minimum = SPACELESS.test(word) ? 2 : 3;
    if (word.length < minimum || STOPWORDS.has(word) || /^\d{1,2}$/.test(word)) continue;
    if (!out.includes(word)) out.push(word);
    if (out.length >= max) break;
  }
  return out;
}
