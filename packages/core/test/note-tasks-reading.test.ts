import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { noteTasksOf, tasksOfRow, TASK_READING } from "../src/db/noteTasks.js";
import type { ScannedTask } from "../src/vault/taskScan.js";
import { FRONTMATTERS, random, randomNote, TASK_LINES } from "./helpers/taskListing.js";

/**
 * The task table keeps what `noteTasksOf` made of a note's text, and a row
 * counts only for the reading it was made by (`TASK_READING`, db/noteTasks.ts).
 * A change to that reading — a field of `scanTasks`, one of its rules, a mark
 * of `taskMetadata.ts`, the reading of `plainva.tasks`, `plainva.repeat` or
 * `plainva.pim.uid` — made without raising the number would leave every
 * unchanged note with the tasks of before for good. So the output for a fixed
 * corpus is held here, by its hash, under the number it belongs to: change the
 * reading, raise `TASK_READING`, and record the new hash under the new number
 * (never change one a release carried).
 *
 * The corpus must reach every field `scanTasks` can hand out and every value
 * of its few-valued fields, or a change there would pass unseen:
 * `EVERY_FIELD` names each field of `ScannedTask` — a field added there and
 * not here fails the type check — and the test fails for a field the corpus
 * never fills, or one it fills that is not named here.
 */
const READINGS: Record<number, string> = {
  1: "200044b3bb5d4c63fcc9de1a8dbff3f5e44cd65fb763b90b32e29f481261a204",
};

const EVERY_FIELD: Record<keyof ScannedTask, true> = {
  line: true, ordinal: true, done: true, state: true, text: true, tags: true, due: true, dueTime: true,
  created: true, completed: true, scheduled: true, start: true, taskId: true, recurrence: true,
  recurrenceSupported: true, priority: true, priorityLevel: true, cancelled: true, heading: true,
  indented: true, parent: true, details: true,
};

/** Every mark and form a task line can carry (taskMetadata.ts, taskScan.ts), each at least once. */
export const EVERY_FORM = [
  "- [ ] every date ➕ 2026-01-02 ⏳ 2026-02-03 🛫 2026-02-01 📅 2026-03-04 14:30",
  "- [x] done ✅ 2026-10-02 📅 2026-10-01",
  "- [-] cancelled ❌ 2026-09-30",
  "- [/] in progress #work #deep/tag",
  "- [ ] highest 🔺",
  "- [ ] high ⏫",
  "- [ ] medium 🔼",
  "- [ ] low 🔽",
  "- [ ] lowest ⏬",
  "- [ ] high with a variation selector ⏫️",
  "- [ ] repeats 🔁 every week 📅 2026-01-05",
  "- [ ] repeats when done 🔁 every 2 days when done ⏳ 2026-01-05",
  "- [ ] repeats in no rule we know 🔁 every blue moon",
  "- [ ] repeats and waits ⛔ abc 🔁 every month",
  "- [ ] repeats and ends 🏁 delete 🔁 every year",
  "- [ ] twin 🆔 same 🔁 every week",
  "- [ ] twin again 🆔 same 🔁 every week",
  "- [ ] with an id 🆔 task-1",
  "- [ ] a date in code `📅 2026-01-01` and a real one 📅 2026-01-02",
  "- [ ] an escaped \\📅 2026-01-01",
  "- [ ] a bad date 📅 2026-13-45",
  "- [ ] block id ^abc-1",
  "- [ ] parent",
  "  - [ ] child under it",
  "    - a detail of the child",
  "    - a second detail",
  "    - a third detail, past the limit",
  "  - a plain bullet under the parent",
  "- [ ] 10:15 a journal stamp",
];

function corpus(): string[] {
  const notes: string[] = [];
  const bodies = [EVERY_FORM.join("\n"), `# Heading\n\n${EVERY_FORM.join("\n")}\n\n## Second heading\n- [ ] under the second`];
  const fronts = [
    ...FRONTMATTERS,
    "---\nplainva:\n  repeat: weekly\n---\n",
    "---\nplainva:\n  pim:\n    uid: abc\n---\n",
    "---\nplainva:\n  tasks: false\n  repeat: daily\n---\n",
  ];
  for (const front of fronts) for (const body of bodies) notes.push(front + body);
  for (const front of FRONTMATTERS) for (const line of TASK_LINES) notes.push(`${front}${line}\n${line}\n  - [ ] under it\n`);
  const r = random(2026_11_25);
  for (let i = 0; i < 400; i++) notes.push(randomNote(r));
  return notes;
}

describe("the reading of a note's tasks", () => {
  it("is the one recorded for TASK_READING", () => {
    expect.hasAssertions();
    const hash = createHash("sha256");
    for (const note of corpus()) hash.update(JSON.stringify(noteTasksOf(note))).update("\n");
    const digest = hash.digest("hex");
    expect(READINGS[TASK_READING], `no hash recorded for TASK_READING ${TASK_READING}; this run gives ${digest}`).toBeDefined();
    expect(digest, `the reading of tasks changed: raise TASK_READING in db/noteTasks.ts and record ${digest} under it`).toBe(READINGS[TASK_READING]);
  });

  it("is held over a corpus that fills every field and every value of the few-valued ones", () => {
    expect.hasAssertions();
    const rows = corpus().map(noteTasksOf);
    const tasks = rows.flatMap((row) => tasksOfRow(row.tasks));
    const filled = new Set(tasks.flatMap((task) => Object.keys(task).filter((key) => (task as unknown as Record<string, unknown>)[key] != null)));
    expect([...filled].sort()).toEqual(Object.keys(EVERY_FIELD).sort());
    expect(new Set(tasks.map((t) => t.state))).toEqual(new Set(["open", "progress", "done", "cancelled"]));
    expect(new Set(tasks.map((t) => t.priorityLevel).filter(Boolean))).toEqual(new Set(["highest", "high", "medium", "low", "lowest"]));
    expect(new Set(tasks.map((t) => t.priority).filter(Boolean))).toEqual(new Set([1, 2, 3]));
    expect(new Set(tasks.map((t) => t.recurrenceSupported).filter((v) => v !== undefined))).toEqual(new Set([true, false]));
    expect(new Set(tasks.map((t) => t.done))).toEqual(new Set([true, false]));
    expect(new Set(rows.filter((row) => row.tasks !== "").map((row) => row.excluded))).toEqual(new Set([true, false]));
  });
});
