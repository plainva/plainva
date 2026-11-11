// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { mkdirSync, writeFileSync } from "node:fs";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Evidence markup for R8 (run with PLAINVA_EVIDENCE_HTML=<folder>): the phone's
 * Security & Sharing screen as React renders it - "Add another device", the
 * invitation panel for your own device and for a member, and the restore
 * question - written out as HTML so a browser can draw it with the shell's
 * built stylesheet at phone width. The web hull of the app cannot reach an
 * unlocked workspace (it has no cloud folder to hold one), so this is the
 * honest smallest picture: the real component and the real styles, with the
 * workspace and its store as doubles. Skipped in a normal run.
 */
const OUT = process.env.PLAINVA_EVIDENCE_HTML;

vi.mock("./services/syncService", () => ({
  getStoredProvider: vi.fn(async () => ({ provider: "drive" })),
  getMobileWorkspaceObjectStore: vi.fn(async () => ({})),
  findMobileWorkspaceObjectStore: vi.fn(async () => null),
  getMobileRemoteWorkspaceInfo: vi.fn(async () => ({ workspaceId: "ws-1", fingerprint: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90" })),
  quarantineSync: vi.fn(),
  stopSyncAndDrain: vi.fn(async () => undefined),
  restartSyncIfActive: vi.fn(async () => undefined),
  mobileEncryptedRemotePorts: vi.fn(async () => ({ load: async () => null, save: async () => undefined, clear: async () => undefined })),
}));
vi.mock("./services/vaultService", () => ({ reloadActiveMobileVault: vi.fn(async () => undefined) }));
vi.mock("./services/vaultRegistry", () => ({ getActiveVaultEntry: vi.fn(async () => ({ id: "v", name: "Notes" })) }));
vi.mock("./services/mobileWorkspaceSecurity", async () => {
  const known: Record<string, unknown> = {
    getMobileWorkspaceStatus: vi.fn(async (vaultId: string) => (vaultId === "joined" ? { version: 1, workspaceId: "ws-1", fingerprint: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90", deviceName: "iPhone 1", phase: "active", lastError: null } : null)),
  };
  return new Proxy(known, {
    get: (cache, key) => (typeof key !== "string" || key === "then" ? undefined : (cache[key] ??= vi.fn(async () => null))),
    has: () => true,
  });
});

import { SecurityAreaScreen } from "./screens/SecurityAreaScreen";
import { MobileDialogHost } from "./components/MobileDialogHost";

const runtime = {
  workspaceId: "ws-1",
  memberId: "member-owner-5b1d",
  ownerMemberId: "member-owner-5b1d",
  device: { publicIdentity: { deviceId: "device-1" } },
  groupKeys: [],
  policy: {
    payload: {
      devices: [{ deviceId: "device-1", displayName: "iPhone 1", platform: "ios", state: "active" }],
      members: [
        { memberId: "member-owner-5b1d", displayName: "Me", state: "active" },
        { memberId: "member-anna-77c2", displayName: "Anna", state: "active" },
      ],
      assignments: [
        { subjectKind: "member", subjectId: "member-owner-5b1d", role: "Owner", scopeKind: "workspace" },
        { subjectKind: "member", subjectId: "member-anna-77c2", role: "Editor", scopeKind: "workspace" },
      ],
      groups: [],
      slices: [],
    },
  },
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  container.className = "m-app";
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
function save(name: string) {
  mkdirSync(OUT!, { recursive: true });
  writeFileSync(`${OUT}/${name}.html`, document.body.innerHTML, "utf8");
}

describe.skipIf(!OUT)("evidence markup of the phone's join surfaces (R8)", () => {
  it("your own other device", async () => {
    await act(async () => { root.render(<SecurityAreaScreen vault={{ vaultId: "joined", workspaceState: null, workspaceRuntime: runtime, db: null, syncQueue: null, files: {} } as never} initialArea="access" onBack={() => {}} onSetupWorkspace={() => {}} />); });
    await settle();
    save("m-access-row");
    await act(async () => { container.querySelector<HTMLElement>('[data-testid="workspace-add-device"]')!.click(); });
    expect(container.querySelector('[data-testid="workspace-invite-panel"]')).not.toBeNull();
    save("m-add-device-panel");
  });

  it("a member's invitation", async () => {
    await act(async () => { root.render(<SecurityAreaScreen vault={{ vaultId: "joined", workspaceState: null, workspaceRuntime: runtime, db: null, syncQueue: null, files: {} } as never} initialArea="sharing" onBack={() => {}} onSetupWorkspace={() => {}} />); });
    await settle();
    const show = [...container.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent?.trim() === "Show invitation")!;
    await act(async () => { show.click(); });
    expect(container.querySelector('[data-testid="workspace-invite-panel"]')).not.toBeNull();
    save("m-member-invite-panel");
  });

  it("the restore question on a second phone", async () => {
    await act(async () => {
      root.render(<><SecurityAreaScreen vault={{ vaultId: "second-phone", workspaceState: null, workspaceRuntime: null, db: null, syncQueue: null, files: {} } as never} onBack={() => {}} onSetupWorkspace={() => {}} /><MobileDialogHost /></>);
    });
    await settle();
    save("m-join-screen");
    const file = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => {
      Object.defineProperty(file, "files", { value: [new File([new Uint8Array([1, 2, 3])], "vault.pvrecovery")], configurable: true });
      file.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    const code = [...container.querySelectorAll<HTMLInputElement>("input")].filter((input) => input.type !== "file").pop()!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(code, "ABCD-EFGH");
      code.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const restore = [...container.querySelectorAll<HTMLElement>("button, [role=button]")].filter((el) => /Restore access/.test(el.textContent?.trim() ?? "")).pop()!;
    await act(async () => { restore.click(); });
    await settle();
    expect(document.body.textContent).toContain("Restore access on this device?");
    save("m-restore-question");
  });
});
