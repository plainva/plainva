/**
 * Moment-style format strings, translated to date-fns.
 *
 * Plainva speaks Moment tokens to the user — `{{date:DD.MM.YYYY}}`, the
 * daily-note filename format — because that is what Obsidian uses and what
 * people arriving from there already know (decision E2 of the Vorlagen-Engine
 * plan). Internally everything formats with date-fns, and the two token sets
 * overlap just enough to be dangerous:
 *
 *   - `DD` is "day of month" in Moment and "day of YEAR" in date-fns;
 *   - `YYYY` is the calendar year in Moment and the week-numbering year in
 *     date-fns, which throws a RangeError by design to catch this very mix-up;
 *   - `dddd` is a weekday name in Moment; date-fns reads it as four
 *     day-of-month tokens and prints "27272727".
 *
 * The previous conversion was a chain of four `.replace` calls covering
 * `YYYY|YY|DD|D`. Everything else silently produced nonsense — a vault whose
 * daily-note format contained `dddd` got unusable file names.
 *
 * On top of the token table this escapes anything that is NOT a token: date-fns
 * throws on unescaped latin letters, so a format like `YYYY-MM-DD ~` would take
 * the whole formatting call down.
 *
 * Letters that ARE tokens stay tokens, even inside a word — exactly as Moment
 * and Obsidian behave. `Journal` formats as gibberish there too (its `a` is the
 * meridiem token); literal words belong in `[brackets]`. Deviating here would
 * mean the same format string produces different file names in Plainva and in
 * Obsidian, which is a worse failure than a surprising format.
 */

import { format as formatDate, parse as parseDate } from "date-fns";

/** Moment token → date-fns token. Order matters: longest match wins. */
const TOKENS: ReadonlyArray<readonly [string, string]> = [
  // year
  ["YYYY", "yyyy"],
  ["YY", "yy"],
  ["GGGG", "RRRR"], // ISO week-numbering year
  ["gggg", "YYYY"], // locale week-numbering year
  // quarter
  ["Q", "Q"],
  // month
  ["MMMM", "MMMM"],
  ["MMM", "MMM"],
  ["MM", "MM"],
  ["M", "M"],
  // day of year (before day of month: DDDD/DDD are longer than DD/D)
  ["DDDD", "DDD"],
  ["DDD", "D"],
  // day of month
  ["DD", "dd"],
  ["Do", "do"],
  ["D", "d"],
  // weekday
  ["dddd", "EEEE"],
  ["ddd", "EEE"],
  ["dd", "EEEEEE"],
  // Moment `d` is 0..6 (Sunday = 0), date-fns `i` is 1..7 (Monday = 1). Same
  // idea — "weekday as a number" — with a different origin. Documented drift;
  // a bare `d` in a file name format is vanishingly rare.
  ["d", "i"],
  ["E", "i"],
  // week
  ["ww", "ww"],
  ["w", "w"],
  ["WW", "II"], // ISO week
  ["W", "I"],
  // hour
  ["HH", "HH"],
  ["H", "H"],
  ["hh", "hh"],
  ["h", "h"],
  // minute / second / fraction
  ["mm", "mm"],
  ["m", "m"],
  ["ss", "ss"],
  ["s", "s"],
  ["SSS", "SSS"],
  ["SS", "SS"],
  ["S", "S"],
  // meridiem: Moment A = "AM", a = "am"
  ["A", "a"],
  ["a", "aaa"],
  // timezone / timestamps
  ["ZZ", "xx"],
  ["Z", "xxx"],
  ["X", "t"],
  ["x", "T"],
];

// Longest first so `YYYY` never matches as `YY` + `YY`.
const SORTED = [...TOKENS].sort((a, b) => b[0].length - a[0].length);

const LATIN = /[A-Za-z]/;

/** date-fns escapes literal text with single quotes; a literal quote doubles. */
function quote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

/**
 * Translates a Moment-style format to date-fns. Literal text in Moment's
 * `[brackets]` and any letter that is not a known token are escaped, so the
 * result never makes date-fns throw.
 */
export function momentToDateFns(format: string): string {
  let out = "";
  let literal = "";
  let i = 0;

  const flush = () => {
    if (literal) {
      out += quote(literal);
      literal = "";
    }
  };

  while (i < format.length) {
    // Moment's own escape: [text] is literal.
    if (format[i] === "[") {
      const end = format.indexOf("]", i + 1);
      if (end !== -1) {
        literal += format.slice(i + 1, end);
        i = end + 1;
        continue;
      }
    }
    const token = SORTED.find((t) => format.startsWith(t[0], i));
    if (token) {
      flush();
      out += token[1];
      i += token[0].length;
      continue;
    }
    // Unknown latin letters must be escaped or date-fns throws; everything
    // else (separators, digits, spaces) can stay as it is — but a literal
    // single quote has to be escaped too.
    const ch = format[i];
    if (LATIN.test(ch) || ch === "'") literal += ch;
    else {
      flush();
      out += ch;
    }
    i++;
  }
  flush();
  return out;
}

/**
 * date-fns guards `D`/`DD` (day of year) and `YYYY`/`YY` (week-numbering year)
 * behind opt-in flags, because they are the tokens Moment users type by
 * mistake. Here the translation is deliberate — `momentToDateFns` only emits
 * them for Moment's `DDD`/`DDDD` and `gggg` — so both are enabled centrally
 * instead of at every call site.
 */
const DATE_FNS_OPTIONS = { useAdditionalDayOfYearTokens: true, useAdditionalWeekYearTokens: true } as const;

/**
 * Formats `date` with a Moment-style format. An invalid format falls back to
 * `fallback` (ISO by default) rather than throwing: a broken format string is
 * a user typo, and it must not take down whatever is being written.
 *
 * Deliberately NOT localised: month and weekday names come out English. These
 * strings end up in FILE NAMES, and `parseDailyNoteDate` has to find those
 * files again — a localised name would make every existing daily note
 * unfindable the moment someone switches the app language. Localisation
 * belongs where text is displayed, not where it is stored.
 */
export function formatMoment(date: Date, momentFormat: string, fallback = "yyyy-MM-dd"): string {
  try {
    return formatDate(date, momentToDateFns(momentFormat), DATE_FNS_OPTIONS);
  } catch {
    return formatDate(date, fallback);
  }
}

/**
 * Parses `text` against a Moment-style format. Returns an Invalid Date when the
 * format itself cannot be used — callers check with `isValid` either way.
 */
export function parseMoment(text: string, momentFormat: string, reference: Date = new Date()): Date {
  try {
    return parseDate(text, momentToDateFns(momentFormat), reference, DATE_FNS_OPTIONS);
  } catch {
    return new Date(NaN);
  }
}
