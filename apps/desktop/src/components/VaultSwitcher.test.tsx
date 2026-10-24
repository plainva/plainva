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

  it("opens the menu in any window that shows a vault", async () => {
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

  it("switches a second window to another vault (stage D)", async () => {
    // A client used to hand this to the central window, because one process
    // held one vault. It switches its own now — the runtime is still the
    // owner's, but which vault this WINDOW shows is this window's business.
    const openVault = vi.fn();
    await mount({ open: true, closeVault: () => {}, openVault, recentVaults: ["/a/one"] });
    const entry = [...host.querySelectorAll<HTMLButtonElement>(".pv-menu-item")][0];
    await act(async () => { entry.click(); });
    expect(openVault).toHaveBeenCalledWith("/a/one");
  });

  it("opens the other vault in a window of its own, and the menu goes", async () => {
    const openVaultWindow = vi.fn();
    const onOpenChange = vi.fn();
    await mount({ open: true, closeVault: () => {}, openVaultWindow, onOpenChange, recentVaults: ["/a/one"] });
    const inWindow = host.querySelector<HTMLButtonElement>(".pv-menu .pv-iconbtn")!;
    await act(async () => { inWindow.click(); });
    expect(openVaultWindow).toHaveBeenCalledWith("/a/one");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // The menu was drawn by hand until 2026-10-11: the look of a menu and none
  // of its contract. It stayed open until its own line was pressed again.
  it("is the menu primitive: Escape closes it, wherever the keyboard is", async () => {
    const onOpenChange = vi.fn();
    await mount({ open: true, closeVault: () => {}, onOpenChange, recentVaults: ["/a/one"] });
    expect(host.querySelector('.pv-menu[role="menu"]')).not.toBeNull();
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes on a press beside it — and leaves a press on its own line to the line", async () => {
    const onOpenChange = vi.fn();
    await mount({ open: true, closeVault: () => {}, onOpenChange, recentVaults: ["/a/one"] });
    const press = (target: Element) => act(async () => {
      target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    });
    // Inside the menu, and on the line it hangs on: neither is "beside".
    await press(host.querySelector(".pv-menu-label")!);
    await press(host.querySelector('button[aria-haspopup="true"]')!);
    expect(onOpenChange).not.toHaveBeenCalled();
    // The line's own press is what closes the menu there: one press, one change.
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-haspopup="true"]')!.click(); });
    expect(onOpenChange.mock.calls).toEqual([[false]]);

    await press(document.body);
    expect(onOpenChange.mock.calls).toEqual([[false], [false]]);
  });

  it("stays dead only where there is nothing to switch to", async () => {
    // No `closeVault` means no app layer behind this line at all (the splash
    // renders no sidebar) — offering a menu there would be a lie.
    await mount({ open: true, recentVaults: ["/a/one"] });
    expect(host.querySelector(".pv-menu")).toBeNull();
    expect(host.textContent).not.toContain("one");
    expect(button().disabled).toBe(true);
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
