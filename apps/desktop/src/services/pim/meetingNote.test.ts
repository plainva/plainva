import { describe, expect, it } from "vitest";
import type { PimEventRow } from "@plainva/core";
import { readFrontmatterPath } from "@plainva/core";
import { buildMeetingNoteContent, meetingNoteStem, resolveOrCreateMeetingNote, type MeetingNoteAdapter } from "./meetingNote";
import {
  MEETING_TEMPLATE_TOKENS,
  finalizeTemplate,
  meetingTemplateEvent,
  meetingTemplatePath,
  resolveTemplate,
  type MeetingTemplateSettings,
  type TemplateContext,
} from "@plainva/ui";

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

// ---------------------------------------------------------------------------
// Meeting-note template (plan Befunde 24.09., E24)
// ---------------------------------------------------------------------------

const NO_RULES: MeetingTemplateSettings = { template: "", folderRules: [], typeRules: [], templateFolder: "Templates" };
const settings = (over: Partial<MeetingTemplateSettings> = {}): MeetingTemplateSettings => ({ ...NO_RULES, ...over });

/** A timed event at local 09:30–10:15, independent of the machine's zone. */
function timedEvent(partial: Partial<PimEventRow> = {}): PimEventRow {
  return ev({
    start: { ts: new Date(2026, 6, 20, 9, 30).getTime() },
    end: { ts: new Date(2026, 6, 20, 10, 15).getTime() },
    location: "Room 5",
    attendees: ["Ada", "Grace"],
    rsvps: [
      { name: "Grace", email: "grace@example.org", status: "accepted" },
      { name: "Ada", email: "ada@example.org", status: "accepted", organizer: true },
    ],
    meetingUrl: "https://teams.microsoft.com/l/meetup-join/abc",
    description: "Agenda: [Q4 plan](https://contoso.sharepoint.com/q4.docx)",
    ...partial,
  });
}

const ALL_TOKENS_TEMPLATE = [
  "---",
  "type: Besprechung",
  "tags: [meeting]",
  "---",
  "# {{title}}",
  "Von {{start}} bis {{end}} ({{start:HH:mm}}–{{end:HH:mm}})",
  "Ort: {{location}}",
  "Wer: {{attendees}}",
  "{{attendees:list}}",
  "Leitung: {{organizer}}",
  "Link: {{link}}",
  "",
  "{{description}}",
  "",
].join("\n");

describe("meeting-note template: which one applies", () => {
  it("takes the explicit setting first, then a folder rule, then a type rule", () => {
    const all = settings({
      template: "Meeting.md",
      folderRules: [{ folder: "Meetings", template: "Ordner.md" }],
      typeRules: [{ type: "Meeting", template: "Typ.md" }],
    });
    expect(meetingTemplatePath(all, "Meetings", "Meeting")).toBe("Templates/Meeting.md");
    expect(meetingTemplatePath({ ...all, template: "" }, "Meetings", "Meeting")).toBe("Templates/Ordner.md");
    expect(meetingTemplatePath({ ...all, template: "", folderRules: [] }, "Meetings", "Meeting")).toBe("Templates/Typ.md");
    expect(meetingTemplatePath(NO_RULES, "Meetings", "Meeting")).toBe("");
  });

  it("reads a name the way the rules do: bare name in the templates folder, a path as it stands, .md completed", () => {
    expect(meetingTemplatePath(settings({ template: "Meeting", templateFolder: "Vorlagen/" }), "Meetings", "Meeting")).toBe("Vorlagen/Meeting.md");
    expect(meetingTemplatePath(settings({ template: "Vorlagen/Meeting" }), "Meetings", "Meeting")).toBe("Vorlagen/Meeting.md");
  });

  it("lists exactly the placeholders the plan names, for both settings pages", () => {
    expect([...MEETING_TEMPLATE_TOKENS]).toEqual(["title", "start", "end", "location", "attendees", "organizer", "link", "description"]);
  });
});

describe("meeting-note template: without one the note is byte for byte what it was", () => {
  // Pinned from the builder before E24 — a template feature must not change a
  // single byte for anyone who does not use it.
  const TODAY_WITH_FIELDS =
    "---\ntype: Meeting\ndate: 2026-07-20\nplainva:\n  pim:\n    uid: uid-abc\n    account: acc-1\n    calendar: cal-1\nlocation: Room 5\nattendees:\n  - a@example.org\n  - b@example.org\n---\n# Weekly Standup\n";
  const TODAY_BARE =
    "---\ntype: Meeting\ndate: 2026-07-20\nplainva:\n  pim:\n    uid: uid-abc\n    account: acc-1\n    calendar: cal-1\n---\n# Weekly Standup\n";

  it("with template settings that name nothing", async () => {
    const { adapter, files } = fakeAdapter();
    const event = ev({ location: "Room 5", attendees: ["a@example.org", "b@example.org"] });
    const res = await resolveOrCreateMeetingNote({ adapter, event, dayKey: "2026-07-20", folder: "Meetings", noteType: "Meeting", templates: NO_RULES });
    expect(res).toEqual({ path: "Meetings/2026-07-20 Weekly Standup.md", created: true });
    expect(files.get(res.path)).toBe(TODAY_WITH_FIELDS);
  });

  it("without template settings at all", async () => {
    const { adapter, files } = fakeAdapter();
    const res = await resolveOrCreateMeetingNote({ adapter, event: ev(), dayKey: "2026-07-20", folder: "Meetings", noteType: "Meeting" });
    expect(files.get(res.path)).toBe(TODAY_BARE);
  });

  it("when the named template file is missing — no silent swap to another rule", async () => {
    const { adapter, files } = fakeAdapter({ "Templates/Typ.md": "TYPE TEMPLATE {{title}}" });
    const res = await resolveOrCreateMeetingNote({
      adapter,
      event: ev(),
      dayKey: "2026-07-20",
      folder: "Meetings",
      noteType: "Meeting",
      templates: settings({ template: "Gone.md", typeRules: [{ type: "Meeting", template: "Typ.md" }] }),
    });
    expect(files.get(res.path)).toBe(TODAY_BARE);
  });
});

