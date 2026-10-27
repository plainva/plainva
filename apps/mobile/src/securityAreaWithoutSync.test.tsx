// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * "Security & Sharing" in a vault without a sync provider (issue 143, the
 * side finding). Every open of the screen asked for the cloud store of the
 * vault's workspace — to bring publication counts in line — and that call
 * throws "sync connection required" where there is no provider. Nothing caught
 * it: an unhandled rejection on every open, and the line the reporter of #143
 * found in the diagnostics of a vault in a picked folder, which never has one.
 *
 * The store lookup is what the real one does without a provider: the throwing
 * variant throws, the looking one answers null.
 */

const store = vi.hoisted(() => ({
  get: vi.fn(async () => { throw new Error("sync connection required"); }),
  find: vi.fn(async () => null),
}));

vi.mock("./services/syncService", () => ({
  getStoredProvider: vi.fn(async () => null),
  getMobileWorkspaceObjectStore: store.get,
  findMobileWorkspaceObjectStore: store.find,
  getMobileRemoteWorkspaceInfo: vi.fn(async () => { throw new Error("sync connection required"); }),
  quarantineSync: vi.fn(),
  stopSyncAndDrain: vi.fn(async () => undefined),
}));
vi.mock("./services/vaultService", () => ({ reloadActiveMobileVault: vi.fn(async () => undefined) }));
vi.mock("./services/vaultRegistry", () => ({ getActiveVaultEntry: vi.fn(async () => ({ id: "folder-vault", name: "Notes" })) }));
vi.mock("./services/mobileWorkspaceSecurity", async () => {
  const none = () => vi.fn(async () => null);
  return new Proxy({} as Record<string, unknown>, {
    get: (cache, key) => {
      if (typeof key !== "string" || key === "then") return undefined;
      return (cache[key] ??= none());
    },
    has: () => true,
  });
});

import { SecurityAreaScreen } from "./screens/SecurityAreaScreen";

let container: HTMLDivElement;
let root: Root;
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };

beforeEach(() => {
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandled);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  process.off("unhandledRejection", onUnhandled);
});

describe("Security & Sharing without a sync provider", () => {
  it("opens without an unhandled rejection", async () => {
    const vault = { vaultId: "folder-vault", workspaceState: null, workspaceRuntime: null, db: null, syncQueue: null, files: {} };
    await act(async () => {
      root.render(<SecurityAreaScreen vault={vault as never} onBack={() => {}} onSetupWorkspace={() => {}} />);
    });
    // Let every promise the screen started settle, and the runtime report the ones nobody caught.
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(unhandled.map(String)).toEqual([]);
    expect(store.get).not.toHaveBeenCalled();
  });
});
