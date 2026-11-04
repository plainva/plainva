/**
 * Tasks query fixtures (plan Tasks-Abfragen, T0): examples for each part of the
 * query language (plan § 2, read from the Tasks 8.6.0 documentation) and the
 * tester's case, each with the result expected against the sample vault
 * (`sampleVault.ts`, today 2026-10-29).
 *
 * `expect` is the shape of the result:
 *
 * - ungrouped: the task labels in result order; a task with subtasks shown
 *   (`show tree`) as `[label, children]`, a child that does not match the
 *   query itself marked with a leading `~`;
 * - grouped: `[heading id, contents]` per group, in group order — ids like
 *   `due:2026-10-27`, `due:none`, `due:invalid`, `status:done`,
 *   `priority:high`, `tags:#presse`, `heading:none`;
 * - `{ error }` for a query Tasks rejects too: no result at all.
 *
 * The default order of the whole vault (Tasks' default sort: status type,
 * urgency, due, priority, path) is spelled out once in `ALL`.
 */
import type { TasksQueryErrorReason, TasksQueryUnsupportedReason } from "../../../src/tasksQuery/parse.js";

export type ItemShape = string | [string, ItemShape[]];
export type GroupShape = [string, ItemShape[] | GroupShape[]];

export interface TasksQueryFixture {
  name: string;
  /** The part of the language (plan § 2 / § 4). */
  section: "frame" | "status" | "dates" | "recurrence" | "priority" | "text" | "boolean" | "sort" | "group" | "layout" | "limit" | "dependencies" | "tester";
  query: string;
  filePath?: string;
  expect: ItemShape[] | GroupShape[] | { error: TasksQueryErrorReason };
  /** Lines left out with a hint (case a), in order. */
  notices?: TasksQueryUnsupportedReason[];
  /** `total` (before limit) and `shown`, where they differ from the list. */
  counts?: { total: number; shown: number };
}

// Labels of the sample vault's tasks.
const A1 = "Petition einreichen", A2 = "Unterschriften zählen", A3 = "Text schreiben", A4 = "Flyer drucken", A5 = "Pressemitteilung", A6 = "Treffen mit Verband";
const B1 = "Maler anrufen", B2 = "Angebote vergleichen", B3 = "Teppich kaufen", B4 = "Dach prüfen", B5 = "Keller aufräumen";
const C1 = "Zahnarzt Termin", C2 = "Steuer", C3 = "Rechnung bezahlen", C4 = "Wöchentlicher Bericht";
const D1 = "Offene Todos sammeln", D2 = "Buch zurückgeben", E1 = "Vorlage-Aufgabe";

/**
 * Tasks' default sort over the whole vault. In progress first; then the open
 * tasks by urgency (Maler anrufen 18.71, Petition 14.34, Buch 10.75,
 * Pressemitteilung 7.55, Treffen 6.95, Dach 2.4, then six at 1.95 — among them
 * the invalid due date first, then by path —, Keller −4.8); then done, then
 * cancelled.
 */
export const ALL = [B2, B1, A1, D2, A5, A6, B4, C2, D1, C1, C4, A2, E1, B5, C3, A3, A4, B3];
const NOT_DONE = [B2, B1, A1, D2, A5, A6, B4, C2, D1, C1, C4, A2, E1, B5];

