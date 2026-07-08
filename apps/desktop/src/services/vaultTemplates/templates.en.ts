import { DEFAULT_DAILY_NOTE_TYPE } from "../../contexts/VaultContext";
import { welcomeBody, type VaultTemplateDefinition } from "./types";
import { defineBase } from "./baseBuilders";

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
    {
      id: "para",
      name: "PARA",
      description: "Projects, Areas, Resources, Archive — sorted by actionability (Tiago Forte).",
      folders: ["Projects", "Tasks", "Areas", "Resources", "Archive", "Templates"],
      bases: [
        defineBase({
          path: "Projects.base",
          sourceFolder: "Projects",
          columns: [
            { key: "status", input: "status", options: ["Planned", "Active", "Waiting", "Done"] },
            { key: "area", input: "relation", relationBase: "Areas.base", relationLimit: "one" },
            { key: "due", input: "date" },
            { key: "tasks", reverseOf: { base: "Tasks.base", property: "project" } },
          ],
          views: [
            { name: "Table", type: "table" },
            { name: "By status", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Templates/Project.md",
        }),
        defineBase({
          path: "Tasks.base",
          sourceFolder: "Tasks",
          columns: [
            { key: "status", input: "status", options: ["Open", "In progress", "Done"] },
            { key: "project", input: "relation", relationBase: "Projects.base", relationLimit: "one" },
            { key: "due", input: "date" },
          ],
          views: [
            { name: "Table", type: "table" },
            { name: "By status", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Templates/Task.md",
        }),
        defineBase({
          path: "Areas.base",
          sourceFolder: "Areas",
          columns: [{ key: "projects", reverseOf: { base: "Projects.base", property: "area" } }],
          views: [{ name: "Table", type: "table" }],
        }),
      ],
      notes: [
        {
          path: "Welcome.md",
          description: "Starting point and quick guide for this vault.",
          body: welcomeBody(
            "Welcome",
            "This vault is organized with the PARA method (Tiago Forte): content is sorted by actionability, not by topic.",
            [
              { name: "Projects", description: "Efforts with a clear goal and an end date (Projects.base)." },
              { name: "Tasks", description: "Single next steps — each points at its project (Tasks.base)." },
              { name: "Areas", description: "Ongoing responsibilities without an end date." },
              { name: "Resources", description: "Topics, material and references worth keeping." },
              { name: "Archive", description: "Completed and inactive items from the other folders." },
            ],
            "Open the Projects.base, Tasks.base and Areas.base databases to see projects by status, assign tasks to them and link them to their areas — finished work moves to the Archive, while links and the index.md overviews are maintained automatically."
          ),
        },
        {
          path: "Projects/Example Project.md",
          description: "An example project note.",
          properties: { status: "Active", area: "[[Example Area]]" },
          body: "# Example Project\n\nA project has a clear goal and a foreseeable end. Capture its purpose, next steps and outcomes here.\n\n- [ ] Write down the project goal\n- [ ] Decide the next step\n",
        },
        {
          path: "Tasks/Example Task.md",
          description: "An example task linked to its project.",
          properties: { status: "Open", project: "[[Example Project]]" },
          body: "# Example Task\n\nA task is a single, concrete next step. Through its Project property it belongs to the Example Project.\n",
        },
        {
          path: "Areas/Example Area.md",
          description: "An example area of responsibility.",
          body: "# Example Area\n\nAn area is an ongoing responsibility with no end date — for example \"Health\" or \"Finances\". Projects link to it through their Area property.\n",
        },
        {
          path: "Templates/Project.md",
          properties: { status: "Planned" },
          body: "# {{title}}\n\n## Goal\n\n## Next steps\n\n- [ ] \n",
        },
        {
          path: "Templates/Task.md",
          properties: { status: "Open" },
          body: "# {{title}}\n\n## Notes\n\n- [ ] \n",
        },
      ],
      settings: { templateFolder: "Templates" },
    },
    {
      id: "zettelkasten",
      name: "Zettelkasten",
      description: "One idea per note, densely linked — fleeting, literature and permanent notes (Luhmann).",
      folders: ["Fleeting Notes", "Literature Notes", "Permanent Notes", "Templates"],
      bases: [
        defineBase({
          path: "Literature.base",
          sourceFolder: "Literature Notes",
          columns: [
            { key: "author", input: "text" },
            { key: "year", input: "number" },
            { key: "kind", input: "select", options: ["Book", "Article", "Video", "Podcast", "Website"] },
            { key: "status", input: "status", options: ["To read", "Read", "Processed"] },
            { key: "url", input: "url" },
            { key: "slips", reverseOf: { base: "Slips.base", property: "source" } },
          ],
          views: [
            { name: "Table", type: "table" },
            { name: "By status", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Templates/Literature Note.md",
        }),
        defineBase({
          path: "Slips.base",
          sourceFolder: "Permanent Notes",
          columns: [{ key: "source", input: "relation", relationBase: "Literature.base" }],
          views: [{ name: "Table", type: "table" }],
        }),
      ],
      notes: [
        {
          path: "Welcome.md",
          description: "Starting point and quick guide for this vault.",
          body: welcomeBody(
            "Welcome",
            "This vault follows the Zettelkasten method (Niklas Luhmann): one idea per note — connections grow through links, not folder hierarchies.",
            [
              { name: "Fleeting Notes", description: "Quick raw thoughts — short-lived, processed later." },
              { name: "Literature Notes", description: "Summaries of what you read, in your own words, with the source." },
              { name: "Permanent Notes", description: "Well-formed, lasting ideas — one per note, heavily linked." },
            ],
            "Use Literature.base to track your sources by reading status; Slips.base links permanent notes to the literature they came from through their Source property."
          ),
        },
        {
          path: "Permanent Notes/Example Note.md",
          description: "An example permanent note.",
          properties: { source: ["[[Example Literature Note]]"] },
          body: "# Example Note\n\nA permanent note contains exactly one idea, written in full sentences and in your own words.\n\nLink related notes directly in the text — that is how the web of ideas grows.\n",
        },
        {
          path: "Literature Notes/Example Literature Note.md",
          description: "An example literature note.",
          properties: { author: "Niklas Luhmann", year: 1992, kind: "Book", status: "Read" },
          body: "# Example Literature Note\n\nSummarize what you read in your own words and record the source. Permanent notes point back to this literature note through their Source property.\n",
        },
        {
          path: "Templates/Literature Note.md",
          properties: { status: "To read" },
          body: "# {{title}}\n\n## Summary\n\n## Source\n",
        },
      ],
      settings: { templateFolder: "Templates" },
    },
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
    {
      id: "gtd",
      name: "GTD",
      description: "Getting Things Done — Inbox, Tasks, Projects, Reference and Someday lists.",
      folders: ["Inbox", "Tasks", "Projects", "Reference", "Someday", "Templates"],
      bases: [
        defineBase({
          path: "Tasks.base",
          sourceFolder: "Tasks",
          columns: [
            { key: "status", input: "status", options: ["Inbox", "Next", "Waiting", "Someday", "Done"] },
            { key: "context", input: "select", options: ["@Home", "@Work", "@Errands", "@Phone"] },
            { key: "project", input: "relation", relationBase: "Projects.base", relationLimit: "one" },
            { key: "due", input: "date" },
          ],
          views: [
            { name: "Table", type: "table" },
            { name: "By status", type: "board", groupBy: "status" },
            { name: "By context", type: "board", groupBy: "context" },
          ],
          newItemTemplate: "Templates/Task.md",
        }),
        defineBase({
          path: "Projects.base",
          sourceFolder: "Projects",
          columns: [
            { key: "status", input: "status", options: ["Active", "Waiting", "Someday", "Done"] },
            { key: "tasks", reverseOf: { base: "Tasks.base", property: "project" } },
          ],
          views: [
            { name: "Table", type: "table" },
            { name: "By status", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Templates/Project.md",
        }),
      ],
      notes: [
        {
          path: "Welcome.md",
          description: "Starting point and quick guide for this vault.",
          body: welcomeBody(
            "Welcome",
            "This vault follows Getting Things Done (David Allen): everything lands in the Inbox first and gets processed into concrete tasks and projects from there.",
            [
              { name: "Inbox", description: "Capture point for everything new — empty it regularly." },
              { name: "Tasks", description: "Single next actions — organized by status and context (Tasks.base)." },
              { name: "Projects", description: "Anything that needs more than one step (Projects.base)." },
              { name: "Reference", description: "Look-up material with no action required." },
              { name: "Someday", description: "Ideas and maybe-later plans." },
            ],
            "In Tasks.base you assign every task to a project through its Project property; Projects.base then shows what belongs to each project in the Tasks column automatically. The weekly review keeps the system trustworthy."
          ),
        },
        {
          path: "Weekly Review.md",
          description: "Checklist for the weekly GTD review.",
          body: "# Weekly Review\n\n- [ ] Get the inbox to zero\n- [ ] Walk the project list and check next actions\n- [ ] Skim the Someday list\n- [ ] Look at the calendar for the next two weeks\n",
        },
        {
          path: "Projects/Example Project.md",
          description: "An example GTD project note.",
          properties: { status: "Active" },
          body: "# Example Project\n\nDesired outcome: what does done look like?\n\nNext action:\n\n- [ ] Write down the one concrete next step\n",
        },
        {
          path: "Tasks/Example Task.md",
          description: "An example task linked to a project.",
          properties: { status: "Next", context: "@Work", project: "[[Example Project]]" },
          body: "# Example Task\n\nA task is a single, concrete next action. Through its Project property it belongs to the Example Project.\n",
        },
        {
          path: "Tasks/Collect Ideas.md",
          description: "An example of a fresh inbox item.",
          properties: { status: "Inbox" },
          body: "# Collect Ideas\n\nJust landed in the inbox and not processed yet. At the next review this task gets a context and a project.\n",
        },
        {
          path: "Templates/Task.md",
          properties: { status: "Inbox" },
          body: "# {{title}}\n\n## Notes\n\n- [ ] \n",
        },
        {
          path: "Templates/Project.md",
          properties: { status: "Active" },
          body: "# {{title}}\n\n## Desired outcome\n\n## Next steps\n\n- [ ] \n",
        },
      ],
      settings: { templateFolder: "Templates" },
    },
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
