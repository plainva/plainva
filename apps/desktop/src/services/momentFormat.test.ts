import { describe, it, expect, afterEach } from "vitest";
import { isValid } from "date-fns";
import { de } from "date-fns/locale/de";
import {
  APP_LANGUAGES,
  buildDailyNotePath,
  formatMoment,
  formatMomentLocalized,
  getDateLocale,
  loadDateLocale,
  momentToDateFns,
  parseMoment,
  setDateLocaleForTests,
} from "@plainva/ui";
import { changeAppLanguage } from "@plainva/ui/i18n";

const D = new Date(2026, 6, 29, 14, 37, 5); // Wednesday, 29 July 2026, 14:37:05

const fmt = (moment: string) => formatMoment(D, moment);

describe("momentToDateFns", () => {
  it("keeps the vault default byte-identical", () => {
    expect(momentToDateFns("YYYY-MM-DD")).toBe("yyyy-MM-dd");
    expect(fmt("YYYY-MM-DD")).toBe("2026-07-29");
  });

  it("translates the tokens the old four-replace chain already covered", () => {
    expect(fmt("DD.MM.YYYY")).toBe("29.07.2026");
    expect(fmt("YY-M-D")).toBe("26-7-29");
  });

  // The regression the chain produced: `dddd` survived as four date-fns
  // day-of-month tokens and printed 27272727 instead of a weekday name.
  it("translates weekday names instead of printing four day numbers", () => {
    expect(fmt("dddd")).not.toMatch(/^\d+$/);
    expect(fmt("dddd")).toBe("Wednesday");
    expect(fmt("ddd")).toBe("Wed");
    expect(fmt("dddd, DD. MMMM YYYY")).toBe("Wednesday, 29. July 2026");
  });

  it("handles time, meridiem and seconds", () => {
    expect(fmt("HH:mm")).toBe("14:37");
    expect(fmt("HH:mm:ss")).toBe("14:37:05");
    expect(fmt("hh:mm A")).toBe("02:37 PM");
    expect(fmt("h:mm a")).toBe("2:37 pm");
  });

  it("does not confuse day-of-year with day-of-month", () => {
    // Moment DDD = day of year (210th day of 2026), DD = day of month.
    expect(fmt("DDD")).toBe("210");
    expect(fmt("DD")).toBe("29");
  });

  it("escapes letters that are not tokens instead of letting date-fns throw", () => {
    // `v`, `q`, `n` are no tokens in either dialect — unescaped they would make
    // date-fns raise "unescaped latin alphabet character".
    expect(() => fmt("YYYY-MM-DD vqn")).not.toThrow();
    expect(fmt("YYYY-MM-DD vqn")).toBe("2026-07-29 vqn");
  });

  it("treats token letters as tokens even inside a word, like Moment does", () => {
    // The `a` of "Journal" is the meridiem token — in Obsidian too. Writing a
    // literal word without brackets is a user error, not something to smooth
    // over: silently differing from Obsidian would produce different file
    // names for the same format string.
    expect(fmt("Journal")).toContain("pm");
    expect(fmt("[Journal]")).toBe("Journal");
  });

  it("honours Moment's [bracket] escapes", () => {
    expect(fmt("[Tag] DD.MM.")).toBe("Tag 29.07.");
    // Brackets around something that WOULD be a token keep it literal.
    expect(fmt("[YYYY] YYYY")).toBe("YYYY 2026");
  });

  it("survives an unterminated bracket instead of throwing", () => {
    expect(() => fmt("[Tag DD")).not.toThrow();
  });

  it("escapes a literal single quote", () => {
    expect(fmt("[o'clock]")).toBe("o'clock");
  });

  it("passes separators, digits and spaces through untouched", () => {
    expect(fmt("YYYY/MM/DD")).toBe("2026/07/29");
    expect(fmt("YYYY_MM_DD")).toBe("2026_07_29");
  });

  it("produces formats that round-trip through parse", () => {
    for (const moment of ["YYYY-MM-DD", "DD.MM.YYYY", "YYYY/MM/DD", "YY-MM-DD", "[Tag] DD.MM.YYYY"]) {
      const printed = formatMoment(D, moment);
      const parsed = parseMoment(printed, moment);
      expect(isValid(parsed)).toBe(true);
      expect(formatMoment(parsed, "YYYY-MM-DD")).toBe("2026-07-29");
    }
  });

  // The translation escapes everything it cannot map, so date-fns never sees
  // an invalid pattern — the fallback in formatMoment is a backstop that
  // should stay unreachable. These are the shapes that used to blow up.
  it("never throws, whatever the user typed into the format field", () => {
    for (const bad of ["YYYY-'", "[unterminated", "", "????", "YYYY-MM-DD ~ Journal", "\\", "%s"]) {
      expect(() => formatMoment(D, bad)).not.toThrow();
      expect(() => parseMoment("whatever", bad)).not.toThrow();
    }
  });

  it("reports an unparseable text as an invalid date rather than guessing", () => {
    expect(isValid(parseMoment("not a date", "YYYY-MM-DD"))).toBe(false);
  });
});

