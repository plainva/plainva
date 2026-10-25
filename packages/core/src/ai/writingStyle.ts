import { noteBodyOf } from "../frontmatter-block.js";

/**
 * The user's writing style (plan KI-Harness P9-3, § 18; ADR 0035): what this
 * device measures in notes the user chose as examples — how long sentences
 * and paragraphs are, lists or running text, headings, how people are
 * addressed, bold, emojis, exclamation marks and dashes.
 *
 * No model, nothing sent: the numbers are counted here. No word, no phrase
 * and no vocabulary is kept — nothing that would make one person's writing
 * recognisable, only how a text is built. What a model is told of it are a
 * few lines the app writes itself from those numbers (`styleLine`), and only
 * in a conversation where the user chose it.
 */

/** The features, in the order a view lists them; each one the user can take out on its own. */
export const STYLE_FEATURE_KEYS = ["sentences", "paragraphs", "lists", "headings", "address", "emphasis", "emoji", "exclamations", "dashes"] as const;
export type StyleFeatureKey = (typeof STYLE_FEATURE_KEYS)[number];

/** The languages of Plainva whose address shows in its words — German "du" and "Sie", French "tu" and "vous" … */
export const STYLE_ADDRESS_LANGUAGES = ["de", "nl", "fr", "es", "it", "pt", "pl", "zh"] as const;
export type StyleAddressLanguage = (typeof STYLE_ADDRESS_LANGUAGES)[number];

/**
 * One measured feature: what it says (`value`) and the numbers it rests on,
 * which a view shows beside it. Every value is one of a few words, so a view
 * and the model's line are written from the same thing.
 */
export type StyleFeature =
  | { key: "sentences"; value: "short" | "medium" | "long"; unit: "words" | "chars"; length: number }
  | { key: "paragraphs"; value: "short" | "long"; sentences: number }
  | { key: "lists"; value: "lists" | "prose"; share: number }
  | { key: "headings"; value: "headings"; wordsPerHeading: number }
  | { key: "headings"; value: "none"; words: number }
  | { key: "address"; value: "informal" | "formal"; language: StyleAddressLanguage; informal: number; formal: number }
  | { key: "emphasis"; value: "none" | "often"; count: number; words: number }
  | { key: "emoji"; value: "none" | "rare" | "often"; count: number; words: number }
  | { key: "exclamations"; value: "rare" | "often"; count: number; sentences: number }
  | { key: "dashes"; value: "dashes" | "none"; count: number; sentences: number };

export interface StyleMeasure {
  /** What stands out, in the order of `STYLE_FEATURE_KEYS`. */
  features: StyleFeature[];
  /** How much text the examples hold, in words; two characters of Chinese or Japanese count as one. */
  words: number;
  /** Too little text to say anything: fewer than `STYLE_MIN_WORDS` words in all. */
  tooShort: boolean;
}

/** Below this many words the examples say nothing reliable, and nothing is measured. */
export const STYLE_MIN_WORDS = 100;
/** At most this many examples. */
export const STYLE_EXAMPLES_MAX = 8;
/** Of a long note, its beginning is measured: enough to show how it is written, and a measurement stays quick. */
export const STYLE_EXAMPLE_CHARS = 40_000;

/** The two words of address a view and a model name, and the language's English name. */
export const STYLE_ADDRESS_WORDS: Readonly<Record<StyleAddressLanguage, { informal: string; formal: string; name: string }>> = {
  de: { informal: "du", formal: "Sie", name: "German" },
  nl: { informal: "jij", formal: "u", name: "Dutch" },
  fr: { informal: "tu", formal: "vous", name: "French" },
  es: { informal: "tú", formal: "usted", name: "Spanish" },
  it: { informal: "tu", formal: "Lei", name: "Italian" },
  pt: { informal: "tu", formal: "o senhor", name: "Portuguese" },
  pl: { informal: "ty", formal: "Pan", name: "Polish" },
  zh: { informal: "你", formal: "您", name: "Chinese" },
};

const words = (list: string): ReadonlySet<string> => new Set(list.split(" "));

/**
 * Frequent words of a language that few of the others share — what tells
 * which language an example is written in. English is here so that an English
 * text is recognised as one: it has no address in words, and gets none.
 */
