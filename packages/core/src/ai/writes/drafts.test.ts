import { describe, expect, it } from "vitest";
import { acpAuthorId } from "../acp/agents.js";
import { assistantAuthorId, machineAuthorId, machineAuthorKind, machineAuthorSubject, mcpAuthorId, scriptAuthorId } from "./authors.js";
import {
  OPENED_DRAFT_KINDS,
  WRITE_DRAFT_DONE_CAP,
  WRITE_DRAFT_LIMITS,
  draftEndsOf,
  isCivilDay,
  isClockTime,
  isDraftAddress,
  parseWriteDraft,
  parseWriteDraftOutcomes,
  parseWriteDrafts,
  serializeWriteDrafts,
  withWriteDraft,
  withWriteDraftOutcome,
  withoutWriteDraft,
  type WriteDraft,
  type WriteDraftOutcome,
} from "./drafts.js";
import { MEMORY_LIMITS } from "../memory/memoryFile.js";

const draft = (over: Partial<WriteDraft> = {}): WriteDraft => ({
  id: "d-000001",
  createdAt: "2026-10-07T09:00:00.000Z",
  author: { id: assistantAuthorId("model-x"), label: "Plainva AI · model-x" },
  conversationId: "c1",
  title: "Roof plan",
  body: { kind: "note", path: null, folder: "Projects", content: "# Roof plan\n\nText\n" },
  inherited: ["cloud"],
  sources: [{ resource: "Projects/Offer.md", title: "Offer" }],
  defused: 0,
  ...over,
});

describe("who a machine's write is signed with", () => {
  it("has one id per kind of writer", () => {
    expect(machineAuthorId({ kind: "assistant", model: "model-x" })).toBe("plainva-ai/model-x");
    expect(machineAuthorId({ kind: "mcp", clientId: "3f9a" })).toBe("mcp:3f9a");
    expect(machineAuthorId({ kind: "acp", agentId: "a1" })).toBe(acpAuthorId("a1"));
    expect(machineAuthorId({ kind: "script", name: "tag-count" })).toBe("script:tag-count");
    expect(mcpAuthorId("3f9a")).toBe("mcp:3f9a");
    expect(scriptAuthorId("tag-count")).toBe("script:tag-count");
  });

  it("tells a machine from a person, and reads the id back", () => {
    expect(machineAuthorKind("plainva-ai/model-x")).toBe("assistant");
    expect(machineAuthorKind("mcp:3f9a")).toBe("mcp");
    expect(machineAuthorKind("acp:a1")).toBe("acp");
    expect(machineAuthorKind("script:tag-count")).toBe("script");
    expect(machineAuthorSubject("plainva-ai/vendor/model-x")).toBe("vendor/model-x");
    expect(machineAuthorSubject("mcp:3f9a")).toBe("3f9a");
    expect(machineAuthorSubject("script:tag-count")).toBe("tag-count");
    // A device id, a member id, a prefix with nothing behind it: a person's, or nobody's.
    for (const id of ["4f3a9c0d4f3a9c0d4f3a9c0d4f3a9c0d", "member-7", "plainva-ai/", "mcp:", "acp:", "script:", "scripts:x", "", null, undefined]) {
      expect(machineAuthorKind(id), String(id)).toBeNull();
    }
    expect(machineAuthorSubject("member-7")).toBeNull();
  });
});

