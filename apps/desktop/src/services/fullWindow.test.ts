// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWindowParams, buildWindowQuery, isOwnerWindow, resetWindowParamsForTest, windowStateKey, windowStatePrefix } from "./windowContext";

/**
 * The full second window (stage C).
 *
 * Three things have to hold for it, and each of them fails SILENTLY when it
 * does not — which is why they are pinned rather than commented:
 *
 * 1. `?win=full` parses as a client. Anything unrecognised falls back to owner,
 *    so a typo here would not error: it would boot a SECOND window that thinks
 *    it owns the background services, on the same vault, with two sync workers.
 * 2. Tauri assigns capabilities by window LABEL. A `full-1` window that matches
 *    no capability entry is not restricted, it is DEAD — every `invoke` is
 *    denied and the window shows an empty frame.
 * 3. The client window must not carry the owner's permissions either: the whole
 *    point is that one window owns the writes.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const CAPS = join(HERE, "..", "..", "src-tauri", "capabilities");
const clientCaps = JSON.parse(readFileSync(join(CAPS, "auxiliary-window.json"), "utf8"));
const ownerCaps = JSON.parse(readFileSync(join(CAPS, "default.json"), "utf8"));

describe("full second window", () => {
  it("parses ?win=full as a client window", () => {
    const p = parseWindowParams("?win=full&vault=/v&label=full-1");
    expect(p.role).toBe("full");
    expect(p.vaultPath).toBe("/v");
    expect(p.label).toBe("full-1");
  });

  it("is not the owner window", () => {
    // The guard the whole client path hangs on: everything from the vault
    // provider's mode to the window bus reads this one answer.
    resetWindowParamsForTest();
    const p = parseWindowParams("?win=full&vault=/v&label=full-1");
    expect(p.role === "owner").toBe(false);
    // …and an ordinary launch still is, byte for byte.
    expect(isOwnerWindow()).toBe(true);
    resetWindowParamsForTest();
  });

  it("builds a query the parser reads back", () => {
    const q = buildWindowQuery({ role: "full", vaultPath: "/v", label: "full-2" });
    expect(parseWindowParams(q)).toMatchObject({ role: "full", vaultPath: "/v", label: "full-2" });
  });

  it("is covered by the client capability, by label", () => {
    // `full-*` and nothing else: the label prefix IS the permission boundary.
    expect(clientCaps.windows).toContain("full-*");
  });

  it("is not covered by the owner capability", () => {
    for (const pattern of ownerCaps.windows as string[]) {
      // The owner set matches "main" exactly; a wildcard here would hand a
      // second window the updater, the watcher and every write permission.
      expect(pattern).toBe("main");
    }
  });
});

/**
 * What the second window does NOT do itself (stage C2).
 *
 * The claim is not "the buttons are gone" — they are not, deliberately: a
 * greyed-out gear explains nothing. It is that the shell decides in ONE place
 * what happens behind them, so a fourth entry point for the same run cannot
 * quietly bypass it.
 */
describe("runs that stay with the central window", () => {
  it("hands the vault-wide runs over from the client shell", () => {
    const shell = read("AppShell.tsx");
    // Both events, one listener block: index.md sweep and manual backup.
    expect(shell).toContain('defer("update-indexes")');
    expect(shell).toContain('defer("backup")');
    // …and the local run is switched off in the same window, otherwise it
    // would happen twice.
    expect(shell).toContain("if (capabilities.deferToOwner) return; // handed over above");
  });

  it("does not leave the vault switcher as a dead command", () => {
    // The palette entry existed before this stage and called a capability the
    // client does not have — a command that silently does nothing.
    expect(read("AppShell.tsx")).toContain('capabilities.deferToOwner("switch-vault")');
  });

  it("is the client that defers, never the central window", () => {
    // If the owner ever carried `deferToOwner` it would ask ITSELF and the run
    // would never happen.
    expect(read("FullApp.tsx")).toContain("deferToOwner:");
    expect(read("App.tsx")).not.toContain("deferToOwner:");
  });
});

/**
 * What the second window shows about the sync (stage C3).
 *
 * A client has no worker of its own — there is one per vault, in the central
 * window. The mistake worth pinning is the shape of the ABSENCE: a null worker
 * does not read as "ask somebody else", it reads through the whole shell as
 * "this vault does not sync", and the status bar then says LOCAL for a vault
 * that syncs.
 */
describe("sync as a client window shows it", () => {
  it("gives a client window a sync worker rather than none", () => {
    const ctx = read("contexts/VaultContext.tsx");
    expect(ctx).toContain("syncWorker: createClientSyncWorker()");
  });

  it("takes the status from the owner instead of inventing one", () => {
    // Without the mirror the store in this window never leaves "idle".
    expect(read("contexts/VaultContext.tsx")).toContain('bus.onBroadcast("sync-status"');
    expect(read("services/ownerBus.ts")).toContain("installSyncStatusMirror");
  });
});

/**
 * What each window keeps to itself (stage C4, § 5.5).
 *
 * A second window exists in order to show something else. Sidebar widths, what
 * is collapsed and which context sections are open therefore belong to the
 * window, not to the app — while the central window keeps the keys it has
 * always had, so nobody's settings move on update.
 */
