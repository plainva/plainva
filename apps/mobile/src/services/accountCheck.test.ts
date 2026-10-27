import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudAccountRecord } from "@plainva/ui";

/**
 * "Check connection" on the phone (plan "Verbinden", V0). TestFlight build 144
 * reported files and calendar as not working while both ran: files were read
 * through the probe of a connection that does not exist yet (no vault, no
 * account - the slot's refresh token is empty since K2), and the calendar
 * through the registry's id instead of the row the account page shows.
 */

let grant: unknown = { clientId: "c", refreshToken: "r", scopes: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar" };
vi.mock("./accountBroker", () => ({ getAccountToken: async () => grant }));
vi.mock("./syncService", () => ({
  getStoredProvider: async () => ({ provider: "drive", creds: { clientId: "c", refreshToken: "" } }),
  // The creation probe: without the card it renews an empty token.
  listProviderFolders: async (_p: unknown, _path: string, context?: { cloudAccountId?: string }) => {
    if (!context?.cloudAccountId) throw new Error("invalid_request: refresh token missing");
    return [];
  },
  // The vault's stored slot, read the way the sync reads it.
  listStoredProviderFolders: async () => [],
}));
vi.mock("./pim/pimService", () => ({
  checkPimAccount: async (_vault: string, id: string) => {
    if (id !== "pim-local") throw new Error("not connected");
  },
}));
vi.mock("@plainva/ui/mail", () => ({ listMailAccounts: async () => [], checkMailbox: async () => undefined }));

import { checkMobileAccount } from "./accountCheck";

const record = {
  id: "acc-1",
  family: "google",
  label: "anna@gmail.com",
  // The registry's id for the calendar; this phone knows the row as "pim-local".
  services: { files: { provider: "drive" }, calendar: { pimAccountId: "pim-shared" } },
} as unknown as CloudAccountRecord;

describe("checkMobileAccount", () => {
  beforeEach(() => {
    grant = { clientId: "c", refreshToken: "r", scopes: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar" };
  });

  it("reads files through the vault's slot and the card's sign-in", async () => {
    const rows = await checkMobileAccount("v1", record, { pimAccountId: "pim-local" });
    expect(rows.find((row) => row.service === "files")).toEqual({ service: "files", state: "ok" });
  });

  it("checks the calendar row the account page shows", async () => {
    const rows = await checkMobileAccount("v1", record, { services: ["files", "calendar"], pimAccountId: "pim-local" });
    expect(rows).toEqual([
      { service: "files", state: "ok" },
      { service: "calendar", state: "ok" },
    ]);
  });

  it("says 'not signed in' for every service of a card signed out on this device", async () => {
    grant = null;
    const rows = await checkMobileAccount("v1", record, { pimAccountId: "pim-local" });
    expect(rows.map((row) => row.state)).toEqual(["signin", "signin"]);
  });
});
