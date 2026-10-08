// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EFFECT_DECLINED, WRITE_REFUSALS, WRITE_RESULTS, acpAuthorId, mcpAuthorId, planCommentDecision, readFrontmatterPath } from "@plainva/core";
import { acpPlanNoteWrite, acpProposeRound, applyTextShape, proposeSuggestionRound, readTextShape, type AcpVaultAccess } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { LOCAL, answering, chat, results, turn, viaDispatch } from "./mcpSessionHarness";
import { gateSession, gateVault, removeGateVaults, type GateVault } from "./writeGateHarness";

// The journal of comment operations lives in the app's data, behind Tauri; here it is the same file journal over a
// folder of the test's own.
vi.mock("../services/commentOperationJournal", async () => {
  const { gateJournal } = await import("./writeGateJournal");
  return { desktopCommentOperationJournal: gateJournal };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const { runMcpCall } = await import("../services/ai/mcpBridge");
const { McpPlans } = await import("../services/ai/mcpPlans");

/**
 * The gate of the writing tools (plan KI-Harness P5, §21: "Gate"). Each
 * `describe` is one of its sentences, played on a vault on a real disk through
 * the real session, the real writing tools, the comment files a vault really
 * has, and the desktop's own operation that accepts a suggestion — with a
 * model that does what its script says. What is compared is bytes.
 */

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await removeGateVaults();
});

const OFFER = [
  "---",
  "stage: open",
  "owner: Anna",
  "---",
  "# Offer",
  "",
  "The day rate is 1,800 euros.",
  "",
  "Payment within 30 days.",
  "",
  "```md",
  "[[Not a link]] in code stays as it is.",
  "```",
  "",
].join("\n");
const NOTES_AROUND = { "Projects/Brief.md": "# Brief\n\nShort.\n", "Projects/Table.md": "| a | b |\n|---|---|\n| 1 | 2 |\n" };

/** A byte order mark, made at run time: written into this file it would be an invisible character of the source. */
const BOM = String.fromCharCode(0xfeff);

/** The same note in the shapes a file comes in. */
const SHAPES: Array<[name: string, text: string]> = [
  ["a note with \\n", OFFER],
  ["a note with \\r\\n, as Windows writes it", OFFER.replace(/\n/g, "\r\n")],
  ["a note with a byte order mark and \\r\\n", `${BOM}${OFFER.replace(/\n/g, "\r\n")}`],
  ["a note without a last line break", OFFER.trimEnd()],
];

/** What a model asks for, and the note as it then has to read — said on the text an editor holds. */
const CHANGES: Array<[name: string, args: Record<string, unknown>, expected: (edited: string) => string]> = [
  ["one passage in a line", { edits: [{ find: "1,800 euros", replace: "1,900 euros" }], note: "New rate" }, (edited) => edited.replace("1,800 euros", "1,900 euros")],
  [
    "two passages, one of them over several lines",
    {
      edits: [
        { find: "# Offer", replace: "# Offer 2027" },
        { find: "The day rate is 1,800 euros.\n\nPayment within 30 days.", replace: "The day rate is 1,900 euros.\n\nPayment within 14 days.\nLate fees apply." },
      ],
    },
    (edited) => edited.replace("# Offer", "# Offer 2027").replace("The day rate is 1,800 euros.\n\nPayment within 30 days.", "The day rate is 1,900 euros.\n\nPayment within 14 days.\nLate fees apply."),
  ],
];

async function proposed(shape: string, args: Record<string, unknown>) {
  const vault = await gateVault({ "Projects/Offer.md": shape, ...NOTES_AROUND });
  const before = await vault.notes();
  const { s } = await gateSession([turn({ calls: [viaDispatch("c1", "propose_edit", { path: "Projects/Offer.md", ...args })] }), turn({ text: "Proposed." })], vault);
  expect(await s.send("Change the offer.")).toEqual({ kind: "answered" });
  return { vault, before, s };
}

