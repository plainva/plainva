// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, useEffect, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The app half and the vault half, told apart (multi-window stage D).
 *
 * These assertions guard the line the split drew: what belongs to the APP
 * (recents, the last-vault memory, auto-open, which vault a window shows) and
 * what belongs to a VAULT (the runtime, one per open vault). A regression here
 * does not look like a crash — it looks like a second window quietly running a
 * second sync worker on the same files, which is the failure this architecture
 * exists to prevent.
 */

const storeValues: Record<string, unknown> = {};
vi.mock("../services/settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async <T,>(k: string) => storeValues[k] as T | undefined,
    set: async (k: string, v: unknown) => {
      storeValues[k] = v;
    },
    save: async () => {},
  }),
}));

const picked = { value: null as string | null };
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => picked.value }));

let windowLabel: string | null = null;
vi.mock("../services/windowContext", () => ({
  currentWindowParams: () => ({ role: "owner", vaultPath: null, content: null, label: windowLabel, preset: null }),
}));

/**
 * The real provider builds an indexer, a watcher and a sync chain over Tauri.
 * What the host decides is only WHICH vaults get one and which of them draws
 * the app, so a stub is the honest scope here — the runtime itself is covered
 * by the suites this refactor deliberately left untouched.
 */
const mounted: string[] = [];
vi.mock("./VaultContext", async () => {
  const actual = await vi.importActual<typeof import("./VaultContext")>("./VaultContext");
  return {
    ...actual,
    VaultProvider: ({ vaultPath, appBooting, children }: { vaultPath?: string | null; appBooting?: boolean; children?: ReactNode }) => {
      useEffect(() => {
        if (!vaultPath) return;
        mounted.push(vaultPath);
        return () => {
          const i = mounted.indexOf(vaultPath);
          if (i >= 0) mounted.splice(i, 1);
        };
      }, [vaultPath]);
      return (
        <div data-testid={`runtime:${vaultPath ?? "none"}`} data-booting={String(Boolean(appBooting))}>
          {children}
        </div>
      );
    },
  };
});

import { AppProvider, LAST_VAULT_PATHS_KEY, StaticAppProvider, useApp } from "./AppContext";
import { VaultHost } from "./VaultHost";
import { acquireVault, heldVaults, holdersOf, releaseHolder, resetVaultRuntimes } from "../services/vaultRuntimes";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let api: ReturnType<typeof useApp> | null = null;

const Probe: React.FC = () => {
  const app = useApp();
  useEffect(() => {
    api = app;
  });
  return null;
};

