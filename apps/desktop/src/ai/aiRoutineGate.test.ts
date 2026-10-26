import { describe, expect, it } from "vitest";
import { ROUTINE_RUN_LIMITS, routineTools, type EgressChunk } from "@plainva/core";
import { CLOUD, LOCAL, chat, turn } from "./mcpSessionHarness";
import { at, ownSkill, routineSession, routineVault, toolNames } from "./routineSessionHarness";

/**
 * The gate of plan KI-Harness P8 (ADR 0033): a run nobody watches fails
 * closed. A routine carries the tools that read and nothing else; it never
 * shows a send overview and never asks a question; where it would need a yes
 * — more would go than was confirmed, the device asks before every request,
 * its skill is not what was confirmed, its model is not on a device that is
 * fully local — it ends without sending and says what it needs. And it runs
 * beside the conversation on screen without touching it.
 *
 * The session is the real one, the vault's host the one both shells build;
 * the model is scripted and the clock is the test's.
 */

const NOTES = {
  "Projects/Offer.md": "# Offer\n\nFor Northwind, due on Friday.",
  "Journal/2026-10-08.md": "# Thursday\n\nCalled the studio.",
};
const BRIEF = "Today: the offer for Northwind is due [[Offer]].";
const NEVER = ["run_command", "open_in_app", "find_tools", "call_tool", "use_skill", "fetch_url", "web_search", "propose_edit", "set_property", "create_note", "create_task", "add_journal_entry", "create_entry", "remember", "forget", "draft_mail", "draft_event", "rename_note", "move_note", "delete_note"];
const routineOf = (h: Awaited<ReturnType<typeof routineSession>>, name = "Morning brief") => h.s.getState().routines.list.find((routine) => routine.name === name)!;
const titles = (h: Awaited<ReturnType<typeof routineSession>>) => h.s.getState().summaries.map((summary) => summary.title);

describe("setting a routine up", () => {
  it("shows what a run would send — put together like a run, and not sent", async () => {
    const vault = routineVault(NOTES);
    vault.touch("Projects/Offer.md", NOTES["Projects/Offer.md"], at(8, 18).getTime());
    const h = await routineSession([], vault);
    const outcome = await h.s.routinePreview({ name: "Morning brief", skill: "plainva:daily-orientation", request: "", days: [1, 2, 3, 4, 5], time: "07:00", missed: "catch-up", onlyWhenChanged: false, choice: CLOUD });
    expect(outcome.kind).toBe("preview");
    if (outcome.kind !== "preview") return;
    const { preview } = outcome;
    expect(h.sent).toEqual([]);
    expect(h.overviews).toEqual([]);
    expect(preview).toMatchObject({ provider: "Anthropic", model: "m-1", here: false, folder: "Inbox", noteTitle: "Morning brief – 2026-10-09", shared: false, everyRequest: false, noMail: false, growth: [] });
    expect(preview.limits).toEqual(ROUTINE_RUN_LIMITS);
    // What it may carry: tools that read — the ones its skill names, where this vault serves them.
    expect(preview.manifest.tools.length).toBeGreaterThan(0);
    expect(routineTools(preview.manifest.tools)).toEqual(preview.manifest.tools);
    for (const name of NEVER) expect(preview.manifest.tools, name).not.toContain(name);
    expect(preview.manifest.more ?? []).toEqual([]);
    expect(preview.manifest.web).toBe(false);
    // The note that changed lately is what a run would bring along today.
    expect(preview.manifest.folders).toEqual(["Projects"]);
    // Nothing exists before the yes.
    expect(h.s.getState().routines.list).toEqual([]);
    expect(vault.stored()).toBeNull();
    expect(h.s.getState().summaries).toEqual([]);
  });

  it("confirms for a provider's model exactly what was shown, and nothing for a model on this device", async () => {
    const vault = routineVault(NOTES);
    vault.touch("Projects/Offer.md", NOTES["Projects/Offer.md"], at(8, 18).getTime());
    const h = await routineSession([], vault);
    const cloud = await h.setUp({ name: "Brief" });
    expect(cloud.routine.scope).toMatchObject({ recipients: ["anthropic/m-1"], folders: ["Projects"], web: false, tools: cloud.preview.manifest.tools });
    expect(cloud.routine.skillHash).toBe("plainva");
    const local = await h.setUp({ name: "Brief here", choice: LOCAL });
    expect(local.preview.here).toBe(true);
    expect(local.routine.scope).toBeNull();
    // Kept in the app's data for this vault on this device — never in the vault, which every device syncs.
    expect((vault.stored() as { routines: unknown[] }).routines).toHaveLength(2);
    expect([...vault.disk.keys()].sort()).toEqual(Object.keys(NOTES).sort());
    expect(h.sent).toEqual([]);
  });

  it("offers no skill that does more than read, none that is not active, and no provider's model while the device is fully local", async () => {
    const vault = routineVault({ ...NOTES, ".agent/skills/lookback/SKILL.md": ownSkill("lookback") });
    const h = await routineSession([], vault);
    const draft = { name: "X", request: "", days: [1] as const, time: "07:00", missed: "catch-up" as const, onlyWhenChanged: false, choice: CLOUD };
    // Research names the tools of the internet; memory care writes the memory.
    expect(await h.s.routinePreview({ ...draft, skill: "plainva:research" })).toEqual({ kind: "refused", reason: "skill" });
    expect(await h.s.routinePreview({ ...draft, skill: "plainva:memory-care" })).toEqual({ kind: "refused", reason: "skill" });
    // The vault's own skill arrived and nobody approved it on this device.
    expect(await h.s.routinePreview({ ...draft, skill: ".agent/skills/lookback" })).toEqual({ kind: "refused", reason: "skill" });
    expect(await h.s.routinePreview({ ...draft, skill: "plainva:no-such-skill" })).toEqual({ kind: "refused", reason: "skill" });
    expect(await h.s.routinePreview({ ...draft, skill: "plainva:daily-orientation", choice: { providerId: "gone", model: "m" } })).toEqual({ kind: "refused", reason: "model" });
    await h.s.updateSettings((settings) => ({ ...settings, localOnly: true }));
    expect(await h.s.routinePreview({ ...draft, skill: "plainva:daily-orientation" })).toEqual({ kind: "refused", reason: "local" });
    expect((await h.s.routinePreview({ ...draft, skill: "plainva:daily-orientation", choice: LOCAL })).kind).toBe("preview");
    expect(h.sent).toEqual([]);
  });

  it("stores nothing for a confirmation that belongs to another draft", async () => {
    const h = await routineSession([], routineVault(NOTES));
    const draft = { name: "Brief", skill: "plainva:daily-orientation", request: "", days: [1] as const, time: "07:00", missed: "catch-up" as const, onlyWhenChanged: false, choice: CLOUD };
    const shown = await h.s.routinePreview(draft);
    if (shown.kind !== "preview") throw new Error("no confirmation");
    expect(await h.s.saveRoutine({ ...draft, choice: { providerId: "anthropic", model: "m-2" } }, shown.preview)).toBe("failed");
    expect(await h.s.saveRoutine({ ...draft, skill: "plainva:weekly-review" }, shown.preview)).toBe("failed");
    expect(await h.s.saveRoutine({ ...draft, name: " " }, shown.preview)).toBe("failed");
    expect(h.s.getState().routines.list).toEqual([]);
    expect(await h.s.saveRoutine(draft, shown.preview)).toBe("saved");
  });
});

