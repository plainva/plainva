// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RunWrites, WriteDraft, WriteDraftOutcome } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { AiDraftCard, AiEffectApproval, AiOpenPanel, AiOpenWrites, AiRunWrites, openWritesCount, toast, toastStore, type DraftOutcome, type EffectRequest, type OpenProposal, type WriteDraftState } from "@plainva/ui";

/**
 * What an assistant laid down, as the reader sees it (plan KI-Harness P5-2,
 * mockup chapter 20), shared by both shells: the line and the cards under an
 * answer, the list of everything that waits, and the question about a plan.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  toast.clearAll();
});

function show(node: ReactNode): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
const click = async (el: Element | null | undefined) => {
  await act(async () => {
    (el as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await settle();
};
const text = (el: Element | null | undefined) => el?.textContent ?? "";
const q = (container: Element, id: string) => container.querySelector(`[data-testid="${id}"]`);
/** The rows of a card's list as "label: value". */
const rows = (card: Element) => [...card.querySelectorAll("dl > dt")].map((dt) => `${text(dt)}: ${text(dt.nextElementSibling)}`);

const draft = (over: Partial<WriteDraft> = {}): WriteDraft => ({
  id: "d-000001",
  createdAt: "2026-10-07T09:00:00.000Z",
  author: { id: "plainva-ai/m-1", label: "Plainva AI · m-1" },
  conversationId: "c1",
  title: "Kick-off",
  body: { kind: "note", path: null, folder: "Projects", content: "Agenda\n\n- one\n" },
  inherited: [],
  sources: [],
  defused: 0,
  ...over,
});
const task = draft({ id: "d-000002", title: "Call the roofer", body: { kind: "task", text: "Call the roofer tomorrow 9:00 !!!", day: "2026-10-07" } });
const line = draft({ id: "d-000003", title: "Met Anna", body: { kind: "journal", text: "Met Anna", day: "2026-10-07", time: "10:30", task: false } });

