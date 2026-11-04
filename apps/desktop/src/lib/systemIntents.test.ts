import { describe, expect, it } from "vitest";
import {
  buildIntentDirectory,
  INTENT_DIRECTORY_MAX_NOTES,
  INTENT_DIRECTORY_VERSION,
  INTENT_KEY_PATTERN,
  INTENT_NAVIGATION_TTL_MS,
  INTENT_ORDER_MAX,
  INTENT_ORDER_TEXT_LIMIT,
  INTENT_TITLE_LIMIT,
  intentNoteKey,
  parseIntentDirectory,
  planIntentOrders,
  readIntentOrders,
  readIntentRefTable,
  resolveIntentNavigation,
  serializeIntentDirectory,
  type IntentOrder,
} from "@plainva/ui";

/**
 * What the system's assistant gets to know of a vault, and what it may ask of
 * the app (AI harness P4.7). These pin the four rules of `systemIntents.ts`:
 * titles pass the privacy gate; no path and no text leave the app's own
 * storage; off means empty; an order is words, not a write.
 */

const NOW = new Date("2026-10-07T10:00:00Z");
const SECRET = "5f1c0a94d27be3861190c4aa7d3e20b6";
const key = (path: string) => intentNoteKey(SECRET, path);
const NOTES = [
  { path: "Projects/Plan.md", title: "Plan" },
  { path: "Health/Results.md", title: "Results" },
  { path: "Journal/2026-10-07.md", title: "2026-10-07" },
  { path: "Welcome.md", title: "Welcome" },
];
const denied = new Set(["Health/Results.md"]);
const build = (over: Partial<Parameters<typeof buildIntentDirectory>[0]> = {}) =>
  buildIntentDirectory({ vaultName: "Studio", enabled: true, notes: NOTES, allowed: (path) => !denied.has(path), key, now: NOW, ...over });

describe("the key of a note", () => {
  it("is sixteen hex digits, the same for the same path under the same secret", () => {
    expect(key("Projects/Plan.md")).toMatch(INTENT_KEY_PATTERN);
    expect(key("Projects/Plan.md")).toBe(key("Projects/Plan.md"));
    expect(key("Projects/Plan.md")).not.toBe(key("Projects/Plan 2.md"));
    // Another device, another name for the same note: a key says nothing that travels.
    expect(intentNoteKey("5f1c0a94d27be3861190c4aa7d3e20b7", "Projects/Plan.md")).not.toBe(key("Projects/Plan.md"));
    // Letters beyond one byte count in full.
    expect(key("Notizen/Über.md")).not.toBe(key("Notizen/Uber.md"));
    expect(key("笔记/计划.md")).not.toBe(key("笔记/计戈.md"));
    expect(key("")).toMatch(INTENT_KEY_PATTERN);
  });

  it("is SipHash-2-4 under the device's secret — the reference vectors", () => {
    // Key 00..0f; the messages are the bytes 00..(n-1). From the SipHash paper (appendix A) and its reference vectors.
    const reference = "000102030405060708090a0b0c0d0e0f";
    const bytes = (count: number) => String.fromCharCode(...Array.from({ length: count }, (_, index) => index));
    expect(intentNoteKey(reference, "")).toBe("726fdb47dd0e0e31");
    expect(intentNoteKey(reference, bytes(15))).toBe("a129ca6149be45e5");
    // One whole block and nothing left over: the last block then carries only the length.
    expect(intentNoteKey(reference, bytes(8))).toBe("93f5f5799a932462");
  });

  it("is no key at all without a secret: a fingerprint anybody could work out would be the path", () => {
    for (const secret of ["", "device-secret", "5F1C0A94D27BE3861190C4AA7D3E20B6", `${SECRET}00`]) expect(intentNoteKey(secret, "Projects/Plan.md")).toBe("");
    // …and a directory built with no keys names nobody.
    expect(build({ key: (path) => intentNoteKey("", path) }).directory.notes).toEqual([]);
  });

  it("does not collide over a vault's worth of paths", () => {
    const keys = new Set<string>();
    for (let index = 0; index < 20000; index++) keys.add(key(`Folder ${index % 37}/Note ${index}.md`));
    expect(keys.size).toBe(20000);
  });
});

