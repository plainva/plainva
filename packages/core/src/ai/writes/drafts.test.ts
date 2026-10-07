import { describe, expect, it } from "vitest";
import { acpAuthorId } from "../acp/agents.js";
import { assistantAuthorId, machineAuthorId, machineAuthorKind, machineAuthorSubject, mcpAuthorId } from "./authors.js";
import { WRITE_DRAFT_LIMITS, parseWriteDraft, parseWriteDrafts, serializeWriteDrafts, withWriteDraft, withoutWriteDraft, type WriteDraft } from "./drafts.js";

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
    expect(mcpAuthorId("3f9a")).toBe("mcp:3f9a");
  });

  it("tells a machine from a person, and reads the id back", () => {
    expect(machineAuthorKind("plainva-ai/model-x")).toBe("assistant");
    expect(machineAuthorKind("mcp:3f9a")).toBe("mcp");
    expect(machineAuthorKind("acp:a1")).toBe("acp");
    expect(machineAuthorSubject("plainva-ai/vendor/model-x")).toBe("vendor/model-x");
    expect(machineAuthorSubject("mcp:3f9a")).toBe("3f9a");
    // A device id, a member id, a prefix with nothing behind it: a person's, or nobody's.
    for (const id of ["4f3a9c0d4f3a9c0d4f3a9c0d4f3a9c0d", "member-7", "plainva-ai/", "mcp:", "acp:", "", null, undefined]) {
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
