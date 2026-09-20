import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { captureVocabularyFrom, parseTaskCapture, weekdayOfKey, type CaptureVocabulary } from "@plainva/ui";

/**
 * Plan Aufgaben-Oberfläche, B2: one sentence in, one task out — in all ten
 * languages, from the words the locale files actually carry.
 */

// A Monday. "Montag" said on a Monday means the NEXT one.
const TODAY = "2026-09-21";
const LOCALES = join(__dirname, "../../../packages/ui/src/locales");

function vocab(lang: string): CaptureVocabulary {
  const tasks = JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), "utf8")).tasks as Record<string, string>;
  return captureVocabularyFrom(
    {
      today: tasks.captureToday, tomorrow: tasks.captureTomorrow, dayAfterTomorrow: tasks.captureDayAfterTomorrow,
      nextWeek: tasks.captureNextWeek, inDays: tasks.captureInDays, inWeeks: tasks.captureInWeeks,
      daily: tasks.captureDaily, weekly: tasks.captureWeekly, monthly: tasks.captureMonthly, yearly: tasks.captureYearly,
      every: tasks.captureEvery, everyNDays: tasks.captureEveryNDays, everyNWeeks: tasks.captureEveryNWeeks,
      oclock: tasks.captureOclock, at: tasks.captureAt,
    },
    lang,
    tasks.captureWeekdays,
  );
}

/** What a sentence must come out as; omitted fields must stay empty. */
interface Expectation {
  title: string;
  due?: string | null;
  minutes?: number | null;
  priority?: number;
  tags?: string[];
  repeat?: [string, number] | null;
}

function check(lang: string, sentence: string, want: Expectation) {
  const got = parseTaskCapture(sentence, vocab(lang), TODAY);
  expect({ sentence, title: got.title, due: got.due, minutes: got.minutes, priority: got.priority, tags: got.tags, repeat: got.repeat ? [got.repeat.freq, got.repeat.interval] : null }).toEqual({
    sentence, title: want.title, due: want.due ?? null, minutes: want.minutes ?? null, priority: want.priority ?? 0, tags: want.tags ?? [], repeat: want.repeat ?? null,
  });
}

describe("parseTaskCapture — what needs no language", () => {
  it("reads ISO dates, times, priority marks and tags in any language", () => {
    for (const lang of ["de", "en", "fr", "ja", "zh-CN"]) {
      check(lang, "Report 2026-10-02 09:30 !!! #work", { title: "Report", due: "2026-10-02", minutes: 570, priority: 1, tags: ["work"] });
    }
  });

  it("maps !, !! and !!! to low, medium and high — and ignores a fourth", () => {
    expect(parseTaskCapture("a !", vocab("en"), TODAY).priority).toBe(3);
    expect(parseTaskCapture("a !!", vocab("en"), TODAY).priority).toBe(2);
    expect(parseTaskCapture("a !!!", vocab("en"), TODAY).priority).toBe(1);
    expect(parseTaskCapture("Wow!!!! really", vocab("en"), TODAY)).toMatchObject({ priority: 0, title: "Wow!!!! really" });
    // Punctuation that belongs to a word is not a mark.
    expect(parseTaskCapture("Call Anna!", vocab("en"), TODAY)).toMatchObject({ priority: 0, title: "Call Anna!" });
  });

  it("leaves what it does not recognise in the title — all of it", () => {
    const got = parseTaskCapture("Steuer 2025 prüfen, Seite 14 von 30", vocab("de"), TODAY);
    expect(got).toMatchObject({ title: "Steuer 2025 prüfen, Seite 14 von 30", due: null, minutes: null, bricks: [] });
  });

  it("a time without a day means today; a written date beats the one a weekday rhythm implies", () => {
    expect(parseTaskCapture("Anruf 16:00", vocab("de"), TODAY)).toMatchObject({ due: TODAY, minutes: 960 });
    const got = parseTaskCapture("Tonne raus jeden Donnerstag 01.10.", vocab("de"), TODAY);
    expect(got).toMatchObject({ title: "Tonne raus", due: "2026-10-01", repeat: { freq: "weekly", interval: 1 } });
  });

  it("a day and month without a year is the next such day, never a past one", () => {
    expect(parseTaskCapture("Geschenk 24.12.", vocab("de"), TODAY).due).toBe("2026-12-24");
    expect(parseTaskCapture("Rückblick 05.01.", vocab("de"), TODAY).due).toBe("2027-01-05");
    expect(parseTaskCapture("Unsinn 31.02.", vocab("de"), TODAY)).toMatchObject({ due: null, title: "Unsinn 31.02." });
    // The language decides what 3/4 means.
    expect(parseTaskCapture("x 3/4", vocab("en"), TODAY).due).toBe("2027-03-04");
    expect(parseTaskCapture("x 3/4", vocab("it"), TODAY).due).toBe("2027-04-03");
  });

  it("reports every match as a brick, and a switched-off brick goes back into the title", () => {
    const v = vocab("de");
    const first = parseTaskCapture("Angebot morgen 14 Uhr !! #kunde", v, TODAY);
    expect(first.bricks.map((b) => [b.kind, b.text, b.active])).toEqual([
      ["date", "morgen", true], ["time", "14 Uhr", true], ["priority", "!!", true], ["tag", "#kunde", true],
    ]);
    const timeBrick = first.bricks.find((b) => b.kind === "time")!;
    const second = parseTaskCapture("Angebot morgen 14 Uhr !! #kunde", v, TODAY, new Set([timeBrick.id]));
    expect(second).toMatchObject({ title: "Angebot 14 Uhr", due: "2026-09-22", minutes: null });
    expect(second.bricks.find((b) => b.kind === "time")).toMatchObject({ active: false });
  });
});