describe("the directory of titles", () => {
  it("names a note by its title and its folder — and keeps where it lies to itself", () => {
    const { directory, table } = build();
    expect(directory).toEqual({
      version: INTENT_DIRECTORY_VERSION,
      writtenAt: NOW.getTime(),
      vault: "Studio",
      notes: [
        { k: key("Projects/Plan.md"), t: "Plan", f: "Projects" },
        { k: key("Journal/2026-10-07.md"), t: "2026-10-07", f: "Journal" },
        { k: key("Welcome.md"), t: "Welcome" },
      ],
    });
    // Which note a key means is the app's to know.
    expect(table).toEqual({ writtenAt: NOW.getTime(), refs: { [key("Projects/Plan.md")]: "Projects/Plan.md", [key("Journal/2026-10-07.md")]: "Journal/2026-10-07.md", [key("Welcome.md")]: "Welcome.md" } });
    const sent = serializeIntentDirectory(directory);
    expect(sent).not.toContain(".md");
    expect(sent).not.toContain("Projects/Plan");
    expect(sent).not.toContain(SECRET);
  });

  it("gives a note the same key in every directory, so a shortcut somebody saved keeps meaning it", () => {
    const first = build();
    const later = build({ now: new Date(NOW.getTime() + 60_000), notes: [{ path: "New.md", title: "New" }, ...NOTES] });
    expect(later.directory.writtenAt).not.toBe(first.directory.writtenAt);
    expect(later.directory.notes.find((note) => note.t === "Plan")!.k).toBe(first.directory.notes.find((note) => note.t === "Plan")!.k);
  });

  it("never names a note the privacy gate keeps from the cloud", () => {
    const { directory, table } = build();
    expect(JSON.stringify(directory)).not.toContain("Results");
    expect(Object.values(table.refs)).not.toContain("Health/Results.md");
    // Nothing of the folder either, where every note of it is kept back.
    expect(JSON.stringify(directory)).not.toContain("Health");
    // Not even its key: a key that is nowhere cannot be asked for.
    expect(JSON.stringify(directory)).not.toContain(key("Health/Results.md"));
  });

  it("is empty while the switch is off or the vault is an encrypted workspace — not full and hidden", () => {
    const { directory, table } = build({ enabled: false });
    expect(directory.notes).toEqual([]);
    expect(table.refs).toEqual({});
    // Neither the gate nor the keys are even asked.
    let asked = 0;
    build({ enabled: false, allowed: () => (asked++, true), key: (path) => (asked++, key(path)) });
    expect(asked).toBe(0);
  });

  it("names only notes: nothing of Plainva's own folders, no database, no attachment, no note twice", () => {
    const { table } = build({
      notes: [
        { path: ".plainva/sync/comments.md", title: "comments" },
        { path: ".agent/skills/review/SKILL.md", title: "SKILL" },
        { path: "Notes/.hidden/Secret.md", title: "Secret" },
        { path: "Data/table.base", title: "table" },
        { path: "Attachments/scan.png", title: "scan" },
        { path: "Notes/A.md", title: "A" },
        { path: "Notes/A.md", title: "A" },
        { path: "", title: "nothing" },
      ],
    });
    expect(Object.values(table.refs)).toEqual(["Notes/A.md"]);
  });

  it("leaves out a note whose key is no key, or is another note's already", () => {
    const clash = build({ key: () => "0123456789abcdef" });
    expect(clash.directory.notes).toHaveLength(1);
    expect(clash.table.refs).toEqual({ "0123456789abcdef": "Projects/Plan.md" });
    expect(build({ key: () => "not a key" }).directory.notes).toEqual([]);
    expect(build({ key: () => "__proto__" }).directory.notes).toEqual([]);
  });

  it("writes a title as another process may show or speak it: one line, nothing invisible, a bounded length", () => {
    const rtl = String.fromCharCode(0x202e);
    const zero = String.fromCharCode(0x200b);
    const bell = String.fromCharCode(7);
    const { directory } = build({
      notes: [
        { path: "A/One.md", title: `In${zero}voice${rtl} 2026\n${bell}final` },
        { path: "A/Two.md", title: "x".repeat(400) },
        // The index names a note without a title by its path: the file's name is the title then.
        { path: "A/Three.md", title: "A/Three.md" },
        { path: "A/Four.md", title: "   " },
      ],
    });
    expect(directory.notes[0]!.t).toBe("In voice 2026 final");
    expect([...directory.notes[1]!.t]).toHaveLength(INTENT_TITLE_LIMIT);
    expect(directory.notes[2]).toMatchObject({ t: "Three", f: "A" });
    expect(directory.notes[3]).toMatchObject({ t: "Four", f: "A" });
  });

  it("keeps the notes changed last where a vault has more than the file carries", () => {
    const many = Array.from({ length: INTENT_DIRECTORY_MAX_NOTES + 25 }, (_, index) => ({ path: `N/${index}.md`, title: `Note ${index}` }));
    const { directory } = build({ notes: many });
    expect(directory.notes).toHaveLength(INTENT_DIRECTORY_MAX_NOTES);
    expect(directory.notes[0]!.t).toBe("Note 0");
    // A note that is kept back does not use up a row.
    const kept = build({ notes: many, allowed: (path) => path !== "N/0.md" });
    expect(kept.directory.notes).toHaveLength(INTENT_DIRECTORY_MAX_NOTES);
    expect(kept.directory.notes[0]!.t).toBe("Note 1");
  });

  it("stays below the size the native reader takes, however long the titles are", () => {
    const wide = "計".repeat(INTENT_TITLE_LIMIT);
    const many = Array.from({ length: INTENT_DIRECTORY_MAX_NOTES }, (_, index) => ({ path: `${"夾".repeat(60)}/${index}.md`, title: wide }));
    const { directory, table } = build({ notes: many });
    expect(new TextEncoder().encode(serializeIntentDirectory(directory)).length).toBeLessThan(1024 * 1024);
    // The newest notes are the ones that are kept, and the table knows exactly those.
    expect(directory.notes.length).toBeGreaterThan(1000);
    expect(directory.notes.length).toBeLessThan(INTENT_DIRECTORY_MAX_NOTES);
    expect(Object.keys(table.refs)).toHaveLength(directory.notes.length);
    expect(table.refs[directory.notes[0]!.k]).toBe(many[0]!.path);
  });

  it("reads back what it wrote, and nothing from anything else", () => {
    const { directory, table } = build();
    expect(parseIntentDirectory(serializeIntentDirectory(directory))).toEqual(directory);
    const k = key("Welcome.md");
    for (const bad of [
      "",
      "{",
      "null",
      "[]",
      JSON.stringify({ ...directory, version: 2 }),
      JSON.stringify({ ...directory, notes: [{ k, t: 5 }] }),
      JSON.stringify({ ...directory, notes: [{ k, t: "A", f: 5 }] }),
      JSON.stringify({ ...directory, notes: [{ t: "A" }] }),
      JSON.stringify({ ...directory, notes: [{ k: "Welcome.md", t: "A" }] }),
      JSON.stringify({ ...directory, writtenAt: "now" }),
    ]) {
      expect(parseIntentDirectory(bad), bad).toBeNull();
    }
    // The table, as the app's storage hands it back.
    expect(readIntentRefTable(JSON.parse(JSON.stringify(table)))).toEqual(table);
    expect(readIntentRefTable({ writtenAt: 1, refs: { "not a key": "A.md", [k]: "Welcome.md", "0123456789abcdef": 5 } })).toEqual({ writtenAt: 1, refs: { [k]: "Welcome.md" } });
    for (const bad of [null, "table", { writtenAt: "x", refs: {} }, { writtenAt: 1 }, { writtenAt: 1, refs: ["A.md"] }]) expect(readIntentRefTable(bad)).toBeNull();
  });
});

