// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { LocalEmbeddingsContext, RelatedNotesList, type LocalEmbeddings, type RelatedAnswer } from "@plainva/ui";

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** The controller as far as the list uses it: its state for the hook, and the reader's word. */
function fakeController() {
  const state = { engine: { kind: "off" }, progress: { state: "idle", current: 0, total: 0, deferred: 0, withheld: 0 }, related: { enabled: true, vaultPaused: false, paused: [], dismissed: 0, version: 0 } };
  return {
    subscribe: () => () => undefined,
    snapshot: () => state,
    dismissRelated: vi.fn(async () => undefined),
    resumeRelated: vi.fn(async () => undefined),
  };
}

function mount(answer: RelatedAnswer, controller = fakeController(), handlers = { onOpenNote: vi.fn(), onJump: vi.fn() }) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <LocalEmbeddingsContext.Provider value={controller as unknown as LocalEmbeddings}>
        <RelatedNotesList path="Film/Kickoff.md" answer={answer} {...handlers} />
      </LocalEmbeddingsContext.Provider>,
    ),
  );
  return { el: host, controller, ...handlers };
}

const HINTS: RelatedAnswer = {
  kind: "hints",
  hints: [
    {
      path: "Film/Schedule.md",
      title: "Schedule",
      prominence: 6.4,
      from: { chain: "Kick-off › Production", line: 7, lineText: "Tom suggests two blocks.", excerpt: "Tom suggests two blocks." },
      to: { chain: "Days › Split", line: 5, lineText: "Two days each.", excerpt: "Two days each." },
      shared: [{ path: "People/Studio.md", title: "Studio" }],
    },
  ],
};

/** Plan KI-Harness P2b-4: one list for both shells. */
describe("RelatedNotesList", () => {
  it("names each hint and its pair of sections, with the links both set", () => {
    void i18n.changeLanguage("en");
    const { el, onOpenNote } = mount(HINTS);
    expect(el.textContent).toContain("Schedule");
    expect(el.textContent).toContain("Kick-off › Production ↔ Days › Split · both mention [[Studio]]");
    act(() => (el.querySelector('[data-testid="related-row"]') as HTMLButtonElement).click());
    expect(onOpenNote).toHaveBeenCalledWith("Film/Schedule.md");
  });

  it("shows why behind the info button, jumps to a section, and hides the pair when it is not helpful", () => {
    void i18n.changeLanguage("en");
    const { el, controller, onJump } = mount(HINTS);
    expect(el.querySelector('[data-testid="related-why-panel"]')).toBeNull();
    act(() => (el.querySelector('[data-testid="related-why"]') as HTMLButtonElement).click());
    const panel = el.querySelector('[data-testid="related-why-panel"]')!;
    expect(panel.textContent).toContain("This note, Kick-off › Production: “Tom suggests two blocks.”");
    expect(panel.textContent).toContain("very close in meaning · not linked yet · computed on this device");
    act(() => (panel.querySelectorAll("button")[1] as HTMLButtonElement).click());
    expect(onJump).toHaveBeenCalledWith({ path: "Film/Schedule.md", line: 5, term: "Two days each." });
    act(() => (el.querySelector('[data-testid="related-dismiss"]') as HTMLButtonElement).click());
    expect(controller.dismissRelated).toHaveBeenCalledWith("Film/Kickoff.md", "Film/Schedule.md");
  });

  it("disappears without hints, and keeps a paused note's line with the way back", () => {
    void i18n.changeLanguage("en");
    expect(mount({ kind: "hints", hints: [] }).el.textContent).toBe("");
    act(() => root?.unmount());
    host?.remove();
    const { el, controller } = mount({ kind: "paused" });
    expect(el.textContent).toContain("Paused for this note.");
    act(() => (el.querySelector('[data-testid="related-resume-note"]') as HTMLButtonElement).click());
    expect(controller.resumeRelated).toHaveBeenCalledWith("Film/Kickoff.md");
  });
});
