import { DEFAULT_DAILY_NOTE_TYPE, welcomeBody, type VaultTemplateDefinition } from "./types";
import { defineBase } from "./baseBuilders";
import { buildPlainvaTour, TOUR_STRINGS_DE } from "./plainvaTour";
import { buildPara, PARA_STRINGS_DE } from "./paraTemplate";
import { buildGtd, GTD_STRINGS_DE } from "./gtdTemplate";
import { buildZettelkasten, ZK_STRINGS_DE } from "./zettelkastenTemplate";

/** German template set — folder/file names follow the app language.
 *
 * PARA, GTD, Zettelkasten and Journal additionally ship pre-wired `.base`
 * databases (Gesamtplan DB-Vorlagen 2026-07-04); ACE and Johnny.Decimal stay
 * link-/folder-based on purpose. Database column KEYS are translated but kept
 * ASCII/umlaut-free; option VALUES, view names and `.base` file names are fully
 * localized. Relation columns and their reverse counterparts are wired here so
 * the databases show real data as soon as the vault is indexed. */
export function templates(): VaultTemplateDefinition[] {
  return [
    buildPlainvaTour(TOUR_STRINGS_DE),
    buildPara(PARA_STRINGS_DE),
    buildZettelkasten(ZK_STRINGS_DE),
    {
      id: "ace",
      name: "ACE (Linking Your Thinking)",
      description: "Atlas, Kalender und Vorhaben — MOC-zentriertes Arbeiten nach Nick Milo.",
      folders: ["Atlas", "Kalender", "Vorhaben"],
      notes: [
        {
          path: "Willkommen.md",
          description: "Startpunkt und Kurzanleitung für diesen Vault.",
          body: welcomeBody(
            "Willkommen",
            "Dieser Vault nutzt das ACE-Schema aus „Linking Your Thinking“ (Nick Milo): Wissen wird über Maps of Content (MOCs) verknüpft statt tief verschachtelt.",
            [
              { name: "Atlas", description: "Karten deines Wissens — MOCs und Übersichtsnotizen." },
              { name: "Kalender", description: "Zeitgebundenes — Tagesnotizen, Journale, Rückblicke." },
              { name: "Vorhaben", description: "Efforts — alles, woran du aktiv arbeitest." },
            ],
            "Starte im Atlas mit der Home-Notiz und verlinke von dort in dein Wissen."
          ),
        },
        {
          path: "Atlas/Home.md",
          description: "Deine oberste Map of Content.",
          body: "# Home\n\nDie Home-Notiz ist dein Einstiegspunkt: Verlinke hier die wichtigsten Maps of Content und aktuellen Vorhaben.\n",
        },
      ],
    },
    {
      id: "jd",
      name: "Johnny.Decimal",
      description: "Nummerierte Bereiche und Kategorien (10-19 / 11 / 11.01) für strikte Auffindbarkeit.",
      folders: [
        "00-09 System",
        "00-09 System/00 Index",
        "10-19 Privat",
        "10-19 Privat/11 Finanzen",
        "10-19 Privat/12 Gesundheit",
        "20-29 Arbeit",
        "20-29 Arbeit/21 Projekte",
        "20-29 Arbeit/22 Besprechungen",
      ],
      notes: [
        {
          path: "Willkommen.md",
          description: "Startpunkt und Kurzanleitung für diesen Vault.",
          body: welcomeBody(
            "Willkommen",
            "Dieser Vault ist nach Johnny.Decimal organisiert: maximal zehn Bereiche (10-19, 20-29, …), je Bereich maximal zehn Kategorien (11, 12, …) — und jede Notiz bekommt eine ID wie 11.01.",
            [
              { name: "00-09 System", description: "Verwaltung des Systems selbst — Index und Konventionen." },
              { name: "10-19 Privat", description: "Beispielbereich für private Themen." },
              { name: "20-29 Arbeit", description: "Beispielbereich für berufliche Themen." },
            ],
            "Benenne Bereiche und Kategorien nach deinen Themen um — die bewusst begrenzte Tiefe (Bereich → Kategorie → ID) ist der Kern der Methode."
          ),
        },
        {
          path: "00-09 System/00 Index/00.00 Index.md",
          description: "Der Johnny.Decimal-Index: alle Nummern an einem Ort.",
          body: "# 00.00 Index\n\nFühre hier die Liste aller Bereiche, Kategorien und IDs. Wer eine Nummer sucht, schaut zuerst hier.\n\n## 10-19 Privat\n\n- 11 Finanzen\n- 12 Gesundheit\n\n## 20-29 Arbeit\n\n- 21 Projekte\n- 22 Besprechungen\n",
        },
      ],
    },
    buildGtd(GTD_STRINGS_DE),
    {
      id: "journal",
      name: "Journal",
      description: "Tagesnotizen mit vorbereiteter Vorlage und Journal-Datenbank — Daily Notes sind sofort verdrahtet.",
      folders: ["Journal", "Vorlagen"],
      bases: [
        defineBase({
          path: "Journal.base",
          sourceFolder: "Journal",
          columns: [
            { key: "datum", input: "date" },
            { key: "stimmung", input: "select", options: ["Gut", "Neutral", "Schlecht", "Produktiv", "Müde"] },
            { key: "schlagworte", input: "tags" },
          ],
          views: [
            { name: "Tabelle", type: "table", sort: [{ property: "datum", direction: "DESC" }] },
            { name: "Kalender", type: "calendar", dateField: "datum" },
          ],
        }),
      ],
      notes: [
        {
          path: "Willkommen.md",
          description: "Startpunkt und Kurzanleitung für diesen Vault.",
          body: welcomeBody(
            "Willkommen",
            "Dieser Vault ist auf tägliches Schreiben ausgelegt: Tagesnotizen landen im Ordner Journal und entstehen aus der Vorlage im Ordner Vorlagen.",
            [
              { name: "Journal", description: "Deine Tagesnotizen, eine pro Tag." },
              { name: "Vorlagen", description: "Vorlagen für neue Notizen — die Tagesnotiz-Vorlage ist bereits eingerichtet." },
            ],
            "Öffne den Kalender in der rechten Seitenleiste und klicke auf einen Tag, um die erste Tagesnotiz anzulegen. Journal.base zeigt deine Einträge als Tabelle und im Kalender — mit Datum, Stimmung und Schlagworten."
          ),
        },
        {
          path: "Vorlagen/Tagesnotiz.md",
          description: "Vorlage für neue Tagesnotizen — {{date}}, {{time}} und {{title}} werden ersetzt.",
          type: DEFAULT_DAILY_NOTE_TYPE,
          properties: { datum: "{{date}}" },
          body: "# {{title}}\n\n## Notizen\n\n## Aufgaben\n\n- [ ] \n",
        },
      ],
      settings: { dailyNotesFolder: "Journal", templateFolder: "Vorlagen", dailyNoteTemplate: "Tagesnotiz.md" },
    },
  ];
}