const LANGUAGE_MARKS: Readonly<Record<"en" | Exclude<StyleAddressLanguage, "zh">, ReadonlySet<string>>> = {
  en: words("the and of that it for with are this have not you what be from they but has which would there their been were can about all if"),
  de: words("der die das und ist nicht ich ein eine zu mit auf für sich den dem von auch wir wie aber noch oder wenn dass nach bei hat sind wird schon nur mal mir uns haben kann werden"),
  nl: words("het een van niet dat op met voor zijn maar ook er als aan bij nog wel dan naar om wat heeft deze dit wordt moet geen worden hebben mijn wij hij zij ik"),
  fr: words("les et est une des pas qui dans pour sur avec ce elle au aux sont plus nous cette être très ont été fait comme leur sa son ses ces était"),
  es: words("el los las y más pero muy también hay ya fue sin puede cuando donde sus eso esto aquí ahora hace tiene"),
  it: words("il gli è di che non per della sono anche più questo questa nel alla dei delle molto ho hanno essere perché già così degli nella sul"),
  pt: words("os é uma não em com mas são também isso muito você ele ela já foi tem seu sua pelo pela ao aos às onde então isto aqui nós eles elas ainda depois"),
  pl: words("w z nie się jest że jak ale po tak za od przez już tylko może są czy dla oraz jego jej był była było będzie tym tego który która które bardzo gdzie kiedy mnie"),
};

interface AddressRule {
  /** Words of informal address, in lower case. A word that ends in an apostrophe matches as a prefix ("t'" in "t'aime"). */
  informal: ReadonlySet<string>;
  /** Words of formal address, in lower case. */
  formal: ReadonlySet<string>;
  /** A formal word counts only capitalised, and not at the start of a sentence — German "Sie", Italian "Lei", Polish "Pan". */
  capital?: true;
  /** A formal word counts only after one of these — Portuguese "o senhor". */
  after?: ReadonlySet<string>;
}

const ADDRESS_RULES: Readonly<Record<Exclude<StyleAddressLanguage, "zh">, AddressRule>> = {
  de: { informal: words("du dich dir dein deine deinen deinem deiner deines euch euer eure euren eurem eurer eures"), formal: words("sie ihnen ihr ihre ihren ihrem ihrer ihres"), capital: true },
  nl: { informal: words("je jij jou jouw jullie"), formal: words("u uw") },
  fr: { informal: words("tu toi te ton ta tes t' t’"), formal: words("vous votre vos") },
  es: { informal: words("tú te ti contigo tu tus tuyo tuya tuyos tuyas vosotros vosotras"), formal: words("usted ustedes ud uds vd vds") },
  it: { informal: words("tu ti te tuo tua tuoi tue"), formal: words("lei le la suo sua suoi sue"), capital: true },
  // "você" is the everyday address in Brazil and a polite one in Portugal: it counts as neither.
  pt: { informal: words("tu te ti contigo teu tua teus tuas"), formal: words("senhor senhora senhores senhoras"), after: words("o a os as") },
  pl: {
    informal: words("ty cię ciebie tobie tobą twój twoja twoje twojego twojej twoim twoją twoich twoimi"),
    formal: words("pan pani pana panu panem panią państwo państwa państwu państwem panowie panów"),
    capital: true,
  },
};

/** Abbreviations whose period ends no sentence (lower case, without the period). */
const ABBREVIATIONS = words("bzw ca etc usw nr dr vgl ggf inkl evtl bspw sog ugs str tel mio mrd vs mr mrs ms prof jr sr fig approx dept jan feb apr jun jul aug sep sept okt oct nov dez dec");

