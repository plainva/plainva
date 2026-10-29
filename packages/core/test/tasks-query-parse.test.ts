import { describe, expect, it } from "vitest";
import { isBooleanInstruction, parseTasksQuery, tasksQueryFilePlaceholders, TASKS_DEFAULT_LAYOUT, type TasksQueryLine } from "../src/tasksQuery/index.js";

/** The parser of a Tasks query (plan Tasks-Abfragen, T2). */

const TODAY = "2026-10-29";
const parse = (source: string, filePath?: string) => parseTasksQuery(source, { today: TODAY, ...(filePath !== undefined ? { filePath } : {}) });
const states = (source: string) => parse(source).lines.map((l) => [l.source, l.status, l.unsupported?.reason ?? l.error?.reason ?? null]);
const only = (source: string): TasksQueryLine => {
  const lines = parse(source).lines;
  expect(lines).toHaveLength(1);
  return lines[0];
};

describe("lines", () => {
  it("skips blank lines and both kinds of comment, and numbers lines as in the block", () => {
    const query = parse("\n# a comment\nnot done\n{{! one\ntwo }}\n   \ndue today {{! behind }}\n");
    expect(query.lines.map((l) => [l.line, l.source])).toEqual([[3, "not done"], [7, "due today"]]);
  });

  it("joins a line ending in a backslash with the next, and keeps a doubled one as one backslash", () => {
    const query = parse("(priority is highest) OR \\\n    (priority is lowest)\ndescription includes a\\\\\nnot done");
    expect(query.lines.map((l) => [l.line, l.lineCount, l.source])).toEqual([
      [1, 2, "(priority is highest) OR (priority is lowest)"],
      [3, 1, "description includes a\\"],
      [4, 1, "not done"],
    ]);
    expect(query.errors).toEqual([]);
  });

  it("reads instructions in any case, but Boolean operators only in capitals", () => {
    expect(states("NOT DONE\nDue Before Tomorrow\nSORT BY DUE REVERSE\nGroup By Folder\nShow Tree\nLIMIT 5")).toEqual([
      ["NOT DONE", "understood", null],
      ["Due Before Tomorrow", "understood", null],
      ["SORT BY DUE REVERSE", "understood", null],
      ["Group By Folder", "understood", null],
      ["Show Tree", "understood", null],
      ["LIMIT 5", "understood", null],
    ]);
    expect(only("(done) or (not done)").error?.reason).toBe("booleanMalformed");
  });

  it("an unknown line is an error with its line number; the result keeps every other line", () => {
    const query = parse("not done\nwhat is this\ndue tomorow");
    expect(query.errors.map((l) => [l.line, l.error!.reason])).toEqual([[2, "unknownInstruction"]]);
    // "tomorow" is a phrase Plainva does not read: left out, not an error.
    expect(query.notices.map((l) => [l.line, l.unsupported!.reason, l.unsupported!.effect])).toEqual([[3, "datePhrase", "filter"]]);
  });
});

describe("placeholders", () => {
  it("fills in the six query.file values", () => {
    expect(tasksQueryFilePlaceholders("Work/Projects/Plan.md")).toEqual({
      "query.file.path": "Work/Projects/Plan.md",
      "query.file.pathWithoutExtension": "Work/Projects/Plan",
      "query.file.root": "Work/",
      "query.file.folder": "Work/Projects/",
      "query.file.filename": "Plan.md",
      "query.file.filenameWithoutExtension": "Plan",
    });
    expect(tasksQueryFilePlaceholders("Top.md")).toMatchObject({ "query.file.root": "/", "query.file.folder": "/", "query.file.pathWithoutExtension": "Top" });
    expect(only("path includes {{query.file.pathWithoutExtension}}").source).toBe("path includes {{query.file.pathWithoutExtension}}");
    const line = parse("path includes {{ query.file.filenameWithoutExtension }}", "A/B.md").lines[0];
    expect([line.source, line.status]).toEqual(["path includes B", "understood"]);
  });

  it("without a note it is an error; other placeholders and presets are left out", () => {
    expect(only("path includes {{query.file.path}}").error?.reason).toBe("placeholderWithoutFile");
    expect(parse("path includes {{query.file.property('x')}}", "a.md").lines[0].unsupported).toEqual({ reason: "placeholder", effect: "query" });
    expect(parse("{{preset.this_file}}", "a.md").lines[0].unsupported).toEqual({ reason: "preset", effect: "query" });
    expect(only("preset this_file").unsupported).toEqual({ reason: "preset", effect: "query" });
  });
});