const order = (over: Partial<IntentOrder> & { id: number }): IntentOrder => ({ kind: "journal", at: NOW.getTime() - 1000, text: "Called the dentist", ...over });

describe("the orders an intent leaves", () => {
  it("are read as words with the moment they were said, and anything else is dropped", () => {
    const k = key("Projects/Plan.md");
    const raw = [
      { id: 1, kind: "journal", at: 1000, text: "  Called the\tdentist  " },
      { id: 2, kind: "task", at: 2000, text: "Buy milk tomorrow" },
      { id: 3, kind: "open", at: 3000, text: "Plan", key: k },
      { id: 4, kind: "search", at: 4000, text: "shooting\ndays" },
      // Not orders:
      { id: 5, kind: "delete", at: 5000, text: "everything" },
      { id: 0, kind: "journal", at: 1, text: "no id" },
      { id: 1, kind: "journal", at: 1, text: "an id twice" },
      { id: 6, kind: "journal", at: -5, text: "before time" },
      { id: 7.5, kind: "journal", at: 1, text: "half an id" },
      "journal",
      null,
    ];
    expect(readIntentOrders(raw)).toEqual([
      { id: 1, kind: "journal", at: 1000, text: "Called the dentist" },
      { id: 2, kind: "task", at: 2000, text: "Buy milk tomorrow" },
      { id: 3, kind: "open", at: 3000, text: "Plan", key: k },
      { id: 4, kind: "search", at: 4000, text: "shooting days" },
    ]);
    expect(readIntentOrders("orders")).toEqual([]);
    expect(readIntentOrders(undefined)).toEqual([]);
  });

  it("keep the line breaks of what was said, lose what is invisible, and are bounded", () => {
    const zero = String.fromCharCode(0x200b);
    const [first] = readIntentOrders([{ id: 1, kind: "journal", at: 1, text: `Line one\r\nLine${zero} two\n\n\n\nLine three` }]);
    expect(first!.text).toBe("Line one\nLine two\n\nLine three");
    const [long] = readIntentOrders([{ id: 2, kind: "task", at: 1, text: "x".repeat(INTENT_ORDER_TEXT_LIMIT + 500) }]);
    expect([...long!.text]).toHaveLength(INTENT_ORDER_TEXT_LIMIT);
    // An order without words is still an order: the plan decides what it is worth.
    expect(readIntentOrders([{ id: 3, kind: "journal", at: 1 }])).toEqual([{ id: 3, kind: "journal", at: 1, text: "" }]);
    // A key is a key or nothing: a path, or a name of something else, is not carried along.
    expect(readIntentOrders([{ id: 4, kind: "open", at: 1, text: "Plan", key: "Projects/Plan.md" }])).toEqual([{ id: 4, kind: "open", at: 1, text: "Plan" }]);
    expect(readIntentOrders([{ id: 5, kind: "journal", at: 1, text: "x", key: "0123456789abcdef" }])).toEqual([{ id: 5, kind: "journal", at: 1, text: "x" }]);
    expect(readIntentOrders(Array.from({ length: INTENT_ORDER_MAX + 20 }, (_, index) => ({ id: index + 1, kind: "journal", at: 1, text: "x" })))).toHaveLength(INTENT_ORDER_MAX);
  });

  it("are all written, oldest first — and of the places somebody asked for, only the last counts", () => {
    const now = NOW.getTime();
    const plan = planIntentOrders(
      [
        order({ id: 3, kind: "task", at: now - 5000, text: "Buy milk" }),
        order({ id: 1, kind: "journal", at: now - 9000 }),
        order({ id: 4, kind: "open", at: now - 4000, text: "Plan", key: key("Projects/Plan.md") }),
        order({ id: 5, kind: "search", at: now - 3000, text: "shooting days" }),
        order({ id: 2, kind: "journal", at: now - 9000, text: "Second of the same moment" }),
      ],
      now,
    );
    expect(plan.captures.map((entry) => entry.id)).toEqual([1, 2, 3]);
    expect(plan.navigation?.id).toBe(5);
    expect(plan.moot).toEqual([4]);
  });

  it("never drop for its age what somebody asked to have written down", () => {
    const now = NOW.getTime();
    const year = 365 * 24 * 60 * 60 * 1000;
    const plan = planIntentOrders([order({ id: 1, at: now - year }), order({ id: 2, kind: "task", at: now - 2 * year, text: "Buy milk" })], now);
    // Oldest first, each with the moment it was said: it lands in the day it was said on.
    expect(plan.captures).toEqual([order({ id: 2, kind: "task", at: now - 2 * year, text: "Buy milk" }), order({ id: 1, at: now - year })]);
    expect(plan.moot).toEqual([]);
  });

  it("drop only what means nothing: words that are none, and a place that was asked for more than two minutes ago", () => {
    const now = NOW.getTime();
    const day = 24 * 60 * 60 * 1000;
    const plan = planIntentOrders(
      [
        order({ id: 3, kind: "open", at: now - INTENT_NAVIGATION_TTL_MS - 1, text: "Plan" }),
        order({ id: 4, kind: "task", text: "" }),
        // A clock that was two days ahead was a wrong clock: the words are written, at the moment that is known.
        order({ id: 5, at: now + 2 * day }),
        order({ id: 6, kind: "search", at: now + 2 * day, text: "x" }),
        // A few hours ahead is a time zone or a correction: the moment stays as it was said.
        order({ id: 7, at: now + 3 * 60 * 60 * 1000, text: "Later today" }),
      ],
      now,
    );
    expect(plan.captures).toEqual([order({ id: 7, at: now + 3 * 60 * 60 * 1000, text: "Later today" }), order({ id: 5, at: now })]);
    expect(plan.navigation).toBeNull();
    expect([...plan.moot].sort()).toEqual([3, 4, 6]);
  });
});

