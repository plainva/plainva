import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which sign-in a calendar reads (finding 2026-08-19).
 *
 * The phone asked the shared account token first for Google as well, so a
 * calendar that had JUST been re-authorised kept reading a token that could not
 * see a calendar — and no button could change that, because every one of them
 * wrote the slot this provider never looked at. The desktop has drawn the line
 * since 2026-07-30; these assertions hold the phone to the same line.
 */

const state = vi.hoisted(() => ({
  brokerToken: vi.fn(async () => undefined as ((force: boolean) => Promise<string>) | undefined),
  refreshDrive: vi.fn(async () => ({ accessToken: "own-google-access", expiresIn: 3600 })),
  refreshOneDrive: vi.fn(async () => ({ accessToken: "own-ms-access", expiresIn: 3600 })),
  saved: [] as unknown[],
}));

vi.mock("../accountBroker", () => ({ brokerTokenProvider: state.brokerToken }));
vi.mock("../../adapters/webdavHttp", () => ({ webdavFetch: vi.fn() }));
vi.mock("./pimCredentials", () => ({ savePimCredentials: async (...args: unknown[]) => void state.saved.push(args) }));
vi.mock("@plainva/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plainva/core")>()),
  refreshDriveAccessToken: state.refreshDrive,
  refreshOneDriveAccessToken: state.refreshOneDrive,
}));

import { buildPimAuthProvider } from "./pimAuth";

const shared = (token: string) => async () => async () => token;

describe("mobile calendar token precedence", () => {
  beforeEach(() => {
    state.brokerToken.mockReset();
    state.brokerToken.mockResolvedValue(undefined);
    state.refreshDrive.mockClear();
    state.saved = [];
  });

  it("uses a Google calendar's own sign-in and never asks the shared token", async () => {
    state.brokerToken.mockImplementation(shared("shared-drive-only-access"));
    const provider = buildPimAuthProvider("v1", "a1", {
      kind: "google",
      clientId: "c",
      clientSecret: "s",
      refreshToken: "own-refresh",
    });

    await expect(provider.getAccessToken()).resolves.toBe("own-google-access");
    expect(state.brokerToken).not.toHaveBeenCalled();
  });

  it("falls back to the shared token when the Google account has no sign-in of its own", async () => {
    state.brokerToken.mockImplementation(shared("shared-access"));
    const provider = buildPimAuthProvider("v1", "a1", {
      kind: "google",
      clientId: "c",
      clientSecret: "s",
      refreshToken: "",
    });

    await expect(provider.getAccessToken()).resolves.toBe("shared-access");
    expect(state.refreshDrive).not.toHaveBeenCalled();
  });

  it("keeps Microsoft on the broker even with a per-service token, because its token rotates", async () => {
    state.brokerToken.mockImplementation(shared("shared-ms-access"));
    const provider = buildPimAuthProvider("v1", "a1", { kind: "microsoft", clientId: "c", refreshToken: "own-refresh" });

    await expect(provider.getAccessToken()).resolves.toBe("shared-ms-access");
  });

  it("re-probes after a negative answer while there is nothing to fall back on", async () => {
    // The repair writes the account slot while this provider is alive. A cached
    // "no broker" is what kept an account broken until the app restarted.
    state.brokerToken.mockResolvedValueOnce(undefined).mockImplementation(shared("repaired-access"));
    const provider = buildPimAuthProvider("v1", "a1", { kind: "google", clientId: "c", clientSecret: "s", refreshToken: "" });

    await expect(provider.getAccessToken()).resolves.toBe("repaired-access");
    expect(state.brokerToken).toHaveBeenCalledTimes(2);
  });

  it("says so instead of asking the provider to renew nothing", async () => {
    const provider = buildPimAuthProvider("v1", "a1", { kind: "google", clientId: "c", clientSecret: "s", refreshToken: "" });
    await expect(provider.getAccessToken()).rejects.toThrow(/no stored sign-in|connect it again/i);
    expect(state.refreshDrive).not.toHaveBeenCalled();
  });
});
