import { describe, expect, it } from "vitest";
import { readFrontmatterPath, type WorkspaceCommentRecord, type WriteDraft, type WriteDraftOutcome } from "@plainva/core";
import { EMPTY_WRITE_DRAFTS, createWriteDraftStore, draftDetail, draftedEntryContent, draftedNoteContent, entryPlaceOf, machineProposals, serializeBaseConfig, stripFrontmatter } from "@plainva/ui";
import { memoryFiles } from "./mcpTestHost";

/**
 * Drafts on this device, the note a drafted note or a drafted entry of a
 * database becomes, and the list of notes that carry a machine's open
 * proposals (plan KI-Harness P5-2, P5-4).
 */

const draft = (over: Partial<WriteDraft> = {}): WriteDraft => ({
  id: "d-000001",
  createdAt: "2026-10-07T09:00:00.000Z",
  author: { id: "plainva-ai/m-1", label: "Plainva AI · m-1" },
  conversationId: "c1",
  title: "Roof plan",
  body: { kind: "note", path: null, folder: "Projects", content: "First the scaffold.\n\n- then the tiles\n" },
  inherited: [],
  sources: [],
  defused: 0,
  ...over,
});

describe("the drafts of a vault on this device", () => {
  it("keeps the waiting drafts and what became of earlier ones, in the app's own storage", async () => {
    const files = memoryFiles();
    const store = createWriteDraftStore(files, "vault-a");
    expect(await store.load()).toEqual(EMPTY_WRITE_DRAFTS);
    const done: WriteDraftOutcome = { id: "d-000000", kind: "task", title: "Buy nails", outcome: "created", path: "Tasks/Buy nails.md", at: "2026-10-07T08:00:00.000Z" };
    await store.save({ drafts: [draft()], done: [done] });
    expect([...files.files.keys()]).toEqual(["vault-a/drafts.json"]);
    expect(await store.load()).toEqual({ drafts: [draft()], done: [done] });
    // Another vault's drafts are another file.
    expect(await createWriteDraftStore(files, "vault-b").load()).toEqual(EMPTY_WRITE_DRAFTS);
  });

  it("takes a file it cannot read for no drafts — it never makes one up", async () => {
    const files = memoryFiles();
    const store = createWriteDraftStore(files, "vault-a");
    for (const broken of ["{", "[]", '"drafts"', JSON.stringify({ version: 9, drafts: [draft()] }), JSON.stringify({ version: 1, drafts: [{ id: "d-000002", title: "No body" }, "x"] })]) {
      files.files.set("vault-a/drafts.json", broken);
      expect(await store.load(), broken).toEqual(EMPTY_WRITE_DRAFTS);
    }
  });

  it("writes one change after the other, so two drafts of one run both land", async () => {
    const files = memoryFiles();
    const store = createWriteDraftStore(files, "vault-a");
    const first = store.save({ drafts: [draft()], done: [] });
    const second = store.save({ drafts: [draft(), draft({ id: "d-000002", title: "Second" })], done: [] });
    await Promise.all([first, second]);
    expect((await store.load()).drafts.map((item) => item.id)).toEqual(["d-000001", "d-000002"]);
  });

  it("refuses a vault key that could name another folder", () => {
    for (const key of ["", "../other", "a/b", "a b", "x".repeat(65)]) expect(() => createWriteDraftStore(memoryFiles(), key), key).toThrow();
  });
});

describe("the note a drafted note becomes", () => {
  const now = new Date("2026-10-07T10:00:00Z");

  it("carries its title, who wrote it and the draft's text — stamped once, when the user creates it", () => {
    const note = draftedNoteContent(draft(), now, []);
    expect(readFrontmatterPath(note, ["generated", "by"])).toBe("plainva-ai/m-1");
    expect(String(readFrontmatterPath(note, ["generated", "at"]))).toMatch(/^2026-10-07T/);
    expect(readFrontmatterPath(note, ["sources"])).toBeUndefined();
    expect(readFrontmatterPath(note, ["plainva"])).toBeUndefined();
    expect(stripFrontmatter(note).trim()).toBe("# Roof plan\n\nFirst the scaffold.\n\n- then the tiles");
    expect(note.endsWith("- then the tiles\n")).toBe(true);
  });

  it("names what it rests on, and takes the rules of those notes along", () => {
    const note = draftedNoteContent(draft({ sources: [{ resource: "Projects/Offer.md" }, { resource: "Private/Client.md" }], inherited: ["cloud", "web"] }), now, ["cloud"]);
    expect(readFrontmatterPath(note, ["sources"])).toEqual([{ resource: "Projects/Offer.md" }, { resource: "Private/Client.md" }]);
    // Only the rules the place would not give it anyway are written into it: the caller says which.
    expect(readFrontmatterPath(note, ["plainva", "ai", "cloud"])).toBe("deny");
    expect(readFrontmatterPath(note, ["plainva", "ai", "web"])).toBeUndefined();
  });

  it("makes a note of an empty draft too, and of nothing that is no note", () => {
    const empty = draftedNoteContent(draft({ body: { kind: "note", path: null, folder: null, content: "  \n" } }), now, []);
    expect(stripFrontmatter(empty).trim()).toBe("# Roof plan");
    expect(() => draftedNoteContent(draft({ body: { kind: "task", text: "Buy nails", day: "2026-10-07" } }), now, [])).toThrow();
  });
});

