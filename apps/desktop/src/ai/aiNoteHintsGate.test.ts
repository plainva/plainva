import { describe, expect, it } from "vitest";
import {
  buildLinkTargetIndex,
  DEFAULT_AI_APP_SETTINGS,
  resolveLinkTargetIndexed,
  resolveMarkdownLinkIndexed,
  withTodoAsTask,
  type AiAppSettings,
  type AiEgress,
  type HttpRequestSpec,
  type PimEventRow,
} from "@plainva/core";
import {
  AiSession,
  brokenLinkNotePath,
  brokenLinksIn,
  createAiVaultHost,
  createVaultPolicy,
  meetingsWithoutNote,
  NOTE_HINTS_KEPT,
  readNoteHintsPrefs,
  type NoteHintItem,
  type NoteHintsAnswer,
  type NoteHintsHost,
} from "@plainva/ui";
import { memoryFiles } from "./mcpTestHost";

/**
 * Calm hints at the open note (plan KI-Harness P8-3, mockup chapter 25): the
 * device notices by itself — no model, nothing sent — a link of the note that
 * leads nowhere, a line that begins with TODO and is no task yet, and in
 * today's daily note an appointment of tomorrow no note is connected to. At
 * most three, one of each kind first. Each step is the app's own way, on the
 * user's click: the note a link names where the link finds it, the line made a
 * task where it stands (and nothing else of the note), the meeting note the
 * calendar's way. What is hidden or paused is kept on this device, for this
 * vault, in the app's data.
 *
 * The session is the real one, the vault's host the one both shells build;
 * the shell's index, calendar and steps are this vault's files in memory, the
 * links resolved by the core's own rule.
 */

const DAILY = "Journal/2026-10-24.md";
const PLAN_PATH = "Projects/Plan.md";
const title = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

const PLAN = [
  "---",
  "type: Note",
  "todo: a property, not a line of the note",
  "---",
  "# Plan",
  "",
  "See [[Budget]], [[Kickoff]] and [the offer](Offers/Offer%202026.md).",
  "TODO: call Tom",
  "- [ ] TODO already a task",
  "```",
  "TODO inside a fence",
  "```",
  "todo send the offer",
  "![[shot.png]] and [[Spec.pdf]] are files, [[Plan.v2]] is a note.",
  "Again [[Kickoff]].",
].join("\n");

/** An appointment of tomorrow as the calendar keeps it. */
const event = (uid: string, eventTitle: string, hours: number, allDay = false) =>
  ({ uid, title: eventTitle, allDay, start: { ts: new Date(2026, 9, 25, hours, 0).getTime() } }) as unknown as PimEventRow;

interface HintsVaultOptions {
  events?: PimEventRow[];
  /** The uids a note's `plainva.pim` anchor names. */
  anchored?: string[];
  /** The shell builds no hints. */
  noHints?: boolean;
  /** Every step fails. */
  failing?: boolean;
  /** The template's questions of a meeting note are cancelled. */
  cancelMeeting?: boolean;
}

