import { describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("./pimCredentials", () => ({ getPimCredentials: async () => stored.value }));

import { pimTargetCredentials } from "./pimTargetCredentials";

/**
 * Review of plan "Verbinden", finding 3: an account signed out on this phone
 * builds no calendar or task target - the worker kept polling iCloud or
 * Nextcloud with an emptied password, which they answer with a lockout.
 */
describe("the credentials a calendar target is built with", () => {
  it("are none for an account signed out on this phone", async () => {
    stored.value = { kind: "caldav", url: "https://caldav.icloud.com", user: "anna", pass: "", signedOutHere: true };
    expect(await pimTargetCredentials("v", "a")).toBeNull();
  });

  it("are the stored ones for a CalDAV server without a password", async () => {
    stored.value = { kind: "caldav", url: "https://dav.example", user: "anna", pass: "" };
    expect(await pimTargetCredentials("v", "a")).toEqual(stored.value);
  });

  it("are the new ones once a password signs the account in again", async () => {
    stored.value = { kind: "caldav", url: "https://dav.example", user: "anna", pass: "new", signedOutHere: true };
    expect(await pimTargetCredentials("v", "a")).toEqual(stored.value);
  });
});
