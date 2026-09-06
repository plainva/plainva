import { describe, expect, it } from "vitest";
import { dueModelOf, rowDueTone, rowIsDone } from "@plainva/ui";

// The overdue rule of the database views (issues #83/#84, plan 2026-09-06 E4):
// only a database that knows what "done" means can have overdue rows, and a
// done row is never overdue. Local days, so no UTC drift.

const today = new Date(2026, 8, 6); // 2026-09-06 local

const checkboxDb = { columns: { done: { input: "checkbox" }, due: { input: "date" } } };
const statusDb = { columns: { status: { input: "status", options: [{ value: "Open" }, { value: "Doing" }, { value: "Done" }] } } };
const contactsDb = { columns: { birthday: { input: "date" }, name: { input: "text" } } };

describe("rowDueTone", () => {
  it("is none without a completion model — a birthday is never overdue", () => {
    expect(dueModelOf(contactsDb)).toBeNull();
    expect(rowDueTone({ birthday: "1990-01-01" }, dueModelOf(contactsDb), "1990-01-01", today)).toBe("none");
  });

  it("marks today and earlier as due, later days as later (checkbox model)", () => {
    const model = dueModelOf(checkboxDb);
    expect(rowDueTone({ done: false }, model, "2026-09-06", today)).toBe("due");
    expect(rowDueTone({ done: "false" }, model, "2026-09-03", today)).toBe("due");
    expect(rowDueTone({ done: false }, model, "2026-09-07", today)).toBe("later");
    expect(rowDueTone({ done: false }, model, "2026-09-06T14:30", today)).toBe("due");
  });

  it("never marks a done row, however old the date", () => {
    const model = dueModelOf(checkboxDb);
    expect(rowDueTone({ done: true }, model, "2025-01-01", today)).toBe("none");
    expect(rowDueTone({ "note.done": "true" }, model, "2025-01-01", today)).toBe("none");
  });

  it("reads the status convention: last option is done, first is open", () => {
    const model = dueModelOf(statusDb);
    expect(rowIsDone({ status: "Done" }, model!)).toBe(true);
    expect(rowIsDone({ status: "Doing" }, model!)).toBe(false);
    expect(rowIsDone({ status: "" }, model!)).toBeNull();
    expect(rowDueTone({ status: "Done" }, model, "2026-09-01", today)).toBe("none");
    expect(rowDueTone({ status: "Doing" }, model, "2026-09-01", today)).toBe("due");
    // An unknown status is not "done", so the date still counts.
    expect(rowDueTone({}, model, "2026-09-01", today)).toBe("due");
  });

  it("is none for an unreadable or missing date", () => {
    const model = dueModelOf(checkboxDb);
    expect(rowDueTone({ done: false }, model, undefined, today)).toBe("none");
    expect(rowDueTone({ done: false }, model, "soon", today)).toBe("none");
  });
});