describe("filters", () => {
  it("reads each filter of the scope table", () => {
    const query = parse([
      "done", "not done", "status.type is in_progress", "status.type is not CANCELLED",
      "due on 2026-10-25", "scheduled before today", "starts after 2026-W44", "done on or before yesterday", "created on or after last month",
      "cancelled in 2026-Q4", "happens in or before next year", "happens in or after 2026", "due tomorrow",
      "has due date", "no start date", "has happens date", "due date is invalid", "done date is invalid",
      "is recurring", "is not recurring", "recurrence includes week", "recurrence does not include month",
      "priority is high", "priority is not none", "priority is above low", "priority is below medium", "priority lowest",
      "description includes x", "description does not include y", "path includes a/b", "filename includes c.md", "folder does not include d/",
      "root includes e/", "heading includes f", "tags include #g", "tag includes h", "tags do not include #i", "tag does not include j",
      "has tags", "no tags", "exclude sub-items",
    ].join("\n"));
    expect(query.errors).toEqual([]);
    expect(query.notices).toEqual([]);
    expect(query.filters).toHaveLength(41);
    expect(query.filters[2]).toEqual({ kind: "statusType", type: "IN_PROGRESS", negate: false });
    expect(query.filters[6]).toMatchObject({ kind: "date", field: "start", operator: "after", value: { kind: "range", from: "2026-10-26", to: "2026-11-01" } });
    expect(query.filters[10]).toMatchObject({ kind: "date", field: "happens", operator: "inOrBefore", value: { kind: "range", from: "2027-01-01", to: "2027-12-31" } });
    expect(query.filters[12]).toEqual({ kind: "date", field: "due", operator: "on", value: { kind: "day", day: "2026-10-30" }, phrase: "tomorrow" });
    expect(query.filters[26]).toEqual({ kind: "priority", operator: "is", level: "lowest" });
    expect(query.filters[29]).toEqual({ kind: "text", field: "path", includes: true, value: "a/b" });
    expect(query.filters[35]).toEqual({ kind: "tags", includes: true, value: "h" });
  });

  it("an `in` that belongs to the date phrase", () => {
    expect(parse("due in 3 days").filters[0]).toMatchObject({ operator: "on", value: { kind: "day", day: "2026-11-01" }, phrase: "in 3 days" });
    expect(parse("due in this week").filters[0]).toMatchObject({ operator: "in", value: { kind: "range", from: "2026-10-26" } });
  });

  it("leaves out what Plainva does not read, with the reason and its effect", () => {
    expect(states([
      "filter by function task.urgency > 10", "description regex matches /a|b/", "path regex does not match /x/", "tags regex matches /y/",
      "status.name includes Todo", "is blocked", "is not blocking", "has id", "no depends on", "id includes abc",
      "due before next friday at noon", "sort by random", "sort by function task.x", "sort by id", "sort by status.name",
      "group by function task.x", "group by id", "group by status.name",
    ].join("\n"))).toEqual([
      ["filter by function task.urgency > 10", "unsupported", "code"],
      ["description regex matches /a|b/", "unsupported", "regex"],
      ["path regex does not match /x/", "unsupported", "regex"],
      ["tags regex matches /y/", "unsupported", "regex"],
      ["status.name includes Todo", "unsupported", "statusName"],
      ["is blocked", "unsupported", "dependencies"],
      ["is not blocking", "unsupported", "dependencies"],
      ["has id", "unsupported", "dependencies"],
      ["no depends on", "unsupported", "dependencies"],
      ["id includes abc", "unsupported", "dependencies"],
      ["due before next friday at noon", "unsupported", "datePhrase"],
      ["sort by random", "unsupported", "sortRandom"],
      ["sort by function task.x", "unsupported", "code"],
      ["sort by id", "unsupported", "sortId"],
      ["sort by status.name", "unsupported", "statusName"],
      ["group by function task.x", "unsupported", "code"],
      ["group by id", "unsupported", "groupId"],
      ["group by status.name", "unsupported", "statusName"],
    ]);
    expect(parse("sort by random").notices[0].unsupported!.effect).toBe("sort");
    expect(parse("group by id").notices[0].unsupported!.effect).toBe("group");
  });

  it("rejects what Tasks rejects too", () => {
    expect(states("status.type is SOMETIMES\npriority is very high\ndue before 2026-02-29\nscheduled 2026-W54\nstarts in 2026-13\ndone 2026-Q5\ndue\nlimit lots\nsort by colour\nsort by due sideways\ngroup by colour\nshow sparkles")).toEqual([
      ["status.type is SOMETIMES", "error", "invalidStatusType"],
      ["priority is very high", "error", "invalidPriority"],
      ["due before 2026-02-29", "error", "invalidDate"],
      ["scheduled 2026-W54", "error", "invalidDate"],
      ["starts in 2026-13", "error", "invalidDate"],
      ["done 2026-Q5", "error", "invalidDate"],
      ["due", "error", "missingDate"],
      ["limit lots", "error", "invalidLimit"],
      ["sort by colour", "error", "unknownSortKey"],
      ["sort by due sideways", "error", "unknownSortKey"],
      ["group by colour", "error", "unknownGroupKey"],
      ["show sparkles", "error", "unknownLayoutItem"],
    ]);
  });
});