describe("meeting-note template: rendering", () => {
  it("fills every placeholder from the event and keeps the template's own frontmatter", async () => {
    const { adapter, files } = fakeAdapter({ "Templates/Meeting.md": ALL_TOKENS_TEMPLATE });
    const res = await resolveOrCreateMeetingNote({
      adapter,
      event: timedEvent(),
      dayKey: "2026-07-20",
      folder: "Meetings",
      noteType: "Meeting",
      templates: settings({ template: "Meeting.md" }),
    });
    const note = files.get(res.path)!;
    expect(note).toContain("# Weekly Standup");
    expect(note).toContain("Von 2026-07-20 09:30 bis 2026-07-20 10:15 (09:30–10:15)");
    expect(note).toContain("Ort: Room 5");
    expect(note).toContain("Wer: Ada, Grace");
    expect(note).toContain("- Ada\n- Grace");
    expect(note).toContain("Leitung: Ada");
    expect(note).toContain("Link: https://teams.microsoft.com/l/meetup-join/abc");
    expect(note).toContain("Agenda: [Q4 plan](https://contoso.sharepoint.com/q4.docx)");
    expect(note).not.toContain("{{");
    // The template's type wins (OKF write rule); its other keys survive.
    expect(readFrontmatterPath(note, ["type"])).toBe("Besprechung");
    expect(readFrontmatterPath(note, ["tags"])).toEqual(["meeting"]);
    // The event's fields are Plainva's, written after the template.
    expect(readFrontmatterPath(note, ["date"])).toBe("2026-07-20");
    expect(readFrontmatterPath(note, ["location"])).toBe("Room 5");
    expect(readFrontmatterPath(note, ["attendees"])).toEqual(["Ada", "Grace"]);
    expect(readFrontmatterPath(note, ["plainva", "pim"])).toEqual({ uid: "uid-abc", account: "acc-1", calendar: "cal-1" });
  });

  it("gives an all-day event its LAST day as the end, not the provider's exclusive one", async () => {
    const { adapter, files } = fakeAdapter({ "Templates/Meeting.md": "{{start}} – {{end}} · {{end:DD.MM.}}" });
    const res = await resolveOrCreateMeetingNote({
      adapter,
      event: ev({ allDay: true, start: { ts: 0, date: "2026-07-20" }, end: { ts: 0, date: "2026-07-23" } }),
      dayKey: "2026-07-20",
      folder: "Meetings",
      noteType: "Meeting",
      templates: settings({ template: "Meeting.md" }),
    });
    expect(files.get(res.path)).toContain("2026-07-20 – 2026-07-22 · 22.07.");
  });

  it("empties what the event does not have, and strips the template-only keys", async () => {
    const tpl = "---\nplainva:\n  templateFor: ['[[Meetings.base]]']\n  icon: 📅\n---\nOrt: {{location}}|Link: {{link}}|Leitung: {{organizer}}";
    const { adapter, files } = fakeAdapter({ "Templates/Meeting.md": tpl });
    const res = await resolveOrCreateMeetingNote({
      adapter, event: ev(), dayKey: "2026-07-20", folder: "Meetings", noteType: "Meeting", templates: settings({ template: "Meeting.md" }),
    });
    const note = files.get(res.path)!;
    expect(note).toContain("Ort: |Link: |Leitung: ");
    expect(readFrontmatterPath(note, ["plainva", "templateFor"])).toBeUndefined();
    // Another plainva key of the template is inheritable and survives the anchor.
    expect(readFrontmatterPath(note, ["plainva", "icon"])).toBe("📅");
    expect(readFrontmatterPath(note, ["plainva", "pim", "uid"])).toBe("uid-abc");
    expect(readFrontmatterPath(note, ["type"])).toBe("Meeting");
  });

  it("applies a folder rule for the meetings folder and a type rule for 'Meeting'", async () => {
    for (const templates of [
      settings({ folderRules: [{ folder: "Meetings", template: "Besprechung.md" }] }),
      settings({ typeRules: [{ type: "Meeting", template: "Besprechung.md" }] }),
    ]) {
      const { adapter, files } = fakeAdapter({ "Templates/Besprechung.md": "## Agenda for {{title}}\n" });
      const res = await resolveOrCreateMeetingNote({ adapter, event: ev(), dayKey: "2026-07-20", folder: "Meetings", noteType: "Meeting", templates });
      expect(files.get(res.path)).toContain("## Agenda for Weekly Standup");
      expect(readFrontmatterPath(files.get(res.path)!, ["plainva", "pim", "uid"])).toBe("uid-abc");
    }
  });
});

