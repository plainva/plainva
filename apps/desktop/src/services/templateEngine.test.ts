import { describe, it, expect, afterEach } from "vitest";
import { de } from "date-fns/locale/de";
import {
  applyTemplatePlaceholders,
  extractTemplatePrompts,
  finalizeTemplate,
  resolveTemplate,
  scanTemplate,
  setDateLocaleForTests,
  type TemplateContext,
} from "@plainva/ui";

const NOW = new Date(2026, 6, 29, 14, 37); // Wednesday, 29 July 2026, 14:37
const ctx = (extra: Partial<TemplateContext> = {}): TemplateContext => ({ title: "Meine Notiz", now: NOW, ...extra });

const head = (text: string, extra: Partial<TemplateContext> = {}) => resolveTemplate(text, ctx(extra), "headless").text;

describe("scanTemplate", () => {
  it("reads name, offset and argument out of one grammar", () => {
    const tokens = scanTemplate("{{title}} {{date+7}} {{date:DD.MM.}} {{prompt:Stimmung|gut}}");
    expect(tokens.map((t) => t.name)).toEqual(["title", "date", "date", "prompt"]);
    expect(tokens[1].offset).toBe(7);
    expect(tokens[2].arg).toBe("DD.MM.");
    expect(tokens[3].arg).toBe("Stimmung|gut");
  });

  it("marks an escaped token", () => {
    expect(scanTemplate("\\{{date}}")[0].escaped).toBe(true);
    expect(scanTemplate("{{date}}")[0].escaped).toBe(false);
  });
});

describe("resolveTemplate — the always-resolvable tokens", () => {
  it("keeps the three tokens that existed before working exactly as they did", () => {
    expect(head("# {{title}}")).toBe("# Meine Notiz");
    expect(head("{{date}}")).toBe("2026-07-29");
    expect(head("{{time}}")).toBe("14:37");
  });

  it("formats with Moment tokens", () => {
    expect(head("{{date:DD.MM.YYYY}}")).toBe("29.07.2026");
    expect(head("{{date:dddd}}")).toBe("Wednesday");
    expect(head("{{time:HH-mm}}")).toBe("14-37");
  });

  it("counts day offsets from the reference instant", () => {
    expect(head("{{date+1}}")).toBe("2026-07-30");
    expect(head("{{date-1}}")).toBe("2026-07-28");
    expect(head("{{date+7}}")).toBe("2026-08-05");
    expect(head("{{date-30}}")).toBe("2026-06-29");
  });

  it("combines offset and format", () => {
    expect(head("{{date+1:DD.MM.}}")).toBe("30.07.");
  });

  it("has yesterday/tomorrow as the readable shorthand", () => {
    expect(head("{{yesterday}}")).toBe(head("{{date-1}}"));
    expect(head("{{tomorrow}}")).toBe(head("{{date+1}}"));
  });

  it("fills folder and vault from the context", () => {
    expect(head("{{folder}}", { folder: "Projekte/2026" })).toBe("Projekte/2026");
    expect(head("{{vault}}", { vaultName: "Wissen" })).toBe("Wissen");
    // Absent context is empty, not the literal token.
    expect(head("{{folder}}")).toBe("");
  });
});

describe("resolveTemplate — escaping and unknown tokens", () => {
  it("writes an escaped token into the note instead of resolving it", () => {
    expect(head("\\{{date}}")).toBe("{{date}}");
    expect(head("\\{{prompt:Stimmung}}")).toBe("{{prompt:Stimmung}}");
  });

  it("leaves an unknown token visible rather than swallowing it", () => {
    // A typo must look like a typo, not like a broken feature.
    expect(head("{{titel}}")).toBe("{{titel}}");
  });
});

describe("resolveTemplate — the two modes", () => {
  const TPL = "Stimmung: {{prompt:Stimmung|neutral}}\nStatus: {{select:Status|Offen,Fertig}}\nFällig: {{date_prompt:Fällig}}";

  it("headless never asks — it takes the default, else nothing", () => {
    const r = resolveTemplate(TPL, ctx(), "headless");
    expect(r.requests).toEqual([]);
    expect(r.text).toContain("Stimmung: neutral");
    expect(r.text).toContain("Status: \n");
    expect(r.text).not.toContain("{{");
  });

  it("interactive collects the questions with kind, default and options", () => {
    const r = resolveTemplate(TPL, ctx(), "interactive");
    expect(r.requests).toEqual([
      { label: "Stimmung", kind: "text", defaultValue: "neutral", options: undefined },
      { label: "Status", kind: "select", defaultValue: undefined, options: ["Offen", "Fertig"] },
      { label: "Fällig", kind: "date", defaultValue: undefined, options: undefined },
    ]);
    // The tokens stay in place until the answers arrive.
    expect(r.text).toContain("{{prompt:Stimmung|neutral}}");
  });

  it("asks for a repeated label only once", () => {
    const r = resolveTemplate("{{prompt:Wer}} und {{prompt:Wer}}", ctx(), "interactive");
    expect(r.requests).toHaveLength(1);
  });
});

