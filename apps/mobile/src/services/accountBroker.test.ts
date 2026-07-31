import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_CALENDAR_SCOPES,
} from "@plainva/core";
import type { CloudAccountRecord } from "@plainva/ui";

const state = vi.hoisted(() => ({
  secrets: new Map<string, unknown>(),
  records: [] as CloudAccountRecord[],
  refreshDrive: vi.fn(async ({ clientId }: { clientId: string }) => ({
    accessToken: `access-${clientId}`,
    expiresIn: 3600,
  })),
}));

vi.mock("../platform/secureStore", () => ({
  secureCredentialStore: {
    readSecret: async (key: string) => state.secrets.get(key) ?? null,
    writeSecret: async (key: string, value: unknown) => void state.secrets.set(key, structuredClone(value)),
    removeSecret: async (key: string) => void state.secrets.delete(key),
  },
}));

vi.mock("./cloudAccountsStore", () => ({
  loadCloudAccounts: async () => state.records,
}));

vi.mock("@plainva/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plainva/core")>()),
  refreshDriveAccessToken: state.refreshDrive,
  refreshOneDriveAccessToken: vi.fn(),
}));

import {
  accountSecretKey,
  brokerTokenProvider,
  replaceAccountClientRegistration,
} from "./accountBroker";

const google = (id: string, pimId: string): CloudAccountRecord => ({
  id,
  family: "google",
  label: "person@example.invalid",
  services: { calendar: { pimAccountId: pimId } },
});

describe("mobile account broker local OAuth boundary", () => {
  beforeEach(() => {
    state.secrets.clear();
    state.records = [google("g1", "pim-1"), google("g2", "pim-2")];
    state.refreshDrive.mockClear();
  });

  it("routes a calendar through the matching local account slot", async () => {
    state.secrets.set(accountSecretKey("v1", "g1"), {
      clientId: "android-client-1",
      refreshToken: "android-refresh-1",
      scopes: GOOGLE_CALENDAR_SCOPES,
    });
    state.secrets.set(accountSecretKey("v1", "g2"), {
      clientId: "android-client-2",
      refreshToken: "android-refresh-2",
      scopes: GOOGLE_CALENDAR_SCOPES,
    });

    const provider = await brokerTokenProvider("v1", "calendar", "pim-2");
    await expect(provider?.(false)).resolves.toBe("access-android-client-2");
    expect(state.refreshDrive).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "android-client-2", refreshToken: "android-refresh-2" }),
      expect.anything(),
    );
  });

  it("does not hand a Drive-only Google grant to the calendar", async () => {
    state.secrets.set(accountSecretKey("v1", "g1"), {
      clientId: "android-client-1",
      refreshToken: "android-refresh-1",
      scopes: "https://www.googleapis.com/auth/drive",
    });

    await expect(brokerTokenProvider("v1", "calendar", "pim-1")).resolves.toBeUndefined();
  });

  it("changes client and invalidates token in one local slot write", async () => {
    state.secrets.set(accountSecretKey("v1", "g1"), {
      clientId: "old-client",
      clientSecret: "old-secret",
      refreshToken: "old-refresh",
      scopes: GOOGLE_CALENDAR_SCOPES,
    });

    await expect(replaceAccountClientRegistration("v1", "g1", {
      clientId: "new-client",
      clientSecret: "new-secret",
    })).resolves.toBe(true);
    expect(state.secrets.get(accountSecretKey("v1", "g1"))).toEqual({
      clientId: "new-client",
      clientSecret: "new-secret",
      refreshToken: "",
    });
  });
});
