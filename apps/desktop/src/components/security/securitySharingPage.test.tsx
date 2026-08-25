// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import "@plainva/ui/i18n";

/**
 * What the security centre does when a button is pressed (plan P6).
 *
 * The three layers of proof are deliberately different. `packages/core` runs the
 * six workspace flows against real cryptography, so BEHAVIOUR is settled there.
 * `securitySharingContract.test.ts` reads this file's source and proves the
 * calls exist at all. Neither can see the piece in between: that the right
 * control reaches the control plane with the right ARGUMENTS.
 *
 * Removing somebody is where that gap bites. The two modes differ fundamentally
 * — an epoch change against rewriting every object — and the mode is chosen in
 * a dialog, carried through a callback and handed to the vault as a string a
 * grep cannot distinguish from the other one. So this asks the page: press
 * remove, choose, confirm, and say what arrived.
 *
 * No browser and no keys here on purpose; this is jsdom against a mocked vault.
 */

// Typed on purpose: an untyped stub records calls as an empty tuple, and the
// assertion that matters here reads the THIRD argument.
type Revoke = (id: string, reason: string, mode: "future" | "full") => Promise<void>;
const revokeWorkspaceMember = vi.fn<Revoke>(async () => undefined);
const revokeWorkspaceDevice = vi.fn<Revoke>(async () => undefined);

const governance = {
  memberId: "me",
  deviceId: "this-device",
  members: [
    { memberId: "me", displayName: "Marco", state: "active" },
    { memberId: "other", displayName: "Rea", state: "active" },
  ],
  devices: [],
  groups: [],
  assignments: [],
  slices: [],
  brokenSlices: [],
  quarantine: [],
  localForks: [],
};

/*
 * The page destructures around thirty functions out of the vault context and
 * calls several of them from effects. Listing every one would make this test a
 * copy of the context's shape that goes stale the day somebody adds a
 * thirty-first; the proxy hands back a resolved stub for anything the test does
 * not care about, and the handful of values the page READS are named.
 */
const vaultValues: Record<string, unknown> = {
  workspaceSecurityStatus: { phase: "active", workspaceId: "ws-1", fingerprint: "ab:cd" },
  revokeWorkspaceMember,
  revokeWorkspaceDevice,
  getWorkspaceGovernance: vi.fn(async () => governance),
  getWorkspaceDiagnostics: vi.fn(async () => ({ meta: {}, legacyPlaintextPaths: 0 })),
  detectJoinableWorkspace: vi.fn(async () => null),
};

vi.mock("../../contexts/VaultContext", () => ({
  useVault: () =>
    new Proxy(vaultValues, {
      get(target, key: string) {
        if (key in target) return target[key];
        const stub = vi.fn(async () => undefined);
        target[key] = stub;
        return stub;
      },
    }),
}));

let container: HTMLDivElement;
let root: Root;

async function renderMembersArea(): Promise<void> {
  const { SecuritySharingPage } = await import("./SecuritySharingPage");
  await act(async () => {
    root.render(
      <SecuritySharingPage
        selectedVault="/vault"
        isActiveVault
        hasSyncConnection
        securityArea="members"
        onOpenSecurityArea={() => {}}
      />,
    );
  });
  // The governance effect resolves a promise; let it land before asserting.
  await act(async () => { await Promise.resolve(); });
}

function click(element: Element | null): Promise<void> {
  expect(element, "the control this test drives has to exist").not.toBeNull();
  return act(async () => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("removing someone carries the chosen mode to the vault", () => {
  beforeEach(() => {
    revokeWorkspaceMember.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("hands over \"future\" when the dialog is confirmed as it opens", async () => {
    await renderMembersArea();
    await click(container.querySelector('[data-testid="workspace-revoke-member"]'));
    expect(container.querySelector('[data-testid="workspace-revoke-dialog"]')).not.toBeNull();
    await click(container.querySelector('[data-testid="workspace-revoke-confirm"]'));
    expect(revokeWorkspaceMember).toHaveBeenCalledTimes(1);
    expect(revokeWorkspaceMember.mock.calls[0]).toEqual(["other", "Removed in Security Center", "future"]);
  });

  it("hands over \"full\" once the second choice is picked", async () => {
    await renderMembersArea();
    await click(container.querySelector('[data-testid="workspace-revoke-member"]'));
    const radios = [...container.querySelectorAll('input[type="radio"][name="pv-revoke-mode"]')];
    expect(radios, "the dialog offers both modes").toHaveLength(2);
    await click(radios[1]);
    await click(container.querySelector('[data-testid="workspace-revoke-confirm"]'));
    expect(revokeWorkspaceMember.mock.calls[0]?.[2]).toBe("full");
  });

  it("does not offer removal for the member this device is", async () => {
    await renderMembersArea();
    const buttons = container.querySelectorAll('[data-testid="workspace-revoke-member"]');
    expect(buttons, "only the other member can be removed from here").toHaveLength(1);
  });
});
