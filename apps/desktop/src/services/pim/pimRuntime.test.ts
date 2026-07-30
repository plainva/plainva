import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PimAccountRow } from "@plainva/core";

const { getPimCredentials } = vi.hoisted(() => ({ getPimCredentials: vi.fn() }));
vi.mock("./pimCredentials", () => ({ getPimCredentials, savePimCredentials: vi.fn() }));
vi.mock("./pimAuth", () => ({ buildPimAuthProvider: () => ({ getAccessToken: async () => "token" }) }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("../authFetch", () => ({ microsoftAuthFetch: vi.fn() }));
vi.mock("@plainva/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plainva/core")>()),
  PimCacheRepository: class {},
  PimWorker: class {
    start() {}
    stop() {}
  },
}));

import { createPimRuntime } from "./pimRuntime";

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

  beforeEach(() => getPimCredentials.mockReset());

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
