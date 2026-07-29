import { DEFAULT_DAILY_NOTE_TYPE, welcomeBody, type VaultTemplateDefinition } from "./types";
import { defineBase } from "./baseBuilders";
import { buildPlainvaTour, TOUR_STRINGS_EN } from "./plainvaTour";
import { buildPara, PARA_STRINGS_EN } from "./paraTemplate";
import { buildGtd, GTD_STRINGS_EN } from "./gtdTemplate";
import { buildZettelkasten, ZK_STRINGS_EN } from "./zettelkastenTemplate";

/** English template set — also the fallback for languages without their own set.
 *
 * PARA, GTD, Zettelkasten and Journal additionally ship pre-wired `.base`
 * databases (Gesamtplan DB-Vorlagen 2026-07-04); ACE and Johnny.Decimal stay
 * link-/folder-based on purpose. Relation columns and their reverse
 * counterparts are wired here so the databases show real data as soon as the
 * vault is indexed. This module is the structural reference the other language
 * sets mirror. */
export function templates(): VaultTemplateDefinition[] {
  return [
    buildPlainvaTour(TOUR_STRINGS_EN),
    buildPara(PARA_STRINGS_EN),
    buildZettelkasten(ZK_STRINGS_EN),
    {
      id: "ace",
      name: "ACE (Linking Your Thinking)",
      description: "Atlas, Calendar and Efforts — MOC-centered knowledge work after Nick Milo.",
      folders: ["Atlas", "Calendar", "Efforts"],
      notes: [
        {
          path: "Welcome.md",
          description: "Starting point and quick guide for this vault.",
          body: welcomeBody(
            "Welcome",
            "This vault uses the ACE schema from \"Linking Your Thinking\" (Nick Milo): knowledge is connected through Maps of Content (MOCs) instead of deep nesting.",
            [
              { name: "Atlas", description: "Maps of your knowledge — MOCs and overview notes." },
              { name: "Calendar", description: "Time-bound notes — dailies, journals, reviews." },
              { name: "Efforts", description: "Everything you are actively working on." },
            ],
            "Start in the Atlas with the Home note and link out into your knowledge from there."
          ),
        },
        {
          path: "Atlas/Home.md",
          description: "Your top-level Map of Content.",
          body: "# Home\n\nThe Home note is your entry point: link your most important Maps of Content and current efforts here.\n",
        },
      ],
    },
    {
      id: "jd",
      name: "Johnny.Decimal",
      description: "Numbered areas and categories (10-19 / 11 / 11.01) for strict findability.",
      folders: [
        "00-09 System",
        "00-09 System/00 Index",
        "10-19 Personal",
        "10-19 Personal/11 Finances",
        "10-19 Personal/12 Health",
        "20-29 Work",
        "20-29 Work/21 Projects",
        "20-29 Work/22 Meetings",
      ],
      notes: [
        {
          path: "Welcome.md",
          description: "Starting point and quick guide for this vault.",
          body: welcomeBody(
            "Welcome",
            "This vault is organized with Johnny.Decimal: at most ten areas (10-19, 20-29, …), at most ten categories per area (11, 12, …) — and every note gets an ID like 11.01.",
            [
              { name: "00-09 System", description: "Managing the system itself — index and conventions." },
              { name: "10-19 Personal", description: "Example area for personal topics." },
              { name: "20-29 Work", description: "Example area for work topics." },
            ],
            "Rename areas and categories to match your topics — the deliberately limited depth (area → category → ID) is the core of the method."
          ),
        },
        {
          path: "00-09 System/00 Index/00.00 Index.md",
          description: "The Johnny.Decimal index: every number in one place.",
          body: "# 00.00 Index\n\nKeep the list of all areas, categories and IDs here. Anyone looking for a number checks this note first.\n\n## 10-19 Personal\n\n- 11 Finances\n- 12 Health\n\n## 20-29 Work\n\n- 21 Projects\n- 22 Meetings\n",
        },
      ],
    },
    buildGtd(GTD_STRINGS_EN),
    {
      id: "journal",
      name: "Journal",
      description: "Daily notes with a ready-made template and a journal database — daily notes are wired up instantly.",
      folders: ["Journal", "Templates"],
      bases: [
        defineBase({
          path: "Journal.base",
          sourceFolder: "Journal",
          columns: [
            { key: "date", input: "date" },
            { key: "mood", input: "select", options: ["Good", "Neutral", "Bad", "Productive", "Tired"] },
            { key: "keywords", input: "tags" },
          ],
          views: [
            { name: "Table", type: "table", sort: [{ property: "date", direction: "DESC" }] },
            { name: "Calendar", type: "calendar", dateField: "date" },
          ],
        }),
      ],
      notes: [
        {
          path: "Welcome.md",
          description: "Starting point and quick guide for this vault.",
          body: welcomeBody(
            "Welcome",
            "This vault is built for daily writing: daily notes live in the Journal folder and are created from the template in the Templates folder.",
            [
              { name: "Journal", description: "Your daily notes, one per day." },
              { name: "Templates", description: "Templates for new notes — the daily note template is already set up." },
            ],
            "Open the calendar in the right sidebar and click a day to create your first daily note. Journal.base shows your entries as a table and on a calendar — with date, mood and keywords."
          ),
        },
        {
          path: "Templates/Daily Note.md",
          description: "Template for new daily notes — {{date}}, {{time}} and {{title}} get replaced.",
          type: DEFAULT_DAILY_NOTE_TYPE,
          properties: { date: "{{date}}" },
          body: "# {{title}}\n\n## Notes\n\n## Tasks\n\n- [ ] \n",
        },
      ],
      settings: { dailyNotesFolder: "Journal", templateFolder: "Templates", dailyNoteTemplate: "Daily Note.md" },
    },
  ];
}
