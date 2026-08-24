// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createRef, type ReactElement, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { rememberSearch, setPlatformServices } from "@plainva/ui";
import { RecentSearchesPopover } from "./RecentSearchesPopover";

/**
 * The desktop side of the recent-search list the phone has had since S16.
 *
 * Runs against the REAL shared store (with a fake settings backend under it),
 * not a stubbed loader: the point of closing the gap was that both shells read
 * the same five entries under the same rules, and a stubbed loader would prove
 * nothing about that.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const backing = new Map<string, unknown>();
setPlatformServices({
  loadSettings: async () => ({
    get: async (k: string) => backing.get(k),
    set: async (k: string, v: unknown) => {
      backing.set(k, v);
    },
    delete: async (k: string) => {
      backing.delete(k);
    },
    keys: async () => [...backing.keys()],
    save: async () => {},
  }),
  credentials: {} as never,
  openExternal: async () => {},
} as never);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  backing.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(el: ReactElement) {
  act(() => root.render(el));
}

/** Renders the popover and lets its load effect settle. */
async function mount(onPick = vi.fn()) {
  const anchor = createRef<HTMLDivElement>() as RefObject<HTMLDivElement | null>;
  render(
    <>
      <div ref={anchor} />
      <RecentSearchesPopover
        vaultPath="/vault"
        anchorRef={anchor}
        open
        reloadKey={0}
        onPick={onPick}
        onClose={vi.fn()}
      />
    </>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return { onPick };
}

const panel = () => container.querySelector('[data-testid="recent-searches"]');
const options = () => [...container.querySelectorAll('[role="option"]')] as HTMLButtonElement[];

describe("recent searches on the desktop", () => {
  it("offers what was searched before, newest first", async () => {
    await rememberSearch("/vault", "alpha");
    await rememberSearch("/vault", "beta");
    await mount();

    expect(panel()).not.toBeNull();
    expect(options().map((o) => o.textContent)).toEqual(["beta", "alpha"]);
  });

  it("stays away when nothing was searched yet", async () => {
    await mount();
    // Nothing to offer is not an empty panel — it is no panel. One that opened
    // blank under every focus would be noise on a fresh vault.
    expect(panel()).toBeNull();
  });

  it("hands the picked term back instead of searching itself", async () => {
    await rememberSearch("/vault", "quarterly report");
    const { onPick } = await mount();

    act(() => {
      options()[0].click();
    });
    expect(onPick).toHaveBeenCalledWith("quarterly report");
  });

  it("reads the store the phone writes", async () => {
    // The shells key by vault (path here, id on the phone) but share the key
    // shape, so the two lists cannot silently drift apart.
    await rememberSearch("/vault", "shared");
    expect(backing.has("mobileRecentSearches_/vault")).toBe(true);
  });
});