describe("gate: nothing in a note differs that nobody accepted", () => {
  for (const [shapeName, shape] of SHAPES) {
    for (const [changeName, args, expected] of CHANGES) {
      it(`${shapeName}, ${changeName}: proposing writes no note, declining writes none, accepting writes exactly the passages`, async () => {
        const { vault, before, s } = await proposed(shape, args);
        // 1. The run is over, the model was told that something waits — and no note has another byte.
        expect(results(s.getState().active!).map((result) => result.isError ?? false)).toEqual([false]);
        expect(await vault.notes()).toEqual(before);
        const waiting = await vault.open("Projects/Offer.md");
        expect(waiting.length).toBeGreaterThan(0);

        // 2. Declined, the note is what it was — on a second vault, so the first can still accept.
        const other = await proposed(shape, args);
        await other.vault.decide("Projects/Offer.md", "declined");
        expect(await other.vault.notes()).toEqual(other.before);
        expect(await other.vault.open("Projects/Offer.md")).toEqual([]);

        // 3. Accepted, the note reads as asked for — in the file's own shape — and nothing else in the vault moved.
        await vault.decide("Projects/Offer.md", "applied");
        const { text: edited, shape: fileShape } = readTextShape(shape);
        const after = await vault.notes();
        expect(after["Projects/Offer.md"]).toBe(Buffer.from(applyTextShape(expected(edited), fileShape), "utf8").toString("latin1"));
        expect({ ...after, "Projects/Offer.md": "" }).toEqual({ ...before, "Projects/Offer.md": "" });
        expect(await vault.open("Projects/Offer.md")).toEqual([]);
      });
    }
  }

  it("a paragraph added to the end of a note leaves every byte that was there where it was", async () => {
    for (const [, shape] of SHAPES) {
      const { vault } = await proposed(shape, { append: "Valid until the end of the year." });
      await vault.decide("Projects/Offer.md", "applied");
      const disk = (await vault.disk("Projects/Offer.md"))!;
      const { text: edited, shape: fileShape } = readTextShape(shape);
      expect(disk.startsWith(applyTextShape(edited.trimEnd(), fileShape))).toBe(true);
      expect(readTextShape(disk).text.trimEnd().endsWith("\n\nValid until the end of the year.")).toBe(true);
      // No line end was written twice, and none in another form than the file's own.
      expect(disk.includes("\r\r")).toBe(false);
      expect(fileShape.eol === "\r\n" ? /[^\r]\n/.test(disk) : disk.includes("\r")).toBe(false);
    }
  });

  it("accepting one of two suggestions writes that one passage and leaves the other waiting", async () => {
    const { vault, before } = await proposed(OFFER, {
      edits: [
        { find: "1,800 euros", replace: "1,900 euros" },
        { find: "30 days", replace: "14 days" },
      ],
    });
    const both = await vault.open("Projects/Offer.md");
    expect(both).toHaveLength(2);
    // A block is the smallest change that says it: which words it stands on is read from the note, not guessed here.
    const edited = await vault.asEdited("Projects/Offer.md");
    const first = [...both].sort((a, b) => (a.anchor?.approximateOffset ?? 0) - (b.anchor?.approximateOffset ?? 0))[0]!;
    expect(first.anchor!.approximateOffset).toBeLessThan(edited.indexOf("Payment"));
    await vault.decide("Projects/Offer.md", "applied", (waiting) => waiting.filter((record) => record.commentId === first.commentId));
    expect(await vault.disk("Projects/Offer.md")).toBe(OFFER.replace("1,800 euros", "1,900 euros"));
    expect((await vault.open("Projects/Offer.md")).map((record) => record.commentId)).toEqual(both.filter((record) => record.commentId !== first.commentId).map((record) => record.commentId));
    expect({ ...(await vault.notes()), "Projects/Offer.md": "" }).toEqual({ ...before, "Projects/Offer.md": "" });
    // The other one is still what it was, and accepting it later lands on the note as it is by then.
    await vault.decide("Projects/Offer.md", "applied");
    expect(await vault.disk("Projects/Offer.md")).toBe(OFFER.replace("1,800 euros", "1,900 euros").replace("30 days", "14 days"));
  });
});

const RATE = { path: "Projects/Offer.md", edits: [{ find: "1,800 euros", replace: "1,900 euros" }] };
const proposeRate = () => [turn({ calls: [viaDispatch("c1", "propose_edit", RATE)] }), turn({ text: "Proposed." })];

