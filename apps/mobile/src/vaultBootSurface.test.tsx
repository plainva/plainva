// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRoot, type Root } from "react-dom/client";
import type { VaultEntry } from "./services/vaultRegistry";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * What the shell shows while it has no vault (issue 143).
 *
 * It rendered an empty container: while the vault opened, and for good when the
 * boot failed or never answered — the reporter's phone stayed blank with no way
 * out. The shell is the whole app and cannot be rendered in a unit test, so
 * this renders what it renders without a vault — the boot hook and the boot
 * surface, wired the way App.tsx wires them — and pins that wiring in the
 * shell's source.
 */

const boot = vi.hoisted(() => ({
  next: null as null | (() => Promise<unknown>),
  switchVault: vi.fn(async () => {}),
  previous: null as VaultEntry | null,
  vaults: [] as VaultEntry[],
  activeId: "folder-1",
}));

vi.mock("./services/vaultService", () => ({
  getMobileVault: () => boot.next!(),
  previousMobileVault: async () => boot.previous,
  switchVault: boot.switchVault,
}));
vi.mock("./services/vaultRegistry", () => ({
  getActiveVaultEntry: async () => boot.vaults.find((v) => v.id === boot.activeId)!,
  listVaults: async () => boot.vaults,
}));
vi.mock("./services/conflictState", () => ({ bindConflictStore: vi.fn() }));
vi.mock("./services/syncService", () => ({ startSyncIfConfigured: vi.fn(async () => {}) }));
vi.mock("./services/pim/pimService", () => ({ startPim: vi.fn(async () => {}), stopPim: vi.fn(), restartPimAfterImport: vi.fn(async () => {}) }));
vi.mock("./services/pim/pimOAuth", () => ({ resumePimOAuthResult: vi.fn(async () => {}) }));
vi.mock("./services/mail/mailRuntime", () => ({ startMobileMail: vi.fn(), stopMobileMail: vi.fn() }));

import "@plainva/ui/i18n";
import { useVaultBoot } from "./hooks/useVaultBoot";
import { VaultBootSurface } from "./components/VaultBootSurface";
import { beginIndexBuild, endIndexBuild, reportIndexBuild } from "./services/indexBuild";
import { currentMobileDialog, dismissMobileDialog } from "./services/mobileDialogs";

/** What App.tsx renders before its vault is there. */
function Shell() {
  const { vault, boot: state } = useVaultBoot({ onOpened: () => {}, onSwitching: () => {}, onAccountsImported: () => {} });
  if (!vault) return <VaultBootSurface boot={state} />;
  return <div data-testid="the-app" />;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  boot.switchVault.mockClear();
  boot.previous = null;
  boot.vaults = [
    { id: "local", name: "" },
    { id: "folder-1", name: "Notes", external: { handle: "h", label: "Notes", platform: "android" } },
  ];
  boot.activeId = "folder-1";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  const open = currentMobileDialog();
  if (open) dismissMobileDialog(open);
  act(() => root.unmount());
  container.remove();
  endIndexBuild("folder-1");
});

const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

describe("the shell without a vault", () => {
  it("shows the opening vault and the way back while the boot has not answered", async () => {
    boot.next = () => new Promise(() => {});
    boot.previous = { id: "local", name: "" };
    await act(async () => root.render(<Shell />));
    await settle();
    const surface = q("vault-boot");
    expect(surface, "never the empty container").not.toBeNull();
    expect(surface!.dataset.state).toBe("opening");
    expect(surface!.textContent).toContain("Notes");
    const back = q("vault-boot-back");
    expect(back).not.toBeNull();
    await act(async () => back!.click());
    expect(boot.switchVault).toHaveBeenCalledWith("local");
  });

  it("counts the files read while the vault's first index is built", async () => {
    boot.next = () => new Promise(() => {});
    await act(async () => root.render(<Shell />));
    await settle();
    expect(q("vault-boot-count")).toBeNull();
    await act(async () => { beginIndexBuild("folder-1"); reportIndexBuild("folder-1", 42, 1000); });
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
    expect(q("vault-boot-count")?.textContent).toContain("42");
  });

  it("after a cold start, offers the other vaults instead", async () => {
    boot.next = () => new Promise(() => {});
    await act(async () => root.render(<Shell />));
    await settle();
    expect(q("vault-boot-back")).toBeNull();
    const other = q("vault-boot-other");
    expect(other).not.toBeNull();
    await act(async () => other!.click());
    expect(currentMobileDialog()?.kind).toBe("actions");
  });

  it("says why a boot failed, with the way back and the way to try again", async () => {
    boot.next = () => Promise.reject(new Error("the folder did not answer list \"\" in time"));
    boot.previous = { id: "local", name: "" };
    await act(async () => root.render(<Shell />));
    await settle();
    const surface = q("vault-boot");
    expect(surface!.dataset.state).toBe("failed");
    expect(q("vault-boot-reason")?.textContent).toContain("did not answer");
    expect(q("vault-boot-back")).not.toBeNull();
    await act(async () => q("vault-boot-retry")!.click());
    expect(boot.switchVault).toHaveBeenCalledWith("folder-1");
  });

  it("drops the answer of a boot that a switch left behind", async () => {
    let lateAnswer: (v: unknown) => void = () => {};
    boot.next = () => new Promise((resolve) => { lateAnswer = resolve; });
    await act(async () => root.render(<Shell />));
    await settle();
    const first = lateAnswer;
    // A switch starts the next boot, which does not answer either.
    await act(async () => { window.dispatchEvent(new CustomEvent("m-vault-switched")); });
    await settle();
    await act(async () => first({ vaultId: "folder-1" }));
    await settle();
    expect(q("the-app"), "the vault the person left must not come back").toBeNull();
    expect(q("vault-boot")).not.toBeNull();
  });

  it("is what the shell renders without a vault", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const app = readFileSync(join(here, "App.tsx"), "utf8");
    expect(app).toMatch(/if \(!vault\) return <VaultBootSurface boot=\{boot\} \/>;/);
    expect(app).not.toMatch(/return <div className="m-app" \/>/);
    expect(app).toMatch(/const \{ vault, boot \} = useVaultBoot\(/);
  });
});
