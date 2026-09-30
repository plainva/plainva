/**
 * Text in scripts written without spaces between words — Chinese, Japanese,
 * Thai, Lao, Khmer, Myanmar — and how the vault finds a word inside it.
 *
 * FTS5's `unicode61` tokenizer splits only at spaces and punctuation, so a
 * whole Japanese sentence is ONE token and a word in its middle was never
 * found (finding 2026-09-30, Gesamtplan Volltextsuche CJK). The rule since:
 * inside a run of such characters a term matches ANYWHERE; at the edge of any
 * other script (digits, Latin, …) it matches at a word boundary, as
 * everywhere else. One module carries the rule for the index, the query, the
 * occurrence list and the unlinked-mention scan.
 *
 * The index carries a second form of such text (`fts_notes.seg_content` and
 * `seg_title`): every run of these characters as overlapping character pairs
 * plus the run's last character, the other parts of the same word as pieces
 * of their own. "2026年9月の会議" becomes `2026 年 9 月の の会 会議 議`. A search
 * term in these scripts becomes a phrase of the same pairs, which finds it at
 * any position of a run. The trailing single character ends every run in the
 * index, so a pair phrase never reaches across two runs, and a one-character
 * term still finds a run's last character.
 */

/**
 * One character of a script without spaces. `Script_Extensions` keeps the
 * prolonged sound mark ー and the iteration mark 々 inside Japanese runs.
 * Korean is not here: it separates words with spaces, and the word-prefix
 * search already finds "회의록" in "회의록을".
 */
const SPACELESS_CHAR = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]/u;

const glyphRange = (from: number, to: number) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`;

/**
 * SQLite GLOB pattern that selects text which may hold spaceless characters:
 * wide code point ranges (Thai to Khmer, the CJK blocks with kana, the
 * compatibility and half-width forms, the supplementary ideograph planes).
 * A cheap superset for scanning a table; {@link segmentedIndexText} decides.
 */
export const SPACELESS_GLOB = `*[${[
  glyphRange(0x0e00, 0x0eff),
  glyphRange(0x1000, 0x109f),
  glyphRange(0x1780, 0x17ff),
  glyphRange(0x19e0, 0x19ff),
  glyphRange(0x2e80, 0x9fff),
  glyphRange(0xa9e0, 0xa9ff),
  glyphRange(0xaa60, 0xaa7f),
  glyphRange(0xf900, 0xfaff),
  glyphRange(0xff66, 0xff9f),
  glyphRange(0x20000, 0x3ffff),
].join("")}]*`;

/** A word as the occurrence scan has always cut it: letters and digits, then combining marks. */
export const SEARCH_WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu;

/** The FTS5 column filter of the segmented form. */
export const SEGMENTED_COLUMNS = "{seg_content seg_title}";

/** A base character with its combining marks — Thai tone marks stay with their consonant. */
const CLUSTER = /\P{M}\p{M}*/gu;

export function isSpacelessChar(char: string): boolean {
  return SPACELESS_CHAR.test(char);
}

export function hasSpacelessText(text: string): boolean {
  return SPACELESS_CHAR.test(text);
}

/** A run inside one word: spaceless characters, or everything else (digits, Latin, …). */
export interface WordPiece {
  text: string;
  spaceless: boolean;
  /** Offset inside the word, in UTF-16 units. */
  from: number;
}

/** The pieces of one word, cut where it changes between spaceless and other characters. */
export function wordPieces(word: string): WordPiece[] {
  const pieces: WordPiece[] = [];
  for (const match of word.matchAll(CLUSTER)) {
    const spaceless = SPACELESS_CHAR.test(match[0]);
    const last = pieces[pieces.length - 1];
    if (last && last.spaceless === spaceless) last.text += match[0];
    else pieces.push({ text: match[0], spaceless, from: match.index });
  }
  return pieces;
}

function clusters(text: string): string[] {
  return Array.from(text.matchAll(CLUSTER), (m) => m[0]);
}

/**
 * The index form of every word with spaceless characters in `text`; "" when
 * there is none, so text in other scripts costs one regex test.
 */
export function segmentedIndexText(text: string): string {
  if (!text || !SPACELESS_CHAR.test(text)) return "";
  const out: string[] = [];
  for (const match of text.matchAll(SEARCH_WORD)) {
    if (!SPACELESS_CHAR.test(match[0])) continue;
    for (const piece of wordPieces(match[0])) {
      if (!piece.spaceless) {
        out.push(piece.text);
        continue;
      }
      const units = clusters(piece.text);
      for (let i = 0; i + 1 < units.length; i++) out.push(units[i] + units[i + 1]);
      out.push(units[units.length - 1]);
    }
  }
  return out.join(" ");
}

/**
 * The pair phrase of one word: pairs for each spaceless run, the run's last
 * character where another piece follows (the index ends the run there, too),
 * the other pieces as they are. A lone spaceless character at the end matches
 * as a prefix — it is the first half of a pair or a run's last character.
 */
function wordPhrase(word: string, prefix: boolean): string {
  const pieces = wordPieces(word);
  const tokens: string[] = [];
  let lastPrefix = false;
  pieces.forEach((piece, i) => {
    const last = i === pieces.length - 1;
    if (!piece.spaceless) {
      tokens.push(piece.text);
      if (last) lastPrefix = prefix;
      return;
    }
    const units = clusters(piece.text);
    for (let j = 0; j + 1 < units.length; j++) tokens.push(units[j] + units[j + 1]);
    if (units.length === 1) {
      tokens.push(units[0]);
      if (last) lastPrefix = true;
    } else if (!last) {
      tokens.push(units[units.length - 1]);
    }
  });
  return `"${tokens.join(" ").replace(/"/g, '""')}"${lastPrefix ? "*" : ""}`;
}