describe("window state", () => {
  it("scopes a client's key and leaves the central window's alone", () => {
    resetWindowParamsForTest();
    // An ordinary launch has no query at all: unscoped, byte for byte.
    expect(windowStateKey("plainva-left-sidebar-width")).toBe("plainva-left-sidebar-width");

    resetWindowParamsForTest("?win=full&vault=/v&label=full-1");
    expect(windowStateKey("plainva-left-sidebar-width")).toBe(windowStatePrefix("full-1") + "plainva-left-sidebar-width");
    resetWindowParamsForTest();
  });

  it("keeps the shell off the raw keys", () => {
    // The failure mode is silent and one-directional: a call site that writes
    // the unscoped key from a second window changes the CENTRAL window's
    // sidebar, and only that window's user notices.
    const shell = read("AppShell.tsx");
    for (const key of [
      "plainva-left-sidebar-width",
      "plainva-right-sidebar-width",
      "plainva-left-sidebar-collapsed",
      "plainva-right-sidebar-collapsed",
    ]) {
      expect(shell, `${key} must go through windowStateKey`).not.toContain(`localStorage.getItem("${key}")`);
      expect(shell, `${key} must go through windowStateKey`).not.toContain(`localStorage.setItem("${key}"`);
    }
    expect(read("components/RightSidebar.tsx")).toContain("windowStateKey(");
  });
});

/**
 * What happens when the central window changes vault (stage C5).
 *
 * One process holds one open vault (E7), so a client window’s vault is never
 * its own decision. Two failure shapes hide here, and both still LOOK like a
 * working window: one drawing the tree of a vault the process has left, and one
 * holding adapters the owner has already disposed.
 */
describe("following the central window's vault", () => {
  it("announces from state, not from the switcher", () => {
    const ctx = read("contexts/VaultContext.tsx");
    // The vault also changes through the splash, through "open recent" and
    // through closing it. Announcing at the switcher covers one door of four.
    expect(ctx).toContain("announceVaultChanged(state.vaultPath)");
    expect(ctx).toContain("}, [isClient, state.vaultPath]);");
  });

  it("announces the close as well", () => {
    // `vaultPath: string | null` is the point, and the call has to stay
    // unguarded: `if (state.vaultPath)` would leave every other window on the
    // vault that was just closed.
    expect(read("services/windowBus.ts")).toContain('"vault-changed": { vaultPath: string | null }');
    expect(read("contexts/VaultContext.tsx")).toContain(
      `    if (isClient) return;
    announceVaultChanged(state.vaultPath);`,
    );
  });

  it("lets a client follow the broadcast, not just its launch parameter", () => {
    const ctx = read("contexts/VaultContext.tsx");
    expect(ctx).toContain('bus.onBroadcast("vault-changed"');
    // The launch parameter seeds the state; it must not BE the state, or the
    // window would keep the vault it was born with.
    expect(ctx).toContain("useState<string | null>(clientVaultPath)");
    expect(ctx).toContain("}, [isClient, clientVault]);");
  });

  it("makes a client let go of the services it no longer has", () => {
    const ctx = read("contexts/VaultContext.tsx");
    const branch = ctx.slice(ctx.indexOf("if (!clientVault) {"), ctx.indexOf("if (!clientVault) {") + 900);
    for (const field of ["vaultAdapter: null", "queryService: null", "indexer: null", "syncWorker: null"]) {
      expect(branch, `the client must drop ${field}`).toContain(field);
    }
  });

  it("says so instead of drawing an empty tree", () => {
    // A full window has no "open vault" of its own to offer — it deliberately
    // carries no such capability — so an empty shell would be a dead end.
    const full = read("FullApp.tsx");
    expect(full).toContain("if (!vaultPath)");
    expect(full).toContain("window.noVaultTitle");
  });
});

/**
 * How a second window is opened at all (stage C6).
 *
 * `openFullWindow` existed from C0 and had no caller: the whole stage was
 * unreachable. It is a palette command in BOTH windows, and it travels as an
 * event rather than a call — a client capability deliberately carries no
 * permission to create a window (P0), so calling it there would fail at the
 * Tauri boundary instead of asking the window that may.
 */
describe("opening a second window", () => {
  it("offers the command and does not call the opener directly", () => {
    const shell = read("AppShell.tsx");
    expect(shell).toContain("openSecondWindow:");
    expect(shell).toContain('new CustomEvent("plainva-open-full-window")');
  });

  it("opens it in the central window and defers from a client", () => {
    const shell = read("AppShell.tsx");
    expect(shell).toContain("openFullWindow({ vaultPath })");
    expect(shell).toContain('defer("new-window")');
  });

  it("keeps the surface list in one place", () => {
    // The client used to spell the union out a second time; a value added on
    // one side and forgotten on the other fails as a type error at best and as
    // a silently ignored request at worst.
    expect(read("FullApp.tsx")).toContain("surface: OwnerSurface");
    expect(read("services/ownerBus.ts")).toContain('"new-window": "plainva-open-full-window"');
  });
});
