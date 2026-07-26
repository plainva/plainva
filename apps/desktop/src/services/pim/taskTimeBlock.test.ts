import { describe, expect, it } from "vitest";
import type { IPimTarget, IVaultAdapter } from "@plainva/core";
import { createTaskTimeBlock, readTaskBlocks } from "./taskTimeBlock";

/**
 * "Block time" on a task (issue #34, wave 3). The pins that matter: the event
 * is the deliverable, the note anchor is a bonus that must never be able to
 * undo it, and the anchor never lands in `plainva.pim` (already the task
 * reconciler's and the meeting note's anchor).
 */

function adapterWith(files: Record<string, string>) {
  const written: Record<string, string> = {};
  const adapter = {
    readTextFile: async (p: string) => {
      if (!(p in files)) throw new Error("ENOENT");
      return files[p];
    },
    writeTextFile: async (p: string, c: string) => {
      written[p] = c;
    },
  } as unknown as IVaultAdapter;
  return { adapter, written };
}

function targetSpy(uid = "new-uid") {
  const calls: Array<{ calendarId: string; draft: any }> = [];
  const target = {
    createEvent: async (calendarId: string, draft: any) => {
      calls.push({ calendarId, draft });
      return { uid, etag: '"1"' };
    },
  } as unknown as IPimTarget;
  return { target, calls };
}

const NOTE = `---
type: task
okf_version: "1.0"
plainva:
  pim:
    uid: remote-task-1
    account: acc1
    list: list1
---

# Write the report
`;

const values = { dayKey: "2026-08-03", startTime: "13:00", durationMinutes: 120 };

describe("createTaskTimeBlock", () => {
  it("creates the event and anchors it in the note WITHOUT touching plainva.pim", async () => {
    const { adapter, written } = adapterWith({ "Tasks/Report.md": NOTE });
    const { target, calls } = targetSpy();
    const res = await createTaskTimeBlock({
      adapter,
      target,
      calendarKey: "acc1 cal-work",
      title: "Write the report",
      values,
      notePath: "Tasks/Report.md",
      linkPath: "Tasks/Report.md",
      allPaths: ["Tasks/Report.md"],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].calendarId).toBe("cal-work");
    expect(calls[0].draft.title).toBe("Write the report");
    expect(res).toMatchObject({ uid: "new-uid", accountId: "acc1", calendarId: "cal-work", anchored: true });

    const next = written["Tasks/Report.md"];
    expect(readTaskBlocks(next)).toEqual([
      { uid: "new-uid", account: "acc1", calendar: "cal-work", start: "2026-08-03 13:00" },
    ]);
    // The mirrored-remote-task anchor must survive untouched — writing blocks
    // into it would confuse the task reconciler.
    expect(next).toContain("uid: remote-task-1");
    expect(next).toContain("list: list1");
  });

  it("appends to existing blocks instead of replacing them", async () => {
    const withBlock = `---
type: task
plainva:
  blocks:
    - uid: old
      account: acc1
      calendar: cal-work
      start: "2026-08-01 09:00"
---

# T
`;
    const { adapter, written } = adapterWith({ "T.md": withBlock });
    const { target } = targetSpy("second");
    await createTaskTimeBlock({ adapter, target, calendarKey: "acc1 cal-work", title: "T", values, notePath: "T.md" });
    expect(readTaskBlocks(written["T.md"]).map((b) => b.uid)).toEqual(["old", "second"]);
  });

  it("keeps the event when the note cannot be written — the block is what was asked for", async () => {
    const { adapter } = adapterWith({}); // read throws
    const { target, calls } = targetSpy();
    const res = await createTaskTimeBlock({ adapter, target, calendarKey: "acc1 cal-work", title: "T", values, notePath: "gone.md" });
    expect(calls).toHaveLength(1);
    expect(res.anchored).toBe(false);
  });

  it("creates only the event for a checkbox task (no note of its own)", async () => {
    const { adapter, written } = adapterWith({ "Journal/Mon.md": "# Monday\n\n- [ ] call back\n" });
    const { target, calls } = targetSpy();
    const res = await createTaskTimeBlock({
      adapter,
      target,
      calendarKey: "acc1 cal-work",
      title: "call back",
      values,
      linkPath: "Journal/Mon.md",
      allPaths: ["Journal/Mon.md"],
    });
    expect(res.anchored).toBe(false);
    expect(written).toEqual({}); // the note a checkbox lives in is never rewritten
    expect(calls[0].draft.description).toBe("[[Mon]]");
  });

  it("rejects a malformed calendar key before writing anything", async () => {
    const { adapter } = adapterWith({});
    const { target, calls } = targetSpy();
    await expect(
      createTaskTimeBlock({ adapter, target, calendarKey: "no-calendar", title: "T", values })
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("readTaskBlocks", () => {
  it("ignores hand-edited nonsense rather than throwing", () => {
    expect(readTaskBlocks("# no frontmatter")).toEqual([]);
    expect(readTaskBlocks(`---\nplainva:\n  blocks: "oops"\n---\n`)).toEqual([]);
    expect(readTaskBlocks(`---\nplainva:\n  blocks:\n    - {}\n    - uid: ok\n---\n`).map((b) => b.uid)).toEqual(["ok"]);
  });
});
