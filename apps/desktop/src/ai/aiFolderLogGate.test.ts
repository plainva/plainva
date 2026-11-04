import { describe, expect, it } from "vitest";
import { FOLDER_LOG_LIMITS, FOLDER_LOG_REQUEST_TOKENS, type RoutineDraft } from "@plainva/core";
import { CLOUD, LOCAL, chat, turn } from "./mcpSessionHarness";
import { at, routineSession, routineVault, toolNames } from "./routineSessionHarness";

/**
 * A folder's log (plan KI-Harness P8-2, ADR 0033 decision 13): the device
 * finds which notes of a folder changed since the log's last entry and what
 * each gained; a model is shown that in ONE request without a tool and finds
 * one sentence per note; the app writes the entry into the folder's `log.md`
 * — the day from the clock, each link from the index, of the model's answer
 * only a sentence per number. What a note's own rules keep back, and what
 * was removed from a note, is neither shown nor written. Where nothing
 * changed, no model is asked and nothing is written.
 *
 * The session is the real one, the vault's host the one both shells build;
 * the model is scripted and the clock is the test's.
 */

const PLAN_BEFORE = "# Plan\n\nKick-off on Monday.\nBudget: open.\n";
const PLAN_NOW = "# Plan\n\nKick-off on Monday.\nBudget: 12,000 € — agreed with Tom.\n";
const IDEA = "---\ntype: Note\n---\n# New idea\n\nA podcast about the studio.\n";
const ANSWER = [
  "[1] A podcast about the studio was planned.",
  "[2] The budget was agreed with Tom.",
  "## A heading of the model's own",
  "See [this](https://example.org/page) and <b>more</b>.",
  "[3] A note nobody asked about.",
].join("\n");

const LOG: Partial<RoutineDraft> = { name: "Project log", skill: "", request: "", days: [0, 1, 2, 3, 4, 5, 6], time: "18:00", onlyWhenChanged: true, log: { folder: "Projects" } };

/** The vault of these tests: a plan that was edited, a note that was made, and notes elsewhere and unchanged. */
function projects() {
  const vault = routineVault({ "Projects/Old.md": "# Old\n\nNothing new.\n", "Journal/2026-10-08.md": "# Thursday\n\nCalled the studio.\n" });
  vault.make("Projects/Plan.md", PLAN_BEFORE, at(1, 9).getTime());
  vault.make("Projects/Old.md", "# Old\n\nNothing new.\n", at(1, 9).getTime());
  return vault;
}

/** What one request carried: its messages as text. */
const said = (spec: { body?: unknown } | undefined) => JSON.stringify(spec?.body ?? null);

describe("setting a folder's log up", () => {
  it("shows what a run would bring along today — put together like a run, and not sent — and covers a busy day", async () => {
    const vault = projects();
    vault.edit("Projects/Plan.md", PLAN_NOW, at(8, 20).getTime());
    const h = await routineSession([], vault);
    const outcome = await h.s.routinePreview({ ...LOG, choice: CLOUD, missed: "catch-up" } as RoutineDraft);
    expect(outcome.kind).toBe("preview");
    if (outcome.kind !== "preview") return;
    const { preview } = outcome;
    expect(h.sent).toEqual([]);
    expect(h.overviews).toEqual([]);
    expect(preview.log).toEqual({ folder: "Projects", file: "Projects/log.md", notes: 1, max: 20 });
    expect(preview.limits).toEqual(FOLDER_LOG_LIMITS);
    expect(preview.manifest.tools).toEqual([]);
    expect(preview.manifest.folders).toEqual(["Projects"]);
    expect(preview.manifest.sources.map((source) => source.path)).toEqual(["Projects/Plan.md"]);
    const saved = await h.s.saveRoutine({ ...LOG, choice: CLOUD, missed: "catch-up" } as RoutineDraft, preview);
    expect(saved).toBe("saved");
    const routine = h.s.getState().routines.list[0]!;
    expect(routine).toMatchObject({ skill: "", skillHash: "", request: "", onlyWhenChanged: true, log: { folder: "Projects" } });
    // The yes covers what one request of a log can carry at most: a day on which many notes changed is no growth.
    expect(routine.scope!.maxTokens).toBeGreaterThanOrEqual(FOLDER_LOG_REQUEST_TOKENS);
    expect(vault.file("Projects/log.md")).toBeNull();
  });

  it("refuses a folder the rules keep from the provider, and takes a model on this device for it", async () => {
    const vault = routineVault({}, { policy: "folders:\n  Projects/:\n    cloud: deny\n" });
    vault.make("Projects/Plan.md", PLAN_NOW, at(8, 20).getTime());
    const h = await routineSession([], vault);
    expect(await h.s.routinePreview({ ...LOG, choice: CLOUD, missed: "catch-up" } as RoutineDraft)).toEqual({ kind: "refused", reason: "rules" });
    expect((await h.s.routinePreview({ ...LOG, choice: LOCAL, missed: "catch-up" } as RoutineDraft)).kind).toBe("preview");
    expect(h.sent).toEqual([]);
  });
});

