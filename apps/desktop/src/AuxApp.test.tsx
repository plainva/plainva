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
  AuxTitleBar: ({ title, tabs, actions }: { title: string; tabs?: unknown; actions?: unknown }) => (
    <div data-testid="titlebar">
      {title}
      {tabs as never}
      {actions as never}
    </div>
  ),
}));
/** The context sidebar, reduced to what this shell decides: which sections it may show. */
const sidebarSections: unknown[] = [];
vi.mock("./components/RightSidebar", () => ({
  RightSidebar: ({ sections }: { sections?: readonly string[] }) => {
    sidebarSections.push(sections);
    return <div data-testid="sidebar">{(sections ?? []).join(",")}</div>;
  },
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
  fileTreeVersion: 0,
};
vi.mock("./contexts/VaultContext", () => ({ useVault: () => vault }));

/**
 * The app layer, stubbed to the one thing this shell reads from it: how many
 * vaults the process holds, which decides whether the window title names one
 * (stage D). The rule itself is pinned in `services/windowTitle.test.ts`.
 */
const app = { heldVaults: ["/vault"] as readonly string[] };
vi.mock("./contexts/AppContext", () => ({ useApp: () => app }));

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
  sidebarSections.length = 0;
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

  it("names itself from the requested content before the layout is seeded", async () => {
    // The title used to come from the active path alone, which only exists
    // AFTER the seed. Every window therefore called itself "Plainva" for the
    // first moments — harmless with one window, bad with the restore on start
    // (E5), where several come up at once and the taskbar shows a row of
    // identical entries that sort themselves out a beat later. The window
    // already knows what it was asked to show, so it says so.
    window.history.replaceState({}, "", "/?win=aux&vault=%2Fvault&content=Projekte%2FAlpha.md&label=aux-4");
    resetWindowParamsForTest();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<AuxApp />);
    });

    // Deliberately WITHOUT advancing the timers: this is the moment before the
    // seed runs, the one the production smoke caught.
    const bar = host.querySelector('[data-testid="titlebar"]');
    expect(bar?.textContent).toContain("Alpha.md");
    expect(bar?.textContent).not.toContain("Plainva");
  });
});

describe("the context sidebar of an auxiliary window (finding 2026-09-01, D4)", () => {
  it("shows the note-bound sections and never the calendar (E5)", async () => {
    await mount("/?win=aux&vault=%2Fvault&content=Notes%2FAlpha.md&label=aux-9");
    expect(host.querySelector('[data-testid="aux-right-sidebar"]')).not.toBeNull();
    expect(sidebarSections[sidebarSections.length - 1]).toEqual(["outline", "graph", "databases", "backlinks", "properties"]);
  });

  it("folds away per window and remembers it", async () => {
    await mount("/?win=aux&vault=%2Fvault&content=Notes%2FAlpha.md&label=aux-9");
    const toggle = host.querySelector('[data-testid="aux-right-toggle"]') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    await act(async () => { toggle.click(); });
    expect(host.querySelector('[data-testid="aux-right-sidebar"]')).toBeNull();
    // Another window's key is untouched: the state is scoped to this window.
    const keys = Object.keys(localStorage).filter((k) => k.includes("plainva-aux-right-collapsed"));
    expect(keys.length).toBe(1);
    expect(keys[0]).not.toBe("plainva-aux-right-collapsed");
    expect(localStorage.getItem(keys[0])).toBe("true");
  });
});