beforeEach(() => {
  for (const k of Object.keys(storeValues)) delete storeValues[k];
  mounted.length = 0;
  windowLabel = null;
  picked.value = null;
  api = null;
  resetVaultRuntimes();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Renders and lets the boot read of the settings store settle. */
async function mount(el: ReactElement) {
  await act(async () => {
    root.render(el);
  });
}

const q = (sel: string) => container.querySelector(sel);

describe("app layer and vault layer (stage D)", () => {
  it("reopens the remembered vault only when auto-open is on", async () => {
    storeValues.lastVaultPath = "/A";
    storeValues.autoOpenLastVault = true;
    await mount(<AppProvider><Probe /></AppProvider>);
    expect(api!.shownVault).toBe("/A");

    await act(async () => root.unmount());
    resetVaultRuntimes();
    root = createRoot(container);
    storeValues.autoOpenLastVault = false;
    await mount(<AppProvider><Probe /></AppProvider>);
    // The remembered path is still there; the switch decides whether it is used,
    // and without it the app starts on the splash.
    expect(api!.shownVault).toBe(null);
    expect(storeValues.lastVaultPath).toBe("/A");
  });

  it("adds a remembered vault that never made it into the list", async () => {
    storeValues.lastVaultPath = "/A";
    storeValues.recentVaults = ["/B"];
    await mount(<AppProvider><Probe /></AppProvider>);
    expect(api!.recentVaults).toEqual(["/A", "/B"]);
  });

  it("holds exactly the vault this window shows, and lets go on close", async () => {
    windowLabel = "full-1";
    storeValues.lastVaultPath = "/A";
    storeValues.autoOpenLastVault = true;
    await mount(<AppProvider><Probe /></AppProvider>);
    expect(heldVaults()).toEqual(["/A"]);
    expect(holdersOf("/A")).toEqual(["full-1"]);

    await act(async () => {
      await api!.openVault("/B");
    });
    // A window looks at one vault: opening another MOVES the hold instead of
    // stacking a second one, so the first runtime is free to stop.
    expect(heldVaults()).toEqual(["/B"]);

    await act(async () => {
      await api!.closeVault();
    });
    expect(heldVaults()).toEqual([]);
  });

  it("lets go of the vault when the window goes away", async () => {
    storeValues.lastVaultPath = "/A";
    storeValues.autoOpenLastVault = true;
    await mount(<AppProvider><Probe /></AppProvider>);
    expect(heldVaults()).toEqual(["/A"]);

    await act(async () => root.unmount());
    root = createRoot(container);
    // A closed window that kept its hold would leave a sync worker polling for
    // a window nobody can see.
    expect(heldVaults()).toEqual([]);
  });

  it("remembers an opened vault, forgets a removed one, keeps the list on close", async () => {
    storeValues.recentVaults = ["/A"];
    await mount(<AppProvider><Probe /></AppProvider>);
    expect(api!.recentVaults).toEqual(["/A"]);

    await act(async () => {
      await api!.openVault("/B");
    });
    expect(api!.recentVaults).toEqual(["/B", "/A"]);
    expect(storeValues.lastVaultPath).toBe("/B");

    await act(async () => {
      await api!.removeRecentVault("/A");
    });
    expect(api!.recentVaults).toEqual(["/B"]);

    await act(async () => {
      await api!.closeVault();
    });
    // Closing forgets which vault to REOPEN but keeps it in the recent list.
    expect(storeValues.lastVaultPath).toBe(null);
    expect(api!.recentVaults).toEqual(["/B"]);
  });

  it("persists the auto-open switch", async () => {
    await mount(<AppProvider><Probe /></AppProvider>);
    await act(async () => {
      await api!.setAutoOpenLastVault(true);
    });
    expect(api!.autoOpenLastVault).toBe(true);
    expect(storeValues.autoOpenLastVault).toBe(true);
  });

  it("does not open a vault when the folder picker was cancelled", async () => {
    await mount(<AppProvider><Probe /></AppProvider>);
    await act(async () => {
      await api!.selectVault();
    });
    expect(api!.shownVault).toBe(null);
    expect(heldVaults()).toEqual([]);
  });

  it("runs one runtime per held vault and draws the app under the shown one", async () => {
    storeValues.lastVaultPath = "/A";
    storeValues.autoOpenLastVault = true;
    await mount(
      <AppProvider>
        <VaultHost><span data-testid="app" /></VaultHost>
      </AppProvider>,
    );
    expect(mounted).toEqual(["/A"]);
    // The app renders UNDER the shown vault, not beside it: a tree under the
    // wrong runtime would read and write the wrong vault.
    expect(q('[data-testid="runtime:/A"] [data-testid="app"]')).not.toBeNull();
  });

  it("keeps a runtime for a vault only another window shows", async () => {
    storeValues.lastVaultPath = "/A";
    storeValues.autoOpenLastVault = true;
    await mount(
      <AppProvider>
        <VaultHost><span data-testid="app" /></VaultHost>
      </AppProvider>,
    );

    await act(async () => acquireVault("/B", "full-1"));
    // /B runs in the central window although nothing here shows it: a client
    // window reads through the owner and never boots a runtime of its own.
    expect([...mounted].sort()).toEqual(["/A", "/B"]);
    expect(q('[data-testid="runtime:/B"]')?.childElementCount).toBe(0);
  });

  it("remembers every open vault, not just the last one opened", async () => {
    // One string could only ever bring one vault back: a second window's vault
    // was forgotten on every restart, silently — the app came up looking
    // perfectly normal, just missing a window.
    storeValues.lastVaultPath = "/A";
    storeValues.autoOpenLastVault = true;
    await mount(<AppProvider><Probe /></AppProvider>);
    await act(async () => acquireVault("/B", "full-1"));
    await act(async () => {
      await Promise.resolve();
    });
    expect([...(storeValues[LAST_VAULT_PATHS_KEY] as string[])].sort()).toEqual(["/A", "/B"]);
  });

  it("does not erase the memory on a start that shows no vault", async () => {
    // The splash holds nothing, and the process drains the held set on the way
    // out. Writing that empty set would wipe the memory in the one moment it is
    // about to be read.
    storeValues[LAST_VAULT_PATHS_KEY] = ["/A", "/B"];
    await mount(<AppProvider><Probe /></AppProvider>);
    await act(async () => {
      await Promise.resolve();
    });
    expect(storeValues[LAST_VAULT_PATHS_KEY]).toEqual(["/A", "/B"]);
  });

  it("drops a vault whose window went away", async () => {
    storeValues.lastVaultPath = "/A";
    storeValues.autoOpenLastVault = true;
    await mount(<AppProvider><Probe /></AppProvider>);
    await act(async () => acquireVault("/B", "full-1"));
    await act(async () => releaseHolder("full-1"));
    await act(async () => {
      await Promise.resolve();
    });
    // A closed window's vault is not open any more — and would otherwise
    // reappear on the next start as a window nobody asked for.
    expect(storeValues[LAST_VAULT_PATHS_KEY]).toEqual(["/A"]);
  });

  it("forgets a vault that was closed on purpose", async () => {
    storeValues.lastVaultPath = "/A";
    storeValues.autoOpenLastVault = true;
    await mount(<AppProvider><Probe /></AppProvider>);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await api!.closeVault();
    });
    // Otherwise it comes back on the next start and the button looks broken.
    expect(storeValues[LAST_VAULT_PATHS_KEY]).toEqual([]);
  });

  it("seeds the list from the single vault an older version remembered", async () => {
    storeValues.lastVaultPath = "/A";
    await mount(<AppProvider><Probe /></AppProvider>);
    // Auto-open is off here, so nothing is held: the memory still has to survive
    // the update, or a first start after it comes up empty.
    expect(storeValues[LAST_VAULT_PATHS_KEY]).toEqual(["/A"]);
  });

  it("does not show the splash while the app is still deciding", async () => {
    // The settings read takes a few milliseconds. Clearing the loading state
    // before it returns would flash the splash on every auto-opening start.
    storeValues.lastVaultPath = "/A";
    storeValues.autoOpenLastVault = true;
    act(() => {
      root.render(
        <AppProvider>
          <VaultHost><span data-testid="app" /></VaultHost>
        </AppProvider>,
      );
    });
    const seenBooting = q('[data-testid="runtime:none"]')?.getAttribute("data-booting") === "true";
    await act(async () => {});
    expect(seenBooting).toBe(true);
    expect(mounted).toEqual(["/A"]);
  });

  it("gives the splash a vault context without building a runtime", async () => {
    await mount(
      <AppProvider>
        <VaultHost><span data-testid="app" /></VaultHost>
      </AppProvider>,
    );
    expect(q('[data-testid="runtime:none"] [data-testid="app"]')).not.toBeNull();
    expect(mounted).toEqual([]);
  });

  it("refuses to change the vault from an auxiliary window", async () => {
    await mount(<StaticAppProvider vaultPath="/A"><Probe /></StaticAppProvider>);
    expect(api!.shownVault).toBe("/A");
    // Loud rather than silent: a window that cannot switch vaults has to say
    // so, because a call that quietly does nothing is unreportable.
    await expect(api!.openVault("/B")).rejects.toThrow(/owner-only/);
    await expect(api!.closeVault()).rejects.toThrow(/owner-only/);
    expect(heldVaults()).toEqual([]);
  });
});