describe("a draft's card", () => {
  it("says what the draft would become and where — with the user's two buttons", async () => {
    const onCreate = vi.fn();
    const onDiscard = vi.fn();
    const container = show(<AiDraftCard draft={draft()} canCreate busy={false} onCreate={onCreate} onDiscard={onDiscard} />);
    const card = q(container, "ai-draft")!;
    expect(card.getAttribute("data-kind")).toBe("note");
    expect(card.getAttribute("aria-label")).toBe("Draft · Note: Kick-off");
    expect(rows(card)).toEqual(["Note: Kick-off", "Goes into: Projects"]);
    // The text is there on request, as the draft has it.
    expect(q(card, "ai-draft-text")).toBeNull();
    await click(q(card, "ai-draft-show"));
    expect(text(q(card, "ai-draft-text"))).toBe("Agenda\n\n- one");
    expect(text(q(card, "ai-draft-show"))).toBe("Hide");
    await click(q(card, "ai-draft-create"));
    await click(q(card, "ai-draft-discard"));
    // A note goes nowhere but into the vault: nothing is said about a provider.
    expect(onCreate.mock.calls).toEqual([["d-000001", false]]);
    expect(onDiscard).toHaveBeenCalledWith("d-000001");
    expect(q(card, "ai-draft-provider")).toBeNull();
  });

  it("says where a note would land: the inbox where nobody named a place, the file's folder where its writer named the file", () => {
    const place = (body: WriteDraft["body"]) => text(q(show(<AiDraftCard draft={draft({ body })} canCreate busy={false} onCreate={() => {}} onDiscard={() => {}} />), "ai-draft-place"));
    expect(place({ kind: "note", path: null, folder: null, content: "x" })).toBe("Inbox folder");
    // An agent's note names its own file (plan P5-6): it is made exactly there.
    expect(place({ kind: "note", path: "Projects/Shoot/Day 14.md", folder: null, content: "x" })).toBe("Projects/Shoot");
    // At the vault's top level it lies in no folder — and not in the inbox either.
    expect(place({ kind: "note", path: "Garden.md", folder: null, content: "x" })).toBe("Top level of the vault");
  });

  it("offers a task's provider list the way the capture field does — on, and the user's to switch off", async () => {
    const onCreate = vi.fn();
    const container = show(<AiDraftCard draft={task} canCreate busy={false} onCreate={onCreate} onDiscard={() => {}} taskList="Errands" />);
    const chip = q(container, "ai-draft-provider")!;
    expect(text(chip)).toBe("Also create in “Errands”");
    expect(chip.className).toContain("is-on");
    await click(q(container, "ai-draft-create"));
    await click(chip);
    expect(q(container, "ai-draft-provider")!.className).not.toContain("is-on");
    await click(q(container, "ai-draft-create"));
    expect(onCreate.mock.calls).toEqual([
      ["d-000002", true],
      ["d-000002", false],
    ]);
    // Where the task database names no list there is nothing to ask, and nothing is sent anywhere.
    act(() => root!.render(<AiDraftCard draft={task} canCreate busy={false} onCreate={onCreate} onDiscard={() => {}} taskList={null} />));
    expect(q(container, "ai-draft-provider")).toBeNull();
    await click(q(container, "ai-draft-create"));
    expect(onCreate.mock.calls[2]).toEqual(["d-000002", false]);
    // A journal line and a note never go to a task list, whatever the vault is connected to.
    act(() => root!.render(<AiDraftCard draft={line} canCreate busy={false} onCreate={onCreate} onDiscard={() => {}} taskList="Errands" />));
    expect(q(container, "ai-draft-provider")).toBeNull();
  });

  it("names the inbox where the model named no folder, and says what the note will carry", () => {
    const container = show(<AiDraftCard draft={draft({ body: { kind: "note", path: null, folder: null, content: "x" }, inherited: ["cloud"], defused: 2 })} canCreate busy={false} onCreate={() => {}} onDiscard={() => {}} showAuthor />);
    const card = q(container, "ai-draft")!;
    expect(rows(card)).toEqual(["Note: Kick-off", "Goes into: Inbox folder", "By: Plainva AI · m-1"]);
    expect(text(card)).toContain("The note gets the privacy rules of the notes it rests on.");
    expect(text(card)).toContain("Web addresses the AI brought are in it as text.");
  });

  it("shows a task with the day its words are read from, and a journal line with its day and time", () => {
    const first = show(<AiDraftCard draft={task} canCreate busy={false} onCreate={() => {}} onDiscard={() => {}} />);
    expect(rows(q(first, "ai-draft")!)).toEqual(["Task: Call the roofer", "Drafted on: Wed, Oct 7", "Wording: Call the roofer tomorrow 9:00 !!!"]);
    // Nothing to unfold: a task is its line.
    expect(q(first, "ai-draft-show")).toBeNull();
    act(() => root!.render(<AiDraftCard draft={line} canCreate busy={false} onCreate={() => {}} onDiscard={() => {}} />));
    expect(rows(q(first, "ai-draft")!)).toEqual(["Entry: Met Anna", "Day: Wed, Oct 7 · 10:30"]);
  });

  it("names the database of a drafted entry and the properties it would have — “Create” writes exactly those", async () => {
    const properties = { author: "Frank Herbert", pages: 412, read: false, genres: ["sci-fi", "classic"] };
    const entry = draft({ id: "d-000004", title: "Dune", body: { kind: "entry", base: "Projects/Books.base", properties, content: "A desert planet." }, inherited: ["cloud"] });
    const onCreate = vi.fn();
    const container = show(<AiDraftCard draft={entry} canCreate busy={false} onCreate={onCreate} onDiscard={() => {}} taskList="Errands" />);
    const card = q(container, "ai-draft")!;
    expect(card.getAttribute("data-kind")).toBe("entry");
    expect(card.getAttribute("aria-label")).toBe("Draft · Database entry: Dune");
    // The database by its name; a property under the database's own word for it, its value as a suggestion's card writes one.
    expect(rows(card)).toEqual(["Entry: Dune", "Database: Books", "author: Frank Herbert", "pages: 412", "read: false", "genres: sci-fi, classic"]);
    expect(q(card, "ai-draft-more")).toBeNull();
    expect(text(card)).toContain("The note gets the privacy rules of the notes it rests on.");
    await click(q(card, "ai-draft-show"));
    expect(text(q(card, "ai-draft-text"))).toBe("A desert planet.");
    // An entry goes nowhere but into the vault, whatever the vault is connected to.
    expect(q(card, "ai-draft-provider")).toBeNull();
    await click(q(card, "ai-draft-create"));
    expect(onCreate.mock.calls).toEqual([["d-000004", false]]);

    // A long list is cut, and the card says how much it left out; an entry without text has nothing to unfold.
    const many = draft({ title: "Wide", body: { kind: "entry", base: "Books.base", properties: Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`p${index + 1}`, index])), content: "" } });
    act(() => root!.render(<AiDraftCard draft={many} canCreate busy={false} onCreate={() => {}} onDiscard={() => {}} />));
    expect(card.querySelectorAll('[data-testid="ai-draft-property"]')).toHaveLength(8);
    expect(text(q(container, "ai-draft-more"))).toBe("and 3 more properties");
    expect(q(container, "ai-draft-show")).toBeNull();
    act(() => root!.render(<AiDraftCard draft={draft({ ...many, body: { kind: "entry", base: "Books.base", properties: Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`p${index + 1}`, index])), content: "" } })} canCreate busy={false} onCreate={() => {}} onDiscard={() => {}} />));
    expect(text(q(container, "ai-draft-more"))).toBe("and 1 more property");
  });

  it("cannot be created where this device cannot make it, and waits while another one is being made", () => {
    const container = show(<AiDraftCard draft={draft()} canCreate={false} busy={false} onCreate={() => {}} onDiscard={() => {}} />);
    expect((q(container, "ai-draft-create") as HTMLButtonElement).disabled).toBe(true);
    expect((q(container, "ai-draft-discard") as HTMLButtonElement).disabled).toBe(false);
    act(() => root!.render(<AiDraftCard draft={draft()} canCreate busy onCreate={() => {}} onDiscard={() => {}} />));
    expect((q(container, "ai-draft-create") as HTMLButtonElement).disabled).toBe(true);
    expect((q(container, "ai-draft-discard") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the card of an e-mail and of an appointment (plan P5-6)", () => {
  const mail = draft({
    id: "d-mail01",
    title: "Re: Shooting day",
    body: { kind: "mail", to: ["a.okafor@example.org", "tom@example.org"], cc: ["office@example.org"], bcc: [], subject: "Re: Shooting day", body: "Hello Ms Okafor,\n\nthe 14th is fixed.", unnamed: ["a.okafor@example.org", "office@example.org"] },
  });
  const event = draft({
    id: "d-event1",
    title: "Shooting day",
    body: { kind: "event", title: "Shooting day", allDay: false, day: "2026-05-14", endDay: "2026-05-14", start: "09:00", end: "17:00", location: "Studio 2", description: "Bring the lights.", attendees: ["a.okafor@example.org"], unnamed: [] },
  });

  it("names every recipient in full, says which of them the user did not write, and opens the composer — it creates nothing", async () => {
    const onCreate = vi.fn();
    const container = show(<AiDraftCard draft={mail} canCreate busy={false} onCreate={onCreate} onDiscard={() => {}} />);
    const card = q(container, "ai-draft")!;
    expect(card.getAttribute("data-kind")).toBe("mail");
    expect(card.getAttribute("aria-label")).toBe("Draft · E-mail: Re: Shooting day");
    // To and Cc as they would go; an empty Bcc is no row.
    expect(rows(card)).toEqual(["Subject: Re: Shooting day", "To: a.okafor@example.org, tom@example.org", "Cc: office@example.org"]);
    expect(text(q(card, "ai-draft-unnamed"))).toBe("Not written by you in this conversation: a.okafor@example.org, office@example.org. Check before you send.");
    expect(text(card)).toContain("Nothing is sent from here.");
    // The text is there on request; the button says where it leads, and is not the card's obvious step.
    await click(q(card, "ai-draft-show"));
    expect(text(q(card, "ai-draft-text"))).toBe("Hello Ms Okafor,\n\nthe 14th is fixed.");
    const open = q(card, "ai-draft-create") as HTMLButtonElement;
    expect(text(open)).toBe("Open in Mail");
    expect(open.className).not.toContain("primary");
    await click(open);
    expect(onCreate.mock.calls).toEqual([["d-mail01", false]]);
    expect(q(card, "ai-draft-provider")).toBeNull();
  });

  it("warns about nobody where the user wrote every address themselves", () => {
    const own = draft({ id: "d-mail02", title: "Roof", body: { kind: "mail", to: ["anna@example.org"], cc: [], bcc: ["me@example.org"], subject: "Roof", body: "", unnamed: [] } });
    const card = q(show(<AiDraftCard draft={own} canCreate busy={false} onCreate={() => {}} onDiscard={() => {}} />), "ai-draft")!;
    expect(rows(card)).toEqual(["Subject: Roof", "To: anna@example.org", "Bcc: me@example.org"]);
    expect(q(card, "ai-draft-unnamed")).toBeNull();
    // Nothing to show where the mail has no text.
    expect(q(card, "ai-draft-show")).toBeNull();
  });

  it("says when an appointment is, where, and whom it invites — and opens the event editor", async () => {
    const onCreate = vi.fn();
    const container = show(<AiDraftCard draft={event} canCreate busy={false} onCreate={onCreate} onDiscard={() => {}} />);
    const card = q(container, "ai-draft")!;
    expect(card.getAttribute("aria-label")).toBe("Draft · Event: Shooting day");
    expect(rows(card)).toEqual(["Event: Shooting day", "When: Thu, May 14 · 09:00–17:00", "Where: Studio 2", "Attendees: a.okafor@example.org"]);
    expect(q(card, "ai-draft-unnamed")).toBeNull();
    expect(text(card)).toContain("Nothing is saved from here.");
    expect(text(q(card, "ai-draft-create"))).toBe("Open in Calendar");
    await click(q(card, "ai-draft-create"));
    expect(onCreate.mock.calls).toEqual([["d-event1", false]]);
  });

  it("names the days of an all-day appointment, and warns about an invitee the user did not write", () => {
    const days = draft({
      id: "d-event2",
      title: "Trade fair",
      body: { kind: "event", title: "Trade fair", allDay: true, day: "2026-05-14", endDay: "2026-05-16", start: "", end: "", location: "", description: "", attendees: ["eve@example.org"], unnamed: ["eve@example.org"] },
    });
    const card = q(show(<AiDraftCard draft={days} canCreate busy={false} onCreate={() => {}} onDiscard={() => {}} />), "ai-draft")!;
    expect(rows(card)).toEqual(["Event: Trade fair", "When: Thu, May 14 – Sat, May 16 · all day", "Attendees: eve@example.org"]);
    expect(text(q(card, "ai-draft-unnamed"))).toBe("Not written by you in this conversation: eve@example.org. Check before you save — attendees get an invitation.");
  });

  it("says under the answer what became of each: sent, saved — never “created”", () => {
    const writes: RunWrites = {
      rounds: [],
      drafts: [
        { id: "d-mail01", kind: "mail", title: "Re: Shooting day" },
        { id: "d-mail02", kind: "mail", title: "Roof" },
        { id: "d-mail03", kind: "mail", title: "Lights" },
        { id: "d-event1", kind: "event", title: "Shooting day" },
      ],
      plans: [],
    };
    const at = "2026-10-07T09:10:00.000Z";
    const done: WriteDraftOutcome[] = [
      { id: "d-mail01", kind: "mail", title: "Re: Shooting day", outcome: "sent", at },
      { id: "d-mail02", kind: "mail", title: "Roof", outcome: "saved", at },
      { id: "d-mail03", kind: "mail", title: "Lights", outcome: "opened", at },
      { id: "d-event1", kind: "event", title: "Shooting day", outcome: "saved", at },
    ];
    const container = show(
      <div className="pv-ai-run">
        <AiRunWrites writes={writes} state={{ drafts: [], done }} canCreate busy={false} onOpenNote={() => {}} onCreate={() => {}} onDiscard={() => {}} />
      </div>,
    );
    expect([...container.querySelectorAll('[data-testid="ai-draft-done"]')].map((item) => [item.getAttribute("data-outcome"), item.tagName, text(item)])).toEqual([
      ["sent", "SPAN", "Sent: Re: Shooting day"],
      ["saved", "SPAN", "Saved as a mail draft: Roof"],
      ["opened", "SPAN", "Moved to its own window: Lights"],
      ["saved", "SPAN", "Saved to the calendar: Shooting day"],
    ]);
  });

  it("leaves the card where it is when the composer is taken or no calendar takes an appointment, and says so", async () => {
    const outcomes: DraftOutcome[] = [{ kind: "opened" }, { kind: "refused", reason: "editor-open" }, { kind: "refused", reason: "no-calendar" }];
    const session = { canCreateDrafts: () => true, draftTaskList: async () => null, createDraft: async () => outcomes.shift()!, discardDraft: async () => undefined };
    const opened: string[] = [];
    const container = show(<AiOpenPanel session={session} state={{ drafts: [mail, event], done: [] }} proposals={[]} onOpenNote={() => {}} onOpenCreated={(path) => opened.push(path)} />);
    await settle();
    const [first, second] = [...container.querySelectorAll('[data-testid="ai-draft"]')];
    // Opened: the composer is in front of the user, and nothing is said on top of it — and no note is opened.
    await click(q(first!, "ai-draft-create"));
    expect(toastStore.get()).toEqual([]);
    await click(q(first!, "ai-draft-create"));
    await click(q(second!, "ai-draft-create"));
    expect(toastStore.get().map((item) => [item.kind, item.message])).toEqual([
      ["warning", "“Compose message” is already open with an e-mail. Send or close that one first."],
      ["warning", "No writable calendar selected."],
    ]);
    expect(opened).toEqual([]);
  });
});

describe("under an answer", () => {
  const writes: RunWrites = {
    rounds: [
      { path: "Projects/Offer.md", blocks: 2, properties: 1 },
      { path: "Projects/Plan.md", blocks: 1, properties: 0 },
    ],
    drafts: [
      { id: "d-000001", kind: "note", title: "Kick-off" },
      { id: "d-000002", kind: "task", title: "Call the roofer" },
      { id: "d-000003", kind: "journal", title: "Met Anna" },
      { id: "d-elsewhere", kind: "note", title: "Laid down on another device" },
    ],
    plans: [],
  };
  const created: WriteDraftOutcome = { id: "d-000002", kind: "task", title: "Call the roofer", outcome: "created", path: "Tasks/Call the roofer.md", at: "2026-10-07T09:10:00.000Z" };
  const discarded: WriteDraftOutcome = { id: "d-000003", kind: "journal", title: "Met Anna", outcome: "discarded", at: "2026-10-07T09:11:00.000Z" };

  it("names the notes that carry a proposal, and shows each draft as it stands: waiting, created, discarded", async () => {
    const opened: string[] = [];
    const state: WriteDraftState = { drafts: [draft()], done: [created, discarded] };
    const container = show(
      <div className="pv-ai-run">
        <AiRunWrites writes={writes} state={state} canCreate busy={false} onOpenNote={(path) => opened.push(path)} onCreate={() => {}} onDiscard={() => {}} />
      </div>,
    );
    const proposed = [...container.querySelectorAll('[data-testid="ai-proposed"]')];
    expect(proposed.map(text)).toEqual(["Suggested in “Offer”: 2 passages, 1 property", "Suggested in “Plan”: 1 passage"]);
    await click(proposed[0]);
    // One draft still waits; two were decided; one is not this device's to say anything about.
    expect([...container.querySelectorAll('[data-testid="ai-draft"]')].map((card) => card.getAttribute("data-draft"))).toEqual(["d-000001"]);
    const done = [...container.querySelectorAll('[data-testid="ai-draft-done"]')];
    expect(done.map((item) => [item.getAttribute("data-outcome"), text(item)])).toEqual([
      ["created", "Created: Call the roofer"],
      ["discarded", "Discarded: Met Anna"],
    ]);
    expect(text(container)).not.toContain("another device");
    // What was created is one click away; what was discarded leads nowhere.
    await click(done[0]);
    expect(done[1]!.tagName).toBe("SPAN");
    expect(opened).toEqual(["Projects/Offer.md", "Tasks/Call the roofer.md"]);
  });
});

describe("everything that waits", () => {
  const proposals: OpenProposal[] = [
    { path: "Projects/Offer.md", authorId: "plainva-ai/m-1", changes: 2, at: "2026-10-07T09:05:00.000Z" },
    { path: "Projects/Plan.md", authorId: "mcp:desk-client", authorLabel: "Desk client", changes: 1, at: "2026-10-07T08:00:00.000Z" },
  ];

  it("lists the notes with a machine's proposals and the drafts of this device, each with who laid it down", async () => {
    const opened: string[] = [];
    const container = show(<AiOpenWrites state={{ drafts: [draft(), task], done: [] }} proposals={proposals} canCreate busy={false} onOpenNote={(path) => opened.push(path)} onCreate={() => {}} onDiscard={() => {}} />);
    const listed = [...q(container, "ai-open-proposals")!.querySelectorAll("li")];
    expect(listed.map((item) => text(item.querySelector("button")))).toEqual(["Offer", "Plan"]);
    expect(text(listed[0])).toContain("2 changes · Plainva AI · m-1 · ");
    expect(text(listed[1])).toContain("1 change · Desk client · ");
    await click(listed[1]!.querySelector("button"));
    expect(opened).toEqual(["Projects/Plan.md"]);
    const cards = [...container.querySelectorAll('[data-testid="ai-draft"]')];
    expect(cards.map((card) => text(q(card, "ai-draft-author")))).toEqual(["Plainva AI · m-1", "Plainva AI · m-1"]);
    expect(text(container)).toContain("None of it is in the vault until you accept or create it.");
    expect(openWritesCount({ drafts: [draft(), task], done: [] }, proposals)).toBe(4);
  });

  it("says so when nothing waits — and claims nothing while the proposals are still being looked up", () => {
    const container = show(<AiOpenWrites state={{ drafts: [], done: [] }} proposals={[]} canCreate busy={false} onOpenNote={() => {}} onCreate={() => {}} onDiscard={() => {}} />);
    expect(text(q(container, "ai-open-empty"))).toContain("Nothing is waiting for you");
    expect(q(container, "ai-open")).toBeNull();
    act(() => root!.render(<AiOpenWrites state={{ drafts: [], done: [] }} proposals={null} canCreate busy={false} onOpenNote={() => {}} onCreate={() => {}} onDiscard={() => {}} />));
    expect(q(container, "ai-open-empty")).toBeNull();
    expect(q(container, "ai-open-proposals")).toBeNull();
    expect(openWritesCount({ drafts: [], done: [] }, null)).toBe(0);
  });

  it("creates through the session, opens what was made, and says why when it could not", async () => {
    const outcomes: DraftOutcome[] = [{ kind: "created", path: "Projects/Kick-off.md" }, { kind: "refused", reason: "failed", message: "The folder is read-only." }, { kind: "refused", reason: "unavailable" }];
    const asked: string[] = [];
    const session = {
      canCreateDrafts: () => true,
      draftTaskList: async () => "Errands",
      createDraft: async (id: string, choice?: { atProvider?: boolean }) => {
        asked.push(`create ${id}${choice?.atProvider ? " at the provider" : ""}`);
        return outcomes.shift()!;
      },
      discardDraft: async (id: string) => void asked.push(`discard ${id}`),
    };
    const opened: string[] = [];
    const container = show(<AiOpenPanel session={session} state={{ drafts: [draft(), task], done: [] }} proposals={[]} onOpenNote={(path) => opened.push(`note ${path}`)} onOpenCreated={(path) => opened.push(`created ${path}`)} />);
    await settle();
    const [first, second] = [...container.querySelectorAll('[data-testid="ai-draft"]')];
    // The session named the task database's provider list: the task's card offers it, the note's does not.
    expect(q(first!, "ai-draft-provider")).toBeNull();
    expect(text(q(second!, "ai-draft-provider"))).toBe("Also create in “Errands”");
    await click(q(first!, "ai-draft-create"));
    expect(opened).toEqual(["created Projects/Kick-off.md"]);
    await click(q(second!, "ai-draft-create"));
    await click(q(second!, "ai-draft-provider"));
    await click(q(second!, "ai-draft-create"));
    await click(q(second!, "ai-draft-discard"));
    expect(asked).toEqual(["create d-000001", "create d-000002 at the provider", "create d-000002", "discard d-000002"]);
    expect(toastStore.get().map((item) => [item.kind, item.message])).toEqual([
      ["success", "Created."],
      ["error", "The draft could not be created: The folder is read-only."],
      ["error", "This cannot be created on this device."],
    ]);
    expect(opened).toHaveLength(1);
  });
});

describe("the question about a plan", () => {
  const ask = (question: Extract<EffectRequest, { kind: "plan" }>["question"], onAnswer = vi.fn()) => {
    const container = show(<AiEffectApproval request={{ id: "c1", kind: "plan", question }} onAnswer={onAnswer} />);
    return { card: q(container, "ai-effect")!, onAnswer };
  };

  it("shows what a rename would do: the new name and every note whose links follow it", async () => {
    const files = Array.from({ length: 8 }, (_, index) => ({ path: `Notes/N${index + 1}.md`, links: index === 0 ? 3 : 1 }));
    const { card, onAnswer } = ask({ plan: "rename", path: "Projects/Offer.md", title: "Offer 2027", target: "Projects/Offer 2027.md", files, links: 10 });
    expect(card.getAttribute("data-plan")).toBe("rename");
    expect(card.getAttribute("aria-label")).toBe("Rename?");
    expect(rows(card)).toEqual(["Note: Offer · Projects", "New name: Offer 2027", "Links: 10 links in 8 notes — they follow the new name"]);
    const listed = [...q(card, "ai-effect-files")!.querySelectorAll("li")].map(text);
    expect(listed).toEqual(["Notes/N13 links", "Notes/N21 link", "Notes/N31 link", "Notes/N41 link", "Notes/N51 link", "Notes/N61 link", "and 2 more notes"]);
    expect(text(card)).toContain("The AI only learns whether it happened.");
    expect(text(q(card, "ai-effect-deny"))).toBe("Don't rename");
    await click(q(card, "ai-effect-once"));
    await click(q(card, "ai-effect-deny"));
    expect(onAnswer.mock.calls).toEqual([["once"], ["deny"]]);
  });

  it("says so when no other note links to the one that is renamed", () => {
    const { card } = ask({ plan: "rename", path: "Offer.md", title: "Offer 2027", target: "Offer 2027.md", files: [], links: 0 });
    expect(rows(card)).toEqual(["Note: Offer", "New name: Offer 2027", "Links: No other note links here."]);
    expect(q(card, "ai-effect-files")).toBeNull();
  });

  it("names the folder of a move, and warns when the note would leave a rule behind", () => {
    const { card } = ask({ plan: "move", path: "Private/Client.md", folder: "Archive", target: "Archive/Client.md", loosens: ["cloud", "web"] });
    expect(card.getAttribute("aria-label")).toBe("Move?");
    expect(rows(card)).toEqual(["Note: Client · Private", "Target folder: Archive"]);
    expect(text(q(card, "ai-effect-loosens"))).toBe("In the target folder this no longer holds for the note: never to the cloud · never together with the internet.");
    expect(text(q(card, "ai-effect-once"))).toBe("Move");
    act(() => root!.render(<AiEffectApproval request={{ id: "c2", kind: "plan", question: { plan: "move", path: "Projects/Offer.md", folder: "", target: "Offer.md", loosens: [] } }} onAnswer={() => {}} />));
    const root2 = q(host!, "ai-effect")!;
    expect(rows(root2)).toEqual(["Note: Offer · Projects", "Target folder: Top level of the vault"]);
    expect(q(root2, "ai-effect-loosens")).toBeNull();
  });

  it("does not offer to delete: its button opens the app's own dialog", () => {
    const { card } = ask({ plan: "delete", path: "Projects/Offer.md" });
    expect(card.getAttribute("aria-label")).toBe("The AI asks to delete a note");
    expect(rows(card)).toEqual(["Note: Offer · Projects"]);
    expect(text(q(card, "ai-effect-once"))).toBe("Open delete dialog");
    expect(text(q(card, "ai-effect-deny"))).toBe("Don't delete");
    expect(text(card)).toContain("nothing is gone before you confirm there");
  });

  it("asks about one of the note's own AI rules: which rule, and whether it is written or taken out (plan P5-3)", async () => {
    const { card, onAnswer } = ask({ plan: "rule", path: "Projects/Brief.md", rule: "cloud", set: true });
    expect(card.getAttribute("data-plan")).toBe("rule");
    expect(card.getAttribute("aria-label")).toBe("Change a privacy rule of this note?");
    expect(rows(card)).toEqual(["Note: Brief · Projects", "Rule: never to the cloud", "Change: is written into the note"]);
    // A rule that is written restricts: nothing to warn about, and the step is the card's main one.
    expect(q(card, "ai-effect-loosens")).toBeNull();
    expect(text(q(card, "ai-effect-once"))).toBe("Set the rule");
    expect(q(card, "ai-effect-once")!.className).toContain("pv-btn--primary");
    expect(text(q(card, "ai-effect-deny"))).toBe("Don't change");
    expect(text(card)).toContain("as when you set the rule yourself. The AI only learns whether it happened.");
    await click(q(card, "ai-effect-once"));
    await click(q(card, "ai-effect-deny"));
    expect(onAnswer.mock.calls).toEqual([["once"], ["deny"]]);
  });

  it("warns when a rule would be taken out, and does not make that the step the eye lands on", () => {
    const { card } = ask({ plan: "rule", path: "Brief.md", rule: "cloud", set: false });
    expect(rows(card)).toEqual(["Note: Brief", "Rule: never to the cloud", "Change: is taken out of the note"]);
    expect(text(q(card, "ai-effect-loosens"))).toBe("After this the note may go to cloud models again.");
    expect(text(q(card, "ai-effect-once"))).toBe("Remove the rule");
    expect(q(card, "ai-effect-once")!.className).not.toContain("pv-btn--primary");
    act(() => root!.render(<AiEffectApproval request={{ id: "c2", kind: "plan", question: { plan: "rule", path: "Brief.md", rule: "web", set: false } }} onAnswer={() => {}} />));
    const web = q(host!, "ai-effect")!;
    expect(rows(web)).toEqual(["Note: Brief", "Rule: never together with the internet", "Change: is taken out of the note"]);
    expect(text(q(web, "ai-effect-loosens"))).toBe("After this the note may be part of conversations that use the internet again.");
  });
});
