import { findInlineTags } from "@plainva/core";
import { addDaysToKey, type TaskPriority } from "./taskPlanner";
import type { RepeatRule } from "./taskRecurrence";

/**
 * Quick capture (plan Aufgaben-Oberfläche, B2): one sentence in, one task out —
 * "Angebot abschicken morgen 14 Uhr !!! #kunde jeden Monat".
 *
 * A small grammar of its own instead of a library: the natural-language date
 * libraries cover a few of Plainva's ten languages and weigh many times what
 * this does, and the job here is narrow — a handful of words per language plus
 * everything that needs no language at all (a date in digits, a time, `!`,
 * `#tag`). The words come from the locale files, so a translator can fix them
 * without touching code.
 *
 * Two rules keep it honest:
 *
 * 1. What is recognised is SHOWN before anything is saved — every match is a
 *    brick with its position, and a brick the person switches off goes back
 *    into the title (`disabled`). The parser never gets the last word.
 * 2. What is not recognised stays title. There is no "did you mean".
 *
 * Pure: no clock (today is passed in), no i18n import, no DOM.
 */

export type CaptureBrickKind = "date" | "time" | "priority" | "tag" | "repeat";

export interface CaptureBrick {
  /** Stable while the person types around it: kind plus the matched text. */
  id: string;
  kind: CaptureBrickKind;
  from: number;
  to: number;
  text: string;
  /** False when the person switched it off: shown, but not applied. */
  active: boolean;
}

export interface CaptureResult {
  title: string;
  /** Day key `YYYY-MM-DD`, or null. */
  due: string | null;
  /** Minutes since midnight, or null. */
  minutes: number | null;
  priority: TaskPriority;
  tags: string[];
  repeat: RepeatRule | null;
  bricks: CaptureBrick[];
}

/**
 * The words of one language. Every list holds lower-case alternatives; `{n}` in
 * a pattern stands for a number. Weekdays run Monday → Sunday. `edgeOnly` is for
 * scripts without spaces between words (Japanese, Chinese): a word only counts
 * at the very start or end of the input, where it cannot be part of another.
 */
