// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

/**
 * The one sidebar surface that differs between windows (stage C6).
 *
 * The E2E harness drives a single browser page, so it never sees a second OS
 * window: everything a client window renders differently is invisible to it by
 * construction. This is that difference, and it is a behaviour rather than a
 * look — one process holds one open vault (plan E7), so a client cannot switch
 * it and must ask the central window instead.
 *
 * The failure this pins is quiet: a client that renders the owner menu would
 * offer a vault switch it cannot perform, and a client whose button is merely
 * disabled would explain nothing at all.
 */

vi.mock("./SyncSwitcherIcon", () => ({
  SyncSwitcherIcon: () => <span data-testid="sync-icon" />,
}));

import { VaultSwitcher } from "./VaultSwitcher";

let host: HTMLDivElement;
let root: Root;

async function mount(props: Partial<React.ComponentProps<typeof VaultSwitcher>> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <VaultSwitcher
        vaultPath="/home/me/notes"
        syncWorker={null}
        open={false}
        onOpenChange={() => {}}
        {...props}
      />,
    );
  });
}

const button = () => host.querySelector("button") as HTMLButtonElement;

beforeEach(() => { localStorage.clear(); });
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
});

describe("the vault line in the sidebar", () => {
  it("names the vault in every window", async () => {
    await mount();
    // The client shows the same vault as the central window — it is the same
    // process, and the name is how the user knows the two belong together.
    expect(host.textContent).toContain("notes");
  });

  it("opens the menu in the central window", async () => {
    const onOpenChange = vi.fn();
    await mount({ closeVault: () => {}, recentVaults: ["/a/one", "/b/two"], onOpenChange });
    expect(button().disabled).toBe(false);
    expect(button().getAttribute("aria-haspopup")).toBe("true");
    await act(async () => { button().click(); });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("lists the other vaults when the menu is open", async () => {
    await mount({ open: true, closeVault: () => {}, recentVaults: ["/a/one", "/home/me/notes"] });
    // The vault that is already open is not an offer.
    expect(host.textContent).toContain("one");
    expect(host.querySelectorAll(".pv-menu-item")).toHaveLength(2);
  });

  it("asks the central window instead of switching, in a client", async () => {
    const deferToOwner = vi.fn();
    await mount({ deferToOwner });
    // Not disabled: a dead grey line is the thing this replaces.
    expect(button().disabled).toBe(false);
    await act(async () => { button().click(); });
    expect(deferToOwner).toHaveBeenCalledTimes(1);
  });

  it("never renders the owner menu in a client", async () => {
    // Even asked to be open: without `closeVault` there is nothing here that
    // this window may do, and offering it would be a lie.
    await mount({ open: true, deferToOwner: () => {}, recentVaults: ["/a/one"] });
    expect(host.querySelector(".pv-menu")).toBeNull();
    expect(host.textContent).not.toContain("one");
    expect(button().getAttribute("aria-haspopup")).toBeNull();
  });

  it("shows the sync state where there is a worker and a folder where there is not", async () => {
    await mount();
    expect(host.querySelector('[data-testid="sync-icon"]')).toBeNull();
    await act(async () => { root.unmount(); });
    host.remove();
    await mount({ syncWorker: {} as never });
    // A client gets a worker facade rather than null (C3) — so this icon is
    // exactly what tells the user the vault syncs, in BOTH windows.
    expect(host.querySelector('[data-testid="sync-icon"]')).not.toBeNull();
  });
});