describe("formatMomentLocalized", () => {
  afterEach(() => setDateLocaleForTests(undefined));

  it("writes month and weekday names in the app language", () => {
    setDateLocaleForTests(de);
    expect(formatMomentLocalized(D, "dddd")).toBe("Mittwoch");
    expect(formatMomentLocalized(D, "dddd, D. MMMM YYYY")).toBe("Mittwoch, 29. Juli 2026");
    // How short an abbreviation is belongs to the locale, not to the token:
    // German date-fns writes "Juli" where English writes "Jul".
    expect(formatMomentLocalized(D, "MMM")).toBe("Juli");
  });

  it("is English while no locale is loaded — the state at startup", () => {
    expect(formatMomentLocalized(D, "dddd")).toBe("Wednesday");
  });

  /**
   * The whole reason there are two functions. If localisation ever leaked into
   * `formatMoment`, every daily note created before the language switch would
   * stop being found by `parseDailyNoteDate` — the file name would no longer
   * match the format that produced it.
   */
  it("never leaks into the file-name path", () => {
    setDateLocaleForTests(de);
    expect(formatMoment(D, "dddd")).toBe("Wednesday");
    expect(buildDailyNotePath(D, "dddd, DD.MM.", "Daily").fullPath).toBe("Daily/Wednesday, 29.07..md");
  });

  it("leaves numeric formats untouched, whatever the language", () => {
    setDateLocaleForTests(de);
    expect(formatMomentLocalized(D, "YYYY-MM-DD")).toBe("2026-07-29");
    expect(formatMomentLocalized(D, "HH:mm")).toBe("14:37");
  });

  it("does not throw on a broken format just because a locale is active", () => {
    setDateLocaleForTests(de);
    for (const bad of ["YYYY-'", "[unterminated", "", "%s"]) {
      expect(() => formatMomentLocalized(D, bad)).not.toThrow();
    }
  });
});

describe("loadDateLocale", () => {
  afterEach(() => setDateLocaleForTests(undefined));

  /**
   * Nine literal imports with hand-written export names (`ptBR`, `zhCN`) — a
   * typo in any of them fails silently by falling back to English, which is
   * exactly the bug this is meant to fix. So every registered language gets
   * loaded for real once.
   */
  it("resolves a real locale for every app language", async () => {
    for (const { code } of APP_LANGUAGES) {
      await loadDateLocale(code);
      const locale = getDateLocale();
      if (code === "en") {
        expect(locale, "English is the date-fns default and needs no chunk").toBeUndefined();
      } else {
        expect(locale, `no date-fns locale loaded for ${code}`).toBeDefined();
        expect(formatMomentLocalized(D, "dddd")).not.toBe("Wednesday");
      }
    }
  });

  it("clears the locale for an unknown code instead of keeping the old one", async () => {
    await loadDateLocale("de");
    expect(getDateLocale()).toBeDefined();
    await loadDateLocale("xx-YY");
    expect(getDateLocale()).toBeUndefined();
  });

  /**
   * The wiring, not the loader. Switching the language has to bring the date
   * locale with it — otherwise dates keep the language the app started in, and
   * nothing anywhere would say so.
   */
  it("follows a language switch", async () => {
    await changeAppLanguage("de");
    expect(formatMomentLocalized(D, "dddd")).toBe("Mittwoch");
    await changeAppLanguage("en");
    expect(formatMomentLocalized(D, "dddd")).toBe("Wednesday");
  });
});