describe("a drafted entry of a database", () => {
  const now = new Date("2026-10-07T10:00:00Z");
  /** A database's file as Plainva writes one: its sources, one view, and the folder the user chose for new entries. */
  const base = (sources: string[], newItemFolder?: string) => serializeBaseConfig({ filters: { and: sources }, views: [{ type: "table", name: "All" }], ...(newItemFolder ? { newItemFolder } : {}) });
  const entry = (over: Partial<WriteDraft> = {}) =>
    draft({ title: "Dune", body: { kind: "entry", base: "Projects/Books.base", properties: { author: "Frank Herbert", pages: 412, read: false, genres: ["sci-fi", "classic"] }, content: "A desert planet.\n" }, ...over });

  it("goes where the database's own “New entry” puts one, and carries the tags its source asks for", () => {
    expect(entryPlaceOf(base(['file.folder == "Books"', 'file.hasTag("book")', 'file.hasTag("read")']), "Book")).toEqual({ folder: "Books", noteType: "Book", tags: ["book", "read"] });
    // The folder as a note is written into it, however the database spells it.
    expect(entryPlaceOf(base(['file.folder == "Reading/Books/"']), "Note")?.folder).toBe("Reading/Books");
    // A database of tags alone names its folder once the user chose one with its first entry.
    expect(entryPlaceOf(base(['file.hasTag("book")']), "Note")).toBeNull();
    expect(entryPlaceOf(base(['file.hasTag("book")'], "Shelf"), "Note")).toEqual({ folder: "Shelf", noteType: "Note", tags: ["book"] });
  });

  it("has no place while the database has none: two folders are a question for the user, and a file that is no database is none", () => {
    const two = ['file.folder == "Books"', 'file.folder == "Comics"'];
    expect(entryPlaceOf(base(two), "Note")).toBeNull();
    // The folder the user chose among them answers it — one that is none of them does not.
    expect(entryPlaceOf(base(two, "Comics"), "Note")?.folder).toBe("Comics");
    expect(entryPlaceOf(base(two, "Elsewhere"), "Note")).toBeNull();
    for (const raw of [null, "", "views: []\n", "- a list\n", "{ not: [yaml"]) expect(entryPlaceOf(raw, "Note"), String(raw)).toBeNull();
  });

  it("becomes a note like the database's own new entry — its type, its tags, the properties the draft names — stamped with who wrote it", () => {
    const note = draftedEntryContent(entry({ sources: [{ resource: "Projects/Offer.md" }] }), now, [], { noteType: "Book", tags: ["book"] });
    expect(readFrontmatterPath(note, ["type"])).toBe("Book");
    expect(readFrontmatterPath(note, ["tags"])).toEqual(["book"]);
    expect([readFrontmatterPath(note, ["author"]), readFrontmatterPath(note, ["pages"]), readFrontmatterPath(note, ["read"]), readFrontmatterPath(note, ["genres"])]).toEqual(["Frank Herbert", 412, false, ["sci-fi", "classic"]]);
    expect(readFrontmatterPath(note, ["generated", "by"])).toBe("plainva-ai/m-1");
    expect(readFrontmatterPath(note, ["sources"])).toEqual([{ resource: "Projects/Offer.md" }]);
    expect(readFrontmatterPath(note, ["plainva"])).toBeUndefined();
    expect(stripFrontmatter(note).trim()).toBe("# Dune\n\nA desert planet.");
  });

  it("joins the tags the draft names to the ones that make it a member, and takes the rules of what it rests on along", () => {
    const tagged = entry({ body: { kind: "entry", base: "Projects/Books.base", properties: { tags: ["sci-fi", "book", " "] }, content: "" }, inherited: ["cloud", "web"] });
    const note = draftedEntryContent(tagged, now, ["cloud"], { noteType: "Note", tags: ["book"] });
    expect(readFrontmatterPath(note, ["tags"])).toEqual(["book", "sci-fi"]);
    expect(readFrontmatterPath(note, ["plainva", "ai", "cloud"])).toBe("deny");
    expect(readFrontmatterPath(note, ["plainva", "ai", "web"])).toBeUndefined();
    // A single tag is one, a database without a tag source takes the draft's own, and an entry without text is a heading.
    const single = draftedEntryContent(entry({ body: { kind: "entry", base: "Projects/Books.base", properties: { tags: "sci-fi" }, content: "" } }), now, [], { noteType: "Note", tags: [] });
    expect(readFrontmatterPath(single, ["tags"])).toEqual(["sci-fi"]);
    expect(stripFrontmatter(single).trim()).toBe("# Dune");
    expect(() => draftedEntryContent(draft(), now, [], { noteType: "Note", tags: [] })).toThrow();
  });
});