const LIST_LINE = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(?:\[[^\]\n]\]\s+)?/;
const HEADING_LINE = /^#{1,6}\s+\S/;
const RULE_LINE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const EMOJI = /(?:\p{Regional_Indicator}{2}|(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️)\p{Emoji_Modifier}?(?:‍(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️?)\p{Emoji_Modifier}?)*)/gu;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const BOLD = /\*\*(?=\S)[^*\n]*?\S\*\*|__(?=\S)[^_\n]*?\S__/g;
const DASH = /—+|\s–\s|\s-\s/g;
const LETTER = /[\p{L}\p{N}]/u;
const TOKEN = /[\p{L}\p{M}'’]+/gu;

const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

const median = (values: readonly number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** A line without what stands between `open` and `close` — found by position, so a long line costs its length once. An opener without its closer stays text. */
function withoutSpans(line: string, open: string, close: string): string {
  let out = "";
  let from = 0;
  for (;;) {
    const at = line.indexOf(open, from);
    if (at < 0) return out + line.slice(from);
    const end = line.indexOf(close, at + open.length);
    if (end < 0) return out + line.slice(from);
    out += `${line.slice(from, at)} `;
    from = end + close.length;
  }
}

/**
 * A line's text as it reads: code, markup, addresses and embeds out, a link
 * reduced to what it shows. `bold` still carries the bold markers, for
 * counting them; `plain` has none. No class here runs over the bracket that
 * opened it, so no pattern looks at a character twice from many places.
 */
function readable(line: string): { bold: string; plain: string } {
  const bold = withoutSpans(withoutSpans(withoutSpans(line, "`", "`"), "<!--", "-->"), "%%", "%%")
    .replace(/<[^<>\n]+>/g, " ")
    .replace(/!\[\[[^[\]\n]*\]\]/g, " ")
    .replace(/!\[[^[\]\n]*\]\([^()\n]*\)/g, " ")
    .replace(/\[\[([^[\]|#\n]*)(?:#[^[\]|\n]*)?(?:\|([^[\]\n]*))?\]\]/g, (_m, target: string, shown?: string) => ` ${shown ?? target.slice(target.lastIndexOf("/") + 1)} `)
    .replace(/\[([^[\]\n]*)\]\([^()\n]*\)/g, "$1")
    .replace(/\[\^[^[\]\n]*\]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/(^|\s)#[\p{L}\p{N}_/-]+/gu, "$1")
    .replace(/(^|\s)\^[A-Za-z0-9-]+\s*$/g, "$1");
  return { bold, plain: bold.replace(/[*_~=]+/g, "") };
}

const STOPS = new Set([".", "!", "?", "…"]);
const CJK_STOPS = new Set(["。", "！", "？"]);
/** What may stand between a stop and the space after it: closing quotes and brackets. */
const CLOSERS = new Set(['"', "'", "“", "”", "„", "«", "»", ")", "]"]);
/** What may stand between a stop and the next word: opening quotes and brackets. */
const OPENERS = new Set(['"', "'", "“", "”", "„", "«", "»", "("]);
const isWordChar = (char: string | undefined): boolean => char !== undefined && /^[\p{L}\p{N}]$/u.test(char);
const isSpace = (char: string | undefined): boolean => char !== undefined && /^\s$/.test(char);

/**
 * Whether periods (or an ellipsis) at `at` to `after` end a sentence: not
 * where the next word begins in lower case, and a single period not after an
 * abbreviation, a single letter or a day's number — it belongs to that word.
 */
function endsSentence(text: string, start: number, at: number, after: number): boolean {
  let first = at;
  while (first > start && isWordChar(text[first - 1])) first--;
  const before = text.slice(first, at);
  let next = after;
  while (next < text.length && (isSpace(text[next]) || OPENERS.has(text[next]!))) next++;
  const letter = isWordChar(text[next]) ? text[next]! : "";
  const lower = letter !== "" && letter === letter.toLowerCase() && letter !== letter.toUpperCase();
  const shortWord = /^\p{L}$/u.test(before) || ABBREVIATIONS.has(before.toLowerCase()) || /^\d{1,2}$/.test(before);
  return !(lower || (shortWord && after - at === 1 && text[at] === "."));
}

/**
 * The sentences of a stretch of running text, cut where a stop is followed by
 * a space or the end — or at a Chinese or Japanese stop. A scanner, not a
 * pattern: each character is looked at a bounded number of times.
 */
function sentencesOf(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const cut = (end: number) => {
    const sentence = text.slice(start, end).trim();
    if (sentence) out.push(sentence);
    start = end;
  };
  let i = 0;
  while (i < text.length) {
    const char = text[i]!;
    if (CJK_STOPS.has(char)) {
      let end = i + 1;
      while (end < text.length && CJK_STOPS.has(text[end]!)) end++;
      cut(end);
      i = end;
      continue;
    }
    if (!STOPS.has(char)) {
      i += 1;
      continue;
    }
    let end = i + 1;
    while (end < text.length && STOPS.has(text[end]!)) end++;
    let after = end;
    while (after < text.length && CLOSERS.has(text[after]!)) after++;
    const followedBySpace = after >= text.length || isSpace(text[after]);
    let periods = true;
    for (let j = i; j < end; j++) if (text[j] !== "." && text[j] !== "…") periods = false;
    if (followedBySpace && (!periods || endsSentence(text, start, i, end))) cut(end);
    i = end;
  }
  cut(text.length);
  return out;
}

/** How long a sentence is: in words, or — where Chinese or Japanese is measured — in characters. */
function lengthOf(sentence: string, unit: "words" | "chars"): number {
  const cjk = count(sentence, CJK);
  const latin = sentence.replace(CJK, " ").split(/\s+/).filter((token) => LETTER.test(token)).length;
  return unit === "chars" ? cjk + latin : latin + Math.ceil(cjk / 2);
}

interface ExampleText {
  /** The running text, paragraph by paragraph. */
  paragraphs: string[];
  /** The text of list items, one by one. */
  items: string[];
  /** All of it with its bold markers, for counting them. */
  bold: string;
  lines: number;
  listLines: number;
  headings: number;
}

/** What of a note counts for its style: its text without properties, code, quotes, tables and comments. */
function exampleOf(text: string): ExampleText {
  const paragraphs: string[] = [];
  const items: string[] = [];
  const boldParts: string[] = [];
  let paragraph: string[] = [];
  let lines = 0;
  let listLines = 0;
  let headings = 0;
  let fence: string | null = null;
  let comment: "html" | "obsidian" | null = null;
  let inItem = false;
  const endParagraph = () => {
    if (paragraph.length) paragraphs.push(paragraph.join(" "));
    paragraph = [];
  };
  for (const raw of noteBodyOf(text).slice(0, STYLE_EXAMPLE_CHARS).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (fence) {
      if (line.trimStart().startsWith(fence)) fence = null;
      continue;
    }
    const fenced = FENCE.exec(line);
    if (fenced) {
      endParagraph();
      fence = fenced[1]!.slice(0, 3);
      inItem = false;
      continue;
    }
    if (comment) {
      if (line.includes(comment === "html" ? "-->" : "%%")) comment = null;
      continue;
    }
    if (/^\s*<!--/.test(line) && !line.includes("-->")) {
      endParagraph();
      comment = "html";
      continue;
    }
    if (/^\s*%%/.test(line) && (line.match(/%%/g) ?? []).length === 1) {
      endParagraph();
      comment = "obsidian";
      continue;
    }
    if (!line.trim()) {
      endParagraph();
      inItem = false;
      continue;
    }
    if (/^\s*>/.test(line) || /^\s*\|/.test(line) || RULE_LINE.test(line) || /^\s*\$\$/.test(line)) {
      endParagraph();
      inItem = false;
      continue;
    }
    if (HEADING_LINE.test(line)) {
      endParagraph();
      lines += 1;
      headings += 1;
      inItem = false;
      continue;
    }
    const item = LIST_LINE.exec(line);
    if (item || (inItem && /^\s{2,}\S/.test(line))) {
      endParagraph();
      const { bold, plain } = readable(item ? line.slice(item[0].length) : line);
      if (!LETTER.test(plain)) continue;
      lines += 1;
      if (item) {
        listLines += 1;
        items.push(plain);
      } else items[items.length - 1] = `${items[items.length - 1] ?? ""} ${plain}`;
      boldParts.push(bold);
      inItem = true;
      continue;
    }
    const { bold, plain } = readable(line);
    if (!LETTER.test(plain)) continue;
    lines += 1;
    paragraph.push(plain.trim());
    boldParts.push(bold);
  }
  endParagraph();
  return { paragraphs, items, bold: boldParts.join("\n"), lines, listLines, headings };
}

/** Which language an example is written in, where Plainva can tell; null where it cannot. */
function languageOf(example: ExampleText): StyleAddressLanguage | "en" | "ja" | null {
  const all = [...example.paragraphs, ...example.items].join(" ");
  const cjk = count(all, CJK);
  const letters = count(all, /\p{L}/gu);
  if (letters > 0 && cjk / letters >= 0.5) return count(all, KANA) >= cjk * 0.1 ? "ja" : "zh";
  const tokens = (all.match(TOKEN) ?? []).map((token) => token.toLowerCase());
  if (tokens.length < 30) return null;
  let best: { language: keyof typeof LANGUAGE_MARKS; hits: number } | null = null;
  let second = 0;
  for (const language of Object.keys(LANGUAGE_MARKS) as (keyof typeof LANGUAGE_MARKS)[]) {
    const marks = LANGUAGE_MARKS[language];
    const hits = tokens.filter((token) => marks.has(token)).length;
    if (!best || hits > best.hits) {
      second = best?.hits ?? 0;
      best = { language, hits };
    } else if (hits > second) second = hits;
  }
  // A language is told only where its words stand out: often enough, and clearly more often than another's.
  return best && best.hits >= tokens.length * 0.08 && best.hits >= second * 1.5 ? best.language : null;
}

/** How often an example addresses people informally and formally, in its language. */
function addressIn(example: ExampleText, language: StyleAddressLanguage): { informal: number; formal: number } {
  const sentences = [...example.paragraphs.flatMap(sentencesOf), ...example.items.flatMap(sentencesOf)];
  if (language === "zh") {
    const all = sentences.join("");
    return { informal: count(all, /你/g), formal: count(all, /您/g) };
  }
  const rule = ADDRESS_RULES[language];
  const prefixes = [...rule.informal].filter((word) => /['’]$/.test(word));
  let informal = 0;
  let formal = 0;
  for (const sentence of sentences) {
    const tokens = sentence.match(TOKEN) ?? [];
    tokens.forEach((token, index) => {
      const lower = token.toLowerCase();
      if (rule.informal.has(lower) || prefixes.some((prefix) => lower.startsWith(prefix) && lower.length > prefix.length)) {
        informal += 1;
        return;
      }
      if (!rule.formal.has(lower)) return;
      if (rule.capital && (index === 0 || token[0] === token[0]!.toLowerCase())) return;
      if (rule.after && (index === 0 || !rule.after.has(tokens[index - 1]!.toLowerCase()))) return;
      formal += 1;
    });
  }
  return { informal, formal };
}

/**
 * The features of the examples' text, measured on this device. An example is
 * a note's whole text; nothing of it is kept beyond the numbers, and a
 * feature stands only where the examples show it clearly enough.
 */
export function measureStyle(texts: readonly string[]): StyleMeasure {
  const examples = texts.map(exampleOf);
  const all = examples.flatMap((example) => [...example.paragraphs, ...example.items]).join("\n");
  const cjk = count(all, CJK);
  const latinWords = all.replace(CJK, " ").split(/\s+/).filter((token) => LETTER.test(token)).length;
  const words = latinWords + Math.ceil(cjk / 2);
  if (words < STYLE_MIN_WORDS) return { features: [], words, tooShort: true };
  const unit: "words" | "chars" = cjk / 2 > latinWords ? "chars" : "words";
  const japanese = unit === "chars" && count(all, KANA) >= cjk * 0.1;

  const prose = examples.flatMap((example) => example.paragraphs.map(sentencesOf));
  const proseSentences = prose.flat();
  const sentenceCount = proseSentences.length + examples.reduce((sum, example) => sum + example.items.flatMap(sentencesOf).length, 0);
  const features: StyleFeature[] = [];

  if (proseSentences.length >= 8) {
    const length = Math.round(median(proseSentences.map((sentence) => lengthOf(sentence, unit))));
    const [short, long] = unit === "words" ? [10, 18] : japanese ? [25, 50] : [15, 30];
    features.push({ key: "sentences", value: length <= short ? "short" : length >= long ? "long" : "medium", unit, length });
  }
  if (prose.length >= 4) {
    const perParagraph = median(prose.map((sentences) => sentences.length));
    if (perParagraph <= 2) features.push({ key: "paragraphs", value: "short", sentences: Math.max(1, Math.round(perParagraph)) });
    else if (perParagraph >= 5) features.push({ key: "paragraphs", value: "long", sentences: Math.round(perParagraph) });
  }
  const lines = examples.reduce((sum, example) => sum + example.lines, 0);
  const listLines = examples.reduce((sum, example) => sum + example.listLines, 0);
  const share = lines ? Math.round((listLines / lines) * 100) : 0;
  if (lines >= 10 && share >= 30) features.push({ key: "lists", value: "lists", share });
  else if (lines >= 15 && share <= 5) features.push({ key: "lists", value: "prose", share });
  const headings = examples.reduce((sum, example) => sum + example.headings, 0);
  if (headings > 0 && words / headings <= 250) features.push({ key: "headings", value: "headings", wordsPerHeading: Math.round(words / headings) });
  else if (headings === 0 && words >= 300) features.push({ key: "headings", value: "none", words });

  // The address, in the language most of the examples are written in — where that language shows it in words.
  const told = examples.map((example) => ({ example, language: languageOf(example) }));
  const weight = new Map<string, number>();
  for (const { example, language } of told) if (language) weight.set(language, (weight.get(language) ?? 0) + example.paragraphs.join(" ").length + example.items.join(" ").length);
  const main = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (main && (STYLE_ADDRESS_LANGUAGES as readonly string[]).includes(main)) {
    const language = main as StyleAddressLanguage;
    let informal = 0;
    let formal = 0;
    for (const { example, language: of } of told) {
      if (of !== language) continue;
      const counted = addressIn(example, language);
      informal += counted.informal;
      formal += counted.formal;
    }
    if (informal >= 3 && formal * 4 <= informal) features.push({ key: "address", value: "informal", language, informal, formal });
    else if (formal >= 3 && informal * 4 <= formal) features.push({ key: "address", value: "formal", language, informal, formal });
  }

  const bold = examples.reduce((sum, example) => sum + count(example.bold, BOLD), 0);
  if (bold === 0 && words >= 200) features.push({ key: "emphasis", value: "none", count: 0, words });
  else if ((bold / words) * 100 >= 2) features.push({ key: "emphasis", value: "often", count: bold, words });
  const emoji = count(all, EMOJI);
  if (emoji === 0 && words >= 150) features.push({ key: "emoji", value: "none", count: 0, words });
  else if (emoji > 0) features.push({ key: "emoji", value: (emoji / words) * 100 >= 1 ? "often" : "rare", count: emoji, words });
  const exclamations = count(all, /[!！]/g);
  if (sentenceCount >= 20 && (exclamations / sentenceCount) * 100 < 2) features.push({ key: "exclamations", value: "rare", count: exclamations, sentences: sentenceCount });
  else if (sentenceCount >= 10 && (exclamations / sentenceCount) * 100 > 10) features.push({ key: "exclamations", value: "often", count: exclamations, sentences: sentenceCount });
  const dashes = count(all, DASH);
  if (sentenceCount >= 10 && (dashes / sentenceCount) * 100 >= 5) features.push({ key: "dashes", value: "dashes", count: dashes, sentences: sentenceCount });
  else if (sentenceCount >= 20 && dashes === 0) features.push({ key: "dashes", value: "none", count: 0, sentences: sentenceCount });

  return { features, words, tooShort: false };
}

/** The features the user did not take out. */
export function styleFeaturesWithout(features: readonly StyleFeature[], removed: readonly string[]): StyleFeature[] {
  return features.filter((feature) => !removed.includes(feature.key));
}

/** A feature as a model is told it: one plain line in English, written by the app from the numbers — no word of a note. */
export function styleLine(feature: StyleFeature): string {
  switch (feature.key) {
    case "sentences": {
      const size = feature.value === "medium" ? "medium-length" : feature.value;
      return `Sentences: ${size}, about ${feature.length} ${feature.unit === "chars" ? "characters" : "words"} each.`;
    }
    case "paragraphs":
      return `Paragraphs: ${feature.value}, about ${feature.sentences} ${feature.sentences === 1 ? "sentence" : "sentences"} each.`;
    case "lists":
      return feature.value === "lists"
        ? `Prefers lists: about ${feature.share}% of the lines are list items.`
        : `Writes running text rather than lists: about ${feature.share}% of the lines are list items.`;
    case "headings":
      return feature.value === "headings" ? `Structures text with headings: about one every ${feature.wordsPerHeading} words.` : "Uses no headings.";
    case "address": {
      const said = STYLE_ADDRESS_WORDS[feature.language];
      const [used, not] = feature.value === "informal" ? [said.informal, said.formal] : [said.formal, said.informal];
      return `Addresses people ${feature.value === "informal" ? "informally" : "formally"} (in ${said.name}: "${used}", not "${not}").`;
    }
    case "emphasis":
      return feature.value === "none" ? "Uses no bold text." : "Uses bold text often.";
    case "emoji":
      return feature.value === "none" ? "Uses no emojis." : feature.value === "rare" ? "Uses emojis rarely." : "Uses emojis often.";
    case "exclamations":
      return feature.value === "rare" ? "Hardly uses exclamation marks." : "Uses exclamation marks often.";
    case "dashes":
      return feature.value === "dashes" ? "Uses dashes (— or –) for asides." : "Uses no dashes (— or –) for asides.";
  }
}