/** Twelve sentences per language (plan § 5). Dates are relative to Monday 2026-09-21. */
const SENTENCES: Record<string, Array<[string, Expectation]>> = {
  de: [
    ["Angebot abschicken morgen 14 Uhr !!! #kunde jeden Monat", { title: "Angebot abschicken", due: "2026-09-22", minutes: 840, priority: 1, tags: ["kunde"], repeat: ["monthly", 1] }],
    ["Blumen gießen heute", { title: "Blumen gießen", due: TODAY }],
    ["Zahnarzt übermorgen um 9:15", { title: "Zahnarzt", due: "2026-09-23", minutes: 555 }],
    ["Bericht nächste Woche", { title: "Bericht", due: "2026-09-28" }],
    ["Rechnung in 3 Tagen", { title: "Rechnung", due: "2026-09-24" }],
    ["Review in 2 Wochen", { title: "Review", due: "2026-10-05" }],
    ["Müll raus Freitag", { title: "Müll raus", due: "2026-09-25" }],
    ["Wochenplanung jeden Montag 8 Uhr", { title: "Wochenplanung", due: "2026-09-28", minutes: 480, repeat: ["weekly", 1] }],
    ["Backup prüfen täglich", { title: "Backup prüfen", repeat: ["daily", 1] }],
    ["Filter wechseln alle 14 Tage", { title: "Filter wechseln", repeat: ["daily", 14] }],
    ["Steuer 21.10.2026", { title: "Steuer", due: "2026-10-21" }],
    ["Geburtstag Oma jährlich 03.05.", { title: "Geburtstag Oma", due: "2027-05-03", repeat: ["yearly", 1] }],
  ],
  en: [
    ["Send offer tomorrow at 2pm !!! #client every month", { title: "Send offer", due: "2026-09-22", minutes: 840, priority: 1, tags: ["client"], repeat: ["monthly", 1] }],
    ["Water plants today", { title: "Water plants", due: TODAY }],
    ["Dentist day after tomorrow 9:15", { title: "Dentist", due: "2026-09-23", minutes: 555 }],
    ["Report next week", { title: "Report", due: "2026-09-28" }],
    ["Invoice in 3 days", { title: "Invoice", due: "2026-09-24" }],
    ["Review in 2 weeks", { title: "Review", due: "2026-10-05" }],
    ["Bins out Friday", { title: "Bins out", due: "2026-09-25" }],
    ["Weekly planning every Monday 8am", { title: "Weekly planning", due: "2026-09-28", minutes: 480, repeat: ["weekly", 1] }],
    ["Check backup daily", { title: "Check backup", repeat: ["daily", 1] }],
    ["Change filter every 14 days", { title: "Change filter", repeat: ["daily", 14] }],
    ["Taxes 10/21/2026", { title: "Taxes", due: "2026-10-21" }],
    ["Call mum 12am", { title: "Call mum", due: TODAY, minutes: 0 }],
  ],
  es: [
    ["Enviar oferta mañana a las 14:00 !!! #cliente cada mes", { title: "Enviar oferta", due: "2026-09-22", minutes: 840, priority: 1, tags: ["cliente"], repeat: ["monthly", 1] }],
    ["Regar las plantas hoy", { title: "Regar las plantas", due: TODAY }],
    ["Dentista pasado mañana 9:15", { title: "Dentista", due: "2026-09-23", minutes: 555 }],
    ["Informe la próxima semana", { title: "Informe", due: "2026-09-28" }],
    ["Factura en 3 días", { title: "Factura", due: "2026-09-24" }],
    ["Revisión en 2 semanas", { title: "Revisión", due: "2026-10-05" }],
    ["Sacar la basura viernes", { title: "Sacar la basura", due: "2026-09-25" }],
    ["Planificación cada lunes 8 h", { title: "Planificación", due: "2026-09-28", minutes: 480, repeat: ["weekly", 1] }],
    ["Revisar copia diariamente", { title: "Revisar copia", repeat: ["daily", 1] }],
    ["Cambiar filtro cada 14 días", { title: "Cambiar filtro", repeat: ["daily", 14] }],
    ["Impuestos 21/10/2026", { title: "Impuestos", due: "2026-10-21" }],
    ["Gimnasio todos los sábados", { title: "Gimnasio", due: "2026-09-26", repeat: ["weekly", 1] }],
  ],
  fr: [
    ["Envoyer l'offre demain à 14h30 !!! #client chaque mois", { title: "Envoyer l'offre", due: "2026-09-22", minutes: 870, priority: 1, tags: ["client"], repeat: ["monthly", 1] }],
    ["Arroser les plantes aujourd'hui", { title: "Arroser les plantes", due: TODAY }],
    ["Dentiste après-demain 9:15", { title: "Dentiste", due: "2026-09-23", minutes: 555 }],
    ["Rapport la semaine prochaine", { title: "Rapport", due: "2026-09-28" }],
    ["Facture dans 3 jours", { title: "Facture", due: "2026-09-24" }],
    ["Revue dans 2 semaines", { title: "Revue", due: "2026-10-05" }],
    ["Sortir la poubelle vendredi", { title: "Sortir la poubelle", due: "2026-09-25" }],
    ["Planification chaque lundi 8 h", { title: "Planification", due: "2026-09-28", minutes: 480, repeat: ["weekly", 1] }],
    ["Vérifier la sauvegarde tous les jours", { title: "Vérifier la sauvegarde", repeat: ["daily", 1] }],
    ["Changer le filtre tous les 14 jours", { title: "Changer le filtre", repeat: ["daily", 14] }],
    ["Impôts 21/10/2026", { title: "Impôts", due: "2026-10-21" }],
    ["Marché tous les samedis", { title: "Marché", due: "2026-09-26", repeat: ["weekly", 1] }],
  ],
  it: [
    ["Inviare l'offerta domani alle 14:00 !!! #cliente ogni mese", { title: "Inviare l'offerta", due: "2026-09-22", minutes: 840, priority: 1, tags: ["cliente"], repeat: ["monthly", 1] }],
    ["Annaffiare le piante oggi", { title: "Annaffiare le piante", due: TODAY }],
    ["Dentista dopodomani 9:15", { title: "Dentista", due: "2026-09-23", minutes: 555 }],
    ["Relazione la prossima settimana", { title: "Relazione", due: "2026-09-28" }],
    ["Fattura tra 3 giorni", { title: "Fattura", due: "2026-09-24" }],
    ["Revisione fra 2 settimane", { title: "Revisione", due: "2026-10-05" }],
    ["Portare fuori la spazzatura venerdì", { title: "Portare fuori la spazzatura", due: "2026-09-25" }],
    ["Pianificazione ogni lunedì 8 h", { title: "Pianificazione", due: "2026-09-28", minutes: 480, repeat: ["weekly", 1] }],
    ["Controllare il backup ogni giorno", { title: "Controllare il backup", repeat: ["daily", 1] }],
    ["Cambiare il filtro ogni 14 giorni", { title: "Cambiare il filtro", repeat: ["daily", 14] }],
    ["Tasse 21/10/2026", { title: "Tasse", due: "2026-10-21" }],
    ["Bolletta ogni anno 03/05", { title: "Bolletta", due: "2027-05-03", repeat: ["yearly", 1] }],
  ],
  ja: [
    ["明日 見積もりを送る 14:00 !!! #顧客", { title: "見積もりを送る", due: "2026-09-22", minutes: 840, priority: 1, tags: ["顧客"] }],
    ["植物に水をやる 今日", { title: "植物に水をやる", due: TODAY }],
    ["明後日 歯医者 9:15", { title: "歯医者", due: "2026-09-23", minutes: 555 }],
    ["報告書 来週", { title: "報告書", due: "2026-09-28" }],
    ["請求書 3日後", { title: "請求書", due: "2026-09-24" }],
    ["レビュー 2週間後", { title: "レビュー", due: "2026-10-05" }],
    ["ゴミ出し 金曜日", { title: "ゴミ出し", due: "2026-09-25" }],
    ["毎週月曜日 週の計画 8時", { title: "週の計画", due: "2026-09-28", minutes: 480, repeat: ["weekly", 1] }],
    ["バックアップ確認 毎日", { title: "バックアップ確認", repeat: ["daily", 1] }],
    ["家賃 毎月", { title: "家賃", repeat: ["monthly", 1] }],
    ["税金 2026/10/21", { title: "税金", due: "2026-10-21" }],
    ["会議 10月2日 14時30分", { title: "会議", due: "2026-10-02", minutes: 870 }],
  ],
  nl: [
    ["Offerte versturen morgen om 14:00 !!! #klant elke maand", { title: "Offerte versturen", due: "2026-09-22", minutes: 840, priority: 1, tags: ["klant"], repeat: ["monthly", 1] }],
    ["Planten water geven vandaag", { title: "Planten water geven", due: TODAY }],
    ["Tandarts overmorgen 9:15", { title: "Tandarts", due: "2026-09-23", minutes: 555 }],
    ["Rapport volgende week", { title: "Rapport", due: "2026-09-28" }],
    ["Factuur over 3 dagen", { title: "Factuur", due: "2026-09-24" }],
    ["Review over 2 weken", { title: "Review", due: "2026-10-05" }],
    ["Vuilnis buiten vrijdag", { title: "Vuilnis buiten", due: "2026-09-25" }],
    ["Weekplanning elke maandag 8 uur", { title: "Weekplanning", due: "2026-09-28", minutes: 480, repeat: ["weekly", 1] }],
    ["Back-up controleren dagelijks", { title: "Back-up controleren", repeat: ["daily", 1] }],
    ["Filter vervangen om de 14 dagen", { title: "Filter vervangen", repeat: ["daily", 14] }],
    ["Belasting 21-10-2026", { title: "Belasting 21-10-2026" }],
    ["Belasting 21.10.2026", { title: "Belasting", due: "2026-10-21" }],
  ],
  pl: [
    ["Wysłać ofertę jutro o 14:00 !!! #klient co miesiąc", { title: "Wysłać ofertę", due: "2026-09-22", minutes: 840, priority: 1, tags: ["klient"], repeat: ["monthly", 1] }],
    ["Podlać kwiaty dziś", { title: "Podlać kwiaty", due: TODAY }],
    ["Dentysta pojutrze 9:15", { title: "Dentysta", due: "2026-09-23", minutes: 555 }],
    ["Raport w przyszłym tygodniu", { title: "Raport", due: "2026-09-28" }],
    ["Faktura za 3 dni", { title: "Faktura", due: "2026-09-24" }],
    ["Przegląd za 2 tygodnie", { title: "Przegląd", due: "2026-10-05" }],
    ["Wynieść śmieci piątek", { title: "Wynieść śmieci", due: "2026-09-25" }],
    ["Planowanie w każdy poniedziałek 8:00", { title: "Planowanie", due: "2026-09-28", minutes: 480, repeat: ["weekly", 1] }],
    ["Sprawdzić kopię codziennie", { title: "Sprawdzić kopię", repeat: ["daily", 1] }],
    ["Wymienić filtr co 14 dni", { title: "Wymienić filtr", repeat: ["daily", 14] }],
    ["Podatki 21.10.2026", { title: "Podatki", due: "2026-10-21" }],
    ["Basen w każdą środę", { title: "Basen", due: "2026-09-23", repeat: ["weekly", 1] }],
  ],
  "pt-BR": [
    ["Enviar proposta amanhã às 14h30 !!! #cliente todo mês", { title: "Enviar proposta", due: "2026-09-22", minutes: 870, priority: 1, tags: ["cliente"], repeat: ["monthly", 1] }],
    ["Regar as plantas hoje", { title: "Regar as plantas", due: TODAY }],
    ["Dentista depois de amanhã 9:15", { title: "Dentista", due: "2026-09-23", minutes: 555 }],
    ["Relatório semana que vem", { title: "Relatório", due: "2026-09-28" }],
    ["Fatura em 3 dias", { title: "Fatura", due: "2026-09-24" }],
    ["Revisão em 2 semanas", { title: "Revisão", due: "2026-10-05" }],
    ["Levar o lixo sexta", { title: "Levar o lixo", due: "2026-09-25" }],
    ["Planejamento toda segunda 8 h", { title: "Planejamento", due: "2026-09-28", minutes: 480, repeat: ["weekly", 1] }],
    ["Verificar backup diariamente", { title: "Verificar backup", repeat: ["daily", 1] }],
    ["Trocar o filtro a cada 14 dias", { title: "Trocar o filtro", repeat: ["daily", 14] }],
    ["Impostos 21/10/2026", { title: "Impostos", due: "2026-10-21" }],
    ["Feira todos os sábados", { title: "Feira", due: "2026-09-26", repeat: ["weekly", 1] }],
  ],
  "zh-CN": [
    ["明天 发送报价 14:00 !!! #客户", { title: "发送报价", due: "2026-09-22", minutes: 840, priority: 1, tags: ["客户"] }],
    ["给植物浇水 今天", { title: "给植物浇水", due: TODAY }],
    ["后天 牙医 9:15", { title: "牙医", due: "2026-09-23", minutes: 555 }],
    ["报告 下周", { title: "报告", due: "2026-09-28" }],
    ["发票 3天后", { title: "发票", due: "2026-09-24" }],
    ["评审 2周后", { title: "评审", due: "2026-10-05" }],
    ["倒垃圾 星期五", { title: "倒垃圾", due: "2026-09-25" }],
    ["每周一 周计划 8点", { title: "周计划", due: "2026-09-28", minutes: 480, repeat: ["weekly", 1] }],
    ["检查备份 每天", { title: "检查备份", repeat: ["daily", 1] }],
    ["房租 每月", { title: "房租", repeat: ["monthly", 1] }],
    ["税务 2026/10/21", { title: "税务", due: "2026-10-21" }],
    ["会议 10月2日 14点30分", { title: "会议", due: "2026-10-02", minutes: 870 }],
  ],
};

describe("parseTaskCapture — twelve sentences per language", () => {
  it("starts from a Monday, so the expectations below can be read off a calendar", () => {
    expect(weekdayOfKey(TODAY)).toBe(0);
  });
  for (const [lang, sentences] of Object.entries(SENTENCES)) {
    it(`${lang}: reads its own words`, () => {
      expect(sentences).toHaveLength(12);
      for (const [sentence, want] of sentences) check(lang, sentence, want);
    });
  }
});