/**
 * The FTS5 expression of a search term with spaceless text, or null when the
 * term holds no word. Each word becomes its own condition, all of them
 * required: a word with spaceless characters as a pair phrase in the
 * segmented columns, any other word as usual in every column. The order of
 * several words is checked by the occurrence list, which sees the text
 * itself. `prefix` (search-as-you-type) applies to the last word.
 */
export function segmentedMatchExpression(term: string, prefix: boolean): string | null {
  const words = Array.from(term.matchAll(SEARCH_WORD), (m) => m[0]);
  if (!words.length) return null;
  const parts = words.map((word, i) => {
    const wordPrefix = prefix && i === words.length - 1;
    if (!SPACELESS_CHAR.test(word)) return `"${word.replace(/"/g, '""')}"${wordPrefix ? "*" : ""}`;
    return `${SEGMENTED_COLUMNS} : ${wordPhrase(word, wordPrefix)}`;
  });
  return parts.length > 1 ? `(${parts.join(" AND ")})` : parts[0];
}

/**
 * A question's term as OR-able FTS5 conditions, for retrieval rather than
 * search: a spaceless run becomes its pairs (a note sharing more of them ranks
 * higher), a lone spaceless character a prefix, any other piece a prefix word.
 * "会議の議事録" asks for 会議, 議の, の議, 議事, 事録 — the whole run would only
 * find the exact phrase.
 */
export function spacelessRetrievalTerms(term: string): string[] {
  const out = new Set<string>();
  for (const match of term.matchAll(SEARCH_WORD)) {
    for (const piece of wordPieces(match[0])) {
      if (!piece.spaceless) {
        out.add(`"${piece.text.replace(/"/g, '""')}"*`);
        continue;
      }
      const units = clusters(piece.text);
      if (units.length === 1) out.add(`${SEGMENTED_COLUMNS} : "${units[0]}"*`);
      for (let i = 0; i + 1 < units.length; i++) out.add(`${SEGMENTED_COLUMNS} : "${units[i] + units[i + 1]}"`);
    }
  }
  return [...out];
}

const OTHER_WORD_CHAR = String.raw`(?![\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}])[\p{L}\p{N}]`;

/**
 * Regex source (for the `u` flag) that finds `term` as a word of its own: an
 * edge made of spaceless characters may sit anywhere in a run, any other edge
 * needs a neighbour that is no letter or digit of a script with spaces. A
 * combining mark never follows the match — it would split a character.
 */
export function wordBoundedPattern(term: string): string {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const chars = Array.from(term);
  const before = chars.length && SPACELESS_CHAR.test(chars[0]) ? "" : `(?<!${OTHER_WORD_CHAR})`;
  const after = chars.length && SPACELESS_CHAR.test(chars[chars.length - 1]) ? "" : `(?!${OTHER_WORD_CHAR})`;
  return `${before}${escaped}${after}(?!\\p{M})`;
}