describe("resolveTemplate — injected sources", () => {
  it("uses the providers when they are there", () => {
    // The clipboard deliberately does NOT resolve here any more (decision E7,
    // P5): headless it stays empty, interactively it becomes a pre-filled
    // question. Its behaviour is covered in the clipboard/selection block below.
    expect(head("{{selection}}", { selection: () => "markiert" })).toBe("markiert");
    expect(head("{{daily+1}}", { dailyPath: (o) => `2026-07-${29 + o}` })).toBe("[[2026-07-30]]");
  });

  it("reports a missing source instead of throwing", () => {
    const r = resolveTemplate("{{clipboard}} {{daily-1}}", ctx(), "headless");
    expect(r.unresolved).toHaveLength(2);
    // Clipboard yields nothing; a daily LINK cannot be faked, so it stays put.
    expect(r.text).toContain("{{daily-1}}");
  });
});

describe("resolveTemplate — dates in the app language", () => {
  afterEach(() => setDateLocaleForTests(undefined));

  /**
   * A date in a note is a sentence someone READS, so it follows the app
   * language — unlike the daily-note FILE name, which stays English so the
   * notes keep being found (see momentFormat.test.ts).
   */
  it("localises the tokens that produce words", () => {
    setDateLocaleForTests(de);
    expect(head("{{date:dddd, D. MMMM YYYY}}")).toBe("Mittwoch, 29. Juli 2026");
    expect(head("{{tomorrow:dddd}}")).toBe("Donnerstag");
    expect(head("{{yesterday:dddd}}")).toBe("Dienstag");
    expect(head("{{weekday:friday:dddd, D. MMMM}}")).toBe("Freitag, 31. Juli");
  });

  it("stays English while no locale is loaded", () => {
    expect(head("{{date:dddd}}")).toBe("Wednesday");
  });

  it("leaves numeric formats alone", () => {
    setDateLocaleForTests(de);
    expect(head("{{date}}")).toBe("2026-07-29");
    expect(head("{{time}}")).toBe("14:37");
  });
});

describe("resolveTemplate — {{daily}} labels", () => {
  const daily = { dailyPath: (o: number) => `Tagebuch/2026-07-${29 + o}` };

  it("shows the label instead of the path", () => {
    expect(head("{{daily+1:Morgen}}", daily)).toBe("[[Tagebuch/2026-07-30|Morgen]]");
    expect(head("{{daily:Heute}}", daily)).toBe("[[Tagebuch/2026-07-29|Heute]]");
    expect(head("{{daily-1:Gestern}}", daily)).toBe("[[Tagebuch/2026-07-28|Gestern]]");
  });

  it("still writes a plain link without a label", () => {
    expect(head("{{daily+1}}", daily)).toBe("[[Tagebuch/2026-07-30]]");
  });

  it("strips the characters a wiki link is built from", () => {
    // Left in, `]]` would end the link early and the rest would land in the
    // note as loose text pointing nowhere.
    expect(head("{{daily:Tag]] und [[mehr}}", daily)).toBe("[[Tagebuch/2026-07-29|Tag und mehr]]");
    expect(head("{{daily:A|B}}", daily)).toBe("[[Tagebuch/2026-07-29|AB]]");
  });

  it("falls back to a plain link when nothing survives the cleanup", () => {
    expect(head("{{daily:[[|]]}}", daily)).toBe("[[Tagebuch/2026-07-29]]");
    expect(head("{{daily:   }}", daily)).toBe("[[Tagebuch/2026-07-29]]");
  });
});

describe("finalizeTemplate", () => {
  it("fills answers by label and strips every cursor marker", () => {
    const { text, cursor } = finalizeTemplate("A {{prompt:X|d}} B {{cursor}} C {{cursor}}", { X: "eingesetzt" });
    expect(text).toBe("A eingesetzt B  C ");
    // The caret lands where the FIRST marker stood: right after "A eingesetzt B ".
    expect(cursor).toBe("A eingesetzt B ".length);
    expect(text.slice(0, cursor!)).toBe("A eingesetzt B ");
  });

  it("fills select and date questions too", () => {
    const { text } = finalizeTemplate("{{select:S|a,b}} {{date_prompt:D}}", { S: "b", D: "2026-08-01" });
    expect(text).toBe("b 2026-08-01");
  });

  it("blanks a question nobody answered", () => {
    expect(finalizeTemplate("{{prompt:X|default}}").text).toBe("");
  });

  it("keeps an escaped question as text", () => {
    expect(finalizeTemplate("\\{{prompt:X}}", { X: "y" }).text).toBe("{{prompt:X}}");
  });
});

describe("extractTemplatePrompts", () => {
  it("returns unique labels in first-seen order, across all question kinds", () => {
    expect(extractTemplatePrompts("{{prompt:B}} {{select:A|1,2}} {{prompt:B}} {{date_prompt:C}}")).toEqual(["B", "A", "C"]);
  });

  it("takes the label from a default-carrying prompt", () => {
    expect(extractTemplatePrompts("{{prompt:Stimmung|gut}}")).toEqual(["Stimmung"]);
  });

  it("ignores an escaped token", () => {
    expect(extractTemplatePrompts("\\{{prompt:X}}")).toEqual([]);
  });
});

