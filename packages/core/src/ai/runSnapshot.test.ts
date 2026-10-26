import { describe, expect, it } from "vitest";
import { appendTurn, startConversation } from "./conversation.js";
import { buildContextPackage, type ContextBuildHost, type SituationInput } from "./context/package.js";
import { manifestOf } from "./context/manifest.js";
import { EMPTY_USAGE, readConversationRecord, RUN_READ_CAP, type ConversationRecord } from "./history.js";
import { effectivePolicy, notePolicyFrom } from "./policy.js";
import { NOTE_HASH, noteHash, shortHash, snapshotState } from "./runSnapshot.js";

/**
 * A run's snapshot (plan KI-Harness P9-2, ADR 0034): the version of what went
 * is a hash, kept in the run's record and read back as one; whether a source
 * changed since is its hash against the note as it is now.
 */

const OFFER = "# Offer 2026\n\nThe day rate is 1,800 euros.\n";

describe("the version of a note", () => {
  it("is the SHA-256 of its text, and tells the same text from a changed one and a gone one", () => {
    const hash = noteHash(OFFER);
    expect(hash).toMatch(NOTE_HASH);
    // The hash of a known text: the version is no accident of the way it was computed.
    expect(noteHash("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(snapshotState(hash, OFFER)).toBe("same");
    expect(snapshotState(hash, `${OFFER}Travel is extra.\n`)).toBe("changed");
    // A changed line end is a changed text: the version is the bytes the run read.
    expect(snapshotState(hash, OFFER.replace(/\n/g, "\r\n"))).toBe("changed");
    expect(snapshotState(hash, null)).toBe("gone");
    expect(shortHash(hash)).toBe(hash.slice(0, 7));
  });
});

describe("what a context package keeps of its sources", () => {
  const situation: SituationInput = { now: "2026-10-25 09:14", weekday: "Sunday", calendarDay: "2026-10-25", journalDay: "2026-10-25", active: null, tabs: [], tasks: [], events: [], dailyNote: null };
  const notes: Record<string, string> = {
    "Projects/Offer 2026.md": OFFER,
    "Projects/Kick-off.md": "# Kick-off\n\nPositions: studio days, sound mix.\n",
  };
  const host: ContextBuildHost = {
    policyOf: async (path) => effectivePolicy(path, notePolicyFrom({}), []),
    resolveLink: async () => null,
    readNote: async (path) => (notes[path] === undefined ? null : { title: path.replace(/^.*\//, "").replace(/\.md$/, ""), text: notes[path]! }),
  };

  it("gives each source it read the hash of the note's whole text — and the send overview carries it, never the text", async () => {
    const pack = await buildContextPackage(
      {
        question: "What is the day rate?",
        recipient: { kind: "cloud", provider: "anthropic", model: "m" },
        situation,
        candidates: [[{ path: "Projects/Kick-off.md", title: "Kick-off", signals: { lexical: 1 } }]],
        pins: ["Projects/Offer 2026.md"],
      },
      host,
    );
    const byPath = new Map(pack.refs.map((ref) => [ref.path, ref]));
    expect(byPath.get("Projects/Offer 2026.md")?.hash).toBe(noteHash(OFFER));
    expect(byPath.get("Projects/Kick-off.md")?.hash).toBe(noteHash(notes["Projects/Kick-off.md"]!));
    const manifest = manifestOf(pack, { id: "anthropic", label: "Anthropic", local: false }, "m", { tools: [] });
    const sent = manifest.sources.find((source) => source.path === "Projects/Offer 2026.md")!;
    expect(sent.hash).toBe(noteHash(OFFER));
    expect(JSON.stringify(manifest.sources.map((source) => source.hash))).not.toContain("day rate");
  });
});

describe("a run's record", () => {
  function record(): ConversationRecord {
    const conversation = appendTurn(startConversation("c1", "system", ["read_note"]), { role: "user", parts: [{ type: "text", text: "What is the day rate?" }], at: "2026-10-25T09:14:00Z" });
    return {
      version: 1,
      id: "c1",
      title: "Day rate",
      createdAt: "2026-10-25T09:14:00Z",
      updatedAt: "2026-10-25T09:14:00Z",
      providerId: "openai",
      model: "gpt-5-mini",
      conversation,
      usage: EMPTY_USAGE,
      runs: [
        {
          userTurn: 0,
          providerId: "openai",
          model: "gpt-5-mini",
          sent: ["Projects/Offer 2026.md"],
          kept: [],
          usage: EMPTY_USAGE,
          steps: 2,
          stop: "answered",
          skills: [{ id: "plainva:project-status", how: "bound", tokens: 300, sha256: noteHash("skill") }],
          read: ["Projects/Budget.md"],
          readHashes: [{ path: "Projects/Budget.md", hash: noteHash("# Budget\n") }],
        },
      ],
      pins: ["Projects/Offer 2026.md"],
      replayOf: { conversationId: "c0", userTurn: 0, title: "Budget season 2", at: "2026-10-25T08:00:00Z", providerId: "anthropic", model: "claude-opus-5-5", changed: 1 },
    };
  }

  it("keeps the versions of what its tools read, of its skill, and where a replay comes from — read back as they were", () => {
    const r = record();
    expect(readConversationRecord(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it("drops a version that is no hash, a path that comes twice, and a replay that does not read whole", () => {
    const r = JSON.parse(JSON.stringify(record()));
    r.runs[0].readHashes = [
      { path: "Projects/Budget.md", hash: noteHash("# Budget\n") },
      { path: "Projects/Budget.md", hash: noteHash("other") },
      { path: "Projects/Plan.md", hash: "the text of the plan" },
      { path: 4, hash: noteHash("x") },
    ];
    r.runs[0].skills[0].sha256 = "not a hash";
    r.replayOf = { conversationId: "c0", title: "Budget season 2" };
    const read = readConversationRecord(r)!;
    expect(read.runs[0]!.readHashes).toEqual([{ path: "Projects/Budget.md", hash: noteHash("# Budget\n") }]);
    expect(read.runs[0]!.skills![0]).toEqual({ id: "plainva:project-status", how: "bound", tokens: 300 });
    expect(read.replayOf).toBeUndefined();
  });

  it("keeps the notes a run read at two versions, a read past its record and what it sent redacted, and drops what is no such thing (plan P9-6)", () => {
    const r = JSON.parse(JSON.stringify(record()));
    r.runs[0].readChanged = ["Projects/Plan.md", 4, "Projects/Notes.md"];
    r.runs[0].readUnhashed = true;
    r.runs[0].redact = ["Projects/Budget.md", null];
    const read = readConversationRecord(r)!;
    expect(read.runs[0]!.readChanged).toEqual(["Projects/Plan.md", "Projects/Notes.md"]);
    expect(read.runs[0]!.redact).toEqual(["Projects/Budget.md"]);
    expect(read.runs[0]!.readUnhashed).toBe(true);
    r.runs[0].readUnhashed = "yes";
    expect(readConversationRecord(r)!.runs[0]!.readUnhashed).toBeUndefined();
  });

  it("keeps no more versions than paths of what was read", () => {
    const r = JSON.parse(JSON.stringify(record()));
    r.runs[0].readHashes = Array.from({ length: RUN_READ_CAP + 20 }, (_, i) => ({ path: `N/${i}.md`, hash: noteHash(String(i)) }));
    expect(readConversationRecord(r)!.runs[0]!.readHashes).toHaveLength(RUN_READ_CAP);
  });
});
