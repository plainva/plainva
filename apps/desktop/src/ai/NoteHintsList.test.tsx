// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import type { PimEventRow } from "@plainva/core";
import { NoteHintsActions, NoteHintsList, toast, toastStore, type AiSession, type NoteHintItem, type NoteHintOutcome, type NoteHintsAnswer } from "@plainva/ui";

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  void i18n.changeLanguage("en");
  toast.clearAll();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  toast.clearAll();
});

const PATH = "Journal/2026-10-24.md";
const MEETING = { uid: "evt-1", title: "Review with Tom", allDay: false, start: { ts: new Date(2026, 9, 25, 9, 30).getTime() } } as unknown as PimEventRow;
const LINK: NoteHintItem = { kind: "link", key: `link\n${PATH}\n[[Kickoff]]`, line: 6, subject: "[[Kickoff]]", link: { sourcePath: PATH, targetRaw: "Kickoff", target: "Kickoff", kind: "wikilink" } };
const TODO: NoteHintItem = { kind: "todo", key: `todo\n${PATH}\ncall Tom`, line: 7, subject: "call Tom", raw: "TODO: call Tom" };
const MEET: NoteHintItem = { kind: "meeting", key: `meeting\n${PATH}\nevt-1`, line: null, subject: "Review with Tom", event: MEETING };
const ALL: NoteHintsAnswer = { kind: "hints", items: [LINK, TODO, MEET] };

/** The session as far as the list and its pause use it; each step answers what a test gives it. */
function fakeSession(outcome: NoteHintOutcome = { kind: "done" }) {
  return {
    actOnNoteHint: vi.fn(async () => outcome),
    dismissNoteHint: vi.fn(async () => undefined),
    pauseNoteHints: vi.fn(async () => undefined),
    resumeNoteHints: vi.fn(async () => undefined),
    setNoteHintsVaultPaused: vi.fn(async () => undefined),
  };
}

function mount(answer: NoteHintsAnswer, session = fakeSession(), showStates = false) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const handlers = { onOpenNote: vi.fn(), onJump: vi.fn() };
  act(() =>
    root!.render(
      <>
        <NoteHintsList session={session as unknown as AiSession} path={PATH} answer={answer} showStates={showStates} {...handlers} />
        <NoteHintsActions session={session as unknown as AiSession} path={PATH} answer={answer} />
      </>,
    ),
  );
  return { el: host, session, ...handlers };
}

const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[data-testid="hints-row"]')];
const press = async (button: Element | null | undefined) => {
  await act(async () => {
    (button as HTMLButtonElement).click();
  });
};