export interface CaptureVocabulary {
  today: string[];
  tomorrow: string[];
  dayAfterTomorrow: string[];
  nextWeek: string[];
  inDays: string[];
  inWeeks: string[];
  weekdays: string[][];
  daily: string[];
  weekly: string[];
  monthly: string[];
  yearly: string[];
  /** "jeden", "every" — followed by a weekday. */
  every: string[];
  everyNDays: string[];
  everyNWeeks: string[];
  /** "uhr", "h" — after an hour. */
  oclock: string[];
  /** "um", "at" — before a time; taken along, never required. */
  at: string[];
  dateOrder: "dmy" | "mdy" | "ymd";
  edgeOnly?: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Monday = 0 … Sunday = 6 for a day key, in calendar arithmetic. */
export function weekdayOfKey(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function validDay(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** A day and month without a year mean the NEXT such day — never one in the past. */
function nextDayMonth(m: number, d: number, todayKey: string): string | null {
  const year = Number(todayKey.slice(0, 4));
  const thisYear = validDay(year, m, d);
  if (thisYear && thisYear >= todayKey) return thisYear;
  return validDay(year + 1, m, d) ?? thisYear;
}

interface Match {
  kind: CaptureBrickKind;
  from: number;
  to: number;
  apply(result: CaptureResult): void;
}

/**
 * Finds `phrase` as a whole word: delimited by whitespace or the input's edges
 * (no `\b` — it does not know umlauts, and CJK has no spaces to go by).
 */
function findPhrase(input: string, phrase: string, edgeOnly: boolean): Array<{ from: number; to: number; n?: number }> {
  const source = escapeRe(phrase).replace(/\\\{n\\\}/g, "(\\d{1,3})").replace(/ /g, "\\s+");
  const hits: Array<{ from: number; to: number; n?: number }> = [];
  if (edgeOnly) {
    const start = new RegExp(`^\\s*(${source})`, "iu").exec(input);
    if (start) hits.push({ from: start.index + start[0].length - start[1].length, to: start.index + start[0].length, n: start[2] ? Number(start[2]) : undefined });
    const end = new RegExp(`(${source})\\s*$`, "iu").exec(input);
    if (end && !(start && end.index === hits[0]?.from)) hits.push({ from: end.index, to: end.index + end[1].length, n: end[2] ? Number(end[2]) : undefined });
    return hits;
  }
  const re = new RegExp(`(?<=^|\\s)(${source})(?=$|\\s|[,.;])`, "giu");
  for (let m = re.exec(input); m; m = re.exec(input)) {
    hits.push({ from: m.index, to: m.index + m[1].length, n: m[2] ? Number(m[2]) : undefined });
  }
  return hits;
}

const longestFirst = (words: readonly string[]) => [...words].filter(Boolean).sort((a, b) => b.length - a.length);

/**
 * Reads one capture line. `disabled` holds the ids of bricks the person switched
 * off; they are reported (inactive) and their text stays in the title.
 */
export function parseTaskCapture(
  input: string,
  vocab: CaptureVocabulary,
  todayKey: string,
  disabled: ReadonlySet<string> = new Set()
): CaptureResult {
  const result: CaptureResult = { title: "", due: null, minutes: null, priority: 0, tags: [], repeat: null, bricks: [] };
  const edge = vocab.edgeOnly === true;
  const taken: Array<{ from: number; to: number }> = [];
  const free = (from: number, to: number) => !taken.some((t) => from < t.to && to > t.from);
  let haveDate = false;
  let haveTime = false;
  let haveRepeat = false;
  let havePriority = false;

  const offer = (match: Match): boolean => {
    if (!free(match.from, match.to)) return false;
    const text = input.slice(match.from, match.to);
    const id = `${match.kind}:${text.toLowerCase().replace(/\s+/g, " ")}`;
    const active = !disabled.has(id);
    result.bricks.push({ id, kind: match.kind, from: match.from, to: match.to, text, active });
    if (active) {
      taken.push({ from: match.from, to: match.to });
      match.apply(result);
    }
    return active;
  };

  // 1. Tags — the vault's one tag rule, so "#1" is no more a tag here than in a note.
  for (const tag of findInlineTags(input)) {
    offer({ kind: "tag", from: tag.from, to: tag.to, apply: (r) => { if (!r.tags.includes(tag.name)) r.tags.push(tag.name); } });
  }

  // 2. Priority: !, !! or !!! standing alone. More marks, more important.
  for (let m = /(?<=^|\s)(!{1,3})(?=$|\s)/g, hit = m.exec(input); hit && !havePriority; hit = m.exec(input)) {
    const marks = hit[1].length;
    havePriority = offer({ kind: "priority", from: hit.index, to: hit.index + marks, apply: (r) => { r.priority = (4 - marks) as TaskPriority; } });
  }

  // 3. Repetition. "every Monday" is both a rhythm and a first date — but only
  // a fallback one: a date the person wrote out wins (see the end of step 4).
  let impliedDue: string | null = null;
  const repeatOnce = (from: number, to: number, rule: RepeatRule, due?: string) => {
    if (haveRepeat) return;
    haveRepeat = offer({
      kind: "repeat", from, to,
      apply: (r) => {
        r.repeat = rule;
        if (due) impliedDue = due;
      },
    });
  };
  for (const every of longestFirst(vocab.every)) {
    vocab.weekdays.forEach((names, weekday) => {
      for (const name of longestFirst(names)) {
        // Scripts without spaces write the two as one word (毎週月曜日, 每周一).
        for (const phrase of edge ? [`${every}${name}`, `${every} ${name}`] : [`${every} ${name}`]) {
          for (const hit of findPhrase(input, phrase, edge)) {
            const ahead = (weekday - weekdayOfKey(todayKey) + 7) % 7 || 7;
            repeatOnce(hit.from, hit.to, { freq: "weekly", interval: 1, from: "due" }, addDaysToKey(todayKey, ahead));
          }
        }
      }
    });
  }
  for (const pattern of longestFirst(vocab.everyNDays)) for (const hit of findPhrase(input, pattern, edge)) if (hit.n) repeatOnce(hit.from, hit.to, { freq: "daily", interval: hit.n, from: "due" });
  for (const pattern of longestFirst(vocab.everyNWeeks)) for (const hit of findPhrase(input, pattern, edge)) if (hit.n) repeatOnce(hit.from, hit.to, { freq: "weekly", interval: hit.n, from: "due" });
  for (const [freq, words] of [["daily", vocab.daily], ["weekly", vocab.weekly], ["monthly", vocab.monthly], ["yearly", vocab.yearly]] as const) {
    for (const word of longestFirst(words)) for (const hit of findPhrase(input, word, edge)) repeatOnce(hit.from, hit.to, { freq, interval: 1, from: "due" });
  }

  // 4. Date — digits first (no language needed), then words.
  const dateOnce = (from: number, to: number, due: string | null) => {
    if (haveDate || !due) return;
    haveDate = offer({ kind: "date", from, to, apply: (r) => { r.due = due; } });
  };
  // Digits stand between spaces — except in scripts that do not use any, where
  // "not part of a longer number" is all a boundary can mean (明日14時).
  const LB = edge ? "(?<![\\d])" : "(?<=^|\\s)";
  const LA = edge ? "(?![\\d])" : "(?=$|\\s|[,.;])";
  const scan = (source: string, each: (m: RegExpExecArray) => void) => {
    for (let re = new RegExp(source, "giu"), m = re.exec(input); m; m = re.exec(input)) each(m);
  };
  scan(`${LB}(\\d{4})-(\\d{2})-(\\d{2})${LA}`, (m) => {
    dateOnce(m.index, m.index + m[0].length, validDay(Number(m[1]), Number(m[2]), Number(m[3])));
  });
  const year4 = (raw: string | undefined) => (raw ? (raw.length <= 2 ? 2000 + Number(raw) : Number(raw)) : null);
  if (vocab.dateOrder === "ymd") {
    scan(`${LB}(\\d{4})[/.](\\d{1,2})[/.](\\d{1,2})${LA}`, (m) => {
      dateOnce(m.index, m.index + m[0].length, validDay(Number(m[1]), Number(m[2]), Number(m[3])));
    });
    scan(`${LB}(\\d{1,2})月(\\d{1,2})[日号]`, (m) => {
      dateOnce(m.index, m.index + m[0].length, nextDayMonth(Number(m[1]), Number(m[2]), todayKey));
    });
  } else {
    // 21.09. · 21.9.2026 · 21/9 · 9/21 (by the language's order)
    for (let re = /(?<=^|\s)(\d{1,2})([./])(\d{1,2})(?:\2(\d{2,4})|\.)?(?=$|\s|[,;])/g, m = re.exec(input); m; m = re.exec(input)) {
      const first = Number(m[1]);
      const second = Number(m[3]);
      const [day, month] = vocab.dateOrder === "mdy" && m[2] === "/" ? [second, first] : [first, second];
      const year = year4(m[4]);
      dateOnce(m.index, m.index + m[0].length, year ? validDay(year, month, day) : nextDayMonth(month, day, todayKey));
    }
  }
  const wordDate = (words: readonly string[], due: (n?: number) => string | null) => {
    for (const word of longestFirst(words)) for (const hit of findPhrase(input, word, edge)) dateOnce(hit.from, hit.to, due(hit.n));
  };
  wordDate(vocab.dayAfterTomorrow, () => addDaysToKey(todayKey, 2));
  wordDate(vocab.tomorrow, () => addDaysToKey(todayKey, 1));
  wordDate(vocab.today, () => todayKey);
  wordDate(vocab.nextWeek, () => addDaysToKey(todayKey, 7 - weekdayOfKey(todayKey)));
  wordDate(vocab.inDays, (n) => (n ? addDaysToKey(todayKey, n) : null));
  wordDate(vocab.inWeeks, (n) => (n ? addDaysToKey(todayKey, n * 7) : null));
  vocab.weekdays.forEach((names, weekday) => {
    // A bare weekday is the NEXT one — "Montag" said on a Monday means in a week.
    wordDate(names, () => addDaysToKey(todayKey, (weekday - weekdayOfKey(todayKey) + 7) % 7 || 7));
  });
  // "every Monday" with no date written out: the first Monday is the first date.
  if (result.due === null && impliedDue) result.due = impliedDue;

  // 5. Time: 14:30 · 2pm · 14 Uhr — with an optional "um"/"at" in front.
  const atPrefix = vocab.at.length > 0 ? `(?:(?:${longestFirst(vocab.at).map(escapeRe).join("|")})\\s+)?` : "";
  const oclock = longestFirst(vocab.oclock).map(escapeRe).join("|");
  const timeOnce = (from: number, to: number, hours: number, minutes: number) => {
    if (haveTime || hours > 23 || minutes > 59) return;
    haveTime = offer({ kind: "time", from, to, apply: (r) => { r.minutes = hours * 60 + minutes; } });
  };
  scan(`${LB}${atPrefix}(\\d{1,2}):(\\d{2})(?:\\s*(?:${oclock || "(?!)"}))?${LA}`, (m) => {
    timeOnce(m.index, m.index + m[0].length, Number(m[1]), Number(m[2]));
  });
  scan(`${LB}${atPrefix}(\\d{1,2})(?::(\\d{2}))?\\s?(am|pm)${LA}`, (m) => {
    const base = Number(m[1]) % 12;
    timeOnce(m.index, m.index + m[0].length, m[3].toLowerCase() === "pm" ? base + 12 : base, m[2] ? Number(m[2]) : 0);
  });
  // 14h30 (French and Portuguese write the minutes AFTER the hour mark), 14時30分.
  scan(`${LB}${atPrefix}(\\d{1,2})\\s?h\\s?(\\d{2})${LA}`, (m) => timeOnce(m.index, m.index + m[0].length, Number(m[1]), Number(m[2])));
  scan(`${LB}(\\d{1,2})[時时点點](?:(\\d{1,2})分|半)?`, (m) => {
    timeOnce(m.index, m.index + m[0].length, Number(m[1]), m[2] ? Number(m[2]) : m[0].endsWith("半") ? 30 : 0);
  });
  if (oclock) {
    scan(`${LB}${atPrefix}(\\d{1,2})(?:[.:](\\d{2}))?\\s?(?:${oclock})${LA}`, (m) => {
      timeOnce(m.index, m.index + m[0].length, Number(m[1]), m[2] ? Number(m[2]) : 0);
    });
  }
  // A time without a day means today.
  if (result.minutes !== null && result.due === null) result.due = todayKey;

  // The title is what is left. Positions are cut from the back so they stay valid.
  let title = input;
  for (const t of [...taken].sort((a, b) => b.from - a.from)) title = title.slice(0, t.from) + " " + title.slice(t.to);
  result.title = title.replace(/\s+/g, " ").replace(/^[\s,;–—-]+|[\s,;–—-]+$/g, "").trim();
  result.bricks.sort((a, b) => a.from - b.from);
  return result;
}

/**
 * Puts `word` where the active brick of `kind` stands — or at the end when there
 * is none; an empty `word` takes the brick out. This is what the phone's quick
 * buttons do: they WRITE into the sentence, so the buttons and the keyboard
 * cannot disagree about what will be saved — the text stays the model.
 */
export function setCaptureWord(input: string, result: CaptureResult, kind: CaptureBrickKind, word: string): string {
  const brick = result.bricks.find((b) => b.kind === kind && b.active);
  const tidy = (text: string) => text.replace(/ {2,}/g, " ").replace(/^\s+/, "");
  if (brick) return tidy(input.slice(0, brick.from) + word + input.slice(brick.to));
  if (!word) return input;
  return input.trim().length === 0 ? `${word} ` : `${input.replace(/\s+$/, "")} ${word}`;
}

/** The next mark of the priority button: none → !!! → !! → ! → none. */
export function nextPriorityWord(current: TaskPriority): string {
  return current === 0 ? "!!!" : current === 1 ? "!!" : current === 2 ? "!" : "";
}

/**
 * Builds a vocabulary from the comma-separated lists of a locale file plus the
 * weekday names `Intl` knows for the language. Kept here so both shells build
 * it the same way and a test can build one without i18n.
 */
export function captureVocabularyFrom(
  lists: Record<Exclude<keyof CaptureVocabulary, "weekdays" | "dateOrder" | "edgeOnly">, string>,
  language: string,
  extraWeekdays: string = ""
): CaptureVocabulary {
  // "-" is how a locale file says "this language has no such word" (an empty
  // value would read as a missing translation).
  const split = (raw: string) => raw.split(",").map((w) => w.trim().toLowerCase()).filter((w) => w && w !== "-");
  const lang = language.toLowerCase();
  const edgeOnly = lang.startsWith("ja") || lang.startsWith("zh");
  const weekdays: string[][] = [];
  for (let i = 0; i < 7; i++) {
    // 2024-01-01 was a Monday.
    const date = new Date(Date.UTC(2024, 0, 1 + i));
    const names = new Set<string>();
    // The short names of Japanese and Chinese are single characters (月, 一) that
    // end half the words of the language; only the long ones are safe there.
    for (const style of edgeOnly ? (["long"] as const) : (["long", "short"] as const)) {
      try {
        names.add(new Intl.DateTimeFormat(language, { weekday: style, timeZone: "UTC" }).format(date).toLowerCase().replace(/\.$/, ""));
      } catch {
        /* an unknown language tag leaves only the extras */
      }
    }
    weekdays.push([...names]);
  }
  // Extras: seven "|"-separated groups, Monday first ("mo|di|mi|do|fr|sa|so").
  extraWeekdays.split("|").forEach((group, i) => { if (i < 7) for (const w of split(group)) if (!weekdays[i].includes(w)) weekdays[i].push(w); });
  const dateOrder: CaptureVocabulary["dateOrder"] = edgeOnly ? "ymd" : lang === "en" || lang.startsWith("en-us") ? "mdy" : "dmy";
  return {
    today: split(lists.today), tomorrow: split(lists.tomorrow), dayAfterTomorrow: split(lists.dayAfterTomorrow), nextWeek: split(lists.nextWeek),
    inDays: split(lists.inDays), inWeeks: split(lists.inWeeks), weekdays,
    daily: split(lists.daily), weekly: split(lists.weekly), monthly: split(lists.monthly), yearly: split(lists.yearly),
    every: split(lists.every), everyNDays: split(lists.everyNDays), everyNWeeks: split(lists.everyNWeeks),
    oclock: split(lists.oclock), at: split(lists.at),
    dateOrder,
    edgeOnly,
  };
}
