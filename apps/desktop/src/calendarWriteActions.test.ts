import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Every create that has a way to be tried again names the action it belongs
 * to (A15, review 2026-11-17, O1): "Try again" after "it may still land" is
 * that action again, and the central window does not create the event a
 * second time. A move is "create there, delete here" — its create too. The
 * create itself is tested in `services/pim/remotePimTarget.test.ts`; this
 * holds the surfaces to passing the action on.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const calendar = read("./components/pimcal/CalendarView.tsx");

describe("the calendar's writes carry their action into every retry", () => {
  it("writes an update or a move through the targets of its action", () => {
    expect(calendar).toMatch(/updateEventWithBlockers\(depsFor\(action\), e, draft/);
    expect(calendar).toMatch(/detachBlockerAndUpdate\(depsFor\(action\), blocker, draft/);
    expect(calendar).toMatch(/withWriteAttempt\(await targetFor\(account\), action\)/);
  });

  it("passes the action on in every \"Try again\"", () => {
    for (const retry of [
      "retryWrites.current?.save(e, values, action)",
      "retryWrites.current?.reschedule(e, newStartMs, newEndMs, action)",
      "retryWrites.current?.apply(e, draft, moveTo, shape, action)",
      "retryWrites.current?.write(e, draft, moveTo, shape, action)",
      "retryWrites.current?.write(blocker, draft, moveTo, shape, action)",
    ]) expect(calendar, retry).toContain(retry);
    // The blocker question keeps the action until it is answered.
    expect(calendar).toMatch(/setBlockerPrompt\(\{ blocker: e, source, draft, moveTo, shape, hold, action \}\)/);
  });

  it("names a dialog's action in the time block and the entry put in the calendar", () => {
    expect(read("./components/tasks/TasksView.tsx")).toMatch(/withWriteAttempt\(await pimRuntime\.buildTarget\(account\), blockAction\.current\.id\)/);
    const base = read("./components/BaseViewer.tsx");
    expect(base).toMatch(/withWriteAttempt\(await pimRuntime\.buildTarget\(account\), scheduleAction\.current\)/);
    expect(base).toMatch(/scheduleAction\.current = newWriteAction\("entry-event"\); setScheduleTarget\(p\);/);
  });
});
