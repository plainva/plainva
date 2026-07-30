import { describe, it, expect, vi, beforeEach } from "vitest";

const { brokerTokenProvider } = vi.hoisted(() => ({ brokerTokenProvider: vi.fn() }));
const { refreshDrive } = vi.hoisted(() => ({ refreshDrive: vi.fn() }));

vi.mock("../accountBroker", () => ({
  brokerTokenProvider,
  describeBrokerLookup: async () => "no shared sign-in",
}));
vi.mock("@plainva/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plainva/core")>()),
  refreshDriveAccessToken: refreshDrive,
}));
vi.mock("./pimSecrets", () => ({ savePimCredentials: vi.fn(), getPimCredentials: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("../authFetch", () => ({ microsoftAuthFetch: vi.fn() }));

import { buildPimAuthProvider } from "./pimAuth";

/**
 * Which sign-in the calendar uses — the question behind "I connected the
 * calendar again and it still fails" (finding 2026-07-30).
 *
 * The shared account token can legitimately be NARROWER than the service needs:
 * a Google consent granted for Drive covers Drive and nothing else, and no
 * refresh widens it, because Google returns exactly what was consented. Letting
 * that token speak for a calendar that holds its own, valid sign-in produced a
 * 401 that looked like an expired account and survived every re-authorisation.
 */
describe("google calendar auth", () => {
  beforeEach(() => {
    brokerTokenProvider.mockReset();
    refreshDrive.mockReset();
    refreshDrive.mockResolvedValue({ accessToken: "own-token", expiresIn: 3600 });
  });

  it("uses its own sign-in and never asks the shared account token", async () => {
    brokerTokenProvider.mockResolvedValue(async () => "shared-drive-token");
    const auth = buildPimAuthProvider("/vault", "pim1", {
      kind: "google",
      clientId: "cid",
      clientSecret: "sec",
      refreshToken: "own-refresh",
    });

    expect(await auth.getAccessToken()).toBe("own-token");
    expect(brokerTokenProvider).not.toHaveBeenCalled();
  });

  it("falls back to the shared token when its own slot was blanked by the migration", async () => {
    brokerTokenProvider.mockResolvedValue(async () => "shared-token");
    const auth = buildPimAuthProvider("/vault", "pim1", {
      kind: "google",
      clientId: "cid",
      clientSecret: "sec",
      refreshToken: "",
    });

    expect(await auth.getAccessToken()).toBe("shared-token");
    expect(refreshDrive).not.toHaveBeenCalled();
  });
});