describe("gate: the way back", () => {
  it("accepting keeps exactly what was there as a version — also seconds after a save, inside the snapshot interval", async () => {
    let clock = Date.parse("2026-10-08T10:00:00Z");
    const first = OFFER.replace(/\n/g, "\r\n");
    const vault = await gateVault({ "Projects/Offer.md": first }, { now: () => clock });
    // The user's own save a moment ago: the version history took its one snapshot for these minutes.
    const saved = first.replace("Anna", "Tom");
    await vault.backup.writeTextFile("Projects/Offer.md", saved);
    expect((await vault.versions("Projects/Offer.md")).map((version) => version.text)).toEqual([first]);
    clock += 5_000;
    const { s } = await gateSession(proposeRate(), vault);
    await s.send("Raise the day rate.");
    clock += 5_000;
    await vault.decide("Projects/Offer.md", "applied");
    const accepted = (await vault.disk("Projects/Offer.md"))!;
    expect(accepted).toBe(saved.replace("1,800 euros", "1,900 euros"));
    // Ten seconds after a save an ordinary write keeps nothing. This one kept the bytes it replaced.
    const kept = await vault.versions("Projects/Offer.md");
    expect(kept.map((version) => version.text)).toEqual([saved, first]);

    // Restored, the note is byte for byte what it was — and what was accepted is itself a version by then.
    clock += 5_000;
    await vault.restore("Projects/Offer.md", kept[0]!.backupPath);
    expect(await vault.disk("Projects/Offer.md")).toBe(saved);
    expect((await vault.versions("Projects/Offer.md")).map((version) => version.text)).toEqual([accepted, saved, first]);
  });

  it("an accept that cannot keep what it replaces stops before the note is touched — and goes through when it can", async () => {
    const vault = await gateVault({ "Projects/Offer.md": OFFER });
    const { s } = await gateSession(proposeRate(), vault);
    await s.send("Raise the day rate.");
    const full = vi.spyOn(vault.backup, "ensureSnapshot").mockRejectedValueOnce(new Error("no space left on device"));
    await expect(vault.decide("Projects/Offer.md", "applied")).rejects.toMatchObject({ reason: "storage", phase: "prepared" });
    expect(await vault.disk("Projects/Offer.md")).toBe(OFFER);
    expect(await vault.open("Projects/Offer.md")).toHaveLength(1);
    full.mockRestore();
    // The operation is still in the device's journal: tried again, it is the same one.
    const [stuck] = await vault.service.pending("Projects/Offer.md");
    expect((await vault.service.run(stuck!)).phase).toBe("completed");
    expect(await vault.disk("Projects/Offer.md")).toBe(OFFER.replace("1,800 euros", "1,900 euros"));
    expect((await vault.versions("Projects/Offer.md")).map((version) => version.text)).toEqual([OFFER]);
  });

  it("an accept right after a save that kept these very bytes adds no second copy of them", async () => {
    let clock = Date.parse("2026-10-08T10:00:00Z");
    const vault = await gateVault({ "Projects/Offer.md": OFFER }, { now: () => clock });
    const { s } = await gateSession(proposeRate(), vault);
    await s.send("Raise the day rate.");
    // The editor flushes before a decision: a save of what is there, and the history takes its snapshot of it.
    clock += 1_000;
    await vault.files.writeTextFile("Projects/Offer.md", OFFER);
    expect((await vault.versions("Projects/Offer.md")).map((version) => version.text)).toEqual([OFFER]);
    clock += 20;
    await vault.decide("Projects/Offer.md", "applied");
    expect(await vault.disk("Projects/Offer.md")).toBe(OFFER.replace("1,800 euros", "1,900 euros"));
    // One version of what the accept replaced — not two of the same bytes, milliseconds apart.
    expect((await vault.versions("Projects/Offer.md")).map((version) => version.text)).toEqual([OFFER]);
  });

  it("declining keeps no version: nothing was replaced", async () => {
    const vault = await gateVault({ "Projects/Offer.md": OFFER });
    const { s } = await gateSession(proposeRate(), vault);
    await s.send("Raise the day rate.");
    await vault.decide("Projects/Offer.md", "declined");
    expect(await vault.versions("Projects/Offer.md")).toEqual([]);
  });

  it("a draft that is created is one new file that says who wrote it; one that is discarded leaves nothing behind", async () => {
    const vault = await gateVault({ "Projects/Offer.md": OFFER });
    const before = await vault.notes();
    const script = [
      turn({
        calls: [
          viaDispatch("c1", "create_note", { title: "Kick-off", content: "Agenda\n\n- one" }),
          viaDispatch("c2", "create_note", { title: "Retro", content: "What went well" }),
        ],
      }),
      turn({ text: "Both wait as drafts." }),
    ];
    const { s } = await gateSession(script, vault);
    await s.send("Draft a kick-off note and a retro note.");
    // Drafted, nothing is in the vault — not as a note, and not as a file of Plainva's.
    expect(await vault.everything()).toEqual(before);
    const [kickoff, retro] = s.getState().drafts.drafts;
    expect([kickoff!.author.id, retro!.author.id]).toEqual(["plainva-ai/m-1", "plainva-ai/m-1"]);

    expect(await s.createDraft(kickoff!.id)).toEqual({ kind: "created", path: "Inbox/Kick-off.md" });
    await s.discardDraft(retro!.id);
    const after = await vault.notes();
    expect(Object.keys(after).sort()).toEqual(["Inbox/Kick-off.md", "Projects/Offer.md"]);
    expect(after["Projects/Offer.md"]).toBe(before["Projects/Offer.md"]);
    const note = (await vault.disk("Inbox/Kick-off.md"))!;
    expect(readFrontmatterPath(note, ["generated", "by"])).toBe("plainva-ai/m-1");
    expect(readFrontmatterPath(note, ["generated", "at"])).toBe("2026-10-08T10:00:00Z");
    expect(note.endsWith("# Kick-off\n\nAgenda\n\n- one\n")).toBe(true);
    expect(s.getState().drafts.done.map((outcome) => `${outcome.title}: ${outcome.outcome}`)).toEqual(["Kick-off: created", "Retro: discarded"]);
  });
});