describe("drafts as they are stored", () => {
  it("reads back what it wrote, for every kind", () => {
    const all = [
      draft(),
      draft({ id: "d-000002", createdAt: "2026-10-07T09:01:00.000Z", title: "Call the roofer", body: { kind: "task", text: "Call the roofer tomorrow !high", day: "2026-10-07" }, inherited: [], sources: [] }),
      draft({ id: "d-000003", createdAt: "2026-10-07T09:02:00.000Z", title: "Decided", body: { kind: "journal", text: "Decided on tiles", day: "2026-10-07", time: "11:02", task: false } }),
      draft({ id: "d-000004", createdAt: "2026-10-07T09:03:00.000Z", title: "Tiles", body: { kind: "entry", base: "Projects/Costs.base", properties: { amount: 4500, paid: false, tags: ["roof"] }, content: "" } }),
      draft({ id: "d-000005", createdAt: "2026-10-07T09:04:00.000Z", author: { id: "acp:a1", label: "Helper" }, conversationId: null, body: { kind: "note", path: "Projects/New.md", folder: null, content: "x" } }),
    ];
    const stored = JSON.parse(JSON.stringify(serializeWriteDrafts(all))) as unknown;
    expect(parseWriteDrafts(stored)).toEqual(all);
  });

  it("puts them in the order they were laid down, each once", () => {
    const late = draft({ id: "d-late01", createdAt: "2026-10-07T12:00:00.000Z" });
    const early = draft({ id: "d-early1", createdAt: "2026-10-07T08:00:00.000Z" });
    expect(parseWriteDrafts({ version: 1, drafts: [late, early, late] }).map((item) => item.id)).toEqual(["d-early1", "d-late01"]);
  });

  it("takes a list it cannot read for an empty one", () => {
    for (const raw of [null, undefined, "x", [], {}, { version: 2, drafts: [draft()] }, { version: 1, drafts: "x" }]) expect(parseWriteDrafts(raw)).toEqual([]);
  });

  it("leaves out what is no draft and keeps the rest", () => {
    const bad: unknown[] = [
      { ...draft(), id: "x" },
      { ...draft(), id: "has space" },
      { ...draft(), createdAt: "yesterday" },
      // Signed with a person's id: not written by this code.
      { ...draft(), author: { id: "member-7", label: "Ada" } },
      { ...draft(), author: { id: "plainva-ai/", label: "" } },
      { ...draft(), title: "  " },
      { ...draft(), title: "t".repeat(WRITE_DRAFT_LIMITS.title + 1) },
      { ...draft(), body: { kind: "note", path: "../outside.md", folder: null, content: "" } },
      { ...draft(), body: { kind: "note", path: "Projects/not-a-note.txt", folder: null, content: "" } },
      { ...draft(), body: { kind: "note", path: null, folder: "a//b", content: "" } },
      { ...draft(), body: { kind: "note", path: null, folder: null, content: "x".repeat(WRITE_DRAFT_LIMITS.content + 1) } },
      { ...draft(), body: { kind: "task", text: "", day: "2026-10-07" } },
      { ...draft(), body: { kind: "task", text: "x", day: "7 October" } },
      { ...draft(), body: { kind: "journal", text: "x", day: "2026-10-07", time: "25:00", task: false } },
      { ...draft(), body: { kind: "entry", base: "Projects/Costs.md", properties: {}, content: "" } },
      { ...draft(), body: { kind: "entry", base: "Projects/Costs.base", properties: { nested: { a: 1 } }, content: "" } },
      { ...draft(), body: { kind: "delete", path: "Projects/Offer.md" } },
      "not an object",
    ];
    const good = draft({ id: "d-good01" });
    expect(parseWriteDrafts({ version: 1, drafts: [...bad, good] })).toEqual([good]);
    for (const item of bad) expect(parseWriteDraft(item), JSON.stringify(item).slice(0, 80)).toBeNull();
  });

  it("cleans what is not the form instead of believing it", () => {
    const read = parseWriteDraft({ ...draft(), inherited: ["web", "cloud", "everything", 7], sources: "the internet", defused: -3, extra: "ignored" });
    expect(read?.inherited).toEqual(["cloud", "web"]);
    expect(read?.sources).toEqual([]);
    expect(read?.defused).toBe(0);
    expect(read && "extra" in read).toBe(false);
    // A folder of "" is the vault itself, which a draft says with null.
    expect(parseWriteDraft({ ...draft(), body: { kind: "note", path: null, folder: "", content: "" } })?.body).toEqual({ kind: "note", path: null, folder: null, content: "" });
  });
});

describe("the list of drafts", () => {
  it("takes a draft and gives it back", () => {
    const added = withWriteDraft([], draft());
    expect(added).toEqual({ ok: true, drafts: [draft()] });
    expect(withoutWriteDraft([draft(), draft({ id: "d-000002" })], "d-000001").map((item) => item.id)).toEqual(["d-000002"]);
    expect(withoutWriteDraft([draft()], "d-unknown")).toEqual([draft()]);
  });

  it("never drops a waiting draft to make room for another", () => {
    const full = Array.from({ length: WRITE_DRAFT_LIMITS.drafts }, (_, index) => draft({ id: `d-${String(index).padStart(6, "0")}` }));
    expect(withWriteDraft(full, draft({ id: "d-onemore" }))).toEqual({ ok: false, problem: "full" });
    expect(withWriteDraft(full.slice(1), draft({ id: "d-onemore" })).ok).toBe(true);
  });

  it("refuses the same draft twice and one that is none", () => {
    expect(withWriteDraft([draft()], draft())).toEqual({ ok: false, problem: "duplicate" });
    expect(withWriteDraft([], draft({ title: "" }))).toEqual({ ok: false, problem: "invalid" });
  });
});

