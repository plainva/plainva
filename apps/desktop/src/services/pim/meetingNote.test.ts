import { describe, expect, it } from "vitest";
import type { PimEventRow } from "@plainva/core";
import { readFrontmatterPath } from "@plainva/core";
import { buildMeetingNoteContent, meetingNoteStem, resolveOrCreateMeetingNote, type MeetingNoteAdapter } from "./meetingNote";

function fakeAdapter(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const dirs: string[] = [];
  const adapter: MeetingNoteAdapter = {
    readTextFile: async (p) => {
      const c = files.get(p);
      if (c === undefined) throw new Error("not found: " + p);
      return c;
    },
    writeTextFile: async (p, c) => {
      files.set(p, c);
    },
    exists: async (p) => files.has(p),
    createDir: async (p) => {
      dirs.push(p);
    },
  };
  return { adapter, files, dirs };
}

function ev(partial: Partial<PimEventRow> = {}): PimEventRow {
  return {
    accountId: "acc-1",
    calendarId: "cal-1",
    uid: "uid-abc",
    title: "Weekly Standup",
    start: { ts: 0 },
    end: { ts: 0 },
    allDay: false,
    ...partial,
  } as PimEventRow;
}

describe("meetingNoteStem", () => {
  it("prefixes the day and sanitizes the title", () => {
    expect(meetingNoteStem("2026-07-20", "Weekly: Standup?")).toBe("2026-07-20 Weekly Standup");
  });

  it("falls back to the day key when the title is empty after sanitizing", () => {
    expect(meetingNoteStem("2026-07-20", "???")).toBe("2026-07-20");
  });
});

describe("buildMeetingNoteContent", () => {
  it("carries OKF frontmatter, the pim anchor and the event fields", () => {
    const content = buildMeetingNoteContent(
      ev({ location: "Room 5", attendees: ["a@example.org", "b@example.org"] }),
      "2026-07-20",
      "Meeting"
    );
    expect(readFrontmatterPath(content, ["type"])).toBe("Meeting");
    expect(readFrontmatterPath(content, ["date"])).toBe("2026-07-20");
    expect(readFrontmatterPath(content, ["location"])).toBe("Room 5");
    expect(readFrontmatterPath(content, ["plainva", "pim", "uid"])).toBe("uid-abc");
    expect(readFrontmatterPath(content, ["plainva", "pim", "account"])).toBe("acc-1");
    expect(content).toContain("# Weekly Standup");
  });

  it("omits location/attendees when the event has none", () => {
    const content = buildMeetingNoteContent(ev(), "2026-07-20", "Meeting");
    expect(readFrontmatterPath(content, ["location"])).toBeUndefined();
    expect(readFrontmatterPath(content, ["attendees"])).toBeUndefined();
  });
});

describe("resolveOrCreateMeetingNote", () => {
  it("creates the note (with folder) on first use", async () => {
    const { adapter, files, dirs } = fakeAdapter();
    const res = await resolveOrCreateMeetingNote({ adapter, event: ev(), dayKey: "2026-07-20", folder: "Meetings", noteType: "Meeting" });
    expect(res).toEqual({ path: "Meetings/2026-07-20 Weekly Standup.md", created: true });
    expect(dirs).toContain("Meetings");
    expect(files.get(res.path)).toContain("uid-abc");
  });

  it("reuses an existing note when the anchor matches", async () => {
    const { adapter } = fakeAdapter();
    const first = await resolveOrCreateMeetingNote({ adapter, event: ev(), dayKey: "2026-07-20", folder: "Meetings", noteType: "Meeting" });
    const second = await resolveOrCreateMeetingNote({ adapter, event: ev(), dayKey: "2026-07-20", folder: "Meetings", noteType: "Meeting" });
    expect(second).toEqual({ path: first.path, created: false });
  });

  it("never reuses a same-named foreign note — probes a numbered sibling", async () => {
    const { adapter, files } = fakeAdapter({
      "Meetings/2026-07-20 Weekly Standup.md": "# A user note without an anchor\n",
    });
    const res = await resolveOrCreateMeetingNote({ adapter, event: ev(), dayKey: "2026-07-20", folder: "Meetings", noteType: "Meeting" });
    expect(res).toEqual({ path: "Meetings/2026-07-20 Weekly Standup 2.md", created: true });
    // The foreign note stayed untouched.
    expect(files.get("Meetings/2026-07-20 Weekly Standup.md")).toContain("A user note");
  });

  it("keeps two same-titled events on one day in separate notes", async () => {
    const { adapter } = fakeAdapter();
    const a = await resolveOrCreateMeetingNote({ adapter, event: ev({ uid: "uid-a" }), dayKey: "2026-07-20", folder: "Meetings", noteType: "Meeting" });
    const b = await resolveOrCreateMeetingNote({ adapter, event: ev({ uid: "uid-b" }), dayKey: "2026-07-20", folder: "Meetings", noteType: "Meeting" });
    expect(a.path).not.toBe(b.path);
    // Each event keeps resolving to ITS note.
    const again = await resolveOrCreateMeetingNote({ adapter, event: ev({ uid: "uid-a" }), dayKey: "2026-07-20", folder: "Meetings", noteType: "Meeting" });
    expect(again).toEqual({ path: a.path, created: false });
  });

  it("works at the vault root when the folder is empty", async () => {
    const { adapter, dirs } = fakeAdapter();
    const res = await resolveOrCreateMeetingNote({ adapter, event: ev(), dayKey: "2026-07-20", folder: "", noteType: "Meeting" });
    expect(res.path).toBe("2026-07-20 Weekly Standup.md");
    expect(dirs).toHaveLength(0);
  });
});
