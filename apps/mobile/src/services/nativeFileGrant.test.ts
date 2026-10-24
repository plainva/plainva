import { beforeEach, describe, expect, it, vi } from "vitest";
import { DRIVE_DEFAULT_SCOPE } from "@plainva/core";
import type { CloudAccountRecord } from "@plainva/ui";

/**
 * A Drive vault on Android signed in through Play services' system sheet holds
 * no refresh token: the slot carries `nativeGoogle` instead, and the sheet
 * renews. When the account broker adopts that sign-in onto its card (lazily,
 * whenever something asks the broker - the card list does), the slot is
 * blanked and its `nativeGoogle` removed; from then on the files must be
 * served by the card's grant through the broker.
 */

const IDENTITY = { issuer: "google", subject: "sub-anna" };
const EMAIL = "anna@gmail.com";
const CLIENT = "plainva-android.apps.googleusercontent.com";

const state = vi.hoisted(() => ({
  secrets: new Map<string, unknown>(),
  records: [] as CloudAccountRecord[],
  authorize: vi.fn(async () => ({ accessToken: "native-access", scope: "", expiresIn: 300, profile: { label: "anna@gmail.com", identity: { issuer: "google", subject: "sub-anna" } } })),
}));

vi.mock("../platform/secureStore", () => ({
  secureCredentialStore: {
    readSecret: async (key: string) => structuredClone(state.secrets.get(key) ?? null),
    writeSecret: async (key: string, value: unknown) => void state.secrets.set(key, structuredClone(value)),
    removeSecret: async (key: string) => void state.secrets.delete(key),
  },
}));
vi.mock("./cloudAccountsStore", () => ({ loadCloudAccounts: async () => state.records }));
vi.mock("./googleNativeAuthorization", () => ({
  authorizeNativeGoogle: state.authorize,
  forgetNativeGoogleTokens: () => undefined,
  googleSignInFlow: () => "native",
  hasGooglePlayServices: () => true,
}));
vi.mock("../adapters/webdavHttp", () => ({
  webdavFetch: async (url: string) => (String(url).includes("userinfo")
    ? new Response(JSON.stringify({ sub: "sub-anna", email: "anna@gmail.com", email_verified: true }), { status: 200 })
    : new Response("{}", { status: 404 })),
}));

import { fileBrokerTokenProvider, fileGrantProbe } from "./accountBroker";
import { syncProviderSlot } from "./syncSlot";

describe("a Drive sign-in through the system sheet, adopted onto its card", () => {
  beforeEach(() => {
    state.secrets.clear();
    state.authorize.mockClear();
    state.authorize.mockResolvedValue({ accessToken: "native-access", scope: DRIVE_DEFAULT_SCOPE, expiresIn: 300, profile: { label: EMAIL, identity: IDENTITY } });
    state.records = [{ id: "card-a", family: "google", label: EMAIL, verifiedProviderIdentity: IDENTITY, services: { files: { provider: "drive" } } }];
    state.secrets.set(syncProviderSlot("v1"), {
      provider: "drive",
      creds: { clientId: CLIENT, refreshToken: "", nativeGoogle: { email: EMAIL }, providerIdentity: IDENTITY, grantedScope: DRIVE_DEFAULT_SCOPE },
    });
  });

  it("is still served after the slot was handed to the card", async () => {
    const provider = await fileBrokerTokenProvider("v1", { provider: "drive", clientId: CLIENT });
    // The slot no longer names the system sheet: the card holds the sign-in now.
    const slot = state.secrets.get(syncProviderSlot("v1")) as { creds: Record<string, unknown> };
    expect(slot.creds.nativeGoogle).toBeUndefined();
    expect(provider, "the files must reach the card's grant through the broker").toBeTypeOf("function");
    expect(await provider!(false)).toBe("native-access");
  });

  it("passes the probe that signing in again and moving a vault use", async () => {
    await fileBrokerTokenProvider("v1", { provider: "drive", clientId: CLIENT });
    const probe = await fileGrantProbe("v1", "card-a", "google", { clientId: CLIENT });
    expect(await probe.getAccessToken()).toBe("native-access");
  });
});