/** Latin folding as FTS5 does it: case and diacritics go. */
function foldOther(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * A piece prepared for comparison. Spaceless text has no case and keeps its
 * marks — stripping them would turn が into か — so its fold is the text
 * itself and offsets in it are offsets in the text.
 */
interface ComparablePiece {
  text: string;
  fold: string;
  spaceless: boolean;
  from: number;
}

/** A word of the text being searched, cut into pieces. */
export interface PiecedWord {
  pieces: ComparablePiece[];
}

export function piecedWord(word: string, from: number): PiecedWord {
  if (!SPACELESS_CHAR.test(word)) return { pieces: [{ text: word, fold: foldOther(word), spaceless: false, from }] };
  return { pieces: wordPieces(word).map((piece) => ({ text: piece.text, fold: piece.spaceless ? piece.text : foldOther(piece.text), spaceless: piece.spaceless, from: from + piece.from })) };
}

/** A search term, cut into words and pieces for {@link matchTerm}. */
export interface PiecedTerm {
  words: { fold: string; spaceless: boolean }[][];
  prefix: boolean;
}

export function piecedTerm(text: string, prefix: boolean): PiecedTerm {
  return {
    words: Array.from(text.matchAll(SEARCH_WORD), (m) => piecedWord(m[0], 0).pieces.map((piece) => ({ fold: piece.fold, spaceless: piece.spaceless }))),
    prefix,
  };
}

/**
 * Where one term word sits inside one text word. `openStart` lets it begin
 * after other pieces (the first word of a term), `openEnd` lets it stop before
 * the word ends (the last one). Pieces meet exactly at inner edges; a
 * spaceless run at an open edge may be cut between any two characters, any
 * other piece only matches whole — or as a prefix where the term is typed.
 */
function matchWord(term: { fold: string; spaceless: boolean }[], word: PiecedWord, openStart: boolean, openEnd: boolean, prefix: boolean): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const n = term.length;
  const pieces = word.pieces;
  const lastTerm = term[n - 1];
  // End of a match that starts `at` inside `piece` with the term's last piece, or -1.
  const endIn = (piece: ComparablePiece, at: number): number => {
    if (piece.spaceless) {
      if (!piece.fold.startsWith(lastTerm.fold, at)) return -1;
      const end = at + lastTerm.fold.length;
      return openEnd || end === piece.text.length ? piece.from + end : -1;
    }
    if (at !== 0) return -1;
    // A typed prefix marks the whole word, as the search always has.
    if (openEnd && prefix) return piece.fold.startsWith(lastTerm.fold) ? piece.from + piece.text.length : -1;
    return piece.fold === lastTerm.fold ? piece.from + piece.text.length : -1;
  };
  for (let j = 0; j + n <= pieces.length; j++) {
    if (!openStart && j > 0) break;
    if (!openEnd && j + n !== pieces.length) continue;
    let fits = true;
    for (let i = 0; i < n && fits; i++) fits = term[i].spaceless === pieces[j + i].spaceless;
    for (let i = 1; i < n - 1 && fits; i++) fits = term[i].fold === pieces[j + i].fold;
    if (!fits) continue;
    const first = pieces[j];
    if (n === 1) {
      if (!first.spaceless) {
        const end = endIn(first, 0);
        if (end >= 0) out.push({ from: first.from, to: end });
        continue;
      }
      for (let at = first.fold.indexOf(lastTerm.fold); at >= 0; at = first.fold.indexOf(lastTerm.fold, at + 1)) {
        if (!openStart && at > 0) break;
        const end = endIn(first, at);
        if (end >= 0) out.push({ from: first.from + at, to: end });
      }
      continue;
    }
    // Several pieces: the first ends where its piece ends, the last starts where its piece starts.
    let at = 0;
    if (first.spaceless) {
      if (!(openStart ? first.fold.endsWith(term[0].fold) : first.fold === term[0].fold)) continue;
      at = first.fold.length - term[0].fold.length;
    } else if (first.fold !== term[0].fold) {
      continue;
    }
    const end = endIn(pieces[j + n - 1], 0);
    if (end >= 0) out.push({ from: first.from + at, to: end });
  }
  return out;
}

/**
 * The matches of `term` that begin in the text word at `index`: a one-word
 * term inside that word, a longer term across neighbouring words — its first
 * word ending and its last word starting at the word edge. Ranges are offsets
 * of the text the words were cut from.
 */
export function matchTerm(term: PiecedTerm, words: PiecedWord[], index: number): { from: number; to: number }[] {
  const k = term.words.length;
  if (!k || index + k > words.length) return [];
  if (k === 1) return matchWord(term.words[0], words[index], true, true, term.prefix);
  const head = matchWord(term.words[0], words[index], true, false, false);
  if (!head.length) return [];
  for (let i = 1; i < k - 1; i++) if (!matchWord(term.words[i], words[index + i], false, false, false).length) return [];
  const tail = matchWord(term.words[k - 1], words[index + k - 1], false, true, term.prefix);
  if (!tail.length) return [];
  return [{ from: head[head.length - 1].from, to: tail[0].to }];
}