function hintsVault(files: Record<string, string>, options: HintsVaultOptions = {}) {
  const disk = new Map(Object.entries(files));
  const meetingNotes: string[] = [];
  const index = () => buildLinkTargetIndex([...disk.keys()]);
  const query = {
    resolveNotePath: async (target: string, from?: string) => resolveLinkTargetIndexed(from ?? "", target, index()),
    resolveMarkdownLink: async (target: string, from?: string) => resolveMarkdownLinkIndexed(from ?? "", target, index()),
  } as unknown as Parameters<typeof brokenLinksIn>[0];
  const fail = () => {
    if (options.failing) throw new Error("disk full");
  };
  const hints: NoteHintsHost = {
    brokenLinks: (path, content) => brokenLinksIn(query, path, content),
    isTodaysDailyNote: async (path) => path === DAILY,
    meetingsTomorrow: async () => meetingsWithoutNote(options.events ?? [], async () => new Map((options.anchored ?? []).map((uid) => [uid, {}]))),
    async createLinkTarget(link) {
      fail();
      const place = brokenLinkNotePath(link);
      if (!place) return null;
      disk.set(place.path, `# ${place.title}\n`);
      return place.path;
    },
    async todoAsTask(path, line, raw) {
      fail();
      const text = disk.get(path);
      const next = text === undefined ? null : withTodoAsTask(text, line, raw);
      if (next === null) return false;
      disk.set(path, next);
      return true;
    },
    async createMeetingNote(row) {
      fail();
      if (options.cancelMeeting) return null;
      const path = `Meetings/${row.title}.md`;
      disk.set(path, `---\nplainva:\n  pim: ${row.uid}\n---\n# ${row.title}\n`);
      meetingNotes.push(row.uid);
      return path;
    },
  };
  const appData = memoryFiles();
  const host = createAiVaultHost({
    files: appData,
    vaultKey: "vault-hints",
    policy: createVaultPolicy({ readFile: async (path) => disk.get(path) ?? null, resolveLink: async () => null, encrypted: () => false }),
    activeNote: async () => null,
    readNote: async (path) => (disk.has(path) ? { path, title: title(path), text: disk.get(path)! } : null),
    situation: async () => ({ now: "2026-10-24 08:00", weekday: "Saturday", calendarDay: "2026-10-24", journalDay: "2026-10-24", active: null, tabs: [], tasks: [], events: [], dailyNote: null }),
    retrieval: null,
    toolDeps: null,
    ...(options.noHints ? {} : { hints }),
  });
  return { host, disk, appData, meetingNotes, file: (path: string) => disk.get(path) ?? null, stored: () => readNoteHintsPrefs(appData.files.get("vault-hints/hints.json") ?? null) };
}

type HintsVault = ReturnType<typeof hintsVault>;

async function hintsSession(vault: HintsVault, settings: Partial<AiAppSettings> = {}) {
  const sent: HttpRequestSpec[] = [];
  const egress: AiEgress = {
    async send(_id, spec) {
      sent.push(spec);
    },
    async cancel() {},
    async setKey() {},
    hasKey: async () => true,
    async deleteKey() {},
    addEndpoint: async () => true,
    async removeEndpoint() {},
  };
  let stored: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, providers: ["anthropic"], ...settings };
  const s = new AiSession({
    egress,
    loadSettings: async () => stored,
    saveSettings: async (next) => void (stored = next),
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "English",
    today: () => "2026-10-24",
    now: () => new Date(2026, 9, 24, 8, 0),
    newId: () => "id-1",
    label: (key) => key,
  });
  await s.load();
  await s.attachVault(vault.host);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { s, sent };
}

const items = (answer: NoteHintsAnswer): NoteHintItem[] => (answer.kind === "hints" ? answer.items : []);
const kinds = (answer: NoteHintsAnswer) => items(answer).map((item) => `${item.kind}:${item.subject}`);

describe("what the device notices at the open note", () => {
  it("names a link that leads nowhere, a TODO line that is no task yet — at most three, one of each kind first — and sends nothing", async () => {
    const vault = hintsVault({ [PLAN_PATH]: PLAN, "Finance/Budget.md": "# Budget\n" });
    const { s, sent } = await hintsSession(vault);
    const answer = await s.noteHints(PLAN_PATH, PLAN);
    // Kickoff (once, at its first line), the offer beside the note, the dotted note name — and the two TODO lines,
    // not the property, not the task, not the line in the fence. Round by round: a link, a line, a link.
    expect(kinds(answer)).toEqual(["link:[[Kickoff]]", "todo:call Tom", "link:[…](Offers/Offer%202026.md)"]);
    expect(items(answer).map((item) => item.line)).toEqual([7, 8, 7]);
    expect(items(answer)[1]!.raw).toBe("TODO: call Tom");
    // Not in today's daily note: no appointment is asked for. No model, no request.
    expect(sent).toEqual([]);
  });

  it("in today's daily note names tomorrow's appointments no note is connected to, in the order of the day", async () => {
    const daily = "# Saturday\n\nNothing planned. [[Packing list]]\n";
    const events = [event("late", "Dinner with Ana", 19), event("early", "Review with Tom", 9), event("noted", "Call the studio", 11)];
    const vault = hintsVault({ [DAILY]: daily }, { events, anchored: ["noted"] });
    const { s } = await hintsSession(vault);
    expect(kinds(await s.noteHints(DAILY, daily))).toEqual(["link:[[Packing list]]", "meeting:Review with Tom", "meeting:Dinner with Ana"]);
    // Another note asks for no appointment at all.
    expect(kinds(await s.noteHints(PLAN_PATH, daily))).toEqual(["link:[[Packing list]]"]);
  });

  it("is off where the AI is off, where the hints are switched off, and in a shell that builds none", async () => {
    const files = { [PLAN_PATH]: PLAN };
    expect(await (await hintsSession(hintsVault(files), { enabled: false })).s.noteHints(PLAN_PATH, PLAN)).toEqual({ kind: "off" });
    const off = await hintsSession(hintsVault(files), { noteHints: false });
    expect(await off.s.noteHints(PLAN_PATH, PLAN)).toEqual({ kind: "off" });
    // Switched back on in the settings, the next look finds them.
    await off.s.updateSettings((settings) => ({ ...settings, noteHints: true }));
    expect(kinds(await off.s.noteHints(PLAN_PATH, PLAN))).toHaveLength(3);
    const none = await hintsSession(hintsVault(files, { noHints: true }));
    expect(await none.s.noteHints(PLAN_PATH, PLAN)).toEqual({ kind: "off" });
    expect(none.s.getState().hints.available).toBe(false);
  });
});