describe("what became of a draft", () => {
  const outcome = (over: Partial<WriteDraftOutcome> = {}): WriteDraftOutcome => ({ id: "d-000001", kind: "note", title: "Roof plan", outcome: "created", path: "Inbox/Roof plan.md", at: "2026-10-07T09:05:00.000Z", ...over });

  it("is stored beside the waiting drafts and read back, oldest first", () => {
    const later = outcome({ id: "d-later", at: "2026-10-07T10:00:00.000Z" });
    const stored = JSON.parse(JSON.stringify(serializeWriteDrafts([draft({ id: "d-000002" })], [later, outcome()])));
    expect(parseWriteDrafts(stored).map((item) => item.id)).toEqual(["d-000002"]);
    expect(parseWriteDraftOutcomes(stored)).toEqual([outcome(), later]);
    // A file written before outcomes were kept has none, and so has one that cannot be read.
    expect(parseWriteDraftOutcomes(JSON.parse(JSON.stringify(serializeWriteDrafts([draft()]))))).toEqual([]);
    expect(parseWriteDraftOutcomes({ version: 1, drafts: [] })).toEqual([]);
    expect(parseWriteDraftOutcomes(null)).toEqual([]);
    expect(parseWriteDraftOutcomes({ version: 2, done: [outcome()] })).toEqual([]);
  });

  it("keeps a path only where something was created inside the vault, and nothing that is no outcome", () => {
    const stored = {
      version: 1,
      drafts: [],
      done: [
        outcome({ id: "d-discarded", outcome: "discarded" }),
        { ...outcome({ id: "d-climbs" }), path: "../outside.md" },
        { ...outcome({ id: "d-lost00" }), outcome: "lost" },
        { ...outcome({ id: "d-mail00" }), kind: "mail" },
        { ...outcome({ id: "d-when00" }), at: "yesterday" },
        { ...outcome({ id: "d-blank0" }), title: " " },
        { ...outcome(), id: "x" },
        outcome({ id: "d-discarded", title: "Said twice" }),
        "created",
        null,
      ],
    };
    expect(parseWriteDraftOutcomes(stored)).toEqual([
      { id: "d-climbs", kind: "note", title: "Roof plan", outcome: "created", at: "2026-10-07T09:05:00.000Z" },
      { id: "d-discarded", kind: "note", title: "Roof plan", outcome: "discarded", at: "2026-10-07T09:05:00.000Z" },
    ]);
  });

  it("says the newest word about a draft once, and forgets the oldest past its bound", () => {
    const first = withWriteDraftOutcome([], outcome({ outcome: "discarded", path: undefined }));
    const again = withWriteDraftOutcome(first, outcome());
    expect(again).toEqual([outcome()]);
    let done: WriteDraftOutcome[] = [];
    for (let index = 0; index < WRITE_DRAFT_DONE_CAP + 3; index++) done = withWriteDraftOutcome(done, outcome({ id: `d-${String(index).padStart(6, "0")}` }));
    expect(done).toHaveLength(WRITE_DRAFT_DONE_CAP);
    expect(done[0]!.id).toBe("d-000003");
    // Stored and read back, the bound holds as well.
    const many = Array.from({ length: WRITE_DRAFT_DONE_CAP + 2 }, (_, index) => outcome({ id: `d-${String(index).padStart(6, "0")}`, at: new Date(Date.UTC(2026, 9, 7, 9, 0, index)).toISOString() }));
    const back = parseWriteDraftOutcomes(JSON.parse(JSON.stringify(serializeWriteDrafts([], many))));
    expect(back).toHaveLength(WRITE_DRAFT_DONE_CAP);
    expect(back[0]!.id).toBe("d-000002");
  });
});