describe("a run of a folder's log", () => {
  it("shows the model what each note gained, in one request without a tool, and writes the entry itself", async () => {
    const vault = projects();
    const h = await routineSession([turn({ text: ANSWER })], vault);
    await h.setUp(LOG);
    vault.edit("Projects/Plan.md", PLAN_NOW, at(9, 10).getTime());
    vault.make("Projects/New idea.md", IDEA, at(9, 11).getTime());
    vault.edit("Journal/2026-10-08.md", "# Thursday\n\nCalled the studio again.\n", at(9, 12).getTime());
    h.go(at(9, 18, 1));
    expect(await h.s.runDueRoutines()).toBe(1);

    // One request, no tool, nobody asked.
    expect(h.sent).toHaveLength(1);
    expect(toolNames(h.sent[0])).toEqual([]);
    expect(h.overviews).toEqual([]);
    const request = said(h.sent[0]);
    expect(request).toContain("A podcast about the studio.");
    expect(request).toContain("Budget: 12,000 € — agreed with Tom.");
    // A line that was removed is a number, never a text; a note of another folder is not this log's.
    expect(request).not.toContain("Budget: open.");
    expect(request).toContain("1 line is gone");
    expect(request).not.toContain("Called the studio");
    // The properties block of a note is not what it says.
    expect(request).not.toContain("type: Note");

    expect(vault.file("Projects/log.md")).toBe(
      [
        "# Log of “Projects”",
        "",
        "## 2026-10-09",
        "",
        "* **New**: [New idea](New%20idea.md) — A podcast about the studio was planned.",
        "* **Updated**: [Plan](Plan.md) — The budget was agreed with Tom.",
        "",
      ].join("\n"),
    );
    const routine = h.s.getState().routines.list[0]!;
    expect(routine.last).toMatchObject({ outcome: "answered", note: "Projects/log.md", noteTitle: "Projects/log.md" });
    expect(h.s.getState().routines.ready).toMatchObject({ name: "Project log", note: "Projects/log.md" });
    // Nothing else of the vault was written: no note in the inbox, no other file.
    expect(vault.kept).toEqual([]);
  });

  it("writes no entry through a host that is gone: a new host for the same vault while the run's end is written stops it (strand 6, step 10)", async () => {
    const vault = projects();
    const h = await routineSession([turn({ text: ANSWER })], vault);
    await h.setUp(LOG);
    vault.edit("Projects/Plan.md", PLAN_NOW, at(9, 10).getTime());
    h.go(at(9, 18, 1));
    vault.host.key = "vault-1";
    // The run's conversation is written while the shell hands a new host for the same vault — the index rebuilt, say.
    const save = vault.host.conversations.save.bind(vault.host.conversations);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const saving = new Promise<void>((resolve) => (reached = resolve));
    let first = true;
    vault.host.conversations.save = async (record) => {
      if (first) {
        first = false;
        reached();
        await gate;
      }
      return save(record);
    };
    const due = h.s.runDueRoutines();
    await saving;
    await h.s.attachVault({ ...vault.host });
    release();
    await due;
    // The answer stays in its conversation; nothing went through the host that was.
    expect(vault.file("Projects/log.md")).toBeNull();
    expect(h.sent).toHaveLength(1);
  });

  it("asks no model and writes nothing where nothing changed — and looks from where the last entry ended", async () => {
    const vault = projects();
    const h = await routineSession([turn({ text: "[1] The budget was agreed." }), turn({ text: "[1] The kick-off moved to Tuesday." })], vault);
    await h.setUp(LOG);
    vault.edit("Projects/Plan.md", PLAN_NOW, at(9, 10).getTime());
    h.go(at(9, 18, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    const first = vault.file("Projects/log.md");
    expect(h.sent).toHaveLength(1);

    // The next evening: nothing changed.
    h.go(at(10, 18, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(h.sent).toHaveLength(1);
    expect(vault.file("Projects/log.md")).toBe(first);
    expect(h.s.getState().routines.list[0]!.last).toMatchObject({ outcome: "unchanged" });

    // A day later the plan changes again: the entry speaks of that change only.
    vault.edit("Projects/Plan.md", PLAN_NOW.replace("Monday", "Tuesday"), at(11, 9).getTime());
    h.go(at(11, 18, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(h.sent).toHaveLength(2);
    const second = said(h.sent[1]);
    expect(second).toContain("Kick-off on Tuesday.");
    expect(second).not.toContain("12,000");
    expect(vault.file("Projects/log.md")).toContain("## 2026-10-11\n\n* **Updated**: [Plan](Plan.md) — The kick-off moved to Tuesday.\n\n## 2026-10-09");
  });

  it("leaves a note with stricter rules than its folder out entirely — not named, not shown — for every model", async () => {
    for (const model of [CLOUD, LOCAL]) {
      const vault = projects();
      const h = await routineSession([model === LOCAL ? chat({ text: "[1] The budget was agreed." }) : turn({ text: "[1] The budget was agreed." })], vault, { model });
      await h.setUp({ ...LOG, choice: model });
      vault.edit("Projects/Plan.md", PLAN_NOW, at(9, 10).getTime());
      vault.make("Projects/Salary.md", "---\nplainva:\n  ai:\n    cloud: deny\n---\n# Salary\n\nTom earns 4,000 €.\n", at(9, 11).getTime());
      h.go(at(9, 18, 1));
      expect(await h.s.runDueRoutines()).toBe(1);
      const request = said(h.sent[0]);
      expect(request, model.providerId).not.toContain("Salary");
      expect(request, model.providerId).not.toContain("4,000");
      expect(vault.file("Projects/log.md"), model.providerId).not.toContain("Salary");
      expect(vault.file("Projects/log.md"), model.providerId).toContain("[Plan](Plan.md)");
    }
  });

  it("rests where the folder's rules keep it from its model: nothing is sent, nothing written", async () => {
    const vault = projects();
    const h = await routineSession([turn({ text: "[1] Something." })], vault);
    await h.setUp(LOG);
    // After the yes, the folder is kept from every provider (the rules are read again once the clock moved on).
    vault.disk.set(".agent/policy.yml", "folders:\n  Projects/:\n    cloud: deny\n");
    vault.edit("Projects/Plan.md", PLAN_NOW, at(9, 10).getTime());
    h.go(at(9, 18, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    expect(h.sent).toEqual([]);
    expect(vault.file("Projects/log.md")).toBeNull();
    expect(h.s.getState().routines.list[0]!.last).toMatchObject({ outcome: "needs-you", need: "rules" });
  });

  it("puts the entry under the day an entry of another device already stands under, and leaves the rest of the file as it was", async () => {
    const vault = projects();
    const written = [
      "# Log of “Projects”",
      "",
      "Kept by the team.",
      "",
      "## 2026-10-09",
      "",
      "* **New**: [Brief](Brief.md) — Written on the other laptop.",
      "",
      "## 2026-10-08",
      "",
      "* Something older.",
      "",
    ].join("\r\n");
    vault.make("Projects/log.md", written, at(8, 9).getTime());
    const h = await routineSession([turn({ text: "[1] The budget was agreed." })], vault);
    await h.setUp(LOG);
    vault.edit("Projects/Plan.md", PLAN_NOW, at(9, 10).getTime());
    h.go(at(9, 18, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    // The log file itself is no note of the log: it is not named.
    expect(said(h.sent[0])).not.toContain("Written on the other laptop");
    expect(vault.file("Projects/log.md")).toBe(
      [
        "# Log of “Projects”",
        "",
        "Kept by the team.",
        "",
        "## 2026-10-09",
        "",
        "* **New**: [Brief](Brief.md) — Written on the other laptop.",
        "* **Updated**: [Plan](Plan.md) — The budget was agreed.",
        "",
        "## 2026-10-08",
        "",
        "* Something older.",
        "",
      ].join("\r\n"),
    );
  });

  it("looks back a day before it was set up at its first run, and no further", async () => {
    const vault = projects();
    vault.edit("Projects/Plan.md", PLAN_NOW, at(7, 9).getTime());
    const h = await routineSession([turn({ text: "[1] An idea was noted." })], vault);
    await h.setUp(LOG);
    vault.make("Projects/New idea.md", IDEA, at(8, 20).getTime());
    h.go(at(9, 18, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    const request = said(h.sent[0]);
    expect(request).toContain("New idea");
    expect(request).not.toContain("12,000");
  });
});
