import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_CALENDAR_SCOPES,
  refreshOneDriveAccessToken,
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
  saveAccountToken,
  getAccountBroker,
  forgetAccountBroker,
  microsoftScopeFor,
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

describe("mobile scoped token renewal through the secure store", () => {
  beforeEach(() => {
    state.secrets.clear();
    state.records = [{ id: "ms", family: "microsoft", label: "Person", services: {
      files: { provider: "onedrive" }, calendar: { pimAccountId: "calendar" }, mail: { mailAccountId: "mail" },
    } }];
    forgetAccountBroker("v1", "ms");
    vi.mocked(refreshOneDriveAccessToken).mockReset();
    state.secrets.set(accountSecretKey("v1", "ms"), { clientId: "client", refreshToken: "first" });
  });

  it("uses distinct service permissions and the latest persisted rotation", async () => {
    const requests: string[] = [];
    vi.mocked(refreshOneDriveAccessToken).mockImplementation(async ({ scope, refreshToken }) => {
      requests.push(refreshToken);
      return { accessToken: `access-${scope}`, refreshToken: `rotation-${requests.length}`, expiresIn: 3600, scope };
    });
    const broker = getAccountBroker("v1", "ms");
    await expect(Promise.all(["files", "calendar", "mail"].map((service) => broker.getAccessToken(service))))
      .resolves.toEqual(["files", "calendar", "mail"].map((service) => `access-${microsoftScopeFor(service)}`));
    expect(requests).toEqual(["first", "rotation-1", "rotation-2"]);
    expect(state.secrets.get(accountSecretKey("v1", "ms"))).toMatchObject({ refreshToken: "rotation-3" });
  });

  it("rejects a narrowed response and retries instead of caching it", async () => {
    vi.mocked(refreshOneDriveAccessToken).mockResolvedValueOnce({ accessToken: "wrong", scope: microsoftScopeFor("files") })
      .mockResolvedValue({ accessToken: "correct", scope: microsoftScopeFor("calendar") });
    const broker = getAccountBroker("v1", "ms");
    await expect(broker.getAccessToken("calendar")).rejects.toThrow(/required permissions/);
    await expect(broker.getAccessToken("calendar")).resolves.toBe("correct");
    expect(refreshOneDriveAccessToken).toHaveBeenCalledTimes(2);
  });

  it("reconnect reaches an existing provider and blocks a late write from its old refresh", async () => {
    const provider = (await brokerTokenProvider("v1", "calendar", "calendar"))!;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(refreshOneDriveAccessToken).mockImplementationOnce(async () => {
      await waiting;
      return { accessToken: "old", refreshToken: "old-rotation" };
    }).mockResolvedValue({ accessToken: "fresh", scope: microsoftScopeFor("calendar") });
    const first = provider(false);
    const failure = expect(first).rejects.toThrow(/sign-in changed/);
    await vi.waitFor(() => expect(refreshOneDriveAccessToken).toHaveBeenCalledTimes(1));
    await saveAccountToken("v1", "ms", { clientId: "client", refreshToken: "new-consent", scopes: microsoftScopeFor("calendar") });
    release(); await failure;
    await expect(provider(false)).resolves.toBe("fresh");
    expect(state.secrets.get(accountSecretKey("v1", "ms"))).toMatchObject({ refreshToken: "new-consent" });
  });
});
