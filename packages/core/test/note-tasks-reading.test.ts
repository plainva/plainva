import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { noteTasksOf, TASK_READING } from "../src/db/noteTasks.js";
import { FRONTMATTERS, random, randomNote, TASK_LINES } from "./helpers/taskListing.js";

/**
 * The task table keeps what `noteTasksOf` made of a note's text, and a row
 * counts only for the reading it was made by (`TASK_READING`, db/noteTasks.ts).
 * A change to that reading — a field of `scanTasks`, one of its rules, the
 * reading of `plainva.tasks` — that is made without raising the number would
 * leave every unchanged note with the tasks of before for good. So the output
 * for a fixed corpus is held here, by its hash, under the number it belongs
 * to: change the reading, raise `TASK_READING`, and record the new hash under
 * the new number (never change an old one).
 */
const READINGS: Record<number, string> = {
  1: "9058e8f3f16acd217b215308c88b6cdd2012b500d7923bb5f94aab6890dc8ba9",
};

function corpus(): string[] {
  const notes: string[] = [];
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
});