describe("gate: a note that changed since the suggestion was made", () => {
  async function waiting() {
    const vault = await gateVault({ "Projects/Offer.md": OFFER });
    const { s } = await gateSession(proposeRate(), vault);
    await s.send("Raise the day rate.");
    return vault;
  }

  it("at the passage itself: the suggestion no longer fits, and accepting writes nothing", async () => {
    const vault = await waiting();
    const mine = OFFER.replace("1,800 euros", "2,000 dollars");
    await vault.raw.writeTextFile("Projects/Offer.md", mine);
    await expect(vault.decide("Projects/Offer.md", "applied")).rejects.toThrow("comment-suggestion-orphan");
    expect(await vault.disk("Projects/Offer.md")).toBe(mine);
    expect(await vault.open("Projects/Offer.md")).toHaveLength(1);
    expect(await vault.versions("Projects/Offer.md")).toEqual([]);
  });

  it("somewhere else: the suggestion lands on the note as it is now, and the other change stays", async () => {
    const vault = await waiting();
    const mine = OFFER.replace("30 days", "45 days").replace("# Offer", "# Offer for the studio");
    await vault.raw.writeTextFile("Projects/Offer.md", mine);
    await vault.decide("Projects/Offer.md", "applied");
    expect(await vault.disk("Projects/Offer.md")).toBe(mine.replace("1,800 euros", "1,900 euros"));
  });

  it("on disk, behind the editor's back: the decision is held for review instead of written over it", async () => {
    const vault = await waiting();
    // What the editor holds when "Accept" is pressed …
    const held = await vault.asEdited("Projects/Offer.md");
    const plan = planCommentDecision("Projects/Offer.md", held, await vault.open("Projects/Offer.md"), "applied");
    // … and what another program wrote in that moment.
    const theirs = OFFER.replace("30 days", "60 days");
    await vault.raw.writeTextFile("Projects/Offer.md", theirs);
    await expect(vault.service.run(await vault.service.prepare(plan))).rejects.toMatchObject({ reason: "needs-review" });
    expect(await vault.disk("Projects/Offer.md")).toBe(theirs);
    expect(await vault.versions("Projects/Offer.md")).toEqual([]);
  });

  it("on two devices: the round arrives with its author, and two different decisions end in a conflict that writes nothing more", async () => {
    const desk = await waiting();
    const phone = await gateVault({}, { beside: desk, device: "phone" });
    // The other device reads the suggestion from the first one's comments file — with who made it.
    const arrived = await phone.open("Projects/Offer.md");
    expect(arrived.map((record) => [record.authorMemberId, record.authorDeviceId])).toEqual([["plainva-ai/m-1", "desktop"]]);
    // What the desk sees before the other decision has reached it.
    const stale = await desk.open("Projects/Offer.md");
    await phone.decide("Projects/Offer.md", "applied");
    const accepted = OFFER.replace("1,800 euros", "1,900 euros");
    expect(await desk.disk("Projects/Offer.md")).toBe(accepted);
    await desk.service.run(await desk.service.prepare(planCommentDecision("Projects/Offer.md", await desk.asEdited("Projects/Offer.md"), stale, "declined")));
    // A decline writes no note. Both devices now read two decisions that contradict each other.
    expect(await desk.disk("Projects/Offer.md")).toBe(accepted);
    for (const device of [desk, phone]) {
      const [record] = (await device.records("Projects/Offer.md")).filter((candidate) => candidate.suggestion);
      expect(record!.suggestionDecision?.status).toBe("conflict");
      // Neither can decide it again by writing: a conflict is looked at, not applied.
      expect(() => planCommentDecision("Projects/Offer.md", accepted, [record!], "applied")).toThrow();
    }
    expect(await desk.disk("Projects/Offer.md")).toBe(accepted);
  });
});