/** Plan KI-Harness P8-3: one list of calm hints for both shells, in the grammar of the related notes. */
describe("NoteHintsList", () => {
  it("names each hint with its line and its one step", () => {
    const { el } = mount(ALL);
    expect(rows(el).map((row) => row.dataset.kind)).toEqual(["link", "todo", "meeting"]);
    expect(rows(el)[0]!.textContent).toContain("[[Kickoff]] leads nowhere");
    expect(rows(el)[0]!.textContent).toContain("Line 6");
    expect(rows(el)[0]!.textContent).toContain("Create note");
    expect(rows(el)[1]!.textContent).toContain("“call Tom”");
    expect(rows(el)[1]!.textContent).toContain("Line 7 begins with TODO");
    expect(rows(el)[1]!.textContent).toContain("As a task");
    expect(rows(el)[2]!.textContent).toContain("Tomorrow 09:30 AM Review with Tom");
    expect(rows(el)[2]!.textContent).toContain("no note yet");
    expect(rows(el)[2]!.textContent).toContain("Create meeting note");
  });

  it("an all-day appointment has no time, and no double space where it stood", () => {
    const allDay: NoteHintItem = { ...MEET, event: { ...MEETING, allDay: true } as PimEventRow };
    const { el } = mount({ kind: "hints", items: [allDay] });
    expect(rows(el)[0]!.textContent).toContain("Tomorrow Review with Tom");
  });

  it("takes a step only on the click, and says how it ended", async () => {
    // A note made for a link opens.
    let m = mount(ALL, fakeSession({ kind: "opened", path: "Journal/Kickoff.md" }));
    await press(rows(m.el)[0]!.querySelector('[data-testid="hints-act"]'));
    expect(m.session.actOnNoteHint).toHaveBeenCalledWith(PATH, LINK);
    expect(m.onOpenNote).toHaveBeenCalledWith("Journal/Kickoff.md");
    act(() => root?.unmount());
    // A line changed where it stands: nothing to open, nothing to say — the note's editor shows it.
    m = mount(ALL, fakeSession({ kind: "done" }));
    await press(rows(m.el)[1]!.querySelector('[data-testid="hints-act"]'));
    expect(m.session.actOnNoteHint).toHaveBeenCalledWith(PATH, TODO);
    expect(m.onOpenNote).not.toHaveBeenCalled();
    expect(toastStore.get()).toEqual([]);
    act(() => root?.unmount());
    // The line was no longer that line: nothing was changed, and that is said.
    m = mount(ALL, fakeSession({ kind: "gone" }));
    await press(rows(m.el)[1]!.querySelector('[data-testid="hints-act"]'));
    expect(toastStore.get().map((item) => [item.kind, item.message])).toEqual([["info", "The line changed meanwhile — nothing was changed."]]);
    toast.clearAll();
    act(() => root?.unmount());
    // The template's questions were cancelled: nothing went wrong, nothing is said.
    m = mount(ALL, fakeSession({ kind: "cancelled" }));
    await press(rows(m.el)[2]!.querySelector('[data-testid="hints-act"]'));
    expect(m.session.actOnNoteHint).toHaveBeenCalledWith(PATH, MEET);
    expect(toastStore.get()).toEqual([]);
    expect(m.onOpenNote).not.toHaveBeenCalled();
    act(() => root?.unmount());
    // A step that failed says so.
    m = mount(ALL, fakeSession({ kind: "failed" }));
    await press(rows(m.el)[0]!.querySelector('[data-testid="hints-act"]'));
    expect(toastStore.get().map((item) => [item.kind, item.message])).toEqual([["error", "That didn't work."]]);
  });

  it("says why behind the info button, goes to the line, and hides exactly this hint", async () => {
    const { el, session, onJump } = mount(ALL);
    expect(el.querySelector('[data-testid="hints-why-panel"]')).toBeNull();
    await press(rows(el)[1]!.querySelector('[data-testid="hints-why"]'));
    const panel = el.querySelector('[data-testid="hints-why-panel"]')!;
    expect(panel.textContent).toContain("Line 7 begins with “TODO” and is no task yet. “As a task” turns it into “- [ ] call Tom” where it stands");
    expect(panel.textContent).toContain("noticed on this device · no model");
    await press([...panel.querySelectorAll("button")].find((button) => button.textContent === "Go to the line"));
    expect(onJump).toHaveBeenCalledWith({ path: PATH, line: 7, term: "call Tom" });
    await press(panel.querySelector('[data-testid="hints-dismiss"]'));
    expect(session.dismissNoteHint).toHaveBeenCalledWith(TODO.key);
    // An appointment has no line: its title opens the reason instead of jumping.
    await press(rows(el)[2]!.querySelector(".pv-related-main"));
    expect(rows(el)[2]!.querySelector('[data-testid="hints-why-panel"]')!.textContent).toContain("This appointment is in your calendar tomorrow");
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it("says why there is nothing on the phone's tab, and disappears in the desktop's section", () => {
    expect(mount({ kind: "hints", items: [] }, fakeSession(), true).el.textContent).toContain("Nothing stands out.");
    act(() => root?.unmount());
    expect(mount({ kind: "vaultPaused" }, fakeSession(), true).el.textContent).toContain("Paused in this vault.");
    act(() => root?.unmount());
    const off = mount({ kind: "hints", items: [] });
    expect(off.el.querySelector('[data-testid="hints-state"]')).toBeNull();
    expect(off.el.querySelector('[data-testid="hints-list"]')).toBeNull();
    act(() => root?.unmount());
    expect(mount({ kind: "off" }, fakeSession(), true).el.textContent).toBe("");
  });

  it("pauses for the note and for the vault, and brings each back", async () => {
    let m = mount(ALL);
    await press(m.el.querySelector('[data-testid="hints-pause-note"]'));
    expect(m.session.pauseNoteHints).toHaveBeenCalledWith(PATH);
    await press(m.el.querySelector('[data-testid="hints-pause-vault"]'));
    expect(m.session.setNoteHintsVaultPaused).toHaveBeenCalledWith(true);
    act(() => root?.unmount());
    m = mount({ kind: "paused" });
    expect(m.el.textContent).toContain("Paused for this note.");
    expect(m.el.querySelector('[data-testid="hints-pause-note"]')).toBeNull();
    await press(m.el.querySelector('[data-testid="hints-resume-note"]'));
    expect(m.session.resumeNoteHints).toHaveBeenCalledWith(PATH);
    act(() => root?.unmount());
    m = mount({ kind: "vaultPaused" }, fakeSession(), true);
    await press(m.el.querySelector('[data-testid="hints-resume-vault"]'));
    expect(m.session.setNoteHintsVaultPaused).toHaveBeenCalledWith(false);
  });
});