describe("an e-mail and an appointment as drafts", () => {
  const mail = (over: Record<string, unknown> = {}) => ({ kind: "mail", to: ["anna@example.org"], cc: [], bcc: [], subject: "Roof", body: "Hello Anna", unnamed: [], ...over });
  const event = (over: Record<string, unknown> = {}) => ({
    kind: "event",
    title: "Roofer on site",
    allDay: false,
    day: "2026-10-14",
    endDay: "2026-10-14",
    start: "09:00",
    end: "10:30",
    location: "Main street 4",
    description: "Bring the plan.",
    attendees: ["tom@example.org"],
    unnamed: [],
    ...over,
  });
  const body = (raw: unknown) => parseWriteDraft({ ...draft(), body: raw })?.body ?? null;

  it("reads both back as they were laid down", () => {
    // Laid down one after the other: the list keeps that order.
    const drafts = [
      draft({ id: "d-mail01", createdAt: "2026-10-07T09:00:00.000Z", title: "Roof", body: mail() as WriteDraft["body"] }),
      draft({ id: "d-event1", createdAt: "2026-10-07T09:00:01.000Z", title: "Roofer on site", body: event() as WriteDraft["body"] }),
    ];
    expect(parseWriteDrafts(JSON.parse(JSON.stringify(serializeWriteDrafts(drafts))))).toEqual(drafts);
  });

  it("takes an address only as one plain address — nothing a header or a list could be made of", () => {
    for (const address of ["anna@example.org", "a.b+c@sub.example.co.uk", "ÄNNA@exämple.org"]) expect(isDraftAddress(address), address).toBe(true);
    for (const address of [
      "anna",
      "anna@example",
      "@example.org",
      "anna@",
      "Anna <anna@example.org>",
      "anna@example.org, tom@example.org",
      "anna@example.org;tom@example.org",
      "anna@example.org\nBcc: eve@example.org",
      " anna@example.org",
      "anna @example.org",
      "anna@exa mple.org",
      "anna@@example.org",
      "mailto:anna@example.org",
      `${"a".repeat(320)}@example.org`,
      42,
      null,
    ])
      expect(isDraftAddress(address), String(address)).toBe(false);
    expect(body(mail({ to: ["Anna <anna@example.org>"] }))).toBeNull();
    expect(body(mail({ cc: "anna@example.org" }))).toBeNull();
    expect(body(mail({ bcc: Array.from({ length: WRITE_DRAFT_LIMITS.recipients + 1 }, (_, index) => `p${index}@example.org`) }))).toBeNull();
    // Twice the same counts once.
    expect(body(mail({ to: ["anna@example.org", "anna@example.org"] }))).toMatchObject({ to: ["anna@example.org"] });
  });

  it("is no mail without anything to say or anybody to say it to — and one with either", () => {
    expect(body(mail({ to: [], subject: " ", body: "" }))).toBeNull();
    expect(body(mail({ to: [], subject: "Roof", body: "" }))).toMatchObject({ kind: "mail", to: [], subject: "Roof" });
    expect(body(mail({ subject: "", body: "" }))).toMatchObject({ kind: "mail", to: ["anna@example.org"] });
    expect(body(mail({ subject: "x".repeat(WRITE_DRAFT_LIMITS.subject + 1) }))).toBeNull();
  });

  it("warns only about somebody the mail goes to, or the appointment invites", () => {
    expect(body(mail({ cc: ["tom@example.org"], unnamed: ["tom@example.org", "eve@example.org"] }))).toMatchObject({ unnamed: ["tom@example.org"] });
    expect(body(mail({ unnamed: "anna@example.org" }))).toMatchObject({ unnamed: [] });
    expect(body(event({ unnamed: ["tom@example.org", "anna@example.org"] }))).toMatchObject({ unnamed: ["tom@example.org"] });
  });

  it("reads a day that exists and a time of the clock, and nothing else", () => {
    for (const day of ["2026-10-14", "2028-02-29"]) expect(isCivilDay(day), day).toBe(true);
    for (const day of ["2026-02-30", "2026-13-01", "2026-10-1", "14.10.2026", "tomorrow", "", 20261014]) expect(isCivilDay(day), String(day)).toBe(false);
    for (const time of ["00:00", "09:05", "23:59"]) expect(isClockTime(time), time).toBe(true);
    for (const time of ["24:00", "9:05", "09:60", "9 am", "", 900]) expect(isClockTime(time), String(time)).toBe(false);
  });

  it("is no appointment without a title, on a day that is none, or one that ends before it begins", () => {
    expect(body(event({ title: " " }))).toBeNull();
    expect(body(event({ day: "2026-02-30" }))).toBeNull();
    expect(body(event({ start: "9:00" }))).toBeNull();
    expect(body(event({ end: "09:00" }))).toBeNull();
    expect(body(event({ end: "08:00" }))).toBeNull();
    expect(body(event({ attendees: ["tom"] }))).toBeNull();
    expect(body(event({ location: "x".repeat(WRITE_DRAFT_LIMITS.place + 1) }))).toBeNull();
  });

  it("gives an all-day appointment its days and no times; it ends on its own day or later", () => {
    expect(body(event({ allDay: true, endDay: "2026-10-16", start: "09:00", end: "10:00" }))).toMatchObject({ allDay: true, day: "2026-10-14", endDay: "2026-10-16", start: "", end: "" });
    expect(body(event({ allDay: true, endDay: "2026-10-01" }))).toMatchObject({ endDay: "2026-10-14" });
    expect(body(event({ allDay: true, endDay: "soon" }))).toMatchObject({ endDay: "2026-10-14" });
    // A timed one is on one day, whatever was written beside it.
    expect(body(event({ endDay: "2026-10-20" }))).toMatchObject({ allDay: false, endDay: "2026-10-14" });
  });

  it("ends where the user took the step in the app's own editor — never as something that was created", () => {
    expect(OPENED_DRAFT_KINDS).toEqual(["mail", "event"]);
    expect(draftEndsOf("mail")).toEqual(["discarded", "sent", "saved", "opened"]);
    expect(draftEndsOf("event")).toEqual(["discarded", "saved"]);
    for (const kind of ["note", "task", "journal", "entry"] as const) expect(draftEndsOf(kind), kind).toEqual(["discarded", "created"]);
    const at = "2026-10-07T09:05:00.000Z";
    const stored = {
      version: 1,
      done: [
        { id: "d-sent01", kind: "mail", title: "Roof", outcome: "sent", at },
        { id: "d-saved1", kind: "mail", title: "Roof", outcome: "saved", at },
        { id: "d-moved1", kind: "mail", title: "Roof", outcome: "opened", at },
        { id: "d-event1", kind: "event", title: "Roofer", outcome: "saved", at },
        // Ends these kinds cannot have: a mail that was "created", an appointment that was "sent", a note that was "saved".
        { id: "d-wrong1", kind: "mail", title: "Roof", outcome: "created", at },
        { id: "d-wrong2", kind: "event", title: "Roofer", outcome: "sent", at },
        { id: "d-wrong3", kind: "event", title: "Roofer", outcome: "opened", at },
        { id: "d-wrong4", kind: "note", title: "Roof plan", outcome: "saved", at },
      ],
    };
    expect(parseWriteDraftOutcomes(stored).map((outcome) => `${outcome.id}:${outcome.outcome}`)).toEqual(["d-event1:saved", "d-moved1:opened", "d-saved1:saved", "d-sent01:sent"]);
  });
});

