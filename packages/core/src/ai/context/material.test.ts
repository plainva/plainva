import { describe, expect, it } from "vitest";
import { CONTEXT_NOTE_LIMIT, contextStamp } from "../chat.js";
import { chunkNote } from "../embeddings/chunks.js";
import type { EgressRecipient } from "../egressGate.js";
import { DEFAULT_AI_POLICY, effectivePolicy } from "../policy.js";
import { manifestOf } from "./manifest.js";
import { buildContextPackage, contextStampPath, DEFAULT_CONTEXT_BUDGET, estimateTokensOfChars, naiveComparison, sentStamps, utf8Length, type ContextBuildHost, type SituationInput, type StampRun } from "./package.js";
import { contextSavingsOf } from "../history.js";

const cloud: EgressRecipient = { kind: "cloud", provider: "p", model: "m" };
const situation: SituationInput = { now: "2026-10-01 09:00", weekday: "Thursday", calendarDay: "2026-10-01", journalDay: "2026-10-01", active: null, tabs: [], tasks: [], events: [], dailyNote: null };

const OFFER = `# Offer\n\nIntro.\n\n## Costs\n\nThe rate stays at 95 EUR per hour.\n\n## History\n\n${"Long background. ".repeat(60)}`;
/** A note in a script of three bytes a character: what the index counts in bytes is three times its characters. */
const DIARY = `# 日記\n\n${"今日は雨でした。".repeat(12)}`;
/** Longer than Plainva ever sends of one note: the rate in its last section. */
const MANUAL = `# Manual\n\n## Setup\n\n${"Setup step. ".repeat(3000)}\n\n## Rates\n\nThe rate is 95 EUR per hour.\n`;
/** A note found by a weak signal only, longer than Plainva sends of one: it goes as a card — its first sentence. */
const LOG = `# Log\n\nThe week went well. ${"Calm hours passed by the window. ".repeat(400)}`;
/** A note of many lines, longer than Plainva sends of one: a pinned one would be cut at its last line before that. */
const LINES = `# Lines\n\n${Array.from({ length: 400 }, (_, i) => `Line ${i}: a little more text for the reader.`).join("\n")}\n\n## Rates\n\nThe rate is 95 EUR per hour.\n`;
/** A note whose place stamp Plainva withholds: shorter as it goes, and still whole. */
const TRIP = "# Trip\n\nWe walked by the river.\n📍 52.520008, 13.404954 near the old bridge in the middle of town\n";
/** A long note with a place stamp near its top: pinned, it is cut at the most Plainva sends, the stamp withheld. */
const ROUTE = `# Route\n\n📍 52.520008, 13.404954 near the old bridge in the middle of town\n\n${"Long text of the walk. ".repeat(900)}`;
/** A template: the question's word only in an empty heading, so its card has no sentence. */
const TEMPLATE = `# Template\n\n## Rates\n\n## Next\n\n${"Notes to come. ".repeat(1000)}`;
/** Notes with a number the patterns know (an IBAN): a card and a section of them, redacted or not. */
const RENT = `# Rent\n\nThe rent goes to DE89 3704 0044 0532 0130 00 every month. ${"Calm days follow. ".repeat(400)}`;
const LEASE = `# Lease\n\n## Intro\n\n${"The lease runs on. ".repeat(400)}\n\n## Rent\n\nThe rent goes to DE89 3704 0044 0532 0130 00 every month.\n`;
/** A note whose opening is blank: its properties, an empty line, then its first section. */
const RENOVATION = `---\ntags: [house]\n---\n\n## Quotes\n\nThe roofer asked 4,000 EUR.\n\n## Plan\n\n${"Steps to take. ".repeat(500)}`;
/** A short note under one heading, after its properties: the section found is all the note says. */
const SHORT = `---\ntags: [a]\n---\n\n# Short\n\nThe rate is 95 EUR per hour.\n`;
/** A short note without properties: open, it goes whole — and its one section's text is all of it. */
const BUDGET = "# Budget\n\nWe spend 5k on the rate.\n";
/** A note with properties: the index counts the file, the context sends its body. */
const PLAN = "---\nstatus: active\nowner: Mara\ntags:\n  - project\n---\n# Plan\n\nShip the release in May.\n";
const files: Record<string, string> = {
  "Offer.md": OFFER,
  "Contract.md": "# Contract\n\nSigned in spring. Travel is not included.",
  "Garden.md": "# Garden\n\nWater the tomatoes.",
  "Diary.md": DIARY,
  "Manual.md": MANUAL,
  "Log.md": LOG,
  "Trip.md": TRIP,
  "Plan.md": PLAN,
  "Lines.md": LINES,
  "Route.md": ROUTE,
  "Template.md": TEMPLATE,
  "Rent.md": RENT,
  "Lease.md": LEASE,
  "Renovation.md": RENOVATION,
  "Short.md": SHORT,
  "Budget.md": BUDGET,
  // A short note of two sections, a number the patterns know in the second.
  "Bank.md": "# Bank\n\n## Intro\n\nOur bank account.\n\n## Rent\n\nThe rent goes to DE89 3704 0044 0532 0130 00 every month.\n",
  // A week's template: thirty empty days, and the one thing said under its notes.
  "Week.md": `# Week 42\n\n${Array.from({ length: 30 }, (_, day) => `## Day ${day + 1}\n`).join("\n")}\n## Notes\n\nThe rate is 95 EUR.\n`,
  // All it says is in its last section; the headings before it say nothing.
  "Outline.md": "# Outline\n\n## Empty\n\n## Real\n\nThe rate is 95 EUR.\n",
  // A line a Japanese input method begins with "#" and a full-width space: a paragraph to the outline, so a section's text.
  "Memo.md": `# Memo\n\n## Rates\n\n#${String.fromCharCode(0x3000)}メモ\n\n## Next\n\n${"Notes to come. ".repeat(400)}`,
};