describe("gate: the way to the other devices", () => {
  it("what is accepted is queued for sync as one write of that note — proposing and declining queue no note", async () => {
    const vault = await gateVault({ "Projects/Offer.md": OFFER, ...NOTES_AROUND });
    const { s } = await gateSession(
      [
        turn({ calls: [viaDispatch("c1", "propose_edit", RATE), viaDispatch("c2", "create_note", { title: "Kick-off", content: "Agenda" })] }),
        turn({ text: "Proposed and drafted." }),
        turn({ calls: [viaDispatch("c3", "propose_edit", { path: "Projects/Offer.md", edits: [{ find: "30 days", replace: "14 days" }] })] }),
        turn({ text: "Proposed." }),
      ],
      vault,
    );
    await s.send("Raise the day rate and draft a kick-off note.");
    // A suggestion and a draft are nothing another device has to fetch as a note.
    expect(await vault.queued()).toEqual([]);
    await vault.decide("Projects/Offer.md", "declined");
    expect(await vault.queued()).toEqual([]);
    await s.send("Then shorten the payment term.");
    await vault.decide("Projects/Offer.md", "applied");
    // Accepted: the note goes out as the one write it was — through the same queue as a save in the editor.
    expect(await vault.queued()).toEqual(["write Projects/Offer.md"]);
    // A draft that is created is a new note like any other, and goes the same way.
    await s.createDraft(s.getState().drafts.drafts[0]!.id);
    expect(await vault.queued()).toEqual(["write Projects/Offer.md", "write Inbox/Kick-off.md"]);
  });

  it("a note that was changed outside since it was last synced keeps both: the outside change and the accepted passage — and no copy of it is left beside it", async () => {
    const vault = await gateVault({ "Projects/Offer.md": OFFER });
    await vault.synced("Projects/Offer.md");
    const { s } = await gateSession(proposeRate(), vault);
    await s.send("Raise the day rate.");
    // Another program wrote into the file after the last sync; the editor has taken that in.
    const theirs = `${OFFER}\nAdded by another program.\n`;
    await vault.raw.writeTextFile("Projects/Offer.md", theirs);
    const done = await vault.decide("Projects/Offer.md", "applied");
    expect(done.phase).toBe("completed");
    // The conflict guard saw a file that is not what was synced, and what it wrote is the note with both changes.
    expect(await vault.disk("Projects/Offer.md")).toBe(theirs.replace("1,800 euros", "1,900 euros"));
    expect(Object.keys(await vault.notes())).toEqual(["Projects/Offer.md"]);
    expect(await vault.files.listConflictSessions()).toEqual([]);
    expect(await vault.queued()).toEqual(["write Projects/Offer.md"]);
    // What the accept replaced — the file with the outside change — is the version that was kept.
    expect((await vault.versions("Projects/Offer.md")).map((version) => version.text)).toEqual([theirs]);
  });

  it("a rename and a deletion the user said yes to go out as what they are", async () => {
    const vault = await gateVault({ "Projects/Offer.md": OFFER, ...NOTES_AROUND }, { confirmDelete: true });
    const { s } = await gateSession(
      [turn({ calls: [viaDispatch("c1", "rename_note", { path: "Projects/Offer.md", title: "Offer 2027" })] }), turn({ calls: [viaDispatch("c2", "delete_note", { path: "Projects/Table.md" })] }), turn({ text: "Done." })],
      vault,
    );
    answering(s, () => "once");
    await s.send("Rename the offer and delete the table.");
    expect(vault.acts).toEqual(["rename Projects/Offer.md -> Projects/Offer 2027.md", "delete dialog Projects/Table.md"]);
    expect(await vault.queued()).toEqual(["rename Projects/Offer.md -> Projects/Offer 2027.md", "delete Projects/Table.md"]);
    // The renamed note is the same bytes under its new name: a rename rewrites nothing.
    expect(await vault.disk("Projects/Offer 2027.md")).toBe(OFFER);
    // The deleted note's last text is kept: a deletion always snapshots what it removes.
    expect(await vault.exists("Projects/Table.md")).toBe(false);
    expect((await vault.versions("Projects/Table.md")).map((version) => version.text)).toEqual([NOTES_AROUND["Projects/Table.md"]]);
  });
});

