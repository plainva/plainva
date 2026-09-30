/**
 * Context cards (plan KI-Harness §9.4, P2b-2): what a source further down the
 * ranking contributes instead of a search excerpt. Extractive and verbatim —
 * nothing is paraphrased, so every number, date, amount, deadline, task,
 * negation and link in a card stands exactly as it does in the note (§9.5):
 * the section's first sentence and every sentence that carries protected
 * material, in their order, until the card's budget. What does not fit is
 * left out whole, never shortened, and the card says how much. Built from the
 * note as it is when the message is assembled, a card cannot be stale.
 */
import { atxHeading } from "./sections.js";

export interface ContextCard {
  /** The section it was cut from ("" = the text before the first heading). */
  chain: string;
  /** Verbatim sentences and lines, in the note's order. */
  lines: string[];
  /** Protected sentences that did not fit. */
  omitted: number;
  /** Characters of the section the card stands for. */
  sourceChars: number;
}

/** A card's budget: a source further down is a pointer with its facts, not a second evidence block. */
export const CARD_CHARS = 300;

const TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX/-]\]\s/;
const URL = /https?:\/\/\S/i;
// No "[" inside, so a run of brackets fails at once instead of scanning to the end from each of them.
const WIKILINK = /\[\[[^[\]\n]+\]\]/;
const DIGIT = /\p{Nd}/u;
const CODE = /`[^`\n]+`/;
const TAG_OR_MENTION = /(?:^|\s)[#@][\p{L}\p{N}_/-]/u;

/**
 * Words that turn what a sentence says — negations, obligations, limits,
 * exceptions — in the app's ten languages. Dates and amounts are caught by
 * their digits; plain prepositions ("by", "until") are left out, they are in
 * nearly every sentence.
 */
const TURNING_WORDS = [
  // en
  "not", "no", "never", "none", "nothing", "must", "mustn't", "cannot", "can't", "don't", "doesn't", "won't", "only", "unless", "except", "deadline", "due", "required", "forbidden", "without",
  // de
  "nicht", "nie", "niemals", "kein", "keine", "keinen", "keinem", "keiner", "nichts", "muss", "müssen", "darf", "dürfen", "nur", "außer", "spätestens", "frist", "fällig", "ohne", "verboten", "pflicht",
  // fr
  "ne", "pas", "jamais", "aucun", "aucune", "rien", "doit", "doivent", "seulement", "sauf", "échéance", "sans", "interdit", "obligatoire",
  // es
  "nunca", "ningún", "ninguna", "nada", "debe", "deben", "solo", "sólo", "salvo", "plazo", "sin", "prohibido", "obligatorio",
  // it
  "non", "mai", "nessun", "nessuna", "niente", "deve", "devono", "tranne", "entro", "scadenza", "senza", "vietato", "obbligatorio",
  // pt-BR
  "não", "nenhum", "nenhuma", "devem", "só", "somente", "exceto", "prazo", "sem", "proibido", "obrigatório",
  // nl
  "niet", "nooit", "geen", "niets", "moet", "moeten", "mag", "alleen", "behalve", "uiterlijk", "zonder", "verboden", "verplicht",
  // pl
  "nigdy", "żaden", "żadna", "żadne", "nic", "musi", "muszą", "tylko", "oprócz", "termin", "bez", "zakaz", "obowiązkowo",
];
const TURNING = new RegExp(`(?<![\\p{L}\\p{M}'’])(?:${TURNING_WORDS.map((w) => w.replace(/'/g, "['’]")).join("|")})(?![\\p{L}\\p{M}])`, "iu");
/** Scripts without spaces: the words stand inside the text. */
const TURNING_CJK = /ない|ません|禁止|必須|までに|のみ|期限|必ず|不|没|无|必须|只|仅|截止|务必/;

/** Whether a sentence carries something a summary must never change. */
export function isProtected(sentence: string): boolean {
  return (
    DIGIT.test(sentence) ||
    URL.test(sentence) ||
    WIKILINK.test(sentence) ||
    CODE.test(sentence) ||
    TAG_OR_MENTION.test(sentence) ||
    TURNING.test(sentence) ||
    TURNING_CJK.test(sentence)
  );
}

/** The sentences of one line: after . ! ? and their full-width forms, the mark staying with its sentence. */
export function sentencesOf(line: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    const cjk = c === "。" || c === "！" || c === "？";
    const latin = (c === "." || c === "!" || c === "?") && (i + 1 === line.length || /\s/.test(line[i + 1]!));
    if (!cjk && !latin) continue;
    // A number like "1.850" or "v2.3" is no end: the next character is not a space there.
    const sentence = line.slice(start, i + 1).trim();
    if (sentence) out.push(sentence);
    start = i + 1;
  }
  const rest = line.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/**
 * The card of one section: its first sentence, then every protected sentence
 * and task line, verbatim and in order, within `maxChars`. A first sentence
 * longer than the budget still goes whole — a card is never cut mid-sentence.
 */
export function contextCard(sectionText: string, chain: string, maxChars = CARD_CHARS): ContextCard {
  const units: { text: string; protected: boolean }[] = [];
  let fence = false;
  for (const raw of sectionText.split("\n")) {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(raw)) {
      fence = !fence;
      continue;
    }
    const line = raw.trim();
    if (!line || atxHeading(raw)) continue;
    if (fence) {
      // Code is protected whole: its lines go as they are.
      units.push({ text: line, protected: true });
      continue;
    }
    if (TASK.test(raw)) {
      units.push({ text: line, protected: true });
      continue;
    }
    for (const sentence of sentencesOf(line)) units.push({ text: sentence, protected: isProtected(sentence) });
  }
  const lines: string[] = [];
  let chars = 0;
  let omitted = 0;
  units.forEach((unit, index) => {
    if (index > 0 && !unit.protected) return;
    if (lines.length > 0 && chars + unit.text.length > maxChars) {
      if (unit.protected) omitted++;
      return;
    }
    lines.push(unit.text);
    chars += unit.text.length + 1;
  });
  return { chain, lines, omitted, sourceChars: sectionText.length };
}

/** A card as it goes into the context: its sentences, and what it left out. */
export function cardText(card: ContextCard): string {
  const text = card.lines.join(" ");
  return card.omitted ? `${text} […${card.omitted} more in read_note]` : text;
}
