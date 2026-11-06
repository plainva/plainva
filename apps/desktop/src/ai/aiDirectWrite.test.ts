// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WRITE_RESULTS } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { answering, results, turn, viaDispatch } from "./mcpSessionHarness";
import { gateSession, gateVault, removeGateVaults } from "./writeGateHarness";

// The journal of comment operations lives in the app's data, behind Tauri; here it is the same file journal over a
// folder of the test's own.
vi.mock("../services/commentOperationJournal", async () => {
  const { gateJournal } = await import("./writeGateJournal");
  return { desktopCommentOperationJournal: gateJournal };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

/**
 * "Apply directly" (plan "KI direkt schreiben", W1) through the real session, the
 * real writing tools and a vault on a real disk behind the desktop's chain: where
 * the user switched it on for the conversation, or where a folder's rule lets it,
 * a change is written at once — with a version before it and a line under the
 * answer that takes it back. Everywhere else, and wherever it cannot be, it is a
 * suggestion as before. Renaming, moving and deleting ask in every case.
 */

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await removeGateVaults();
});

const OFFER = "# Offer\n\nThe day rate is 1,800 euros.\n";
const RAISED = "# Offer\n\nThe day rate is 1,900 euros.\n";
const RAISE = { path: "Projects/Offer.md", edits: [{ find: "1,800 euros", replace: "1,900 euros" }] };
const JOURNAL_RULE = 'folders:\n  "Journal/":\n    write: direct\n';

async function run(options: { chip?: boolean; policy?: string; unsaved?: string[]; snapshotFails?: boolean; call?: { name: string; args: Record<string, unknown> } } = {}) {
  const vault = await gateVault({ "Projects/Offer.md": OFFER, "Journal/Today.md": "# Today\n\nWrote the offer.\n" }, { ...(options.policy ? { policy: options.policy } : {}), direct: { unsaved: new Set(options.unsaved ?? []), snapshotFails: () => options.snapshotFails === true } });
  const call = options.call ?? { name: "propose_edit", args: RAISE };
  const { s } = await gateSession([turn({ calls: [viaDispatch("c1", call.name, call.args)] }), turn({ text: "Done." })], vault);
  if (options.chip) s.setDirect(true);
  expect(await s.send("Raise the day rate.")).toEqual({ kind: "answered" });
  const active = s.getState().active!;
  return { vault, s, active, writes: active.runs[0]!.writes, said: results(active).map((result) => result.content) };
}