describe("a run nobody watches", () => {
  it("runs at its time beside the conversation on screen, carries only tools that read, and leaves a note", async () => {
    const vault = routineVault(NOTES);
    const h = await routineSession([chat({ text: "Hello." }), chat({ text: BRIEF })], vault, { model: LOCAL });
    await h.setUp();
    // The user is in a conversation of their own.
    expect(await h.s.send("Hello?")).toEqual({ kind: "answered" });
    const open = h.s.getState().active!;
    expect(await h.s.runDueRoutines()).toBe(0); // six o'clock: not yet
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);

    // It asked nobody anything, and the conversation on screen is as it was.
    expect(h.overviews).toEqual([]);
    const state = h.s.getState();
    expect(state.active).toEqual(open);
    expect(state.live).toBeNull();
    expect(state.notice).toBeNull();
    expect(state.consent).toBeNull();
    expect(state.effect).toBeNull();
    expect(state.routines.running).toBeNull();

    // What the model was offered: tools that read, the ones the skill names.
    const tools = toolNames(h.sent[1]);
    expect(tools.length).toBeGreaterThan(0);
    expect(routineTools(tools)).toEqual(tools);
    for (const name of NEVER) expect(tools, name).not.toContain(name);

    // The result: a note in the inbox, called after the routine and the day, stamped as the model's.
    expect(vault.kept).toEqual(["Inbox/Morning brief – 2026-10-09.md"]);
    const note = vault.file("Inbox/Morning brief – 2026-10-09.md")!;
    expect(note).toContain(BRIEF);
    expect(note).toMatch(/generated:\s*\n\s+by: "?plainva-ai\/granite3\.3:8b/);
    const routine = routineOf(h);
    expect(routine.last).toMatchObject({ scheduledFor: "2026-10-09T07:00", outcome: "answered", note: "Inbox/Morning brief – 2026-10-09.md", noteTitle: "Morning brief – 2026-10-09" });
    expect(routine.answeredAt).toBe(routine.last!.at);
    expect(state.routines.ready).toEqual({ id: routine.id, name: "Morning brief", note: "Inbox/Morning brief – 2026-10-09.md", title: "Morning brief – 2026-10-09" });
    // Its conversation is in the history, under the routine's name.
    expect(titles(h)).toContain("Routine: Morning brief");
    expect(routine.conversationId).toBe(state.summaries.find((summary) => summary.title === "Routine: Morning brief")!.id);
  });

  it("runs once for a moment, catches up once however many were missed, and keeps one conversation per routine", async () => {
    const vault = routineVault(NOTES);
    const h = await routineSession([chat({ text: "Friday." }), chat({ text: "Wednesday." })], vault, { model: LOCAL });
    await h.setUp();
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(await h.s.runDueRoutines()).toBe(0);
    h.go(at(9, 23, 59));
    expect(await h.s.runDueRoutines()).toBe(0);
    // Closed until Wednesday noon: Monday's, Tuesday's and Wednesday's moments passed — one run, for the latest.
    h.go(at(14, 12, 0));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(await h.s.runDueRoutines()).toBe(0);
    expect(h.sent).toHaveLength(2);
    expect(routineOf(h).last).toMatchObject({ scheduledFor: "2026-10-14T07:00", outcome: "answered" });
    expect(vault.kept).toEqual(["Inbox/Morning brief – 2026-10-09.md", "Inbox/Morning brief – 2026-10-14.md"]);
    expect(titles(h).filter((title) => title === "Routine: Morning brief")).toHaveLength(1);
  });

  it("keeps its note and moves on to its new conversation where the previous one cannot be deleted", async () => {
    const vault = routineVault(NOTES);
    const h = await routineSession([chat({ text: "Friday." }), chat({ text: "Wednesday." })], vault, { model: LOCAL });
    await h.setUp();
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    const previous = routineOf(h).conversationId!;
    // From now on the store refuses to delete anything (step 8).
    vault.host.conversations.remove = async () => {
      throw new Error("locked");
    };
    h.go(at(14, 12, 0));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(routineOf(h).last).toMatchObject({ scheduledFor: "2026-10-14T07:00", outcome: "answered" });
    expect(vault.kept).toEqual(["Inbox/Morning brief – 2026-10-09.md", "Inbox/Morning brief – 2026-10-14.md"]);
    expect([routineOf(h).conversationId === previous, h.s.getState().summaries.some((summary) => summary.id === previous)]).toEqual([false, true]);
  });

  // What the user did with the previous run's conversation makes it theirs (strand 6, step 9).
  const wentOn: [string, (h: Awaited<ReturnType<typeof routineSession>>, id: string) => Promise<void>][] = [
    [
      "a message",
      async (h, id) => {
        await h.s.open(id);
        await h.s.send("And on Friday?");
        h.s.newConversation();
      },
    ],
    ["a title", (h, id) => h.s.rename(id, "Kept brief")],
    [
      "a pin",
      async (h, id) => {
        await h.s.open(id);
        await h.s.pin("Projects/Offer.md");
        h.s.newConversation();
      },
    ],
    [
      "a redaction",
      async (h, id) => {
        await h.s.open(id);
        await h.s.toggleRedact("Projects/Offer.md");
        h.s.newConversation();
      },
    ],
    [
      "another model",
      async (h, id) => {
        await h.s.open(id);
        await h.s.setChoice(CLOUD);
        h.s.newConversation();
      },
    ],
    [
      "another model of the same provider",
      async (h, id) => {
        await h.s.open(id);
        await h.s.setChoice({ providerId: LOCAL.providerId, model: "granite3.3:2b" });
        h.s.newConversation();
      },
    ],
    [
      "the same model through another provider",
      async (h, id) => {
        await h.s.open(id);
        await h.s.setChoice({ providerId: CLOUD.providerId, model: LOCAL.model });
        h.s.newConversation();
      },
    ],
  ];
  /** Opens a conversation and sends into it, as the user would: an overview that comes is approved. */
  const goOnWith = async (h: Awaited<ReturnType<typeof routineSession>>, id: string) => {
    h.s.subscribe(() => {
      if (h.s.getState().consent) h.s.answerConsent(true);
    });
    await h.s.open(id);
    return h.s.send("Anything else?");
  };
  for (const [what, step] of wentOn) {
    it(`keeps the previous run's conversation where the user went on with it: ${what}`, async () => {
      const vault = routineVault(NOTES);
      const h = await routineSession([chat({ text: "Friday." }), chat({ text: "Thursday too." }), chat({ text: "Wednesday." }), chat({ text: "Also." })], vault, { model: LOCAL });
      await h.setUp();
      h.go(at(9, 7, 1));
      expect(await h.s.runDueRoutines()).toBe(1);
      const previous = routineOf(h).conversationId!;
      await step(h, previous);
      h.go(at(14, 12, 0));
      expect(await h.s.runDueRoutines()).toBe(1);
      expect([routineOf(h).conversationId === previous, h.s.getState().summaries.some((summary) => summary.id === previous)]).toEqual([false, true]);
      // Nothing about it is being deleted any more: their next message goes (one for a model of another kind is
      // refused by what the conversation was begun for, ADR 0018 — not by a deletion, which sends nothing at all).
      expect(await goOnWith(h, previous)).not.toBeNull();
    });
  }

  it("keeps the previous run's conversation that is on screen when the next run ends", async () => {
    const vault = routineVault(NOTES);
    const h = await routineSession([chat({ text: "Friday." }), chat({ text: "Wednesday." })], vault, { model: LOCAL });
    await h.setUp();
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    const previous = routineOf(h).conversationId!;
    await h.s.open(previous);
    h.go(at(14, 12, 0));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect([h.s.getState().active?.id, h.s.getState().summaries.some((summary) => summary.id === previous)]).toEqual([previous, true]);
  });

  /** Holds the next reading of a conversation until the test lets it go; `reading` once it was asked for. */
  const heldReading = (vault: ReturnType<typeof routineVault>, id: string) => {
    const load = vault.host.conversations.load.bind(vault.host.conversations);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const reading = new Promise<void>((resolve) => (reached = resolve));
    let first = true;
    vault.host.conversations.load = async (asked) => {
      if (first && asked === id) {
        first = false;
        reached();
        await gate;
      }
      return load(asked);
    };
    return { reading, release };
  };

  it("keeps the previous run's conversation the user pinned a note in while its turn came, and then left", async () => {
    const vault = routineVault(NOTES);
    const h = await routineSession([chat({ text: "Friday." }), chat({ text: "Wednesday." })], vault, { model: LOCAL });
    await h.setUp();
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    const previous = routineOf(h).conversationId!;
    await h.s.open(previous);
    // The next run's deletion reads it slowly; meanwhile the user pins a note in it and goes elsewhere (step 9).
    const hold = heldReading(vault, previous);
    h.go(at(14, 12, 0));
    const due = h.s.runDueRoutines();
    await hold.reading;
    const pinning = h.s.pin("Projects/Offer.md");
    h.s.newConversation();
    hold.release();
    await Promise.all([pinning, due]);
    expect(h.s.getState().summaries.some((summary) => summary.id === previous)).toBe(true);
    expect((await vault.host.conversations.load(previous))?.pins).toEqual(["Projects/Offer.md"]);
  });

  it("keeps the previous run's conversation the user pinned a note in while its deletion waited its turn, and then left", async () => {
    const vault = routineVault(NOTES);
    const h = await routineSession([chat({ text: "Friday." }), chat({ text: "Wednesday." })], vault, { model: LOCAL });
    await h.setUp();
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    const previous = routineOf(h).conversationId!;
    await h.s.open(previous);
    // A write of it is slow at the store — the model it has, chosen again —, so the next run's deletion of it waits behind.
    const save = vault.host.conversations.save.bind(vault.host.conversations);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let choiceReached!: () => void;
    const choiceSaving = new Promise<void>((resolve) => (choiceReached = resolve));
    let runReached!: () => void;
    const runSaving = new Promise<void>((resolve) => (runReached = resolve));
    let saves = 0;
    vault.host.conversations.save = async (record) => {
      saves += 1;
      if (saves === 1) {
        choiceReached();
        await gate;
      }
      if (saves === 2) runReached();
      return save(record);
    };
    const choosing = h.s.setChoice(LOCAL);
    await choiceSaving;
    h.go(at(14, 12, 0));
    const due = h.s.runDueRoutines();
    await runSaving;
    for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    // While the deletion waits its turn, the user pins a note in it and goes elsewhere (step 9).
    const pinning = h.s.pin("Projects/Offer.md");
    h.s.newConversation();
    release();
    await Promise.all([choosing, pinning, due]);
    expect((await vault.host.conversations.load(previous))?.pins).toEqual(["Projects/Offer.md"]);
  });

  it("drops the previous run's conversation that was on screen until its turn came, and nothing more", async () => {
    const vault = routineVault(NOTES);
    const h = await routineSession([chat({ text: "Friday." }), chat({ text: "Wednesday." })], vault, { model: LOCAL });
    await h.setUp();
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    const previous = routineOf(h).conversationId!;
    await h.s.open(previous);
    // On screen when the next run ends, no longer when the deletion's turn comes: it is the routine's, and goes.
    const hold = heldReading(vault, previous);
    h.go(at(14, 12, 0));
    const due = h.s.runDueRoutines();
    await hold.reading;
    h.s.newConversation();
    hold.release();
    await due;
    expect(h.s.getState().summaries.some((summary) => summary.id === previous)).toBe(false);
  });

  it("drops the previous run's conversation the user renamed and named back again", async () => {
    const vault = routineVault(NOTES);
    const h = await routineSession([chat({ text: "Friday." }), chat({ text: "Wednesday." })], vault, { model: LOCAL });
    await h.setUp();
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    const previous = routineOf(h).conversationId!;
    // A rename that is through is no rename on its way: the title alone decides (step 9).
    await h.s.rename(previous, "Kept brief");
    await h.s.rename(previous, "Routine: Morning brief");
    h.go(at(14, 12, 0));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(h.s.getState().summaries.some((summary) => summary.id === previous)).toBe(false);
  });

  const unreadable: [string, () => Promise<null>][] = [
    [
      "it throws",
      async () => {
        throw new Error("unreadable");
      },
    ],
    ["it reads as nothing", async () => null],
  ];
  for (const [how, read] of unreadable) {
    it(`keeps the previous run's conversation where it cannot be read: ${how}`, async () => {
      const vault = routineVault(NOTES);
      const h = await routineSession([chat({ text: "Friday." }), chat({ text: "Wednesday." }), chat({ text: "Also." })], vault, { model: LOCAL });
      await h.setUp();
      h.go(at(9, 7, 1));
      expect(await h.s.runDueRoutines()).toBe(1);
      const previous = routineOf(h).conversationId!;
      // The store cannot read it any more — a newer format, a broken file: nothing tells it is the routine's alone (step 9).
      const load = vault.host.conversations.load.bind(vault.host.conversations);
      vault.host.conversations.load = async (id) => (id === previous ? read() : load(id));
      h.go(at(14, 12, 0));
      expect(await h.s.runDueRoutines()).toBe(1);
      expect(h.s.getState().summaries.some((summary) => summary.id === previous)).toBe(true);
      // Readable again, it is as it was: it takes the user's next message.
      vault.host.conversations.load = load;
      expect(await goOnWith(h, previous)).toMatchObject({ kind: "answered" });
    });
  }

  it("drops the previous run's conversation also where the routine was renamed since: by the title it gave it", async () => {
    const vault = routineVault(NOTES);
    const h = await routineSession([chat({ text: "Friday." }), chat({ text: "Wednesday." })], vault, { model: LOCAL });
    const { routine } = await h.setUp();
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    const previous = routineOf(h).conversationId!;
    // The routine renamed: its next conversation has another title, the last one still the one it was given.
    await h.setUp({ name: "Daily brief" }, routine.id);
    h.go(at(14, 12, 0));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect([routineOf(h, "Daily brief").conversationId === previous, h.s.getState().summaries.some((summary) => summary.id === previous)]).toEqual([false, false]);
  });

  it("keeps the previous run's conversation while the user renames it from the history", async () => {
    const vault = routineVault(NOTES);
    const h = await routineSession([chat({ text: "Friday." }), chat({ text: "Wednesday." })], vault, { model: LOCAL });
    await h.setUp();
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    const previous = routineOf(h).conversationId!;
    // The rename reads the conversation slowly; meanwhile the next run ends (step 9).
    const load = vault.host.conversations.load.bind(vault.host.conversations);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const reading = new Promise<void>((resolve) => (reached = resolve));
    let first = true;
    vault.host.conversations.load = async (id) => {
      if (first && id === previous) {
        first = false;
        reached();
        await gate;
      }
      return load(id);
    };
    const renaming = h.s.rename(previous, "Kept brief");
    await reading;
    h.go(at(14, 12, 0));
    expect(await h.s.runDueRoutines()).toBe(1);
    release();
    await renaming;
    expect(h.s.getState().summaries.find((summary) => summary.id === previous)?.title).toBe("Kept brief");
  });

  it("keeps the previous run's conversation whose pin is still being written when the next run ends", async () => {
    const vault = routineVault(NOTES);
    const h = await routineSession([chat({ text: "Friday." }), chat({ text: "Wednesday." })], vault, { model: LOCAL });
    await h.setUp();
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    const previous = routineOf(h).conversationId!;
    await h.s.open(previous);
    // The pin's write held at the store, and the user goes elsewhere meanwhile (step 9).
    const save = vault.host.conversations.save.bind(vault.host.conversations);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let pinReached!: () => void;
    const pinSaving = new Promise<void>((resolve) => (pinReached = resolve));
    let runReached!: () => void;
    const runSaving = new Promise<void>((resolve) => (runReached = resolve));
    let saves = 0;
    vault.host.conversations.save = async (record) => {
      saves += 1;
      if (saves === 1) {
        pinReached();
        await gate;
      }
      if (saves === 2) runReached();
      return save(record);
    };
    const pinning = h.s.pin("Projects/Offer.md");
    await pinSaving;
    h.s.newConversation();
    h.go(at(14, 12, 0));
    const due = h.s.runDueRoutines();
    // The next run's own conversation is written, and its deletion of the last one waits behind the pin.
    await runSaving;
    for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await Promise.all([pinning, due]);
    expect(h.s.getState().summaries.some((summary) => summary.id === previous)).toBe(true);
  });

  it("drops the previous run's conversation in its own vault, also where the shell made a new host for it during the run", async () => {
    const vault = routineVault(NOTES);
    let swap: (() => void) | null = null;
    const h = await routineSession([chat({ text: "Friday." }), chat({ text: "Wednesday." })], vault, {
      model: LOCAL,
      onSend: (count) => {
        if (count === 2) swap?.();
      },
    });
    await h.setUp();
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    const previous = routineOf(h).conversationId!;
    expect(h.s.getState().summaries.some((summary) => summary.id === previous)).toBe(true);
    // The second run's request goes out; at that moment the shell hands a new host for the same vault (step 8).
    swap = () => void h.s.attachVault({ ...vault.host });
    h.go(at(14, 12, 0));
    await h.s.runDueRoutines();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.s.getState().summaries.some((summary) => summary.id === previous)).toBe(false);
  });

  it("with a provider's model: runs within what was confirmed, without an overview", async () => {
    const vault = routineVault(NOTES);
    vault.touch("Projects/Offer.md", NOTES["Projects/Offer.md"], at(8, 18).getTime());
    const h = await routineSession([turn({ text: BRIEF })], vault);
    await h.setUp();
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(h.overviews).toEqual([]);
    expect(h.sent).toHaveLength(1);
    expect(routineTools(toolNames(h.sent[0]))).toEqual(toolNames(h.sent[0]));
    expect(routineOf(h).last).toMatchObject({ outcome: "answered" });
    // What the routine was confirmed for is the routine's: the next message the user types is asked about as ever.
    const typed = h.s.send("And tomorrow?");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.overviews).toHaveLength(1);
    h.s.stop();
    expect(await typed).toBeNull();
  });

  it("stops and sends nothing when more would go than was confirmed; a second look names what is new, and its yes lets it run", async () => {
    const vault = routineVault(NOTES);
    vault.touch("Projects/Offer.md", NOTES["Projects/Offer.md"], at(8, 18).getTime());
    const h = await routineSession([turn({ text: BRIEF })], vault);
    const { routine } = await h.setUp();
    // Overnight a note from a folder nobody confirmed becomes the latest change.
    vault.touch("Finance/Tax 2026.md", "# Tax\n\nThe advance payment is due.", at(9, 6, 30).getTime());
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(h.sent).toEqual([]);
    expect(h.overviews).toEqual([]);
    expect(vault.kept).toEqual([]);
    expect(routineOf(h).last).toMatchObject({ scheduledFor: "2026-10-09T07:00", outcome: "needs-you", need: "scope" });
    // It does not try again at the next tick.
    h.go(at(9, 7, 6));
    expect(await h.s.runDueRoutines()).toBe(0);

    const draft = { name: routine.name, skill: routine.skill, request: "", days: routine.schedule.days, time: routine.schedule.time, missed: routine.missed, onlyWhenChanged: false, choice: routine.choice };
    const again = await h.s.routinePreview(draft, routine.id);
    if (again.kind !== "preview") throw new Error("no confirmation");
    expect(again.preview.growth).toEqual([{ kind: "folder", folder: "Finance" }]);
    expect(await h.s.saveRoutine(draft, again.preview, routine.id)).toBe("saved");
    const confirmed = routineOf(h);
    expect(confirmed.id).toBe(routine.id);
    expect(confirmed.scope!.folders.sort()).toEqual(["Finance", "Projects"]);
    expect(confirmed.last).toBeUndefined();
    // The moment it needed its user for is open again.
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(h.sent).toHaveLength(1);
    expect(routineOf(h).last).toMatchObject({ scheduledFor: "2026-10-09T07:00", outcome: "answered" });
  });

  it("rests where the device asks before every request — unless its model is on this device", async () => {
    const vault = routineVault(NOTES);
    const h = await routineSession([chat({ text: BRIEF })], vault, { settings: { confirmEveryRequest: true } });
    const cloud = await h.setUp({ name: "At a provider" });
    expect(cloud.preview.everyRequest).toBe(true);
    const local = await h.setUp({ name: "Here", choice: LOCAL });
    expect(local.preview.everyRequest).toBe(false);
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(2);
    expect(h.overviews).toEqual([]);
    expect(routineOf(h, "At a provider").last).toMatchObject({ outcome: "needs-you", need: "confirm" });
    expect(routineOf(h, "Here").last).toMatchObject({ outcome: "answered" });
    // One request went out: to the model on this device.
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.endpointId).toBe("ollama");
  });

  it("rests while the device is fully local and its model is not on it", async () => {
    const vault = routineVault(NOTES);
    const h = await routineSession([], vault);
    await h.setUp();
    await h.s.updateSettings((settings) => ({ ...settings, localOnly: true }));
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(h.sent).toEqual([]);
    expect(routineOf(h).last).toMatchObject({ outcome: "needs-you", need: "local" });
  });

  it("needs its user when the provider of its model has no key here any more", async () => {
    const vault = routineVault(NOTES);
    const h = await routineSession([], vault, { noKey: ["anthropic"] });
    await h.setUp();
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(h.sent).toEqual([]);
    expect(routineOf(h).last).toMatchObject({ outcome: "needs-you", need: "model" });
  });

  it("rests when its skill is not what was confirmed — also after the skill itself was approved anew", async () => {
    const SKILL = ".agent/skills/lookback";
    const vault = routineVault({ ...NOTES, [`${SKILL}/SKILL.md`]: ownSkill("lookback") });
    const h = await routineSession([chat({ text: "Nothing much." })], vault, { model: LOCAL });
    const seen = async () => Object.fromEntries((await h.s.refreshSkills()).find((entry) => entry.source.id === SKILL)!.source.files.map((file) => [file.path, file.sha256]));
    expect(await h.s.approveInstruction(SKILL, await seen())).toBe(true);
    const { routine } = await h.setUp({ name: "Look back", skill: SKILL });
    expect(routine.skillHash).toMatch(/^[0-9a-f]{64}$/);

    // The file changes — a sync brought another device's edit. On this device the skill is no longer active.
    vault.disk.set(`${SKILL}/SKILL.md`, ownSkill("lookback", "search_vault read_note", "Say what changed, and add what you think of it."));
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(h.sent).toEqual([]);
    expect(routineOf(h, "Look back").last).toMatchObject({ outcome: "needs-you", need: "skill" });

    // The user approves the skill as it is now. The routine was confirmed for the old one: it still rests.
    expect(await h.s.approveInstruction(SKILL, await seen())).toBe(true);
    h.go(at(12, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(h.sent).toEqual([]);
    expect(routineOf(h, "Look back").last).toMatchObject({ scheduledFor: "2026-10-12T07:00", outcome: "needs-you", need: "skill" });

    // Looked at again and confirmed: it is this skill now, and it runs.
    await h.setUp({ name: "Look back", skill: SKILL }, routine.id);
    expect(routineOf(h, "Look back").skillHash).not.toBe(routine.skillHash);
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(h.sent).toHaveLength(1);
    expect(routineOf(h, "Look back").last).toMatchObject({ outcome: "answered" });
  });

  it("has no tool it was not given, whatever the model calls: nothing is proposed, drafted or created", async () => {
    const vault = routineVault(NOTES);
    const calls = [
      { id: "c1", name: "create_note", args: { title: "From a routine", body: "Text." } },
      { id: "c2", name: "propose_edit", args: { path: "Projects/Offer.md", find: "Northwind", replace: "Southwind" } },
      { id: "c3", name: "run_command", args: { id: "open-settings" } },
      { id: "c4", name: "fetch_url", args: { url: "https://example.org/collect?d=offer", question: "x" } },
    ];
    // Two of them, a tool it has, the other two — never three failures in a row, so the run goes on to its answer.
    const read = { id: "ok", name: "read_note", args: { path: "Projects/Offer.md" } };
    const h = await routineSession([chat({ calls: calls.slice(0, 2) }), chat({ calls: [read] }), chat({ calls: calls.slice(2) }), chat({ text: BRIEF })], vault, { model: LOCAL });
    const before = new Map(vault.disk);
    await h.setUp();
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(routineOf(h).last).toMatchObject({ outcome: "answered" });
    // Nothing waits anywhere, no question was asked, and the vault holds its notes as they were — plus the routine's own.
    expect(h.s.getState().drafts.drafts).toEqual([]);
    expect(h.s.getState().effect).toBeNull();
    expect(h.overviews).toEqual([]);
    for (const [path, text] of before) expect(vault.file(path), path).toBe(text);
    expect([...vault.disk.keys()].filter((path) => !before.has(path))).toEqual(["Inbox/Morning brief – 2026-10-09.md"]);
    // Each of the four calls came back to the model as a call that did nothing.
    const results = JSON.stringify(h.sent[3]!.body);
    for (const call of calls) expect(results, call.name).toContain(call.id);
  });

  it("is ended when the model keeps calling what it was not given, and leaves nothing", async () => {
    const vault = routineVault(NOTES);
    const calls = [
      { id: "c1", name: "create_note", args: { title: "From a routine", body: "Text." } },
      { id: "c2", name: "delete_note", args: { path: "Projects/Offer.md" } },
      { id: "c3", name: "run_command", args: { id: "open-settings" } },
    ];
    const h = await routineSession([chat({ calls }), chat({ text: "Never asked for." })], vault, { model: LOCAL });
    const before = new Map(vault.disk);
    await h.setUp();
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    // Three calls in a row that did nothing: the run's own guard ends it. No second request, no note.
    expect(routineOf(h).last).toMatchObject({ outcome: "failed", failure: "budget" });
    expect(h.sent).toHaveLength(1);
    expect(vault.kept).toEqual([]);
    expect([...vault.disk.entries()]).toEqual([...before.entries()]);
    expect(h.s.getState().drafts.drafts).toEqual([]);
  });

  it("reads no e-mail for a provider's model and asks nobody; with a model on this device it reads them", async () => {
    const SKILL = ".agent/skills/inbox-look";
    const script = (): EgressChunk[][] => [];
    const run = async (model: typeof CLOUD, answers: EgressChunk[][]) => {
      const vault = routineVault({ ...NOTES, [`${SKILL}/SKILL.md`]: ownSkill("inbox-look", "search_mail read_note", "Say which mails are open.") });
      const h = await routineSession([...script(), ...answers], vault, { model });
      const files = Object.fromEntries((await h.s.refreshSkills()).find((entry) => entry.source.id === SKILL)!.source.files.map((file) => [file.path, file.sha256]));
      expect(await h.s.approveInstruction(SKILL, files)).toBe(true);
      const effects: unknown[] = [];
      h.s.subscribe(() => {
        const effect = h.s.getState().effect;
        if (effect && !effects.includes(effect)) effects.push(effect);
      });
      const { preview } = await h.setUp({ name: "Inbox", skill: SKILL });
      h.go(at(9, 7, 1));
      expect(await h.s.runDueRoutines()).toBe(1);
      return { h, vault, preview, effects };
    };
    const call = { id: "c1", name: "search_mail", args: { query: "invoice" } };
    const cloud = await run(CLOUD, [turn({ calls: [call] }), turn({ text: "I could not look into the mail." })]);
    expect(cloud.preview.noMail).toBe(true);
    expect(toolNames(cloud.h.sent[0])).toContain("search_mail");
    expect(cloud.vault.mailSearches).toEqual([]);
    expect(cloud.effects).toEqual([]);
    expect(cloud.h.overviews).toEqual([]);
    expect(routineOf(cloud.h, "Inbox").last).toMatchObject({ outcome: "answered" });

    const local = await run(LOCAL, [chat({ calls: [call] }), chat({ text: "No open mail." })]);
    expect(local.preview.noMail).toBe(false);
    expect(local.vault.mailSearches).toHaveLength(1);
    expect(local.effects).toEqual([]);
  });

  it("asks no model while nothing changed since its last note — its own note does not count", async () => {
    const vault = routineVault(NOTES);
    const h = await routineSession([chat({ text: "Friday." }), chat({ text: "Tuesday." })], vault, { model: LOCAL });
    await h.setUp({ onlyWhenChanged: true });
    // Never left a note yet: the first run asks.
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(h.sent).toHaveLength(1);
    // Monday: nothing but its own note changed.
    h.go(at(12, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(h.sent).toHaveLength(1);
    expect(routineOf(h).last).toMatchObject({ scheduledFor: "2026-10-12T07:00", outcome: "unchanged" });
    expect(vault.kept).toHaveLength(1);
    // A note changes on Monday afternoon: Tuesday's run asks again.
    vault.touch("Projects/Offer.md", "# Offer\n\nSent.", at(12, 15).getTime());
    h.go(at(13, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(h.sent).toHaveLength(2);
    expect(routineOf(h).last).toMatchObject({ scheduledFor: "2026-10-13T07:00", outcome: "answered" });
  });

  it("is stopped by STOP, leaves no note, and says so", async () => {
    const vault = routineVault(NOTES);
    const h = await routineSession([chat({ text: "Never read." })], vault, {
      model: LOCAL,
      onSend: () => h.s.stop(),
    });
    await h.setUp();
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(vault.kept).toEqual([]);
    expect(routineOf(h).last).toMatchObject({ outcome: "stopped" });
    expect(h.s.getState().routines.ready).toBeNull();
    expect(h.s.getState().routines.running).toBeNull();
  });

  it("says why a run that was sent left no note, by a kind", async () => {
    const vault = routineVault(NOTES);
    // The script is empty: the model cannot be reached.
    const h = await routineSession([], vault, { model: LOCAL });
    await h.setUp();
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(routineOf(h).last).toMatchObject({ outcome: "failed", failure: "unreachable" });
    expect(vault.kept).toEqual([]);
    // The conversation on screen got no notice about it.
    expect(h.s.getState().notice).toBeNull();
  });
});

describe("one thing at a time, and only what its user set", () => {
  it("waits while something else has the session, and the session waits while a routine runs", async () => {
    const vault = routineVault(NOTES);
    let during: { send: unknown; running: unknown } | null = null;
    const h = await routineSession([chat({ text: BRIEF })], vault, {
      model: LOCAL,
      onSend: () => {
        // The routine's request is on its way: a message typed now is not sent, and a second routine does not start.
        during = { send: h.s.send("Hello?"), running: h.s.getState().routines.running };
      },
    });
    const { routine } = await h.setUp();
    expect(await h.s.runRoutine(routine.id, "due")).toEqual({ kind: "refused", reason: "not-due" });
    h.go(at(9, 7, 1));
    expect((await h.s.runRoutine(routine.id, "due")).kind).toBe("ran");
    expect(during!.running).toEqual({ id: routine.id, name: "Morning brief" });
    expect(await during!.send).toBeNull();
    expect(h.sent).toHaveLength(1);
  });

  it("runs by hand without using up its next moment, and never while it is paused or after it was removed", async () => {
    const vault = routineVault(NOTES);
    const h = await routineSession([chat({ text: "By hand." }), chat({ text: "At seven." })], vault, { model: LOCAL });
    const { routine } = await h.setUp();
    h.go(at(9, 6, 30));
    const byHand = await h.s.runRoutine(routine.id);
    expect(byHand).toMatchObject({ kind: "ran", run: { scheduledFor: "2026-10-09T06:30", outcome: "answered" } });
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(routineOf(h).last).toMatchObject({ scheduledFor: "2026-10-09T07:00" });

    await h.s.pauseRoutine(routine.id, true);
    h.go(at(12, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(0);
    // Taken off pause at noon: Monday's seven o'clock is not caught up.
    h.go(at(12, 12, 0));
    await h.s.pauseRoutine(routine.id, false);
    expect(await h.s.runDueRoutines()).toBe(0);
    expect(routineOf(h).paused).toBe(false);

    await h.s.removeRoutine(routine.id);
    expect(h.s.getState().routines.list).toEqual([]);
    expect(await h.s.runRoutine(routine.id)).toEqual({ kind: "refused", reason: "gone" });
    // The notes it wrote stay.
    expect(vault.kept).toHaveLength(2);
  });

  it("does nothing while the AI is off, and nothing in a vault that keeps no routines", async () => {
    const vault = routineVault(NOTES);
    const h = await routineSession([], vault, { model: LOCAL });
    const { routine } = await h.setUp();
    await h.s.updateSettings((settings) => ({ ...settings, enabled: false }));
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(0);
    expect(await h.s.runRoutine(routine.id)).toEqual({ kind: "refused", reason: "off" });
    await h.s.attachVault(null);
    expect(h.s.getState().routines).toMatchObject({ available: false, list: [], running: null, ready: null });
  });

  it("names a shared workspace when a routine is set up there, and writes its note without asking again", async () => {
    const vault = routineVault(NOTES, { shared: true });
    const h = await routineSession([chat({ text: BRIEF })], vault, { model: LOCAL });
    const { preview } = await h.setUp();
    expect(preview.shared).toBe(true);
    const effects: unknown[] = [];
    h.s.subscribe(() => {
      if (h.s.getState().effect) effects.push(h.s.getState().effect);
    });
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(effects).toEqual([]);
    expect(vault.kept).toEqual(["Inbox/Morning brief – 2026-10-09.md"]);
  });
});