describe("where an order leads", () => {
  const k = key("Welcome.md");
  const table = { writtenAt: 99, refs: { [key("Projects/Plan.md")]: "Projects/Plan.md", [k]: "Welcome.md" } };

  it("opens the note the app's own table names for a key — whichever directory the key was read from", () => {
    expect(resolveIntentNavigation(order({ id: 1, kind: "open", text: "Welcome", key: k }), table)).toEqual({ kind: "open", path: "Welcome.md" });
    // A key the table does not know: the note moved, or may no longer be named. The title that was chosen is searched for.
    expect(resolveIntentNavigation(order({ id: 2, kind: "open", text: "Welcome", key: key("Old/Welcome.md") }), table)).toEqual({ kind: "search", query: "Welcome" });
    expect(resolveIntentNavigation(order({ id: 3, kind: "open", text: "Welcome", key: k }), null)).toEqual({ kind: "search", query: "Welcome" });
    expect(resolveIntentNavigation(order({ id: 4, kind: "open", text: "Welcome", key: k }), { writtenAt: 0, refs: {} })).toEqual({ kind: "search", query: "Welcome" });
    expect(resolveIntentNavigation(order({ id: 5, kind: "open", text: "Welcome" }), table)).toEqual({ kind: "search", query: "Welcome" });
    // Nothing to open and nothing to search for: nowhere.
    expect(resolveIntentNavigation(order({ id: 6, kind: "open", text: "" }), table)).toBeNull();
  });

  it("opens the search for a search, with the words or without", () => {
    expect(resolveIntentNavigation(order({ id: 1, kind: "search", text: "shooting days" }), table)).toEqual({ kind: "search", query: "shooting days" });
    expect(resolveIntentNavigation(order({ id: 2, kind: "search", text: "" }), null)).toEqual({ kind: "search", query: "" });
    expect(resolveIntentNavigation(order({ id: 3, kind: "journal" }), table)).toBeNull();
  });
});