const host = (sizes?: Record<string, number>): ContextBuildHost => ({
  policyOf: async (path) => effectivePolicy(path, {}, [], DEFAULT_AI_POLICY),
  resolveLink: async () => null,
  readNote: async (path) => (files[path] === undefined ? null : { title: path.replace(/\.md$/, ""), text: files[path]! }),
  ...(sizes ? { noteSizes: async (paths: readonly string[]) => new Map(paths.filter((p) => p in sizes).map((p) => [p, sizes[p]!])) } : {}),
});
/** Runs while the budget note has grown by a section of its own, outside the one about the rate; then puts it back. */
async function withRisks<T>(run: () => Promise<T>): Promise<T> {
  files["Budget.md"] = `${BUDGET}\n# Risks\n\nThe vendor may drop out.\n`;
  try {
    return await run();
  } finally {
    files["Budget.md"] = BUDGET;
  }
}
/** What the context left out in all, as the month counts it. */
const leftOf = (pack: Awaited<ReturnType<typeof buildContextPackage>>) => pack.refs.reduce((sum, ref) => sum + (ref.left ?? 0), 0);
/** The most Plainva sends of one note with the default budget. */
const CEILING = Math.min(CONTEXT_NOTE_LIMIT, Math.max(DEFAULT_CONTEXT_BUDGET.evidenceChars, 4_000));