describe("Apply directly in the conversation", () => {
  it("is off by default: the change waits as a suggestion and the note is what it was", async () => {
    const { vault, writes, s } = await run();
    expect(await vault.disk("Projects/Offer.md")).toBe(OFFER);
    expect(writes?.rounds).toEqual([{ path: "Projects/Offer.md", blocks: 1, properties: 0 }]);
    expect(writes?.applied).toBeUndefined();
    expect(s.directOn()).toBe(false);
  });

  it("writes the change at once, keeps the version before it and the assistant's version marked, and tells the model", async () => {
    const { vault, writes, said, active, s } = await run({ chip: true });
    expect(await vault.disk("Projects/Offer.md")).toBe(RAISED);
    expect(await vault.open("Projects/Offer.md")).toEqual([]);
    expect(writes?.rounds).toEqual([]);
    expect(writes?.applied).toEqual([expect.objectContaining({ path: "Projects/Offer.md", kind: "edit", created: false, passages: 1, by: "chat" })]);
    expect(said).toEqual([WRITE_RESULTS.applied("Projects/Offer.md", 1, 0)]);
    const versions = await vault.versions("Projects/Offer.md");
    expect(versions.map((v) => [v.origin ?? "", v.text])).toEqual([
      ["ai", RAISED],
      ["", OFFER],
    ]);
    expect(vault.told).toEqual(["changed Projects/Offer.md"]);
    // The conversation keeps its leave while it is open; the next one begins without it.
    expect(s.directOn()).toBe(true);
    expect(s.getState().directChats).toEqual([active.id]);
    s.newConversation();
    expect(s.directOn()).toBe(false);
  });

  it("Undo puts the version back; a second Undo has nothing left to take back", async () => {
    const { vault, s } = await run({ chip: true });
    expect(await s.undoDirect(0)).toEqual({ undone: ["Projects/Offer.md"], changed: [], failed: [] });
    expect(await vault.disk("Projects/Offer.md")).toBe(OFFER);
    expect(s.getState().active!.runs[0]!.writes!.applied![0]!.undone).toBe(true);
    expect(await s.undoDirect(0)).toEqual({ undone: [], changed: [], failed: [] });
  });

  it("Undo overwrites nothing somebody changed since: the note comes back as changed, for the comparison", async () => {
    const { vault, s } = await run({ chip: true });
    await vault.files.writeTextFile("Projects/Offer.md", `${RAISED}\nAnd a line of mine.\n`);
    expect(await s.undoDirect(0, "Projects/Offer.md")).toEqual({ undone: [], changed: ["Projects/Offer.md"], failed: [] });
    expect(await vault.disk("Projects/Offer.md")).toBe(`${RAISED}\nAnd a line of mine.\n`);
  });

  it("lays a suggestion on a note open with unsaved keystrokes, and says why", async () => {
    const { vault, writes, said } = await run({ chip: true, unsaved: ["Projects/Offer.md"] });
    expect(await vault.disk("Projects/Offer.md")).toBe(OFFER);
    expect(writes?.rounds).toEqual([{ path: "Projects/Offer.md", blocks: 1, properties: 0, fallback: "unsaved" }]);
    expect(said[0]).toBe(`${WRITE_RESULTS.notApplied("unsaved")}${WRITE_RESULTS.proposed("Projects/Offer.md", 1, 0)}`);
    expect(await vault.open("Projects/Offer.md")).toHaveLength(1);
  });

  it("lays a suggestion where no version could be kept first", async () => {
    const { vault, writes } = await run({ chip: true, snapshotFails: true });
    expect(await vault.disk("Projects/Offer.md")).toBe(OFFER);
    expect(writes?.rounds[0]?.fallback).toBe("snapshot");
  });

  it("makes a new note at once, and Undo takes it away while it is what the assistant made", async () => {
    const { vault, writes, s } = await run({ chip: true, call: { name: "create_note", args: { title: "Rates", content: "The day rate is 1,900 euros." } } });
    expect(writes?.drafts).toEqual([]);
    expect(writes?.applied).toEqual([expect.objectContaining({ path: "Inbox/Rates.md", kind: "note", created: true, before: null })]);
    expect(await vault.disk("Inbox/Rates.md")).toContain("The day rate is 1,900 euros.");
    expect(s.getState().drafts.drafts).toEqual([]);
    expect(await s.undoDirect(0)).toEqual({ undone: ["Inbox/Rates.md"], changed: [], failed: [] });
    expect(await vault.disk("Inbox/Rates.md")).toBeNull();
  });

  it("can be switched on while the conversation goes on: the next change is written, the earlier one stays a suggestion", async () => {
    const vault = await gateVault({ "Projects/Offer.md": OFFER }, { direct: {} });
    const { s } = await gateSession(
      [
        turn({ calls: [viaDispatch("c1", "propose_edit", RAISE)] }),
        turn({ text: "Proposed." }),
        turn({ calls: [viaDispatch("c2", "propose_edit", { path: "Projects/Offer.md", append: "Valid for 2027." })] }),
        turn({ text: "Done." }),
      ],
      vault,
    );
    expect(s.directOffer()).toBe(true);
    await s.send("Raise the day rate.");
    expect(s.getState().active!.runs[0]!.writes?.applied).toBeUndefined();
    s.setDirect(true);
    await s.send("And add the year.");
    expect(s.getState().active!.runs[1]!.writes?.applied).toEqual([expect.objectContaining({ path: "Projects/Offer.md", by: "chat" })]);
    expect(await vault.disk("Projects/Offer.md")).toBe(`${OFFER}\nValid for 2027.\n`);
  });

  it("is not offered where the shell cannot write directly", async () => {
    const vault = await gateVault({ "Projects/Offer.md": OFFER });
    const { s } = await gateSession([turn({ text: "Hi." })], vault);
    expect(s.directOffer()).toBe(false);
    s.setDirect(true);
    expect(s.directOn()).toBe(false);
  });

  it("still asks before a rename", async () => {
    const vault = await gateVault({ "Projects/Offer.md": OFFER }, { direct: {} });
    const { s } = await gateSession([turn({ calls: [viaDispatch("c1", "rename_note", { path: "Projects/Offer.md", title: "Offer 2027" })] }), turn({ text: "Done." })], vault);
    s.setDirect(true);
    const asked = answering(s, () => "deny");
    await s.send("Rename the offer.");
    expect(asked.map((effect) => effect.kind)).toEqual(["plan"]);
    expect(await vault.disk("Projects/Offer.md")).toBe(OFFER);
  });
});

describe("Change without asking, a folder's rule", () => {
  it("writes directly in that folder without the conversation's leave", async () => {
    const { vault, writes } = await run({ policy: JOURNAL_RULE, call: { name: "propose_edit", args: { path: "Journal/Today.md", append: "Raised the rate." } } });
    expect(await vault.disk("Journal/Today.md")).toBe("# Today\n\nWrote the offer.\n\nRaised the rate.\n");
    expect(writes?.applied).toEqual([expect.objectContaining({ path: "Journal/Today.md", by: "folder" })]);
  });

  it("lays a suggestion everywhere else", async () => {
    const { vault, writes } = await run({ policy: JOURNAL_RULE });
    expect(await vault.disk("Projects/Offer.md")).toBe(OFFER);
    expect(writes?.applied).toBeUndefined();
    expect(writes?.rounds).toHaveLength(1);
  });
});