describe("Boolean instructions", () => {
  it("recognises a line that starts with a delimiter or NOT and one", () => {
    expect(["(done)", "[done]", "{done}", '"done"', "NOT (done)", "NOT(done)", "  (done)"].every(isBooleanInstruction)).toBe(true);
    expect(["NOT DONE", "not (done)", "done"].some(isBooleanInstruction)).toBe(false);
  });

  it("binds NOT, then XOR, then AND, then OR", () => {
    const query = parse("(done) OR (has tags) AND NOT (is recurring) XOR (no tags)");
    expect(query.errors).toEqual([]);
    const expression = (query.filters[0] as { expression: unknown }).expression;
    expect(expression).toMatchObject({
      op: "or",
      left: { op: "filter", source: "done" },
      right: { op: "and", left: { op: "filter", source: "has tags" }, right: { op: "xor", left: { op: "not", operand: { op: "filter", source: "is recurring" } }, right: { op: "filter", source: "no tags" } } },
    });
  });

  it("reads all four kinds of delimiter, nested groups, OR NOT", () => {
    for (const source of ["[done] OR NOT [has tags]", "{done} OR NOT {has tags}", '"done" OR NOT "has tags"', "((done) OR (has tags)) AND ((no tags) XOR (is recurring))", "NOT NOT (done)"]) {
      expect(parse(source).errors).toEqual([]);
    }
    expect(parse("(done) OR NOT (has tags)").filters[0]).toMatchObject({ expression: { op: "or", right: { op: "not" } } });
  });

  it("rejects mixed delimiters, a filter ending in its own delimiter, missing operands and stray text", () => {
    expect(states('(done) AND [has tags]\n"done" OR (has tags)\n(description includes (maybe))\n(done) AND\nAND (done)\n(done) (has tags)\n(done\n(done) AND (has tags) junk')).toEqual([
      ["(done) AND [has tags]", "error", "booleanMixedDelimiters"],
      ['"done" OR (has tags)', "error", "booleanMixedDelimiters"],
      ["(description includes (maybe))", "error", "booleanMalformed"],
      ["(done) AND", "error", "booleanMalformed"],
      ["AND (done)", "error", "unknownInstruction"],
      ["(done) (has tags)", "error", "booleanMalformed"],
      ["(done", "error", "booleanMalformed"],
      ["(done) AND (has tags) junk", "error", "booleanMalformed"],
    ]);
  });

  it("a leaf that is an error makes the line an error; one Plainva does not read leaves it out", () => {
    expect(only("(done) OR (priority is urgent)").error).toEqual({ reason: "invalidPriority", detail: "urgent" });
    expect(only("(done) OR (what)").error).toEqual({ reason: "unknownInstruction", detail: "what" });
    expect(only("(done) OR (is blocked)").unsupported).toEqual({ reason: "dependencies", effect: "filter" });
  });
});

describe("sort, group, layout, limit, explain", () => {
  it("collects sort lines with reverse and tag numbers", () => {
    expect(parse("sort by due reverse\nsort by tag 2\nsort by tag reverse 3\nsort by tag\nsort by status.type\nsort by starts").sorters).toEqual([
      { key: "due", reverse: true },
      { key: "tag", reverse: false, tagIndex: 2 },
      { key: "tag", reverse: true, tagIndex: 3 },
      { key: "tag", reverse: false, tagIndex: 1 },
      { key: "statusType", reverse: false },
      { key: "start", reverse: false },
    ]);
  });

  it("takes three group levels and leaves out a fourth", () => {
    const query = parse("group by folder\ngroup by filename reverse\ngroup by heading\ngroup by due");
    expect(query.groupers).toEqual([{ key: "folder", reverse: false }, { key: "filename", reverse: true }, { key: "heading", reverse: false }]);
    expect(query.notices.map((l) => [l.line, l.unsupported])).toEqual([[4, { reason: "groupDepth", effect: "group" }]]);
  });

  it("switches layout items; lines without a counterpart have no effect", () => {
    const query = parse("show tree\nhide backlink\nhide nested backlink\nshow group count\nhide recurrence rule\nhide tags\nhide edit button\nhide postpone button\nhide toolbar\nshow urgency\nhide id\nhide depends on\nhide on completion\nshort mode\nfull mode\nignore global query");
    expect(query.errors).toEqual([]);
    expect(query.layout).toEqual({ ...TASKS_DEFAULT_LAYOUT, tree: true, backlink: false, nestedBacklink: false, groupCount: true, recurrenceRule: false, tags: false });
    expect(query.lines.filter((l) => l.status === "noEffect")).toHaveLength(10);
    expect(query.notices).toEqual([]);
  });

  it("limit, limit groups and explain; the last limit wins", () => {
    const query = parse("limit 10\nlimit to 3 tasks\nlimit groups to 2 tasks\nexplain");
    expect([query.limit, query.limitGroups, query.explain]).toEqual([3, 2, true]);
    expect(parse("limit groups 4").limitGroups).toBe(4);
  });
});