describe("the one step of a hint", () => {
  it("creates the note a link names where the link finds it, and the hint is gone", async () => {
    const vault = hintsVault({ [PLAN_PATH]: PLAN, "Finance/Budget.md": "# Budget\n" });
    const { s } = await hintsSession(vault);
    const [kickoff] = items(await s.noteHints(PLAN_PATH, PLAN));
    const version = s.getState().hints.version;
    expect(await s.actOnNoteHint(PLAN_PATH, kickoff!)).toEqual({ kind: "opened", path: "Projects/Kickoff.md" });
    expect(vault.file("Projects/Kickoff.md")).toBe("# Kickoff\n");
    // Every view asks again; the next look names the next link instead.
    expect(s.getState().hints.version).toBeGreaterThan(version);
    expect(kinds(await s.noteHints(PLAN_PATH, PLAN))[0]).toBe("link:[…](Offers/Offer%202026.md)");
  });

  it("turns exactly the TODO line into a task where it stands — line ends and the rest of the note as they were", async () => {
    const crlf = `${PLAN.replace(/\n/g, "\r\n")}\r\n`;
    const vault = hintsVault({ [PLAN_PATH]: crlf });
    const { s } = await hintsSession(vault);
    const todo = items(await s.noteHints(PLAN_PATH, crlf)).find((item) => item.kind === "todo")!;
    expect(await s.actOnNoteHint(PLAN_PATH, todo)).toEqual({ kind: "done" });
    expect(vault.file(PLAN_PATH)).toBe(crlf.replace("\r\nTODO: call Tom\r\n", "\r\n- [ ] call Tom\r\n"));
  });

  it("changes nothing where the line is no longer that line, and says so", async () => {
    const vault = hintsVault({ [PLAN_PATH]: PLAN });
    const { s } = await hintsSession(vault);
    const todo = items(await s.noteHints(PLAN_PATH, PLAN)).find((item) => item.kind === "todo")!;
    // Typed meanwhile: the line now says something else.
    const typed = PLAN.replace("TODO: call Tom", "TODO: call Tom and Ana");
    vault.disk.set(PLAN_PATH, typed);
    expect(await s.actOnNoteHint(PLAN_PATH, todo)).toEqual({ kind: "gone" });
    expect(vault.file(PLAN_PATH)).toBe(typed);
  });

  it("makes the meeting note the calendar's way; cancelled questions are no failure, a failing step is one", async () => {
    const daily = "# Saturday\n";
    const events = [event("early", "Review with Tom", 9)];
    const vault = hintsVault({ [DAILY]: daily }, { events });
    const { s } = await hintsSession(vault);
    const [meeting] = items(await s.noteHints(DAILY, daily));
    expect(meeting).toMatchObject({ kind: "meeting", line: null, subject: "Review with Tom" });
    expect(await s.actOnNoteHint(DAILY, meeting!)).toEqual({ kind: "opened", path: "Meetings/Review with Tom.md" });
    expect(vault.meetingNotes).toEqual(["early"]);
    const cancelled = await hintsSession(hintsVault({ [DAILY]: daily }, { events, cancelMeeting: true }));
    expect(await cancelled.s.actOnNoteHint(DAILY, items(await cancelled.s.noteHints(DAILY, daily))[0]!)).toEqual({ kind: "cancelled" });
    const failing = await hintsSession(hintsVault({ [DAILY]: daily }, { events, failing: true }));
    expect(await failing.s.actOnNoteHint(DAILY, items(await failing.s.noteHints(DAILY, daily))[0]!)).toEqual({ kind: "failed" });
  });
});