describe("applyTemplatePlaceholders — the headless facade", () => {
  it("still behaves the way every existing caller expects", () => {
    const out = applyTemplatePlaceholders("# {{title}}\n{{date}} {{time}}\n{{cursor}}{{prompt:X}}", "Titel", NOW);
    expect(out).toBe("# Titel\n2026-07-29 14:37\n");
  });

  it("still removes the template-only plainva keys", () => {
    const out = applyTemplatePlaceholders(
      '---\ntype: Note\nplainva:\n  tasks: false\n  templateFor:\n    - "[[A.base]]"\n---\n\nBody\n',
      "Titel",
      NOW
    );
    expect(out).not.toContain("tasks: false");
    expect(out).not.toContain("templateFor");
    expect(out).toContain("type: Note");
  });

  it("accepts the extra context the newer tokens need", () => {
    expect(applyTemplatePlaceholders("{{folder}}/{{vault}}", "T", NOW, { folder: "F", vaultName: "V" })).toBe("F/V");
  });
});

describe("{{weekday:…}}", () => {
  // NOW is Wednesday, 29 July 2026. With a Monday start, that week runs
  // Mon 27 July – Sun 2 August.
  it("gives the named day of the CURRENT week", () => {
    expect(head("{{weekday:monday}}")).toBe("2026-07-27");
    expect(head("{{weekday:friday}}")).toBe("2026-07-31");
    // Earlier in the week is still this week — the token names a day, not a
    // direction.
    expect(head("{{weekday:tuesday}}")).toBe("2026-07-28");
  });

  it("takes 'next' and 'last' for the neighbouring weeks", () => {
    expect(head("{{weekday:next friday}}")).toBe("2026-08-07");
    expect(head("{{weekday:last monday}}")).toBe("2026-07-20");
  });

  it("follows where the week begins", () => {
    // With a Sunday start the current week is 26 July – 1 August, so "sunday"
    // is the day BEFORE today; with a Monday start it is the day after.
    expect(head("{{weekday:sunday}}", { weekStart: 0 })).toBe("2026-07-26");
    expect(head("{{weekday:sunday}}", { weekStart: 1 })).toBe("2026-08-02");
  });

  it("takes a format after a second colon", () => {
    expect(head("{{weekday:monday:DD.MM.YYYY}}")).toBe("27.07.2026");
    expect(head("{{weekday:next friday:dddd}}")).toBe("Friday");
  });

  it("accepts the short day names, because a token that stalls on 'mon' reads as broken", () => {
    expect(head("{{weekday:mon}}")).toBe(head("{{weekday:monday}}"));
    expect(head("{{weekday:next fri}}")).toBe(head("{{weekday:next friday}}"));
  });

  it("leaves an unreadable day visible instead of resolving to nothing", () => {
    const r = resolveTemplate("{{weekday:mondat}}", ctx(), "headless");
    expect(r.text).toBe("{{weekday:mondat}}");
    expect(r.unresolved).toEqual(["{{weekday:mondat}}"]);
  });
});

describe("{{clipboard}} and {{selection}}", () => {
  it("asks about the clipboard instead of pasting it silently (E7)", () => {
    const r = resolveTemplate("Quelle: {{clipboard}}", ctx({ clipboard: () => "hunter2" }), "interactive");
    // The value arrives PRE-FILLED as a question — visible and editable —
    // rather than landing in a note that then syncs.
    expect(r.requests).toEqual([{ label: "Clipboard", kind: "text", defaultValue: "hunter2" }]);
    expect(finalizeTemplate(r.text, { Clipboard: "hunter2" }).text).toBe("Quelle: hunter2");
    // And the answer is what wins, not the clipboard.
    expect(finalizeTemplate(r.text, { Clipboard: "etwas anderes" }).text).toBe("Quelle: etwas anderes");
  });

  it("leaves the clipboard empty in the background, where nobody could see the question", () => {
    expect(head("[{{clipboard}}]", { clipboard: () => "hunter2" })).toBe("[]");
  });

  it("carries a template's own label for the clipboard question", () => {
    const r = resolveTemplate("{{clipboard:Quelle}}", ctx({ clipboard: () => "x" }), "interactive");
    expect(r.requests[0].label).toBe("Quelle");
  });

  it("inserts the selection silently — the person marked it themselves", () => {
    expect(head("> {{selection}}", { selection: () => "markierter Satz" })).toBe("> markierter Satz");
  });

  it("reports a missing source rather than throwing", () => {
    const r = resolveTemplate("{{selection}}{{clipboard}}", ctx(), "interactive");
    expect(r.text).toBe("");
    expect(r.unresolved).toEqual(["{{selection}}", "{{clipboard}}"]);
  });
});