describe("what an assistant drafts for the memory (plan P6)", () => {
  const entry = (body: WriteDraft["body"], id = "d-000001") => draft({ id, title: "x", body, inherited: [], sources: [] });

  it("reads all of them back as they were laid down", () => {
    const all = [
      entry({ kind: "memory", text: "I bill per day.", place: "active", replaces: null }),
      entry({ kind: "memory", text: "My rate is 1000.", place: "long", replaces: "My rate is 950." }, "d-000002"),
      entry({ kind: "forget", entry: "Offers hold for 30 days." }, "d-000003"),
      entry({ kind: "rule", text: "Answer in German." }, "d-000004"),
    ];
    expect(parseWriteDrafts(JSON.parse(JSON.stringify(serializeWriteDrafts(all))))).toEqual(all);
  });

  it("takes as an entry or a rule only what can be written as one: a single line, within the bound, with something to see", () => {
    const stored = (body: unknown) => parseWriteDraft({ ...entry({ kind: "rule", text: "x" }), body });
    for (const text of ["", "   ", "One.\nTwo.", "x".repeat(MEMORY_LIMITS.entryChars + 1), "<!-- only a comment -->"]) {
      expect(stored({ kind: "memory", text, place: "active", replaces: null }), JSON.stringify(text.slice(0, 20))).toBeNull();
      expect(stored({ kind: "rule", text }), JSON.stringify(text.slice(0, 20))).toBeNull();
    }
    // A place nobody knows is the first one, never a third file.
    expect(stored({ kind: "memory", text: "A.", place: "elsewhere" })?.body).toEqual({ kind: "memory", text: "A.", place: "active", replaces: null });
    expect(stored({ kind: "memory", text: "A.", place: "long", replaces: "" })).toBeNull();
    expect(stored({ kind: "forget", entry: "" })).toBeNull();
    expect(stored({ kind: "forget" })).toBeNull();
  });

  it("what became of one is kept like every other outcome", () => {
    const done: WriteDraftOutcome[] = [
      { id: "d-000001", kind: "memory", title: "I bill per day.", outcome: "created", at: "2026-10-09T10:00:00.000Z" },
      { id: "d-000002", kind: "forget", title: "Offers hold.", outcome: "created", at: "2026-10-09T10:01:00.000Z" },
      { id: "d-000003", kind: "rule", title: "Answer in German.", outcome: "discarded", at: "2026-10-09T10:02:00.000Z" },
    ];
    expect(parseWriteDraftOutcomes(JSON.parse(JSON.stringify(serializeWriteDrafts([], done))))).toEqual(done);
  });
});