describe("gate: nothing happens that nobody decided", () => {
  const EVERYTHING = [
    viaDispatch("c1", "propose_edit", RATE),
    viaDispatch("c2", "set_property", { path: "Projects/Offer.md", key: "stage", value: "won" }),
    viaDispatch("c3", "set_property", { path: "Projects/Offer.md", key: "verified", value: "Anna" }),
    viaDispatch("c4", "create_note", { title: "Kick-off", content: "Agenda" }),
    viaDispatch("c5", "create_note", { title: "Forged", content: "---\nverified:\n  by: Anna\n---\nText" }),
    viaDispatch("c6", "rename_note", { path: "Projects/Offer.md", title: "Offer 2027" }),
    viaDispatch("c7", "move_note", { path: "Projects/Brief.md", folder: "" }),
    viaDispatch("c8", "delete_note", { path: "Projects/Table.md" }),
    viaDispatch("c9", "draft_mail", { to: ["someone@example.org"], subject: "The offer", body: "The day rate is 1,800 euros." }),
  ];

  it("a model that asks for everything changes no note: what it laid down waits, every plan was a question, and no was no", async () => {
    const vault = await gateVault({ "Projects/Offer.md": OFFER, ...NOTES_AROUND });
    const before = await vault.notes();
    const { s } = await gateSession([turn({ calls: EVERYTHING }), turn({ text: "I asked for all of it." })], vault);
    const asked = answering(s, () => "deny");
    expect(await s.send("Do whatever you can.")).toEqual({ kind: "answered" });

    expect(await vault.notes()).toEqual(before);
    expect(vault.acts).toEqual([]);
    expect(vault.created).toEqual([]);
    // The three plans were asked about, one after the other, and nothing else was.
    expect(asked.map((effect) => (effect.kind === "plan" ? effect.question.plan : effect.kind))).toEqual(["rename", "move", "delete"]);
    const said = results(s.getState().active!).map((result) => result.content);
    expect(said).toEqual([
      WRITE_RESULTS.proposed("Projects/Offer.md", 1, 0),
      WRITE_RESULTS.proposedProperty("Projects/Offer.md", "stage", false, 0),
      WRITE_REFUSALS.trust,
      WRITE_RESULTS.drafted('a note "Kick-off"', 0),
      WRITE_REFUSALS.frontmatter,
      EFFECT_DECLINED,
      EFFECT_DECLINED,
      EFFECT_DECLINED,
      // This vault has no mail account: there is no such tool here at all.
      'No tool "draft_mail" can be called here. find_tools lists what there is.',
    ]);
    // What waits: one round on the note — a passage and a value —, and one draft on this device.
    const waiting = await vault.open("Projects/Offer.md");
    expect(waiting).toHaveLength(2);
    expect(new Set(waiting.map((record) => record.authorMemberId))).toEqual(new Set(["plainva-ai/m-1"]));
    expect(s.getState().drafts.drafts.map((draft) => draft.title)).toEqual(["Kick-off"]);
    // The only files that are new are the vault's comments.
    const added = Object.keys(await vault.everything()).filter((path) => !(path in before));
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((path) => path.startsWith(".plainva/"))).toBe(true);
  });

  it("a yes to a rename and a move is carried out by the app, and the note is the same bytes under its new name", async () => {
    const vault = await gateVault({ "Projects/Offer.md": OFFER, ...NOTES_AROUND });
    const { s } = await gateSession(
      [turn({ calls: [viaDispatch("c1", "rename_note", { path: "Projects/Offer.md", title: "Offer 2027" })] }), turn({ calls: [viaDispatch("c2", "move_note", { path: "Projects/Offer 2027.md", folder: "" })] }), turn({ text: "Done." })],
      vault,
    );
    answering(s, () => "once");
    await s.send("Rename the offer and move it to the top.");
    expect(vault.acts).toEqual(["rename Projects/Offer.md -> Projects/Offer 2027.md", "move Projects/Offer 2027.md -> Offer 2027.md"]);
    expect(await vault.disk("Offer 2027.md")).toBe(OFFER);
    expect(await vault.exists("Projects/Offer.md")).toBe(false);
  });

  it("a yes to a deletion only opens the app's own dialog: said no there, the note is still there", async () => {
    const vault = await gateVault({ "Projects/Offer.md": OFFER }, { confirmDelete: false });
    const { s } = await gateSession([turn({ calls: [viaDispatch("c1", "delete_note", { path: "Projects/Offer.md" })] }), turn({ text: "It is still there." })], vault);
    answering(s, () => "once");
    await s.send("Delete the offer.");
    expect(vault.acts).toEqual(["delete dialog Projects/Offer.md"]);
    expect(await vault.disk("Projects/Offer.md")).toBe(OFFER);
  });
});

