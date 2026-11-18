import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PimAccountRow } from "@plainva/core";

const { getPimCredentials, scopeState, started, triggered, workerOptions } = vi.hoisted(() => ({ getPimCredentials: vi.fn(), scopeState: vi.fn(), started: vi.fn(), triggered: vi.fn(), workerOptions: [] as Array<Record<string, unknown>> }));
vi.mock("./pimCredentials", () => ({ getPimCredentials, savePimCredentials: vi.fn() }));
vi.mock("./pimAuth", () => ({ buildPimAuthProvider: () => ({ getAccessToken: async () => "token" }) }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("../authFetch", () => ({ microsoftAuthFetch: vi.fn() }));
vi.mock("@plainva/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plainva/core")>()),
  PimCacheRepository: class { setScopeState = scopeState; },
  PimWorker: class {
    constructor(options: Record<string, unknown>) { workerOptions.push(options); }
    start = started;
    triggerImmediate = triggered;
    stop() {}
  },
}));

import { confirmationEndpoint, confirmEndpointsIn, getPlatformServices, setPlatformServices } from "@plainva/ui";
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

  it("builds no target for an account signed out on this device - no request with an emptied password (review finding 3)", async () => {
    getPimCredentials.mockResolvedValue({ kind: "caldav", url: "https://caldav.icloud.com", user: "anna", pass: "", signedOutHere: true });
    expect(await runtime().buildTarget(row("caldav"))).toBeNull();
    // A Google account signed out here does not fall back to the card's (deleted) grant either.
    getPimCredentials.mockResolvedValue({ kind: "google", clientId: "cid", clientSecret: "sec", refreshToken: "", signedOutHere: true });
    expect(await runtime().buildTarget(row("google"))).toBeNull();
  });

  // Review 2026-11-18, fourth round (inject, outage): the worker had a way to
  // sign in at an address another device put into the shared row, and the
  // password went there before the server could prove anything. A device sends
  // its password only to the address of its own sign-in.
  it("gives the worker no way to sign in anywhere but the address of this device's own sign-in", async () => {
    workerOptions.length = 0;
    runtime();
    expect(workerOptions).toHaveLength(1);
    expect(Object.keys(workerOptions[0]).sort()).not.toContain("otherAccess");
    getPimCredentials.mockResolvedValue({ kind: "caldav", url: "https://cloud.example.com/remote.php/dav", user: "anna", pass: "pw" });
    const target = await runtime().buildTarget({ ...row("caldav"), config: { url: "https://evil.example/remote.php/dav", user: "anna" } });
    expect(target?.confirmedAccess?.()).toBeUndefined();
    expect((target as unknown as { creds: { url: string } }).creds.url).toBe("https://cloud.example.com/remote.php/dav");
  });

  it("still builds one for a CalDAV server without a password", async () => {
    getPimCredentials.mockResolvedValue({ kind: "caldav", url: "https://dav.example", user: "anna", pass: "" });
    expect(await runtime().buildTarget(row("caldav"))).not.toBeNull();
  });

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
  // F57 (maintainer, 2026-11-18): a stored password goes to an address without
  // TLS or in a private network only once this device confirmed it.
  it("builds no target for an unconfirmed address without TLS or in a private network, and one once it is confirmed", async () => {
    const settings = new Map<string, unknown>();
    let previous: ReturnType<typeof getPlatformServices> | undefined;
    try { previous = getPlatformServices(); } catch { previous = undefined; }
    setPlatformServices({
      ...previous,
      loadSettings: async () => ({
        get: async (key: string) => settings.get(key),
        set: async (key: string, value: unknown) => void settings.set(key, value),
        delete: async (key: string) => void settings.delete(key),
        keys: async () => [...settings.keys()],
        save: async () => undefined,
      }),
    } as unknown as Parameters<typeof setPlatformServices>[0]);
    for (const url of ["http://cloud.example.com/remote.php/dav", "https://192.168.1.5/remote.php/dav", "https://nas.home.arpa/dav"]) {
      getPimCredentials.mockResolvedValue({ kind: "caldav", url, user: "anna", pass: "pw" });
      expect(await runtime().buildTarget(row("caldav")), url).toBeNull();
      await confirmEndpointsIn("/vault", [confirmationEndpoint(url)]);
      expect(await runtime().buildTarget(row("caldav")), url).not.toBeNull();
    }
    if (previous) setPlatformServices(previous);
  });
});