describe("what a draft says of itself", () => {
  it("names its folder, its day, or its database", () => {
    expect(draftDetail(draft())).toEqual({ folder: "Projects", lines: 2 });
    expect(draftDetail(draft({ body: { kind: "note", path: null, folder: null, content: "" } }))).toEqual({ folder: null, lines: 0 });
    // Another writer's draft names its own file: its folder is that file's.
    expect(draftDetail(draft({ body: { kind: "note", path: "Agents/Out/Report.md", folder: null, content: "x" } }))).toEqual({ folder: "Agents/Out", lines: 1 });
    expect(draftDetail(draft({ body: { kind: "task", text: "Buy nails", day: "2026-10-07" } }))).toEqual({ day: "2026-10-07" });
    expect(draftDetail(draft({ body: { kind: "journal", text: "Met Anna", day: "2026-10-07", time: "10:30", task: false } }))).toEqual({ day: "2026-10-07", time: "10:30" });
    expect(draftDetail(draft({ body: { kind: "entry", base: "Projects/Board.base", properties: {}, content: "" } }))).toEqual({ base: "Projects/Board.base" });
  });
});

describe("the notes that carry a machine's open proposals", () => {
  let n = 0;
  const suggestion = (author: string, createdAt: string, over: Partial<WorkspaceCommentRecord> = {}): WorkspaceCommentRecord =>
    ({
      commentId: `k${++n}`,
      targetObjectId: "x",
      parentCommentId: null,
      authorMemberId: author,
      authorDeviceId: "dev",
      body: "",
      anchor: null,
      createdAt,
      suggestion: { replacement: "new", appliedAt: null, appliedBy: null, declinedAt: null },
      resolvedCommentId: null,
      resolvedAt: null,
      ...over,
    }) as WorkspaceCommentRecord;

  it("lists them by note and writer, newest first — and leaves a person's own suggestions to the comments", () => {
    const byPath = new Map<string, WorkspaceCommentRecord[]>([
      [
        "Projects/Offer.md",
        [
          suggestion("plainva-ai/m-1", "2026-10-07T09:00:00.000Z"),
          suggestion("plainva-ai/m-1", "2026-10-07T09:05:00.000Z"),
          suggestion("mcp:desk-client", "2026-10-07T08:00:00.000Z"),
          // A person's suggestion, and a plain comment of the assistant, are not proposals of a machine.
          suggestion("member-anna", "2026-10-07T11:00:00.000Z"),
          suggestion("plainva-ai/m-1", "2026-10-07T12:00:00.000Z", { suggestion: null, body: "A remark" }),
        ],
      ],
      ["Projects/Plan.md", [suggestion("acp:helper", "2026-10-07T10:00:00.000Z")]],
      ["Archive/Old.md", [suggestion("member-anna", "2026-10-07T10:00:00.000Z")]],
    ]);
    expect(machineProposals(byPath)).toEqual([
      { path: "Projects/Plan.md", authorId: "acp:helper", changes: 1, at: "2026-10-07T10:00:00.000Z" },
      { path: "Projects/Offer.md", authorId: "plainva-ai/m-1", changes: 2, at: "2026-10-07T09:05:00.000Z" },
      { path: "Projects/Offer.md", authorId: "mcp:desk-client", changes: 1, at: "2026-10-07T08:00:00.000Z" },
    ]);
    // With the names the vault's comments keep for their authors, a writer is listed under the name it signed with.
    const names = new Map([
      ["mcp:desk-client", "Claude Code (AI app)"],
      ["acp:helper", "  "],
      ["member-anna", "Anna"],
    ]);
    expect(machineProposals(byPath, names).map((proposal) => [proposal.authorId, proposal.authorLabel])).toEqual([
      ["acp:helper", undefined],
      ["plainva-ai/m-1", undefined],
      ["mcp:desk-client", "Claude Code (AI app)"],
    ]);
  });

  it("counts only what still waits: nothing accepted, declined or resolved", () => {
    const at = "2026-10-07T09:00:00.000Z";
    const byPath = new Map<string, WorkspaceCommentRecord[]>([
      [
        "Projects/Offer.md",
        [
          suggestion("plainva-ai/m-1", at, { suggestion: { replacement: "a", appliedAt: at, appliedBy: "member-anna", declinedAt: null } }),
          suggestion("plainva-ai/m-1", at, { suggestion: { replacement: "b", appliedAt: null, appliedBy: null, declinedAt: at } }),
          suggestion("plainva-ai/m-1", at, { resolvedAt: at }),
        ],
      ],
    ]);
    expect(machineProposals(byPath)).toEqual([]);
    expect(machineProposals(new Map())).toEqual([]);
  });
});