describe("gate: what a text claims to rest on", () => {
  it("a link to a note the vault does not have is laid down as it is — and said: to the model, with the run, and on the draft", async () => {
    const vault = await gateVault({ "Projects/Offer.md": OFFER, ...NOTES_AROUND });
    const script = [
      turn({
        calls: [
          viaDispatch("c1", "propose_edit", { path: "Projects/Offer.md", append: "As agreed in [[Brief]] and in [[Contract 2025]]." }),
          viaDispatch("c2", "create_note", { title: "Kick-off", content: "See [[Offer]] and [[Board meeting]]." }),
        ],
      }),
      turn({ text: "Proposed and drafted." }),
    ];
    const { s } = await gateSession(script, vault);
    await s.send("Add the references.");
    expect(results(s.getState().active!).map((result) => result.content)).toEqual([
      WRITE_RESULTS.proposed("Projects/Offer.md", 1, 0, ["Contract 2025"]),
      WRITE_RESULTS.drafted('a note "Kick-off"', 0, ["Board meeting"]),
    ]);
    expect(s.getState().active!.runs[0]!.writes!.rounds).toEqual([{ path: "Projects/Offer.md", blocks: 1, properties: 0, missing: ["Contract 2025"] }]);
    expect(s.getState().drafts.drafts.map((draft) => draft.missing)).toEqual([["Board meeting"]]);
    // The user decides with that knowledge; accepted, the text is exactly the text that was shown.
    await vault.decide("Projects/Offer.md", "applied");
    expect(await vault.disk("Projects/Offer.md")).toBe(`${OFFER.trimEnd()}\n\nAs agreed in [[Brief]] and in [[Contract 2025]].\n`);
  });

  it("a note kept from the cloud is as absent as one that does not exist — for a cloud model; the user reads which it is, and a model on this device may know it", async () => {
    const kept = "---\nplainva:\n  ai:\n    cloud: deny\n---\n# Salaries\n\nNever to a cloud.\n";
    const notes = { "Projects/Offer.md": OFFER, "Projects/Salaries.md": kept, "Private/Client.md": "# Client\n" };
    const edit = [turn({ calls: [viaDispatch("c1", "propose_edit", { path: "Projects/Offer.md", append: "See [[Salaries]], [[Client]] and [[Nobody]]." })] }), turn({ text: "Proposed." })];
    const policy = "folders:\n  Private/:\n    cloud: deny\n";
    // The note's own rule and the folder's rule both read as "not there": a name is not found out by trying it.
    const cloud = await gateSession(edit, await gateVault(notes, { policy }));
    await cloud.s.send("Add the references.");
    const [told] = results(cloud.s.getState().active!).map((result) => result.content);
    expect(told).toBe(WRITE_RESULTS.proposed("Projects/Offer.md", 1, 0, ["Salaries", "Client", "Nobody"]));
    // One sentence for all three, in the words of a read: nothing in it sorts a kept note from a made-up one.
    expect(told).toContain("not available here: [[Salaries]], [[Client]], [[Nobody]].");
    // Everything the provider was sent in this conversation says that sentence and no more: not the words the
    // user reads about the two notes, and nothing of the kept note itself.
    const sent = JSON.stringify(cloud.fake.sent);
    expect(sent).toContain("not available here: [[Salaries]], [[Client]], [[Nobody]].");
    expect(sent).not.toMatch(/may not read|Never to a cloud/);
    // The user, whose vault it is, reads the difference on this device: two notes are there and were kept back, one is nobody's.
    expect(cloud.s.getState().active!.runs[0]!.writes!.rounds).toEqual([{ path: "Projects/Offer.md", blocks: 1, properties: 0, missing: ["Nobody"], withheld: ["Salaries", "Client"] }]);
    const here = await gateSession(
      [chat({ calls: [viaDispatch("c1", "propose_edit", { path: "Projects/Offer.md", append: "See [[Salaries]] and [[Client]]." })] }), chat({ text: "Proposed." })],
      await gateVault(notes, { policy }),
      LOCAL,
    );
    await here.s.send("Add the references.");
    expect(results(here.s.getState().active!).map((result) => result.content)).toEqual([WRITE_RESULTS.proposed("Projects/Offer.md", 1, 0)]);
    expect(here.s.getState().active!.runs[0]!.writes!.rounds).toEqual([{ path: "Projects/Offer.md", blocks: 1, properties: 0 }]);
  });

  it("the sources of a note made from a draft are what the run read — never a list the model wrote", async () => {
    const vault = await gateVault({ "Projects/Offer.md": OFFER, ...NOTES_AROUND });
    const script = [
      turn({ calls: [{ id: "c1", name: "read_note", args: { path: "Projects/Brief.md" } }] }),
      turn({ calls: [viaDispatch("c2", "create_note", { title: "Summary", content: "The brief is short.\n\nSources: [[Offer]], https://made-up.example/report" })] }),
      turn({ text: "Drafted." }),
    ];
    const { s } = await gateSession(script, vault);
    await s.send("Summarise the brief.");
    const [summary] = s.getState().drafts.drafts;
    expect(summary!.sources).toEqual([{ resource: "Projects/Brief.md" }]);
    await s.createDraft(summary!.id);
    const note = (await vault.disk("Inbox/Summary.md"))!;
    expect(readFrontmatterPath(note, ["sources"])).toEqual([{ resource: "Projects/Brief.md" }]);
    // The address the model brought is text, not a link anybody could follow.
    expect(note).not.toMatch(/\]\(https?:|<https?:/);
    expect(note).toContain("https[://]made-up.example/report");
  });
});

