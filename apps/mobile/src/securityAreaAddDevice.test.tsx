// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { decodeWorkspaceInvite } from "@plainva/core";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A second phone of your own (R8, TestFlight 2026-11-08).
 *
 * The report: an encrypted vault on Google Drive could not be opened on a
 * second iPhone. A device joins with an invitation code from a device that is
 * already in - and the phone could not show one. "Add another device" was the
 * desktop's; inviting a member on the phone said "member created" and showed
 * no code. With two phones and no desktop the only way in was restoring from
 * the recovery file, which removes every other device. Now the phone shows the
 * same code the desktop does, and restoring says what it does first.
 */

const dialogs = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
const security = vi.hoisted(() => ({ recover: vi.fn(async () => null) }));

vi.mock("./services/syncService", () => ({
  getStoredProvider: vi.fn(async () => ({ provider: "drive" })),
  getMobileWorkspaceObjectStore: vi.fn(async () => ({})),
  findMobileWorkspaceObjectStore: vi.fn(async () => null),
  getMobileRemoteWorkspaceInfo: vi.fn(async () => ({ workspaceId: "ws-1", fingerprint: "fp-1" })),
  quarantineSync: vi.fn(),
  stopSyncAndDrain: vi.fn(async () => undefined),
}));
vi.mock("./services/vaultService", () => ({ reloadActiveMobileVault: vi.fn(async () => undefined) }));
vi.mock("./services/vaultRegistry", () => ({ getActiveVaultEntry: vi.fn(async () => ({ id: "v", name: "Notes" })) }));
vi.mock("./services/mobileDialogs", () => ({ mConfirm: dialogs.confirm, mPrompt: vi.fn(async () => null), mSelect: vi.fn(async () => null) }));
vi.mock("./services/mobileWorkspaceSecurity", async () => {
  const known: Record<string, unknown> = {
    getMobileWorkspaceStatus: vi.fn(async (vaultId: string) => (vaultId === "joined" ? { version: 1, workspaceId: "ws-1", fingerprint: "fp-1", deviceName: "iPhone 1", phase: "active", lastError: null } : null)),
    recoverMobileWorkspace: security.recover,
  };
  const none = () => vi.fn(async () => null);
  return new Proxy(known, {
    get: (cache, key) => {
      if (typeof key !== "string" || key === "then") return undefined;
      return (cache[key] ??= none());
    },
    has: () => true,
  });
});

import { SecurityAreaScreen } from "./screens/SecurityAreaScreen";

const runtime = {
  workspaceId: "ws-1",
  memberId: "member-owner",
  ownerMemberId: "member-owner",
  device: { publicIdentity: { deviceId: "device-1" } },
  groupKeys: [],
  policy: {
    payload: {
      devices: [{ deviceId: "device-1", displayName: "iPhone 1", platform: "ios", state: "active" }],
      members: [{ memberId: "member-owner", displayName: "Me", state: "active" }],
      assignments: [{ subjectKind: "member", subjectId: "member-owner", role: "Owner", scopeKind: "workspace" }],
      groups: [],
      slices: [],
    },
  },
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  dialogs.confirm.mockClear();
  security.recover.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("a second device of your own on the phone (R8)", () => {
  it("shows the invitation for this member, as the desktop does", async () => {
    const vault = { vaultId: "joined", workspaceState: null, workspaceRuntime: runtime, db: null, syncQueue: null, files: {} };
    await act(async () => {
      root.render(<SecurityAreaScreen vault={vault as never} initialArea="access" onBack={() => {}} onSetupWorkspace={() => {}} />);
    });
    await settle();
    const add = container.querySelector<HTMLElement>('[data-testid="workspace-add-device"]');
    expect(add).not.toBeNull();
    await act(async () => { add!.click(); });
    const code = container.querySelector('[data-testid="workspace-invite-code"]')?.textContent ?? "";
    // Bound to this member: the other device joins as you, not as a new person.
    expect(decodeWorkspaceInvite(code)).toEqual({ memberId: "member-owner", workspaceId: "ws-1", fingerprint: "fp-1", role: "Owner" });
  });

  it("asks before restoring, because restoring removes every other device", async () => {
    const vault = { vaultId: "second-phone", workspaceState: null, workspaceRuntime: null, db: null, syncQueue: null, files: {} };
    await act(async () => {
      root.render(<SecurityAreaScreen vault={vault as never} onBack={() => {}} onSetupWorkspace={() => {}} />);
    });
    await settle();
    const file = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(file).not.toBeNull();
    await act(async () => {
      Object.defineProperty(file!, "files", { value: [new File([new Uint8Array([1, 2, 3])], "vault.pvrecovery")], configurable: true });
      file!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    const code = [...container.querySelectorAll<HTMLInputElement>("input")].filter((input) => input.type !== "file").pop()!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(code, "ABCD-EFGH");
      code.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const restore = [...container.querySelectorAll<HTMLElement>("button, [role=button]")].filter((el) => /Restore access|workspaceSecurity\.restore$/.test(el.textContent?.trim() ?? "")).pop();
    expect(restore).toBeDefined();
    await act(async () => { restore!.click(); });
    await settle();
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/restoreRevokesTitle|Restore access on this device/), danger: true }));
    // Declined: nothing was restored, no device was removed.
    expect(security.recover).not.toHaveBeenCalled();
  });
});
