import { describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("./pimCredentials", () => ({ getPimCredentials: async () => stored.value }));

import { pimTargetCredentials, refuseUnconfirmedCalendar } from "./pimTargetCredentials";

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

describe("a calendar in the local network (F57)", () => {
  it("builds no target until this phone confirmed its address, and tells the sync why, naming it", async () => {
    const settings = new Map<string, unknown>();
    const { confirmEndpointsIn, getPlatformServices, setPlatformServices } = await import("@plainva/ui");
    let previous: ReturnType<typeof getPlatformServices> | undefined;
    try { previous = getPlatformServices(); } catch { previous = undefined; }
    setPlatformServices({
      ...previous,
      loadSettings: async () => ({
        get: async (k: string) => structuredClone(settings.get(k)),
        set: async (k: string, v: unknown) => void settings.set(k, structuredClone(v)),
        delete: async (k: string) => void settings.delete(k),
        keys: async () => [...settings.keys()],
        save: async () => undefined,
      }),
    } as unknown as Parameters<typeof setPlatformServices>[0]);
    stored.value = { kind: "caldav", url: "http://192.168.1.6/caldav", user: "anna", pass: "pw" };
    expect(await pimTargetCredentials("v", "a")).toBeNull();
    await expect(refuseUnconfirmedCalendar("v", "a")).rejects.toMatchObject({ name: "EndpointNotConfirmedError", endpoint: "http://192.168.1.6:80" });
    await confirmEndpointsIn("v", ["http://192.168.1.6:80"]);
    expect(await pimTargetCredentials("v", "a")).toEqual(stored.value);
    await expect(refuseUnconfirmedCalendar("v", "a")).resolves.toBeUndefined();
  });
});
