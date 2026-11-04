// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { FoundChip, SearchModeSwitch, SemanticCoverage } from "@plainva/ui";

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
});

function mount(node: React.ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

/** Plan KI-Harness P2a-4: the three pieces search by meaning adds to the shared search. */
describe("search by meaning in the result list", () => {
  it("offers words, meaning and both, and reports the choice", () => {
    const onChange = vi.fn();
    const el = mount(<SearchModeSwitch mode="both" onChange={onChange} />);
    const options = [...el.querySelectorAll("button")].map((b) => b.textContent);
    expect(options).toEqual(["Words", "Meaning", "Both"]);
    act(() => el.querySelector<HTMLButtonElement>("[data-testid=search-mode-meaning]")!.click());
    expect(onChange).toHaveBeenCalledWith("meaning");
  });

  it("names what found a hit, and nothing where only words search", () => {
    expect(mount(<FoundChip found="meaning" />).textContent).toBe("Meaning");
    act(() => root!.render(<FoundChip found="both" />));
    expect(host!.textContent).toBe("Words and meaning");
    act(() => root!.render(<FoundChip found={undefined} />));
    expect(host!.textContent).toBe("");
  });

  it("says how far the vectors are and offers the pause, until they are complete", () => {
    const pause = vi.fn();
    const resume = vi.fn();
    const el = mount(<SemanticCoverage progress={{ state: "working", total: 5, current: 3, deferred: 0, withheld: 0 }} onPause={pause} onResume={resume} />);
    expect(el.textContent).toContain("Meaning knows 3 of 5 notes");
    act(() => [...el.querySelectorAll("button")].find((b) => b.textContent === "Pause")!.click());
    expect(pause).toHaveBeenCalled();
    act(() => root!.render(<SemanticCoverage progress={{ state: "paused", total: 5, current: 3, deferred: 0, withheld: 0 }} onPause={pause} onResume={resume} />));
    act(() => [...host!.querySelectorAll("button")].find((b) => b.textContent === "Resume")!.click());
    expect(resume).toHaveBeenCalled();
    act(() => root!.render(<SemanticCoverage progress={{ state: "idle", total: 5, current: 5, deferred: 0, withheld: 0 }} onPause={pause} onResume={resume} />));
    expect(host!.textContent).toBe("");
  });

  it("leaves the notes the rules keep from a cloud out of the count", () => {
    const el = mount(<SemanticCoverage progress={{ state: "working", total: 5, current: 2, deferred: 0, withheld: 1 }} onPause={vi.fn()} onResume={vi.fn()} />);
    expect(el.textContent).toContain("Meaning knows 2 of 4 notes");
    act(() => root!.render(<SemanticCoverage progress={{ state: "idle", total: 5, current: 4, deferred: 0, withheld: 1 }} onPause={vi.fn()} onResume={vi.fn()} />));
    expect(host!.textContent).toBe("");
  });
});