describe("what this device keeps about the hints", () => {
  it("hides exactly one hint, pauses a note and the vault, brings each back — in the app's data, never in the vault", async () => {
    const vault = hintsVault({ [PLAN_PATH]: PLAN, "Finance/Budget.md": "# Budget\n" });
    const { s } = await hintsSession(vault);
    const before = { ...Object.fromEntries(vault.disk) };
    const first = items(await s.noteHints(PLAN_PATH, PLAN));
    await s.dismissNoteHint(first[0]!.key);
    // Hidden, the next of its kind takes its place: still three.
    expect(kinds(await s.noteHints(PLAN_PATH, PLAN))).toEqual(["link:[…](Offers/Offer%202026.md)", "todo:call Tom", "link:[[Plan.v2]]"]);
    expect(vault.stored().dismissed).toEqual([first[0]!.key]);
    await s.pauseNoteHints(PLAN_PATH);
    expect(await s.noteHints(PLAN_PATH, PLAN)).toEqual({ kind: "paused" });
    await s.setNoteHintsVaultPaused(true);
    expect(await s.noteHints(PLAN_PATH, PLAN)).toEqual({ kind: "vaultPaused" });
    expect(s.getState().hints.prefs).toEqual({ vaultPaused: true, pausedNotes: [PLAN_PATH], dismissed: [first[0]!.key] });
    // A new session on this device finds what was decided here.
    const again = await hintsSession(vault);
    expect(again.s.getState().hints.prefs).toEqual({ vaultPaused: true, pausedNotes: [PLAN_PATH], dismissed: [first[0]!.key] });
    await again.s.setNoteHintsVaultPaused(false);
    await again.s.resumeAllNoteHints();
    await again.s.restoreNoteHints();
    expect(kinds(await again.s.noteHints(PLAN_PATH, PLAN))).toEqual(kinds({ kind: "hints", items: first }));
    // The vault's files did not change by any of it.
    expect(Object.fromEntries(vault.disk)).toEqual(before);
  });

  it("a hint that was hidden comes back when its line says something else", async () => {
    const vault = hintsVault({ [PLAN_PATH]: PLAN });
    const { s } = await hintsSession(vault);
    const todo = items(await s.noteHints(PLAN_PATH, PLAN)).find((item) => item.kind === "todo")!;
    await s.dismissNoteHint(todo.key);
    expect(kinds(await s.noteHints(PLAN_PATH, PLAN))).not.toContain("todo:call Tom");
    const changed = PLAN.replace("TODO: call Tom", "TODO: call Tom tomorrow");
    expect(kinds(await s.noteHints(PLAN_PATH, changed))).toContain("todo:call Tom tomorrow");
  });

  it("reads a missing or damaged file as nothing hidden, and keeps each list to its newest entries", () => {
    expect(readNoteHintsPrefs(null)).toEqual({ vaultPaused: false, pausedNotes: [], dismissed: [] });
    expect(readNoteHintsPrefs("{not json")).toEqual({ vaultPaused: false, pausedNotes: [], dismissed: [] });
    expect(readNoteHintsPrefs(JSON.stringify({ version: 2, vaultPaused: true }))).toEqual({ vaultPaused: false, pausedNotes: [], dismissed: [] });
    const many = Array.from({ length: NOTE_HINTS_KEPT + 5 }, (_, i) => `key-${i}`);
    const read = readNoteHintsPrefs(JSON.stringify({ version: 1, vaultPaused: true, pausedNotes: [PLAN_PATH, 7, ""], dismissed: many }));
    expect(read.vaultPaused).toBe(true);
    expect(read.pausedNotes).toEqual([PLAN_PATH]);
    expect(read.dismissed).toHaveLength(NOTE_HINTS_KEPT);
    expect(read.dismissed[0]).toBe("key-5");
  });
});