/** Plan KI-Harness P2b-5 and P9-6: what a package saves, for "View context" and the month. */
describe("the material of a package", () => {
  const candidates = [
    [
      { path: "Offer.md", title: "Offer", signals: { lexical: 1 } },
      { path: "Contract.md", title: "Contract", signals: { lexical: 0.2 } },
      { path: "Garden.md", title: "Garden", signals: { edited: 0.1 } },
    ],
  ];

  it("counts what goes against the whole notes it stands for", async () => {
    const pack = await buildContextPackage({ question: "what is the rate", recipient: cloud, situation, candidates, pins: [] }, host());
    const offer = pack.refs.find((r) => r.path === "Offer.md")!;
    expect(offer.tier).toBe("evidence");
    expect(offer.noteChars).toBeGreaterThan(offer.chars);
    expect(pack.material.sentChars).toBe(pack.refs.reduce((sum, r) => sum + r.chars, 0));
    expect(pack.material.sourceChars).toBeGreaterThan(pack.material.sentChars);
    // Without note sizes there is no naive comparison.
    expect(pack.material.candidateBytes).toBeNull();
    expect(naiveComparison(pack.material)).toBeNull();
  });

  it("knows what every proposed note would have cost when the host knows their sizes", async () => {
    const pack = await buildContextPackage({ question: "what is the rate", recipient: cloud, situation, candidates, pins: [] }, host({ "Offer.md": 9_000, "Contract.md": 60, "Garden.md": 30 }));
    // The notes it read count by their bodies — what "whole" would have sent —, the others by the index.
    const read = (path: string) => utf8Length(files[path]!);
    const named = pack.refs.filter((r) => r.tier === "map").map((r) => r.path);
    const expected = ["Offer.md", "Contract.md", "Garden.md"].reduce((sum, path) => sum + (named.includes(path) ? { "Offer.md": 9_000, "Contract.md": 60, "Garden.md": 30 }[path]! : read(path)), 0);
    expect(pack.material.candidateBytes).toBe(expected);
    // ASCII notes: their bytes are their characters.
    expect(pack.material.sentBytes).toBe(pack.material.sentChars);
  });

  it("saves the rest of a note of which a section went", async () => {
    const pack = await buildContextPackage({ question: "what is the rate", recipient: cloud, situation, candidates: [[{ path: "Offer.md", title: "Offer", signals: { lexical: 1 } }]], pins: [] }, host());
    const [offer] = pack.refs;
    expect(pack.refs).toHaveLength(1);
    expect(offer!.section).toBe("Offer > Costs");
    expect(offer!.left).toBe(offer!.noteChars! - offer!.chars);
    expect(offer!.left).toBeGreaterThan(900);
  });

  it("counts the rest only up to the most Plainva sends of one note", async () => {
    const pack = await buildContextPackage({ question: "what is the rate", recipient: cloud, situation, candidates: [[{ path: "Manual.md", title: "Manual", signals: { lexical: 1 } }]], pins: [] }, host());
    const [manual] = pack.refs;
    expect(manual!.noteChars).toBeGreaterThan(30_000);
    expect(manual!.left).toBe(CEILING - manual!.chars);
    // A note of lines is counted as Plainva would cut it whole: at its last line before the ceiling.
    const lines = await buildContextPackage({ question: "what is the rate", recipient: cloud, situation, candidates: [[{ path: "Lines.md", title: "Lines", signals: { lexical: 1 } }]], pins: [] }, host());
    const cut = LINES.lastIndexOf("\n", CEILING);
    expect(cut).toBeGreaterThan(CEILING * 0.6);
    expect(lines.refs[0]!.left).toBe(cut - lines.refs[0]!.chars);
    // A smaller budget counts less — never under 4,000 characters, the least Plainva sends of a pinned note.
    const small = await buildContextPackage({ question: "what is the rate", recipient: cloud, situation, candidates: [[{ path: "Manual.md", title: "Manual", signals: { lexical: 1 } }]], pins: [], budget: { evidenceChars: 2_000, sectionChars: 1_000 } }, host());
    expect(small.refs[0]!.left).toBe(4_000 - small.refs[0]!.chars);
  });

  it("saves the rest of a note that went as a card", async () => {
    const pack = await buildContextPackage({ question: "the week", recipient: cloud, situation, candidates: [[{ path: "Log.md", title: "Log", signals: { edited: 0.1 } }]], pins: [] }, host());
    const [log] = pack.refs;
    expect(log!.tier).toBe("card");
    expect(log!.chars).toBeLessThan(400);
    // Longer than Plainva sends of one note: the rest is counted up to that, not to the note's end.
    expect(log!.noteChars).toBeGreaterThan(CEILING);
    expect(log!.left).toBe(CEILING - log!.chars);
  });

  it("saves nothing for a note that went whole — also where a place stamp of it was withheld —, and nothing for one that was only named", async () => {
    const pinned = await buildContextPackage({ question: "travel", recipient: cloud, situation, candidates: [], pins: ["Contract.md", "Trip.md"] }, host());
    const byPath = [...pinned.refs].sort((a, b) => (a.path < b.path ? -1 : 1));
    expect(byPath.map((r) => [r.path, r.tier, r.section])).toEqual([
      ["Contract.md", "evidence", undefined],
      ["Trip.md", "evidence", undefined],
    ]);
    const trip = byPath[1]!;
    // The stamp went as a placeholder: shorter than the note, and still the whole note.
    expect(trip.chars).toBeLessThan(trip.noteChars!);
    expect(byPath.map((r) => r.left)).toEqual([undefined, undefined]);
    // Five notes found weakly: the map names them; a handle is no part of a note left out.
    const many = Array.from({ length: 5 }, (_, i) => ({ path: `Map ${i}.md`, title: `Map ${i}`, signals: { edited: 0.01 } }));
    const named = await buildContextPackage({ question: "nothing here", recipient: cloud, situation, candidates: [many], pins: [], budget: { cards: 0 } }, host());
    expect(named.refs.length).toBeGreaterThan(0);
    expect(named.refs.every((r) => r.tier === "map")).toBe(true);
    expect(leftOf(named)).toBe(0);
  });

  it("saves nothing for a card with no sentence: it named the note and sent nothing of it", async () => {
    const pack = await buildContextPackage({ question: "the rates", recipient: cloud, situation, candidates: [[{ path: "Template.md", title: "Template", signals: { edited: 0.1 } }]], pins: [] }, host());
    const [card] = pack.refs;
    expect(card).toMatchObject({ path: "Template.md", tier: "card", chars: 0 });
    expect(card!.noteChars).toBeGreaterThan(CEILING);
    expect(card!.left).toBeUndefined();
  });

  it("saves nothing for a pinned note cut at the most Plainva sends, whatever the cleaning took out of it", async () => {
    const pinned = await buildContextPackage({ question: "the walk", recipient: cloud, situation, candidates: [], pins: ["Route.md"] }, host());
    const [route] = pinned.refs;
    // Cut at the ceiling — "the beginning" —, and the place stamp went as a placeholder: shorter than what was chosen.
    expect(route).toMatchObject({ path: "Route.md", tier: "evidence", section: "" });
    expect(route!.chars).toBeLessThan(CEILING);
    expect(route!.left).toBeUndefined();
  });

  it("counts the same rest whether or not the reader redacts the note's numbers", async () => {
    const plain = await buildContextPackage({ question: "the rent", recipient: cloud, situation, candidates: [[{ path: "Rent.md", title: "Rent", signals: { edited: 0.1 } }, { path: "Lease.md", title: "Lease", signals: { lexical: 1 } }]], pins: [] }, host());
    const redacted = await buildContextPackage({ question: "the rent", recipient: cloud, situation, candidates: [[{ path: "Rent.md", title: "Rent", signals: { edited: 0.1 } }, { path: "Lease.md", title: "Lease", signals: { lexical: 1 } }]], pins: [], redact: new Set(["Rent.md", "Lease.md"]) }, host());
    const byPath = (pack: typeof plain) => Object.fromEntries(pack.refs.map((ref) => [ref.path, ref]));
    const [before, after] = [byPath(plain), byPath(redacted)];
    expect(before["Rent.md"]!.tier).toBe("card");
    expect(before["Lease.md"]!.tier).toBe("evidence");
    // The redaction changed what went, not what was left out.
    expect(after["Rent.md"]!.redacted).toBeGreaterThan(0);
    expect(after["Lease.md"]!.redacted).toBeGreaterThan(0);
    expect(after["Rent.md"]!.chars).not.toBe(before["Rent.md"]!.chars);
    expect(after["Rent.md"]!.left).toBe(before["Rent.md"]!.left);
    expect(after["Lease.md"]!.left).toBe(before["Lease.md"]!.left);
    expect(before["Rent.md"]!.left).toBeGreaterThan(0);
    expect(before["Lease.md"]!.left).toBeGreaterThan(0);
  });

  it("takes a note's first section where its opening is blank, as a card does — and counts its rest", async () => {
    // Found by its name only: no line of it holds a word of the question.
    const pack = await buildContextPackage({ question: "the renovation", recipient: cloud, situation, candidates: [[{ path: "Renovation.md", title: "Renovation", signals: { lexical: 1 } }]], pins: [] }, host());
    const [renovation] = pack.refs;
    expect(renovation).toMatchObject({ path: "Renovation.md", tier: "evidence", section: "Quotes" });
    expect(renovation!.chars).toBeGreaterThan(20);
    expect(renovation!.left).toBe(renovation!.noteChars! - renovation!.chars);
  });

  it("sends a section that holds all the note says as the whole note, which saves nothing", async () => {
    const pack = await buildContextPackage({ question: "what is the rate", recipient: cloud, situation, candidates: [[{ path: "Short.md", title: "Short", signals: { lexical: 1 } }]], pins: [] }, host());
    const [short] = pack.refs;
    expect(short).toMatchObject({ path: "Short.md", tier: "evidence" });
    expect(short!.section).toBeUndefined();
    expect(short!.left).toBeUndefined();
    expect(pack.part.text).toContain("the whole note");
    expect(pack.part.text).not.toContain("read_note gives the rest");
  });

  it("sends a note that went whole from its section again once it grows outside that section", async () => {
    const input = { question: "what is the rate", recipient: cloud, situation, candidates: [[{ path: "Short.md", title: "Short", signals: { lexical: 1 } }]], pins: [] };
    const first = await buildContextPackage(input, host());
    expect(first.refs[0]!.section).toBeUndefined();
    // Unchanged, it is not sent again.
    const same = await buildContextPackage({ ...input, alreadySent: new Set(first.part.context) }, host());
    expect(same.refs[0]).toMatchObject({ path: "Short.md", unchanged: true, chars: 0 });
    // Grown by a section of its own: the model was told it had the whole note, so the section goes again — as a
    // section now, with its rest.
    const before = files["Short.md"]!;
    files["Short.md"] = `${before}\n# Risks\n\nThe vendor may drop out.\n`;
    try {
      const grown = await buildContextPackage({ ...input, alreadySent: new Set(first.part.context) }, host());
      expect(grown.refs[0]).toMatchObject({ path: "Short.md", tier: "evidence", section: "Short" });
      expect(grown.refs[0]!.unchanged).toBeUndefined();
      expect(grown.part.text).toContain("read_note gives the rest");
    } finally {
      files["Short.md"] = before;
    }
  });

  it("sends an open note that went whole again once it grew, also where only its section goes now", async () => {
    const opened: SituationInput = { ...situation, active: { path: "Budget.md", title: "Budget", kind: "note" } };
    const first = await buildContextPackage({ question: "what is the rate", recipient: cloud, situation: opened, candidates: [], pins: [] }, host());
    const budget = first.refs.find((ref) => ref.path === "Budget.md");
    expect(budget).toMatchObject({ tier: "evidence" });
    expect(budget!.section).toBeUndefined();
    // Another note is open now; the search finds this one by its section, whose text is what went before.
    const found = await withRisks(() =>
      buildContextPackage(
        { question: "what is the rate", recipient: cloud, situation, candidates: [[{ path: "Budget.md", title: "Budget", signals: { lexical: 1 } }]], pins: [], alreadySent: new Set(first.part.context) },
        host(),
      ),
    );
    expect(found.refs[0]).toMatchObject({ path: "Budget.md", tier: "evidence", section: "Budget" });
    expect(found.refs[0]!.unchanged).toBeUndefined();
    expect(found.part.text).toContain("read_note gives the rest");
  });

  it("says unchanged only against what the model saw last of a note: a note that changed and changed back goes again", async () => {
    const input = { question: "what is the rate", recipient: cloud, situation, candidates: [[{ path: "Budget.md", title: "Budget", signals: { lexical: 1 } }]], pins: [] };
    const first = await buildContextPackage(input, host());
    expect(first.refs[0]!.section).toBeUndefined();
    const second = await withRisks(() => buildContextPackage({ ...input, alreadySent: sentStamps([{ role: "user", parts: [first.part] }]) }, host()));
    expect(second.refs[0]).toMatchObject({ path: "Budget.md", section: "Budget" });
    // Back as it was in the first turn: the model's latest view is the section with its rest, so the whole note goes again.
    const turns = [
      { role: "user", parts: [first.part] },
      { role: "assistant", parts: [{ type: "text", text: "Noted." }] },
      { role: "user", parts: [second.part] },
    ];
    const third = await buildContextPackage({ ...input, alreadySent: sentStamps(turns) }, host());
    expect(third.refs[0]!.unchanged).toBeUndefined();
    expect(third.part.text).toContain("the whole note");
    // Unchanged since the latest view, it is named, not sent.
    const fourth = await buildContextPackage({ ...input, alreadySent: sentStamps([...turns, { role: "user", parts: [third.part] }]) }, host());
    expect(fourth.refs[0]).toMatchObject({ path: "Budget.md", unchanged: true, chars: 0 });
  });

  it("keeps per note the stamps of the latest turn that carried it, and reads a stamp's path up to its last hash", () => {
    const turn = (...context: string[]) => ({ role: "user", parts: [{ type: "text", text: "context", context }] });
    const seen = sentStamps([turn("A.md#11111111", "C# notes.md#22222222"), { role: "assistant", parts: [] }, turn("A.md#33333333")]);
    expect([...seen].sort()).toEqual(["A.md#33333333", "C# notes.md#22222222"]);
    expect(contextStampPath("C# notes.md#2222222244444444")).toBe("C# notes.md");
    expect(contextStampPath("plain")).toBe("plain");
  });

  it("names a part unchanged only where every view of the note since has the version that part went in", () => {
    const user = (...context: string[]) => ({ role: "user", parts: [{ type: "text", text: "context", context }] });
    const answer = { role: "assistant", parts: [] };
    const run = (userTurn: number, sources: NonNullable<StampRun["manifest"]>["sources"], more: Omit<StampRun, "userTurn" | "manifest"> = {}): StampRun => ({ userTurn, manifest: { sources }, ...more });
    const evidence = (path: string, hash: string) => ({ path, tier: "evidence", chars: 10, hash });
    const card = (path: string, hash: string) => ({ path, tier: "card", chars: 10, hash });
    const section = (path: string, hash: string, chain: string) => ({ path, tier: "evidence", chars: 10, hash, section: chain });
    const turns = [user("P.md#aaaaaaaa"), answer, user("Q.md#bbbbbbbb")];
    const first = run(0, [evidence("P.md", "v1")]);
    // A card of the note in between, at another version: the part that went before is not "unchanged" any more.
    expect([...sentStamps(turns, [first, run(2, [card("P.md", "v2"), evidence("Q.md", "w1")])])]).toEqual(["Q.md#bbbbbbbb"]);
    // At the same version it still holds.
    expect([...sentStamps(turns, [first, run(2, [card("P.md", "v1"), evidence("Q.md", "w1")])])].sort()).toEqual(["P.md#aaaaaaaa", "Q.md#bbbbbbbb"]);
    // A tool gave the model the note at another version after the part went.
    expect([...sentStamps(turns, [run(0, [evidence("P.md", "v1")], { readHashes: [{ path: "P.md", hash: "v2" }] }), run(2, [evidence("Q.md", "w1")])])]).toEqual(["Q.md#bbbbbbbb"]);
    // Another part of the same version in between keeps the earlier part: nothing the model saw since says otherwise.
    const twice = [user("P.md#aaaaaaaa"), answer, user("P.md#cccccccc")];
    expect([...sentStamps(twice, [run(0, [section("P.md", "v1", "A")]), run(2, [section("P.md", "v1", "B")])])].sort()).toEqual(["P.md#aaaaaaaa", "P.md#cccccccc"]);
    // The same part later with another text at the same version — a redaction taken back, less room —: the model's
    // latest copy of that part is the other one.
    expect([...sentStamps(twice, [run(0, [section("P.md", "v1", "A")]), run(2, [section("P.md", "v1", "A")])])]).toEqual(["P.md#cccccccc"]);
    expect([...sentStamps(twice, [run(0, [evidence("P.md", "v1")]), run(2, [evidence("P.md", "v1")])])]).toEqual(["P.md#cccccccc"]);
    // A view whose version is not known keeps nothing earlier of its note: a gist of it in the map, a read of it at two
    // versions in one run — and a run whose reads went past its record, of any note. Listing many notes is no such run.
    expect([...sentStamps(turns, [first, run(2, [{ path: "P.md", tier: "map", chars: 20, gist: true }, evidence("Q.md", "w1")])])]).toEqual(["Q.md#bbbbbbbb"]);
    expect([...sentStamps(turns, [first, run(2, [evidence("Q.md", "w1")], { readChanged: ["P.md"] })])]).toEqual(["Q.md#bbbbbbbb"]);
    expect([...sentStamps(turns, [first, run(2, [evidence("Q.md", "w1")], { readUnhashed: true })])]).toEqual([]);
    expect([...sentStamps(turns, [first, { ...run(2, [evidence("Q.md", "w1")]), readMore: true } as StampRun])].sort()).toEqual(["P.md#aaaaaaaa", "Q.md#bbbbbbbb"]);
    // A tool read the note redacted after the part went plain: it showed its words otherwise.
    expect([...sentStamps(turns, [first, run(2, [evidence("Q.md", "w1")], { readHashes: [{ path: "P.md", hash: "v1" }], redact: ["P.md"] })])]).toEqual(["Q.md#bbbbbbbb"]);
    expect([...sentStamps(turns, [first, run(2, [evidence("Q.md", "w1")], { readHashes: [{ path: "P.md", hash: "v1" }] })])].sort()).toEqual(["P.md#aaaaaaaa", "Q.md#bbbbbbbb"]);
    // Changed and changed back, then another part at the first version: the view in between still says otherwise.
    const thrice = [user("P.md#aaaaaaaa"), answer, user("P.md#cccccccc"), answer, user("P.md#dddddddd")];
    expect([...sentStamps(thrice, [first, run(2, [evidence("P.md", "v2")]), run(4, [evidence("P.md", "v1")])])]).toEqual(["P.md#dddddddd"]);
    // Without the runs' record: per note the latest turn that carried it.
    expect([...sentStamps(twice)]).toEqual(["P.md#cccccccc"]);
  });

  it("names the part an unchanged line vouches for, fenced as the vault's text", async () => {
    const input = { question: "what is the rate", recipient: cloud, situation, candidates: [[{ path: "Offer.md", title: "Offer", signals: { lexical: 1 } }]], pins: [] };
    const first = await buildContextPackage(input, host());
    const again = await buildContextPackage({ ...input, alreadySent: new Set(first.part.context) }, host());
    expect(again.refs[0]).toMatchObject({ path: "Offer.md", unchanged: true, section: "Offer > Costs" });
    expect(again.part.text).toMatch(/<untrusted_data origin="vault:Offer\.md#Offer &gt; Costs" trust="3">\nOffer \(Offer\.md\), section "Offer > Costs": unchanged since it was sent earlier in this conversation\.\n<\/untrusted_data>/);
  });

  it("takes no stamp of an older form for one of today: such a note goes once more", async () => {
    const input = { question: "what is the rate", recipient: cloud, situation, candidates: [[{ path: "Budget.md", title: "Budget", signals: { lexical: 1 } }]], pins: [] };
    // The forms before: the hash of what went; for a whole note, the hash of its text after it.
    const older = new Set([`Budget.md#${contextStamp(BUDGET)}`, `Budget.md#${contextStamp(BUDGET)}${contextStamp(BUDGET)}`]);
    const now = await buildContextPackage(input, host());
    expect((now.part.context ?? []).some((stamp) => older.has(stamp))).toBe(false);
    const again = await buildContextPackage({ ...input, alreadySent: older }, host());
    expect(again.refs[0]!.unchanged).toBeUndefined();
    expect(again.refs[0]!.chars).toBeGreaterThan(0);
  });

  it("sends a found part that is all the note says as the note's whole text, as the open note goes whole", async () => {
    const input = { question: "what is the rate", recipient: cloud, situation, candidates: [[{ path: "Outline.md", title: "Outline", signals: { lexical: 1 } }]], pins: [] };
    const found = await buildContextPackage(input, host());
    expect(found.refs[0]).toMatchObject({ path: "Outline.md", tier: "evidence" });
    expect(found.refs[0]!.section).toBeUndefined();
    expect(found.part.text).toContain("## Empty");
    // Open in the next turn, it goes whole with the same text: named, not sent again.
    const opened: SituationInput = { ...situation, active: { path: "Outline.md", title: "Outline", kind: "note" } };
    const open = await buildContextPackage({ ...input, situation: opened, candidates: [], alreadySent: new Set(found.part.context) }, host());
    expect(open.refs.find((ref) => ref.path === "Outline.md")).toMatchObject({ unchanged: true });
  });

  it("sends a found part that is all the note says as its section where the whole does not fit — its headings a rest to read, and no saving", async () => {
    const input = { question: "what is the rate", recipient: cloud, situation, candidates: [[{ path: "Week.md", title: "Week", signals: { lexical: 1 } }]], pins: [] };
    const tight = await buildContextPackage({ ...input, budget: { ...DEFAULT_CONTEXT_BUDGET, evidenceChars: 200 } }, host());
    expect(tight.refs[0]).toMatchObject({ path: "Week.md", tier: "evidence", section: "Week 42 > Notes" });
    expect(tight.refs[0]!.left).toBeUndefined();
    expect(tight.part.text).toContain("The rate is 95 EUR.");
    expect(tight.part.text).toContain("read_note gives the rest");
    // With room for it, the same note goes whole.
    const roomy = await buildContextPackage(input, host());
    expect(roomy.refs[0]!.section).toBeUndefined();
    expect(roomy.part.text).toContain("## Day 30");
  });

  it("sends a passage found by meaning that is all the note says as its section where the whole does not fit, and saves nothing by it", async () => {
    const chunk = chunkNote("Week", files["Week.md"]!).find((entry) => entry.chain === "Week 42 > Notes")!;
    const pack = await buildContextPackage(
      {
        question: "what do we pay",
        recipient: cloud,
        situation,
        candidates: [[{ path: "Week.md", title: "Week", signals: { semantic: 0.9 }, chunk: { ordinal: chunk.ordinal, hash: chunk.hash } }]],
        pins: [],
        budget: { ...DEFAULT_CONTEXT_BUDGET, evidenceChars: 200 },
      },
      host(),
    );
    expect(pack.refs[0]).toMatchObject({ path: "Week.md", tier: "evidence", section: "Week 42 > Notes" });
    expect(pack.refs[0]!.left).toBeUndefined();
  });

  it("names no part unchanged that a later view of the same version showed with another redaction", async () => {
    const provider = { id: "p", label: "P", local: false };
    type Pack = Awaited<ReturnType<typeof buildContextPackage>>;
    const turnOf = (pack: Pack) => ({ role: "user", parts: [pack.part] });
    const answer = { role: "assistant", parts: [] };
    const runOf = (userTurn: number, pack: Pack, redact: string[] = []): StampRun => ({ userTurn, manifest: manifestOf(pack, provider, "m", { tools: [] }), ...(redact.length ? { redact } : {}) });
    const ask = { question: "where does the rent go", recipient: cloud, situation, candidates: [[{ path: "Bank.md", title: "Bank", signals: { lexical: 1 } }]], pins: [] as string[] };
    // A section plain; then the whole note, pinned and redacted; then the section plain again.
    const t0 = await buildContextPackage(ask, host());
    expect(t0.refs[0]).toMatchObject({ path: "Bank.md", section: "Bank > Rent" });
    const t2 = await buildContextPackage({ ...ask, pins: ["Bank.md"], redact: new Set(["Bank.md"]), alreadySent: sentStamps([turnOf(t0)], [runOf(0, t0)]) }, host());
    expect(t2.refs.find((ref) => ref.path === "Bank.md")).toMatchObject({ redacted: 1 });
    expect(t2.refs.find((ref) => ref.path === "Bank.md")!.section).toBeUndefined();
    const t4 = await buildContextPackage({ ...ask, alreadySent: sentStamps([turnOf(t0), answer, turnOf(t2)], [runOf(0, t0), runOf(2, t2, ["Bank.md"])]) }, host());
    expect(t4.refs[0]!.unchanged).toBeUndefined();
    expect(t4.part.text).toContain("DE89");
    // The same section plain, redacted, plain: sent again as well.
    const s2 = await buildContextPackage({ ...ask, redact: new Set(["Bank.md"]), alreadySent: sentStamps([turnOf(t0)], [runOf(0, t0)]) }, host());
    const s4 = await buildContextPackage({ ...ask, alreadySent: sentStamps([turnOf(t0), answer, turnOf(s2)], [runOf(0, t0), runOf(2, s2, ["Bank.md"])]) }, host());
    expect(s4.refs[0]!.unchanged).toBeUndefined();
    // A redaction held the whole time: the rent, then the intro, then the rent again — named, not sent again.
    const redact = new Set(["Bank.md"]);
    const h0 = await buildContextPackage({ ...ask, redact }, host());
    const h2 = await buildContextPackage({ ...ask, question: "what about the intro", redact, alreadySent: sentStamps([turnOf(h0)], [runOf(0, h0, ["Bank.md"])]) }, host());
    expect(h2.refs[0]).toMatchObject({ path: "Bank.md", section: "Bank > Intro" });
    const h4 = await buildContextPackage({ ...ask, redact, alreadySent: sentStamps([turnOf(h0), answer, turnOf(h2)], [runOf(0, h0, ["Bank.md"]), runOf(2, h2, ["Bank.md"])]) }, host());
    expect(h4.refs[0]).toMatchObject({ path: "Bank.md", unchanged: true });
    // And the intro, in which nothing was found to redact, again: named as well — the choice was the same throughout.
    const held = [turnOf(h0), answer, turnOf(h2), answer, turnOf(h4)];
    const h6 = await buildContextPackage({ ...ask, question: "what about the intro", redact, alreadySent: sentStamps(held, [runOf(0, h0, ["Bank.md"]), runOf(2, h2, ["Bank.md"]), runOf(4, h4, ["Bank.md"])]) }, host());
    expect(h6.refs[0]).toMatchObject({ path: "Bank.md", section: "Bank > Intro", unchanged: true });
    // Without a redaction in between, the section is named, not sent again.
    const same = await buildContextPackage({ ...ask, alreadySent: sentStamps([turnOf(t0)], [runOf(0, t0)]) }, host());
    expect(same.refs[0]).toMatchObject({ unchanged: true });
  });

  it("names the beginning of an open note unchanged as the beginning, not as the whole note", async () => {
    const opened: SituationInput = { ...situation, active: { path: "Manual.md", title: "Manual", kind: "note" } };
    const input = { question: "what about the weather", recipient: cloud, situation: opened, candidates: [], pins: [] };
    const first = await buildContextPackage(input, host());
    expect(first.refs.find((ref) => ref.path === "Manual.md")).toMatchObject({ tier: "evidence", section: "" });
    const again = await buildContextPackage({ ...input, alreadySent: new Set(first.part.context) }, host());
    expect(again.refs.find((ref) => ref.path === "Manual.md")).toMatchObject({ unchanged: true, section: "" });
    expect(again.part.text).toContain("Manual (Manual.md), the beginning: unchanged since it was sent earlier");
  });

  it("sends a passage found by meaning that holds all the note says as the whole note", async () => {
    const chunk = chunkNote("Budget", BUDGET)[0]!;
    const pack = await buildContextPackage(
      { question: "what do we pay", recipient: cloud, situation, candidates: [[{ path: "Budget.md", title: "Budget", signals: { semantic: 0.9 }, chunk: { ordinal: chunk.ordinal, hash: chunk.hash } }]], pins: [] },
      host(),
    );
    const [budget] = pack.refs;
    expect(budget).toMatchObject({ path: "Budget.md", tier: "evidence" });
    expect(budget!.section).toBeUndefined();
    expect(budget!.left).toBeUndefined();
    expect(pack.part.text).toContain("the whole note");
    expect(pack.part.text).not.toContain("read_note gives the rest");
    // The note's whole text, its heading too — as the open note goes in the next turn, which therefore names it.
    expect(pack.part.text).toContain("# Budget");
    const opened: SituationInput = { ...situation, active: { path: "Budget.md", title: "Budget", kind: "note" } };
    const open = await buildContextPackage({ question: "what do we pay", recipient: cloud, situation: opened, candidates: [], pins: [], alreadySent: new Set(pack.part.context) }, host());
    expect(open.refs.find((ref) => ref.path === "Budget.md")).toMatchObject({ unchanged: true });
  });

  it("reads a line the outline does not call a heading as text of the section", async () => {
    const pack = await buildContextPackage({ question: "the rates", recipient: cloud, situation, candidates: [[{ path: "Memo.md", title: "Memo", signals: { lexical: 1 } }]], pins: [] }, host());
    const [memo] = pack.refs;
    expect(memo).toMatchObject({ path: "Memo.md", tier: "evidence", section: "Memo > Rates" });
    expect(memo!.left).toBeGreaterThan(5_000);
  });

  it("saves nothing for a section with no text beyond its heading", async () => {
    const pack = await buildContextPackage({ question: "the rates", recipient: cloud, situation, candidates: [[{ path: "Template.md", title: "Template", signals: { lexical: 1 } }]], pins: [] }, host());
    const [template] = pack.refs;
    expect(template).toMatchObject({ path: "Template.md", tier: "evidence", section: "Template > Rates" });
    expect(template!.chars).toBeLessThan(20);
    expect(template!.left).toBeUndefined();
  });

  it("saves nothing for a section named again unchanged", async () => {
    const input = { question: "what is the rate", recipient: cloud, situation, candidates: [[{ path: "Offer.md", title: "Offer", signals: { lexical: 1 } }]], pins: [] };
    const first = await buildContextPackage(input, host());
    expect(first.refs[0]!.left).toBeGreaterThan(0);
    const again = await buildContextPackage({ ...input, alreadySent: new Set(first.part.context) }, host());
    expect(again.refs[0]).toMatchObject({ path: "Offer.md", unchanged: true, chars: 0 });
    expect(again.refs[0]!.left).toBeUndefined();
  });

  it("counts what goes in bytes, so a note in another script is no saving when it went whole", async () => {
    const bytes = utf8Length(DIARY);
    expect(bytes).toBeGreaterThan(DIARY.length * 2);
    const pack = await buildContextPackage({ question: "rain", recipient: cloud, situation, candidates: [], pins: ["Diary.md"] }, host({ "Diary.md": bytes }));
    expect(pack.material.sentChars).toBe(DIARY.length);
    expect(pack.material.sentBytes).toBe(bytes);
    expect(pack.material.candidateBytes).toBe(bytes);
    // Characters against bytes would have called two thirds of it saved.
    expect(naiveComparison(pack.material)).toBeNull();
  });

  it("counts a note it read by its body, so a note with properties is no saving when it went whole", async () => {
    // The index knows the file: properties and all.
    const pack = await buildContextPackage({ question: "the release", recipient: cloud, situation, candidates: [], pins: ["Plan.md"] }, host({ "Plan.md": utf8Length(PLAN) }));
    expect(pack.refs[0]).toMatchObject({ path: "Plan.md", tier: "evidence" });
    expect(pack.refs[0]!.section).toBeUndefined();
    expect(pack.material.candidateBytes).toBe(pack.material.sentBytes);
    expect(naiveComparison(pack.material)).toBeNull();
  });
});

