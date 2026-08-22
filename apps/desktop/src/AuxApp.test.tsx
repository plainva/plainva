// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

/**
 * What an auxiliary window starts with (multi-window P4).
 *
 * Only the URL travels to a new window, so what it makes of `content=` and
 * `preset=` IS the feature. Two decisions are pinned here, and both are
 * invisible until they go wrong: a preset window starts SPLIT (mail beside the
 * calendar, E4), and a window that restored tabs is never seeded on top of them
 * — a restored arrangement that gets overwritten a moment after it appears
 * would look like the restore had failed.
 *
 * The panes themselves are stubbed: what is under test is the seeding, not the
 * editor, and the real panes drag the whole lazy chunk graph in.
 */

vi.mock("./components/AuxPane", () => ({
  AuxPane: ({ path }: { path: string }) => <div data-testid="pane">{path}</div>,
}));
vi.mock("./components/AuxTitleBar", () => ({
  AuxTitleBar: ({ title, tabs }: { title: string; tabs?: unknown }) => (
    <div data-testid="titlebar">
      {title}
      {tabs as never}
    </div>
  ),
}));
vi.mock("./services/windowBus", () => ({ getWindowBus: async () => null }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    async setTitle() {},
    async isAlwaysOnTop() {
      return false;
    },
  }),
}));

const vault = {
  vaultAdapter: { exists: async () => true } as never,
  vaultPath: "/vault",
  isLoading: false,
  error: null as string | null,
};
vi.mock("./contexts/VaultContext", () => ({ useVault: () => vault }));

import { AuxApp } from "./AuxApp";
import { resetWindowParamsForTest } from "./services/windowContext";

let host: HTMLDivElement;
let root: Root;

/** Mounts the shell with a given window query. */
async function mount(query: string) {
  window.history.replaceState({}, "", query);
  resetWindowParamsForTest();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<AuxApp />);
  });
  // The seed waits for the async layout restore to have its say.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

const panes = () => Array.from(host.querySelectorAll('[data-testid="pane"]')).map((n) => n.textContent);

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.useRealTimers();
  resetWindowParamsForTest();
});

describe("what an auxiliary window starts with", () => {
  it("opens the note it was popped out with", async () => {
    await mount("/?win=aux&vault=%2Fvault&content=Note.md&label=aux-1");
    expect(panes()).toEqual(["Note.md"]);
  });

  it("starts a preset window split, mail beside the calendar", async () => {
    await mount("/?win=aux&vault=%2Fvault&content=plainva%3A%2F%2Fmail&preset=mail-calendar&label=aux-2");

    // Left/top is mail, right/bottom the calendar — a window opened for
    // "communications" that shows one of the two has missed its whole point.
    expect(panes()).toEqual(["plainva://mail", "plainva://calendar"]);
  });

  it("leaves restored tabs alone instead of seeding on top of them", async () => {
    localStorage.setItem(
      "plainva-layout-/vault-aux-3",
      JSON.stringify({
        panes: [{ tabs: [{ history: ["A.md"], historyIndex: 0 }, { history: ["B.md"], historyIndex: 0 }], activeIndex: 1 }],
        direction: "vertical",
        activePaneIndex: 0,
        splitRatio: 0.5,
      }),
    );

    await mount("/?win=aux&vault=%2Fvault&content=Note.md&label=aux-3");

    // The window came back with the two tabs it was closed with; the content it
    // was ONCE popped out with is history.
    expect(panes()).toEqual(["B.md"]);
    expect(host.textContent).not.toContain("Note.md");
  });
});