export const TASKS_QUERY_FIXTURES: TasksQueryFixture[] = [
  // ── The tester's case (iPhone, Build 136) ──
  {
    name: "tester: open #rettediebahn tasks as a tree, by file name reversed",
    section: "tester",
    query: "not done\ntags include #rettediebahn\nshow tree\nsort by filename reverse",
    filePath: "Daily/2026-10-29.md",
    // Vorlage.md > Bahn.md > 2026-10-29.md reversed; the template note counts (E13).
    expect: [E1, [A1, ["~" + A2, "~" + A3]], A6, D1],
  },

  // ── Frame ──
  { name: "an empty block lists every task", section: "frame", query: "", expect: ALL },
  {
    name: "comments, case, continuation",
    section: "frame",
    query: "# only the open ones\nNOT DONE\n{{! an inline\ncomment }}\nPath Includes \\\n  Projekte",
    expect: [B2, B1, A1, A5, A6, B4, A2, B5],
  },
  { name: "placeholder query.file.path", section: "frame", query: "not done\npath includes {{query.file.path}}", filePath: "Projekte/Bahn.md", expect: [A1, A5, A6, A2] },
  { name: "placeholder query.file.folder", section: "frame", query: "folder includes {{ query.file.folder }}\nhas due date", filePath: "Projekte/Haus.md", expect: [B1, A1, A5, B4] },
  { name: "explain changes nothing about the result", section: "frame", query: "explain\nis recurring", expect: [B4, C4] },
  { name: "a preset is left out", section: "frame", query: "preset this_file\nis recurring", expect: [B4, C4], notices: ["preset"] },
  { name: "a preset placeholder is left out", section: "frame", query: "{{preset.mine}}", expect: ALL, notices: ["preset"] },
  { name: "ignore global query has no effect", section: "frame", query: "ignore global query\npriority is highest", expect: [B1] },
  { name: "a line Tasks does not know is an error", section: "frame", query: "not done\nwhat is due", expect: { error: "unknownInstruction" } },

  // ── Status ──
  { name: "done takes in cancelled", section: "status", query: "done", expect: [C3, A3, A4, B3] },
  { name: "not done", section: "status", query: "not done", expect: NOT_DONE },
  { name: "status.type is IN_PROGRESS", section: "status", query: "status.type is IN_PROGRESS", expect: [B2] },
  { name: "status.type is not todo (any case)", section: "status", query: "status.type is not todo", expect: [B2, C3, A3, A4, B3] },
  { name: "ON_HOLD finds nothing in Plainva", section: "status", query: "status.type is ON_HOLD", expect: [] },
  { name: "status.name is left out", section: "status", query: "status.name includes Todo\npriority is highest", expect: [B1], notices: ["statusName"] },
  { name: "an unknown status type is an error", section: "status", query: "status.type is WAITING", expect: { error: "invalidStatusType" } },

  // ── Dates ──
  { name: "due before tomorrow", section: "dates", query: "due before tomorrow", expect: [B1, D2, C3] },
  { name: "due on or before an absolute day", section: "dates", query: "due on or before 2026-10-30", expect: [B1, A1, D2, C3] },
  { name: "due this week (ISO, Mon 10-26 to Sun 11-01)", section: "dates", query: "due this week", expect: [B1, A1, D2] },
  { name: "due next week", section: "dates", query: "due next week", expect: [A5] },
  { name: "due after a range: after its end", section: "dates", query: "due after next week", expect: [B4] },
  { name: "scheduled in a numbered week", section: "dates", query: "scheduled in 2026-W44", expect: [A6] },
  { name: "starts lets tasks without a start date through", section: "dates", query: "starts after today", expect: [B1, A1, D2, A5, A6, B4, C2, D1, C1, C4, A2, E1, B5, C3, A3, A4, B3] },
  { name: "happens: any of start, scheduled, due", section: "dates", query: "happens before 2026-10-28", expect: [B2, B1, C3] },
  { name: "done in a month", section: "dates", query: "done in 2026-10", expect: [C3, A3, A4] },
  { name: "created before", section: "dates", query: "created before 2026-10-02", expect: [C4] },
  { name: "cancelled on", section: "dates", query: "cancelled on 2026-10-24", expect: [B3] },
  { name: "has due date counts an invalid one", section: "dates", query: "has due date", expect: [B1, A1, D2, A5, B4, C2, C3] },
  { name: "no due date", section: "dates", query: "no due date", expect: [B2, A6, D1, C1, C4, A2, E1, B5, A3, A4, B3] },
  { name: "due date is invalid", section: "dates", query: "due date is invalid", expect: [C2] },
  { name: "due in a quarter", section: "dates", query: "due in 2026-Q4", expect: [B1, A1, D2, A5, C3] },
  { name: "due in a range of two days", section: "dates", query: "due 2026-10-26 2026-10-29", expect: [B1, D2] },
  { name: "due in N days", section: "dates", query: "due in 7 days", expect: [A5] },
  { name: "due N days ago", section: "dates", query: "due 2 days ago", expect: [B1] },
  { name: "no happens date ignores an invalid due date", section: "dates", query: "no happens date", expect: [C2, D1, C1, A2, E1, A3, A4, B3] },
  { name: "a phrase beyond Plainva's dates is left out", section: "dates", query: "due before next friday at noon\nis recurring", expect: [B4, C4], notices: ["datePhrase"] },
  { name: "an impossible day is an error", section: "dates", query: "due before 2026-02-30", expect: { error: "invalidDate" } },
  { name: "a date filter without a date is an error", section: "dates", query: "due before", expect: { error: "missingDate" } },

  // ── Recurrence ──
  { name: "is recurring", section: "recurrence", query: "is recurring", expect: [B4, C4] },
  { name: "recurrence includes", section: "recurrence", query: "recurrence includes WEEK", expect: [C4] },
  { name: "recurrence regex is left out", section: "recurrence", query: "recurrence regex matches /week/\nis recurring", expect: [B4, C4], notices: ["regex"] },

  // ── Priority ──
  { name: "priority is above none", section: "priority", query: "priority is above none", expect: [B2, B1, A1] },
  { name: "priority is below none", section: "priority", query: "priority is below none", expect: [B4, B5] },
  { name: "priority is highest", section: "priority", query: "priority is highest", expect: [B1] },
  { name: "priority is not none", section: "priority", query: "priority is not none", expect: [B2, B1, A1, B4, B5] },
  { name: "an unknown priority is an error", section: "priority", query: "priority is urgent", expect: { error: "invalidPriority" } },

  // ── Text and place ──
  { name: "description includes, any case, tags included", section: "text", query: "description includes PRESSE", expect: [A5] },
  { name: "path does not include", section: "text", query: "path does not include Projekte", expect: [D2, C2, D1, C1, C4, E1, C3] },
  { name: "filename includes", section: "text", query: "filename includes Haus", expect: [B2, B1, B4, B5, B3] },
  { name: "folder includes", section: "text", query: "folder includes Daily/", expect: [D2, D1] },
  { name: "root includes", section: "text", query: "root includes vorlagen", expect: [E1] },
  { name: "heading includes", section: "text", query: "heading includes Termine", expect: [A6] },
  { name: "heading does not include matches tasks without a heading", section: "text", query: "heading does not include e", expect: [C2, C1, C4, E1, C3] },
  { name: "tags include, without #, partial", section: "text", query: "tags include rettedie", expect: [A1, A6, D1, E1, A4] },
  { name: "tags do not include", section: "text", query: "tags do not include #rettediebahn\nhas tags", expect: [A5, C1, C4, C3] },
  { name: "no tags", section: "text", query: "no tags", expect: [B2, B1, D2, B4, C2, A2, B5, A3, B3] },
  { name: "exclude sub-items", section: "text", query: "exclude sub-items\npath includes Bahn", expect: [A1, A5, A6, A4] },
  { name: "regex is left out", section: "text", query: "description regex matches /x/i\npriority is highest", expect: [B1], notices: ["regex"] },

  // ── Boolean ──
  { name: "OR", section: "boolean", query: "(due before tomorrow) OR (tags include #presse)", expect: [B1, D2, A5, C3] },
  { name: "NOT", section: "boolean", query: "NOT (done)", expect: NOT_DONE },
  { name: "AND NOT", section: "boolean", query: "(path includes Projekte) AND NOT (has due date)", expect: [B2, A6, A2, B5, A3, A4, B3] },
  { name: "XOR", section: "boolean", query: "(priority is highest) XOR (due before tomorrow)", expect: [D2, C3] },
  { name: "AND binds tighter than OR", section: "boolean", query: "(tags include #presse) OR (tags include #privat) AND (has due date)", expect: [A5] },
  { name: "square brackets around filters with parentheses", section: "boolean", query: "[description includes (maybe)] OR [path includes Inbox]", expect: [C2, C1, C4, C3] },
  { name: "nested groups", section: "boolean", query: "((path includes Haus) OR (path includes Inbox)) AND (not done)", expect: [B2, B1, B4, C2, C1, C4, B5] },
  { name: "blanks around operators are optional", section: "boolean", query: "(path includes Daily)AND(not done)", expect: [D2, D1] },
  { name: "mixed delimiters are an error", section: "boolean", query: '"not done" AND (is recurring)', expect: { error: "booleanMixedDelimiters" } },
  { name: "a dangling operator is an error", section: "boolean", query: "(not done) AND", expect: { error: "booleanMalformed" } },
  { name: "an unknown filter inside is an error", section: "boolean", query: "(not done) OR (foo bar)", expect: { error: "unknownInstruction" } },
  { name: "a filter Plainva does not read leaves the whole line out", section: "boolean", query: "(not done) AND (is blocked)\npriority is highest", expect: [B1], notices: ["dependencies"] },

  // ── Sort ──
  { name: "sort by due: invalid first, no date last", section: "sort", query: "sort by due", expect: [C2, C3, B1, D2, A1, A5, B4, B2, A6, D1, C1, C4, A2, E1, B5, A3, A4, B3] },
  { name: "sort by priority reverse", section: "sort", query: "not done\nsort by priority reverse", expect: [B5, B4, D2, A5, A6, C2, D1, C1, C4, A2, E1, B2, A1, B1] },
  { name: "sort by description", section: "sort", query: "path includes Haus\nsort by description", expect: [B2, B4, B5, B1, B3] },
  { name: "sort by tag", section: "sort", query: "has tags\nsort by tag", expect: [C4, C3, A5, C1, A1, A6, D1, E1, A4] },
  { name: "sort by urgency reverse: least urgent first", section: "sort", query: "path includes Haus\nsort by urgency reverse", expect: [B5, B3, B4, B2, B1] },
  { name: "sort by status", section: "sort", query: "path includes Bahn\nsort by status", expect: [A1, A5, A6, A2, A3, A4] },
  { name: "sort by heading: none first", section: "sort", query: "not done\nsort by heading", expect: [C2, C1, C4, E1, A1, A5, A2, D2, D1, B2, B1, B4, B5, A6] },
  { name: "sort by happens", section: "sort", query: "has happens date\nsort by happens", expect: [C3, B2, B1, A6, D2, A1, C4, A5, B5, B4] },
  { name: "sort by recurring, limited", section: "sort", query: "not done\nsort by recurring\nlimit 3", expect: [B4, C4, B2], counts: { total: 14, shown: 3 } },
  { name: "sort by random is left out", section: "sort", query: "sort by random\npriority is highest", expect: [B1], notices: ["sortRandom"] },
  { name: "sort by function is left out", section: "sort", query: "sort by function task.description.length\npriority is highest", expect: [B1], notices: ["code"] },
  { name: "an unknown sort key is an error", section: "sort", query: "sort by size", expect: { error: "unknownSortKey" } },

  // ── Group ──
  { name: "group by status: Done before Todo", section: "group", query: "group by status", expect: [["status:done", [C3, A3, A4, B3]], ["status:todo", NOT_DONE]] },
  {
    name: "group by due: invalid, days, none",
    section: "group",
    query: "not done\ngroup by due",
    expect: [["due:invalid", [C2]], ["due:2026-10-27", [B1]], ["due:2026-10-29", [D2]], ["due:2026-10-30", [A1]], ["due:2026-11-05", [A5]], ["due:2027-04-01", [B4]], ["due:none", [B2, A6, D1, C1, C4, A2, E1, B5]]],
  },
  { name: "group by priority", section: "group", query: "path includes Haus\ngroup by priority", expect: [["priority:highest", [B1]], ["priority:medium", [B2]], ["priority:none", [B3]], ["priority:low", [B4]], ["priority:lowest", [B5]]] },
  { name: "group by tags: a task under each tag", section: "group", query: "has tags\nnot done\ngroup by tags", expect: [["tags:#arbeit", [C4]], ["tags:#presse", [A5]], ["tags:#privat", [C1]], ["tags:#rettediebahn", [A1, A6, D1, E1]]] },
  {
    name: "two levels: folder, then file name",
    section: "group",
    query: "not done\ngroup by folder\ngroup by filename",
    expect: [
      ["folder:/", [["filename:Inbox", [C2, C1, C4]]]],
      ["folder:Daily/", [["filename:2026-10-29", [D2, D1]]]],
      ["folder:Projekte/", [["filename:Bahn", [A1, A5, A6, A2]], ["filename:Haus", [B2, B1, B4, B5]]]],
      ["folder:Vorlagen/", [["filename:Vorlage", [E1]]]],
    ],
  },
  { name: "group by heading reverse", section: "group", query: "not done\ngroup by heading reverse", expect: [["heading:Termine", [A6]], ["heading:Renovierung", [B2, B1, B4, B5]], ["heading:Heute", [D2, D1]], ["heading:Bahn-Projekt", [A1, A5, A2]], ["heading:none", [C2, C1, C4, E1]]] },
  { name: "group by recurring", section: "group", query: "not done\ngroup by recurring", expect: [["recurring:yes", [B4, C4]], ["recurring:no", [B2, B1, A1, D2, A5, A6, C2, D1, C1, A2, E1, B5]]] },
  {
    name: "limit groups: at most one task per group",
    section: "group",
    query: "not done\ngroup by filename\nlimit groups 1",
    expect: [["filename:2026-10-29", [D2]], ["filename:Bahn", [A1]], ["filename:Haus", [B2]], ["filename:Inbox", [C2]], ["filename:Vorlage", [E1]]],
    counts: { total: 14, shown: 5 },
  },
  { name: "group by function is left out", section: "group", query: "group by function task.urgency\npriority is highest", expect: [B1], notices: ["code"] },
  {
    name: "a fourth group level is left out",
    section: "group",
    query: "priority is highest\ngroup by status\ngroup by priority\ngroup by folder\ngroup by filename",
    expect: [["status:todo", [["priority:highest", [["folder:Projekte/", [B1]]]]]]],
    notices: ["groupDepth"],
  },

  // ── Layout and tree ──
  {
    name: "show tree: a matching child shows under its parent only",
    section: "layout",
    query: "not done\npath includes Bahn\nshow tree\nhide edit button\nhide backlink",
    expect: [[A1, [A2, "~" + A3]], A5, A6],
  },
  { name: "an unknown layout item is an error", section: "layout", query: "hide everything", expect: { error: "unknownLayoutItem" } },

  // ── Limit ──
  { name: "limit", section: "limit", query: "limit 2", expect: [B2, B1], counts: { total: 18, shown: 2 } },
  { name: "limit to N tasks", section: "limit", query: "limit to 3 tasks", expect: [B2, B1, A1], counts: { total: 18, shown: 3 } },
  { name: "limit without a number is an error", section: "limit", query: "limit many", expect: { error: "invalidLimit" } },

  // ── Dependencies (case a) ──
  { name: "is blocked is left out", section: "dependencies", query: "is blocked\nis recurring", expect: [B4, C4], notices: ["dependencies"] },
  { name: "has id is left out", section: "dependencies", query: "has id\nis recurring", expect: [B4, C4], notices: ["dependencies"] },
];
