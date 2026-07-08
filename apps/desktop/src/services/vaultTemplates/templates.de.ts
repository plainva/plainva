import { DEFAULT_DAILY_NOTE_TYPE } from "../../contexts/VaultContext";
import { welcomeBody, type VaultTemplateDefinition } from "./types";
import { defineBase } from "./baseBuilders";

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
    {
      id: "para",
      name: "PARA",
      description: "Projekte, Bereiche, Ressourcen, Archiv — nach Handlungsnähe sortiert (Tiago Forte).",
      folders: ["Projekte", "Aufgaben", "Bereiche", "Ressourcen", "Archiv", "Vorlagen"],
      bases: [
        defineBase({
          path: "Projekte.base",
          sourceFolder: "Projekte",
          columns: [
            { key: "status", input: "status", options: ["Geplant", "Aktiv", "Wartet", "Abgeschlossen"] },
            { key: "bereich", input: "relation", relationBase: "Bereiche.base", relationLimit: "one" },
            { key: "frist", input: "date" },
            { key: "aufgaben", reverseOf: { base: "Aufgaben.base", property: "projekt" } },
          ],
          views: [
            { name: "Tabelle", type: "table" },
            { name: "Nach Status", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Vorlagen/Projekt.md",
        }),
        defineBase({
          path: "Aufgaben.base",
          sourceFolder: "Aufgaben",
          columns: [
            { key: "status", input: "status", options: ["Offen", "In Arbeit", "Erledigt"] },
            { key: "projekt", input: "relation", relationBase: "Projekte.base", relationLimit: "one" },
            { key: "frist", input: "date" },
          ],
          views: [
            { name: "Tabelle", type: "table" },
            { name: "Nach Status", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Vorlagen/Aufgabe.md",
        }),
        defineBase({
          path: "Bereiche.base",
          sourceFolder: "Bereiche",
          columns: [{ key: "projekte", reverseOf: { base: "Projekte.base", property: "bereich" } }],
          views: [{ name: "Tabelle", type: "table" }],
        }),
      ],
      notes: [
        {
          path: "Willkommen.md",
          description: "Startpunkt und Kurzanleitung für diesen Vault.",
          body: welcomeBody(
            "Willkommen",
            "Dieser Vault ist nach der PARA-Methode (Tiago Forte) organisiert: Inhalte werden nach Handlungsnähe sortiert, nicht nach Thema.",
            [
              { name: "Projekte", description: "Vorhaben mit klarem Ziel und Enddatum (Projekte.base)." },
              { name: "Aufgaben", description: "Einzelne nächste Schritte — jeder verweist auf sein Projekt (Aufgaben.base)." },
              { name: "Bereiche", description: "Dauerhafte Verantwortungsbereiche ohne Enddatum." },
              { name: "Ressourcen", description: "Themen, Material und Wissenswertes zum Nachschlagen." },
              { name: "Archiv", description: "Abgeschlossenes und Inaktives aus den anderen Ordnern." },
            ],
            "Öffne die Datenbanken Projekte.base, Aufgaben.base und Bereiche.base, um Projekte nach Status zu sehen, ihnen Aufgaben zuzuordnen und sie mit ihren Bereichen zu verknüpfen — Abgeschlossenes wandert ins Archiv, Links und die index.md-Übersichten pflegt Plainva automatisch."
          ),
        },
        {
          path: "Projekte/Beispielprojekt.md",
          description: "Ein Beispiel für eine Projektnotiz.",
          properties: { status: "Aktiv", bereich: "[[Beispielbereich]]" },
          body: "# Beispielprojekt\n\nEin Projekt hat ein klares Ziel und ein absehbares Ende. Halte hier Zweck, nächste Schritte und Ergebnisse fest.\n\n- [ ] Ziel des Projekts notieren\n- [ ] Nächsten Schritt festlegen\n",
        },
        {
          path: "Aufgaben/Beispielaufgabe.md",
          description: "Ein Beispiel für eine Aufgabe mit Projektbezug.",
          properties: { status: "Offen", projekt: "[[Beispielprojekt]]" },
          body: "# Beispielaufgabe\n\nEine Aufgabe ist ein einzelner, konkreter nächster Schritt. Über die Eigenschaft Projekt gehört sie zum Beispielprojekt.\n",
        },
        {
          path: "Bereiche/Beispielbereich.md",
          description: "Ein Beispiel für einen Verantwortungsbereich.",
          body: "# Beispielbereich\n\nEin Bereich ist eine dauerhafte Verantwortung ohne Enddatum — zum Beispiel „Gesundheit“ oder „Finanzen“. Projekte werden über die Eigenschaft Bereich mit ihm verknüpft.\n",
        },
        {
          path: "Vorlagen/Projekt.md",
          properties: { status: "Geplant" },
          body: "# {{title}}\n\n## Ziel\n\n## Nächste Schritte\n\n- [ ] \n",
        },
        {
          path: "Vorlagen/Aufgabe.md",
          properties: { status: "Offen" },
          body: "# {{title}}\n\n## Notizen\n\n- [ ] \n",
        },
      ],
      settings: { templateFolder: "Vorlagen" },
    },
    {
      id: "zettelkasten",
      name: "Zettelkasten",
      description: "Eine Idee pro Notiz, dicht verlinkt — flüchtige, Literatur- und permanente Notizen (Luhmann).",
      folders: ["Flüchtige Notizen", "Literaturnotizen", "Permanente Notizen", "Vorlagen"],
      bases: [
        defineBase({
          path: "Literatur.base",
          sourceFolder: "Literaturnotizen",
          columns: [
            { key: "autor", input: "text" },
            { key: "jahr", input: "number" },
            { key: "art", input: "select", options: ["Buch", "Artikel", "Video", "Podcast", "Webseite"] },
            { key: "status", input: "status", options: ["Zu lesen", "Gelesen", "Verarbeitet"] },
            { key: "url", input: "url" },
            { key: "zettel", reverseOf: { base: "Zettel.base", property: "quelle" } },
          ],
          views: [
            { name: "Tabelle", type: "table" },
            { name: "Nach Status", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Vorlagen/Literaturnotiz.md",
        }),
        defineBase({
          path: "Zettel.base",
          sourceFolder: "Permanente Notizen",
          columns: [{ key: "quelle", input: "relation", relationBase: "Literatur.base" }],
          views: [{ name: "Tabelle", type: "table" }],
        }),
      ],
      notes: [
        {
          path: "Willkommen.md",
          description: "Startpunkt und Kurzanleitung für diesen Vault.",
          body: welcomeBody(
            "Willkommen",
            "Dieser Vault folgt der Zettelkasten-Methode (Niklas Luhmann): eine Idee pro Notiz — Verbindungen entstehen über Links statt über Ordnerhierarchien.",
            [
              { name: "Flüchtige Notizen", description: "Schnelle Rohgedanken — kurzlebig, werden später verarbeitet." },
              { name: "Literaturnotizen", description: "Zusammenfassungen von Gelesenem in eigenen Worten, mit Quelle." },
              { name: "Permanente Notizen", description: "Ausformulierte, dauerhafte Ideen — eine pro Notiz, stark verlinkt." },
            ],
            "In Literatur.base pflegst du deine Quellen nach Lesestatus; Zettel.base verknüpft permanente Notizen über die Eigenschaft Quelle mit der Literatur, aus der sie stammen."
          ),
        },
        {
          path: "Permanente Notizen/Beispielzettel.md",
          description: "Ein Beispiel für eine permanente Notiz.",
          properties: { quelle: ["[[Beispiel-Literaturnotiz]]"] },
          body: "# Beispielzettel\n\nEine permanente Notiz enthält genau eine Idee, in ganzen Sätzen und in eigenen Worten formuliert.\n\nVerlinke verwandte Zettel direkt im Text — so wächst das Netz aus Ideen.\n",
        },
        {
          path: "Literaturnotizen/Beispiel-Literaturnotiz.md",
          description: "Ein Beispiel für eine Literaturnotiz.",
          properties: { autor: "Niklas Luhmann", jahr: 1992, art: "Buch", status: "Gelesen" },
          body: "# Beispiel-Literaturnotiz\n\nFasse hier in eigenen Worten zusammen, was du gelesen hast, und halte die Quelle fest. Permanente Notizen verweisen über die Eigenschaft Quelle auf diese Literaturnotiz.\n",
        },
        {
          path: "Vorlagen/Literaturnotiz.md",
          properties: { status: "Zu lesen" },
          body: "# {{title}}\n\n## Zusammenfassung\n\n## Quelle\n",
        },
      ],
      settings: { templateFolder: "Vorlagen" },
    },
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
    {
      id: "gtd",
      name: "GTD",
      description: "Getting Things Done — Eingang, Aufgaben, Projekte, Referenz und Irgendwann-Listen.",
      folders: ["Eingang", "Aufgaben", "Projekte", "Referenz", "Irgendwann", "Vorlagen"],
      bases: [
        defineBase({
          path: "Aufgaben.base",
          sourceFolder: "Aufgaben",
          columns: [
            { key: "status", input: "status", options: ["Eingang", "Nächste", "Wartet", "Irgendwann", "Erledigt"] },
            { key: "kontext", input: "select", options: ["@Zuhause", "@Arbeit", "@Unterwegs", "@Telefon"] },
            { key: "projekt", input: "relation", relationBase: "Projekte.base", relationLimit: "one" },
            { key: "frist", input: "date" },
          ],
          views: [
            { name: "Tabelle", type: "table" },
            { name: "Nach Status", type: "board", groupBy: "status" },
            { name: "Nach Kontext", type: "board", groupBy: "kontext" },
          ],
          newItemTemplate: "Vorlagen/Aufgabe.md",
        }),
        defineBase({
          path: "Projekte.base",
          sourceFolder: "Projekte",
          columns: [
            { key: "status", input: "status", options: ["Aktiv", "Wartet", "Irgendwann", "Abgeschlossen"] },
            { key: "aufgaben", reverseOf: { base: "Aufgaben.base", property: "projekt" } },
          ],
          views: [
            { name: "Tabelle", type: "table" },
            { name: "Nach Status", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Vorlagen/Projekt.md",
        }),
      ],
      notes: [
        {
          path: "Willkommen.md",
          description: "Startpunkt und Kurzanleitung für diesen Vault.",
          body: welcomeBody(
            "Willkommen",
            "Dieser Vault folgt Getting Things Done (David Allen): alles landet zuerst im Eingang und wird von dort in konkrete Aufgaben und Projekte verarbeitet.",
            [
              { name: "Eingang", description: "Sammelstelle für alles Neue — regelmäßig leeren." },
              { name: "Aufgaben", description: "Einzelne nächste Aktionen — nach Status und Kontext organisiert (Aufgaben.base)." },
              { name: "Projekte", description: "Alles, was mehr als einen Schritt braucht (Projekte.base)." },
              { name: "Referenz", description: "Nachschlagematerial ohne Handlungsbedarf." },
              { name: "Irgendwann", description: "Ideen und Vielleicht-später-Vorhaben." },
            ],
            "In Aufgaben.base ordnest du jede Aufgabe über die Eigenschaft Projekt einem Projekt zu; die Projekte.base zeigt in der Spalte Aufgaben automatisch, was zu jedem Projekt gehört. Der Wochenrückblick hält das System verlässlich."
          ),
        },
        {
          path: "Wochenrückblick.md",
          description: "Checkliste für den wöchentlichen GTD-Rückblick.",
          body: "# Wochenrückblick\n\n- [ ] Eingang auf null bringen\n- [ ] Projektliste durchgehen und nächste Schritte prüfen\n- [ ] Irgendwann-Liste überfliegen\n- [ ] Kalender der nächsten zwei Wochen ansehen\n",
        },
        {
          path: "Projekte/Beispielprojekt.md",
          description: "Ein Beispiel für eine GTD-Projektnotiz.",
          properties: { status: "Aktiv" },
          body: "# Beispielprojekt\n\nGewünschtes Ergebnis: Was ist fertig, wenn es fertig ist?\n\nNächster Schritt:\n\n- [ ] Die eine, konkrete nächste Aktion notieren\n",
        },
        {
          path: "Aufgaben/Beispielaufgabe.md",
          description: "Ein Beispiel für eine Aufgabe mit Projektbezug.",
          properties: { status: "Nächste", kontext: "@Arbeit", projekt: "[[Beispielprojekt]]" },
          body: "# Beispielaufgabe\n\nEine Aufgabe ist eine einzelne, konkrete nächste Aktion. Über die Eigenschaft Projekt gehört sie zum Beispielprojekt.\n",
        },
        {
          path: "Aufgaben/Ideen sammeln.md",
          description: "Ein Beispiel für einen frischen Eingang.",
          properties: { status: "Eingang" },
          body: "# Ideen sammeln\n\nFrisch im Eingang gelandet und noch nicht verarbeitet. Beim nächsten Rückblick bekommt diese Aufgabe einen Kontext und ein Projekt.\n",
        },
        {
          path: "Vorlagen/Aufgabe.md",
          properties: { status: "Eingang" },
          body: "# {{title}}\n\n## Notizen\n\n- [ ] \n",
        },
        {
          path: "Vorlagen/Projekt.md",
          properties: { status: "Aktiv" },
          body: "# {{title}}\n\n## Gewünschtes Ergebnis\n\n## Nächste Schritte\n\n- [ ] \n",
        },
      ],
      settings: { templateFolder: "Vorlagen" },
    },
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
