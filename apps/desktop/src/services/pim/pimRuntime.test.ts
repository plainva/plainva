import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PimAccountRow } from "@plainva/core";

const { getPimCredentials, scopeState, started, triggered } = vi.hoisted(() => ({ getPimCredentials: vi.fn(), scopeState: vi.fn(), started: vi.fn(), triggered: vi.fn() }));
vi.mock("./pimCredentials", () => ({ getPimCredentials, savePimCredentials: vi.fn() }));
vi.mock("./pimAuth", () => ({ buildPimAuthProvider: () => ({ getAccessToken: async () => "token" }) }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("../authFetch", () => ({ microsoftAuthFetch: vi.fn() }));
vi.mock("@plainva/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plainva/core")>()),
  PimCacheRepository: class { setScopeState = scopeState; },
  PimWorker: class {
    start = started;
    triggerImmediate = triggered;
    stop() {}
  },
}));

import { createPimRuntime, restartPimAccountAfterLogin } from "./pimRuntime";

/**
 * Which accounts the worker is even able to REACH.
 *
 * An account connected through the union consent keeps no per-service sign-in:
 * its one token lives in the account slot, read through the broker. Treating a
 * missing per-service slot as "not connected" skipped exactly those accounts —
 * every cycle, without an error, leaving an empty calendar list that read like
 * an account with nothing in it (finding 2026-07-30).
 */
describe("building a target for an account", () => {
  const runtime = () => createPimRuntime({ db: {} as never, vaultPath: "/vault" });
  const row = (provider: PimAccountRow["provider"]): PimAccountRow => ({
    id: "a1",
    provider,
    label: "marco@example.com",
    config: { clientId: "cid", clientSecret: "sec" },
    enabled: true,
  });

  beforeEach(() => { getPimCredentials.mockReset(); scopeState.mockReset(); started.mockClear(); triggered.mockClear(); });

  it("does not revive a runtime disposed before the login completes", async () => {
    const target = runtime();
    target.stop();
    await restartPimAccountAfterLogin(target, "a1");
    expect(scopeState).not.toHaveBeenCalled();
    expect(started).not.toHaveBeenCalled();
  });

  it("does not revive a runtime disposed while its old failure is cleared", async () => {
    const target = runtime();
    scopeState.mockImplementationOnce(async () => { target.stop(); throw new Error("database closed"); });
    await restartPimAccountAfterLogin(target, "a1");
    expect(started).not.toHaveBeenCalled();
    expect(triggered).not.toHaveBeenCalled();
  });

  it("restarts a live runtime only after a confirmed failure reset", async () => {
    const target = runtime();
    await restartPimAccountAfterLogin(target, "a1");
    expect(scopeState).toHaveBeenCalledWith("a1", "account", { lastError: null });
    expect(started).toHaveBeenCalledTimes(1);
    expect(triggered).toHaveBeenCalledTimes(1);
  });

  it("reaches a Google account whose sign-in lives in the shared account slot", async () => {
    getPimCredentials.mockResolvedValue(null);
    expect(await runtime().buildTarget(row("google"))).not.toBeNull();
  });

  it("reaches a Microsoft account the same way", async () => {
    getPimCredentials.mockResolvedValue(null);
    expect(await runtime().buildTarget(row("microsoft"))).not.toBeNull();
  });

  // CalDAV has no broker and no account slot, so here a missing slot really
  // does mean "not connected" — skipping it is correct.
  it("still skips a CalDAV account without stored credentials", async () => {
    getPimCredentials.mockResolvedValue(null);
    expect(await runtime().buildTarget(row("caldav"))).toBeNull();
  });
});