describe("gate: a program at Plainva's MCP server", () => {
  async function paired(vault: GateVault) {
    const { s } = await gateSession([], vault);
    const plans = new McpPlans();
    let n = 0;
    const call = (tool: string, args: unknown, over: Record<string, unknown> = {}) =>
      runMcpCall(vault.host, { requestId: `r${++n}`, clientId: "c1", client: "Test client", tool, args, folders: ["Projects"], writes: true, ...over }, { session: s, plans, left: () => {}, waitMs: 10 });
    return { s, plans, call };
  }

  it("a change it proposes is a suggestion signed with its id; the note has no other byte until someone accepts", async () => {
    const vault = await gateVault({ "Projects/Offer.md": OFFER.replace(/\n/g, "\r\n") });
    const before = await vault.notes();
    const { call } = await paired(vault);
    expect(await call("propose_edit", RATE)).toMatchObject({ content: WRITE_RESULTS.proposed("Projects/Offer.md", 1, 0), isError: false });
    expect(await vault.notes()).toEqual(before);
    const [record] = await vault.open("Projects/Offer.md");
    expect(record!.authorMemberId).toBe(mcpAuthorId("c1"));
    await vault.decide("Projects/Offer.md", "applied");
    expect(await vault.disk("Projects/Offer.md")).toBe(OFFER.replace("1,800 euros", "1,900 euros").replace(/\n/g, "\r\n"));
  });

  it("a rename reaches the vault only after a yes in Plainva AND the program coming back — claiming an answer does nothing", async () => {
    const vault = await gateVault({ "Projects/Offer.md": OFFER });
    const before = await vault.notes();
    const { plans, call } = await paired(vault);
    const RENAME = { path: "Projects/Offer.md", title: "Offer 2027" };
    const first = await call("rename_note", RENAME);
    const handle = first.pending!.handle;
    // The program says its user agreed. Nobody did, in Plainva.
    await call("rename_note", RENAME, { handle, answer: "accept" });
    // … and a program that makes up a handle of its own names a plan that is not there.
    await call("rename_note", RENAME, { handle: "A".repeat(32), answer: "accept" });
    expect(vault.acts).toEqual([]);
    expect(await vault.notes()).toEqual(before);
    // The user's yes alone carries nothing out either: the program has to come back for it.
    plans.decide(handle, "yes");
    expect(vault.acts).toEqual([]);
    expect((await call("rename_note", RENAME, { handle, answer: "accept" })).content).toBe(WRITE_RESULTS.renamed("Projects/Offer 2027.md"));
    expect(vault.acts).toEqual(["rename Projects/Offer.md -> Projects/Offer 2027.md"]);
    expect(await vault.disk("Projects/Offer 2027.md")).toBe(OFFER);
  });

  it("a program without the grant to propose has no tool that writes", async () => {
    const vault = await gateVault({ "Projects/Offer.md": OFFER });
    const before = await vault.everything();
    const { call } = await paired(vault);
    expect(await call("propose_edit", RATE, { writes: false })).toMatchObject({ isError: true, content: "There is no tool called propose_edit." });
    expect(await call("delete_note", { path: "Projects/Offer.md" }, { writes: false })).toMatchObject({ isError: true });
    expect(await vault.everything()).toEqual(before);
  });
});

describe("gate: an external agent", () => {
  const AGENT = "helper";
  const access = (vault: GateVault): AcpVaultAccess => ({
    root: vault.root,
    read: vault.disk,
    list: async () => [],
    policyOf: (path, text) => vault.host.policy.policyOf(path, text ?? ""),
    propose: (round) => proposeSuggestionRound(vault.service, round),
    encrypted: () => false,
  });
  const texts = { note: "Proposed by the agent.", defused: "Addresses were made inert.", author: "Helper (agent)" };

  it("a file it hands back becomes a round on the note; the file changes when the round is accepted, in its own shape", async () => {
    const onDisk = `${BOM}${OFFER.replace(/\n/g, "\r\n")}`;
    const vault = await gateVault({ "Projects/Offer.md": onDisk });
    const before = await vault.notes();
    // The agent read the file, changed a sentence, and wrote the whole file back — with the line ends its own tools use.
    const written = OFFER.replace("1,800 euros", "1,900 euros");
    const plan = await acpPlanNoteWrite(access(vault), AGENT, "Projects/Offer.md", true, written);
    expect(plan.kind).toBe("round");
    if (plan.kind !== "round") return;
    // One sentence changed: one block — not every line of a file whose line ends differ.
    expect(plan.chunks).toHaveLength(1);
    await acpProposeRound(access(vault), AGENT, plan, texts);
    expect(await vault.notes()).toEqual(before);
    const [record] = await vault.open("Projects/Offer.md");
    expect(record!.authorMemberId).toBe(acpAuthorId(AGENT));
    await vault.decide("Projects/Offer.md", "applied");
    expect(await vault.disk("Projects/Offer.md")).toBe(onDisk.replace("1,800 euros", "1,900 euros"));
  });

  it("a file it hands back as it was — only with other line ends — is no change at all", async () => {
    const vault = await gateVault({ "Projects/Offer.md": OFFER.replace(/\n/g, "\r\n") });
    expect(await acpPlanNoteWrite(access(vault), AGENT, "Projects/Offer.md", true, OFFER)).toEqual({ kind: "unchanged", path: "Projects/Offer.md" });
    expect(await vault.open("Projects/Offer.md")).toEqual([]);
  });
});