describe("what a run's sources saved", () => {
  const refs = [
    { path: "A.md", hash: "h1", left: 3_500 },
    { path: "B.md", hash: "h2", left: 7_000 },
    { path: "C.md", hash: "h3" },
    { path: "D.md" },
  ];

  it("sums what the context left out of the notes, as tokens", () => {
    expect(contextSavingsOf(refs)).toEqual({ savedTokens: estimateTokensOfChars(10_500) });
    expect(estimateTokensOfChars(10_500)).toBe(3000);
  });

  it("leaves out what the run names — a note a tool read, a version counted before", () => {
    expect(contextSavingsOf(refs, (ref) => ref.path === "B.md")).toEqual({ savedTokens: 1000 });
    expect(contextSavingsOf(refs, (ref) => ref.hash === "h1" || ref.hash === "h2")).toBeNull();
    expect(contextSavingsOf([{ path: "C.md" }])).toBeNull();
  });
});

describe("the naive comparison", () => {
  it("is a share of bytes, its tokens counted at the characters a byte of what went stands for", () => {
    expect(naiveComparison({ sentChars: 1000, sentBytes: 1000, candidateBytes: 4000 })).toEqual({ share: 0.75, tokens: estimateTokensOfChars(4000) });
    // Three bytes a character: 1,200 bytes are 400 characters.
    expect(naiveComparison({ sentChars: 100, sentBytes: 300, candidateBytes: 1200 })).toEqual({ share: 0.75, tokens: estimateTokensOfChars(400) });
  });

  it("is left out without sizes, when nothing of the notes went, or when the selection saves nothing", () => {
    expect(naiveComparison({ sentChars: 100, sentBytes: 100, candidateBytes: null })).toBeNull();
    expect(naiveComparison({ sentChars: 0, sentBytes: 0, candidateBytes: 5000 })).toBeNull();
    expect(naiveComparison({ sentChars: 100, sentBytes: 300, candidateBytes: 300 })).toBeNull();
    expect(naiveComparison({ sentChars: 100, sentBytes: 300, candidateBytes: 250 })).toBeNull();
    // A share that rounds to nothing is no saving to show.
    expect(naiveComparison({ sentChars: 999, sentBytes: 999, candidateBytes: 1000 })).toBeNull();
  });
});

describe("utf8Length", () => {
  it("counts as the disk does", () => {
    const loneHigh = String.fromCharCode(0xd83d);
    for (const text of ["", "plain", "é", "日記", "😀", `a${loneHigh}b`, DIARY]) expect(utf8Length(text), text).toBe(Buffer.byteLength(text, "utf8"));
    expect(utf8Length("😀")).toBe(4);
  });
});