describe("meeting-note template: no template can break the link to its event", () => {
  const create = async (template: string, event = ev()) => {
    const { adapter, files } = fakeAdapter({ "Templates/Meeting.md": template });
    const opts = { adapter, event, dayKey: "2026-07-20", folder: "Meetings", noteType: "Meeting", templates: settings({ template: "Meeting.md" }) };
    const first = await resolveOrCreateMeetingNote(opts);
    const second = await resolveOrCreateMeetingNote(opts);
    return { first, second, note: files.get(first.path)! };
  };

  it("overwrites a foreign anchor the template carries", async () => {
    const { first, second, note } = await create("---\nplainva:\n  pim:\n    uid: somebody-else\n    account: x\n---\nBody");
    expect(readFrontmatterPath(note, ["plainva", "pim"])).toEqual({ uid: "uid-abc", account: "acc-1", calendar: "cal-1" });
    // The second click finds the same note — the whole point of the anchor.
    expect(second).toEqual({ path: first.path, created: false });
  });

  it("replaces a `plainva` key that is not a map", async () => {
    const { second, first, note } = await create("---\nplainva: broken\n---\nBody");
    expect(readFrontmatterPath(note, ["plainva", "pim", "uid"])).toBe("uid-abc");
    expect(second).toEqual({ path: first.path, created: false });
  });

  it("falls back to the built-in note when the template's frontmatter cannot be written", async () => {
    const { first, second, note } = await create("---\nplainva: [unclosed\n---\nBody {{title}}");
    expect(note).toBe(buildMeetingNoteContent(ev(), "2026-07-20", "Meeting"));
    expect(second).toEqual({ path: first.path, created: false });
  });

  it("does not let the date be moved by the template", async () => {
    const { note } = await create("---\ndate: 1999-01-01\n---\nBody");
    expect(readFrontmatterPath(note, ["date"])).toBe("2026-07-20");
  });
});

describe("meeting-note template: asked, cancelled, caret", () => {
  it("asks through the shell with the event in the context, and places the caret in the written file", async () => {
    const { adapter, files } = fakeAdapter({ "Templates/Meeting.md": "## Notizen\n{{cursor}}\n{{prompt:Thema}}" });
    let seen: TemplateContext | null = null;
    const res = await resolveOrCreateMeetingNote({
      adapter,
      event: timedEvent(),
      dayKey: "2026-07-20",
      folder: "Meetings",
      noteType: "Meeting",
      templates: settings({ template: "Meeting.md" }),
      resolveTemplate: async (raw, ctx) => {
        seen = ctx;
        const resolved = resolveTemplate(raw, ctx, "interactive");
        return finalizeTemplate(resolved.text, { Thema: "Budget" });
      },
    });
    expect(res).not.toBeNull();
    expect(seen!.event?.location).toBe("Room 5");
    expect(seen!.title).toBe("Weekly Standup");
    const note = files.get(res!.path)!;
    expect(note).toContain("Budget");
    expect(res!.cursor).toBe(note.indexOf("## Notizen\n") + "## Notizen\n".length);
  });

  it("writes nothing — not even the folder — when the questions are cancelled", async () => {
    const { adapter, files, dirs } = fakeAdapter({ "Templates/Meeting.md": "{{prompt:Thema}}" });
    const res = await resolveOrCreateMeetingNote({
      adapter,
      event: ev(),
      dayKey: "2026-07-20",
      folder: "Meetings",
      noteType: "Meeting",
      templates: settings({ template: "Meeting.md" }),
      resolveTemplate: async () => null,
    });
    expect(res).toBeNull();
    expect([...files.keys()]).toEqual(["Templates/Meeting.md"]);
    expect(dirs).toHaveLength(0);
  });

  it("opens an existing note without asking anything", async () => {
    const { adapter } = fakeAdapter({ "Templates/Meeting.md": "{{prompt:Thema}}" });
    const opts = { adapter, event: ev(), dayKey: "2026-07-20", folder: "Meetings", noteType: "Meeting", templates: settings({ template: "Meeting.md" }) };
    const first = await resolveOrCreateMeetingNote(opts);
    let asked = 0;
    const again = await resolveOrCreateMeetingNote({ ...opts, resolveTemplate: async () => { asked++; return null; } });
    expect(again).toEqual({ path: first.path, created: false });
    expect(asked).toBe(0);
  });
});

describe("meetingTemplateEvent", () => {
  it("names the organizer the attendee list marks, and nobody when none is marked", () => {
    expect(meetingTemplateEvent(timedEvent()).organizer).toBe("Ada");
    expect(meetingTemplateEvent(ev()).organizer).toBeUndefined();
  });
});
