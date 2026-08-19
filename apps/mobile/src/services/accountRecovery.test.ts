import { beforeEach, describe, expect, it, vi } from "vitest";
import { DRIVE_DEFAULT_SCOPE, GOOGLE_CALENDAR_SCOPES } from "@plainva/core";
import type { CloudAccountRecord } from "@plainva/ui";

/**
 * The way back out of a shared sign-in that does not carry every service
 * (finding 2026-08-19).
 *
 * A Drive-only grant recorded as covering the calendar was not the whole
 * problem — the problem was that every path which could have corrected it read
 * the same claim back, and the one action that rebuilds the sign-in hid itself
 * the moment a token existed. These assertions pin the two questions the app
 * now asks instead: does this token actually carry the service, and is there
 * still something to repair?
 */

const state = vi.hoisted(() => ({ secrets: new Map<string, unknown>() }));

vi.mock("../platform/secureStore", () => ({
  secureCredentialStore: {
    readSecret: async (key: string) => state.secrets.get(key) ?? null,
    writeSecret: async (key: string, value: unknown) => void state.secrets.set(key, structuredClone(value)),
    removeSecret: async (key: string) => void state.secrets.delete(key),
  },
}));

vi.mock("./cloudAccountsStore", () => ({ loadCloudAccounts: async () => [] }));
vi.mock("./pim/pimOAuth", () => ({ beginPimOAuth: vi.fn(), setOAuthPurposeHandler: vi.fn() }));
vi.mock("./pim/pimCredentials", () => ({ getPimCredentials: vi.fn(async () => null), savePimCredentials: vi.fn() }));
vi.mock("./syncService", () => ({ getStoredProvider: vi.fn(async () => null), switchProviderToAccountBroker: vi.fn() }));

import { accountSecretKey, accountTokenCovers, tokenCoversService } from "./accountBroker";
import { canUnifyMobileAccount } from "./accountLogin";

const account = (services: CloudAccountRecord["services"]): CloudAccountRecord => ({
  id: "g1",
  family: "google",
  label: "person@example.invalid",
  services,
});

const bothServices = account({ files: { provider: "drive" }, calendar: { pimAccountId: "pim-1" } });

describe("shared sign-in coverage", () => {
  beforeEach(() => state.secrets.clear());

  it("does not treat a Drive-only grant as carrying the calendar", () => {
    const token = { clientId: "c", refreshToken: "r", scopes: DRIVE_DEFAULT_SCOPE };
    expect(tokenCoversService(token, "files", "google")).toBe(true);
    expect(tokenCoversService(token, "calendar", "google")).toBe(false);
  });

  it("accepts a grant that names the calendar scopes", () => {
    const token = { clientId: "c", refreshToken: "r", scopes: `${DRIVE_DEFAULT_SCOPE} ${GOOGLE_CALENDAR_SCOPES}` };
    expect(tokenCoversService(token, "calendar", "google")).toBe(true);
  });

  it("carries nothing without a refresh token, whatever the scopes claim", () => {
    expect(tokenCoversService({ clientId: "c", refreshToken: "", scopes: GOOGLE_CALENDAR_SCOPES }, "calendar", "google")).toBe(false);
    expect(tokenCoversService(null, "calendar", "google")).toBe(false);
  });

  it("keeps Microsoft on the historical rule: a token is enough", () => {
    expect(tokenCoversService({ clientId: "c", refreshToken: "r" }, "calendar", "microsoft")).toBe(true);
  });

  it("reads the stored slot for the same question", async () => {
    state.secrets.set(accountSecretKey("v1", "g1"), { clientId: "c", refreshToken: "r", scopes: DRIVE_DEFAULT_SCOPE });
    await expect(accountTokenCovers("v1", "g1", "calendar", "google")).resolves.toBe(false);
    await expect(accountTokenCovers("v1", "g1", "files", "google")).resolves.toBe(true);
  });
});

describe("unify action stays reachable while there is something to repair", () => {
  beforeEach(() => state.secrets.clear());

  it("offers itself when a shared token falls short of a service", async () => {
    state.secrets.set(accountSecretKey("v1", "g1"), { clientId: "c", refreshToken: "r", scopes: DRIVE_DEFAULT_SCOPE });
    await expect(canUnifyMobileAccount("v1", bothServices)).resolves.toBe(true);
  });

  it("offers itself when there is no shared token at all", async () => {
    await expect(canUnifyMobileAccount("v1", bothServices)).resolves.toBe(true);
  });

  it("stands down once the shared token carries every service", async () => {
    state.secrets.set(accountSecretKey("v1", "g1"), {
      clientId: "c",
      refreshToken: "r",
      scopes: `${DRIVE_DEFAULT_SCOPE} ${GOOGLE_CALENDAR_SCOPES}`,
    });
    await expect(canUnifyMobileAccount("v1", bothServices)).resolves.toBe(false);
  });

  it("never offers itself for a single-service account", async () => {
    await expect(canUnifyMobileAccount("v1", account({ calendar: { pimAccountId: "pim-1" } }))).resolves.toBe(false);
  });
});
