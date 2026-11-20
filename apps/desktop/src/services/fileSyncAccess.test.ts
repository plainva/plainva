import { describe, it, expect } from "vitest";
import { resolveFileSyncAccess, type SyncSlots } from "./fileSyncAccess";

/**
 * The rule that decides whether this device reaches the vault's file provider.
 * It exists once because it used to be answered twice — the loader looked for a
 * usable token, the account card looked for a slot — and the two drifted apart
 * exactly where stage B leaves the per-service slot empty on purpose.
 */

const empty: SyncSlots = { drive: null, onedrive: null, dropbox: null, s3: null, webdav: null };

const drive = (over: Partial<{ clientId: string; clientSecret: string; refreshToken: string }> = {}) => ({
  clientId: "cid",
  clientSecret: "sec",
  refreshToken: "rt",
  ...over,
});

describe("resolveFileSyncAccess", () => {
  it("says nothing is configured for a vault without slots", () => {
    const access = resolveFileSyncAccess(empty, { drive: false, onedrive: false });
    expect(access.provider).toBeNull();
    expect(access.blocked).toBeNull();
  });

  it("accepts a broker-backed account whose own token is empty by design", () => {
    const slots = { ...empty, drive: drive({ refreshToken: "" }) };

    expect(resolveFileSyncAccess(slots, { drive: true, onedrive: false }).provider).toBe("drive");
    expect(resolveFileSyncAccess(slots, { drive: true, onedrive: false }).blocked).toBeNull();
  });

  it("reports the configured provider as blocked when nothing opens it", () => {
    // Exactly Marco's vault after the reconnect: the slot is there, the account
    // card said "connected", and no token on this device could open it.
    const slots = { ...empty, drive: drive({ refreshToken: "" }) };

    const access = resolveFileSyncAccess(slots, { drive: false, onedrive: false });
    expect(access.provider).toBeNull();
    expect(access.blocked).toBe("drive");
    expect(access.ready.drive).toBe(false);
  });

  it("never routes Dropbox through the broker", () => {
    // Dropbox has no broker family — a token that exists for Google/Microsoft
    // must not make a tokenless Dropbox slot look usable.
    const slots = { ...empty, dropbox: { appKey: "k", refreshToken: "" } as SyncSlots["dropbox"] };

    expect(resolveFileSyncAccess(slots, { drive: true, onedrive: false }).blocked).toBe("dropbox");
  });

  it("keeps the settings form's provider precedence", () => {
    const slots = {
      ...empty,
      drive: drive(),
      webdav: { url: "https://cloud.example/dav", user: "u", pass: "p" } as SyncSlots["webdav"],
    };

    expect(resolveFileSyncAccess(slots, { drive: false, onedrive: false }).provider).toBe("drive");
  });

  it("treats a half-filled slot as blocked, not as absent", () => {
    // A vault whose S3 credentials lost their region is misconfigured, not
    // unconfigured — silence would leave the user without a single hint.
    const slots = {
      ...empty,
      s3: { endpoint: "e", bucket: "b", accessKeyId: "a", secretAccessKey: "s", region: "" } as SyncSlots["s3"],
    };

    const access = resolveFileSyncAccess(slots, { drive: false, onedrive: false });
    expect(access.provider).toBeNull();
    expect(access.blocked).toBe("s3");
  });

  /** Plan "Verbinden", V2: a password account signed out on this device needs a sign-in, not "again". */
  it("tells a slot signed out on this device from one that stopped working", () => {
    const webdav = { ...empty, webdav: { url: "https://cloud.example/dav", user: "u", pass: "", signedOutHere: true } as SyncSlots["webdav"] };
    expect(resolveFileSyncAccess(webdav, { drive: false, onedrive: false })).toMatchObject({ provider: null, blocked: "webdav", signedOut: true });
    const dropbox = { ...empty, dropbox: { appKey: "k", refreshToken: "", signedOutHere: true } as SyncSlots["dropbox"] };
    expect(resolveFileSyncAccess(dropbox, { drive: false, onedrive: false }).signedOut).toBe(true);
    // A token that ran out is no sign-out.
    const lapsed = { ...empty, dropbox: { appKey: "k", refreshToken: "" } as SyncSlots["dropbox"] };
    expect(resolveFileSyncAccess(lapsed, { drive: false, onedrive: false })).toMatchObject({ blocked: "dropbox" });
    expect(resolveFileSyncAccess(lapsed, { drive: false, onedrive: false }).signedOut).toBeUndefined();
    const s3 = { ...empty, s3: { endpoint: "e", bucket: "b", accessKeyId: "a", secretAccessKey: "s", region: "" } as SyncSlots["s3"] };
    expect(resolveFileSyncAccess(s3, { drive: false, onedrive: false }).signedOut).toBeUndefined();
  });

  it("keeps a WebDAV server without a password syncing (review finding 2)", () => {
    const webdav = { ...empty, webdav: { url: "https://cloud.example/dav", user: "u", pass: "" } as SyncSlots["webdav"] };
    expect(resolveFileSyncAccess(webdav, { drive: false, onedrive: false })).toMatchObject({ provider: "webdav", blocked: null });
  });
});

describe("the file sync of a vault whose address this device has not confirmed (F57; review of F57, O-3)", () => {
  it("is stopped at vault open and reads as unconfirmed, until the address is confirmed", async () => {
    const { confirmEndpointsIn, getPlatformServices, setPlatformServices } = await import("@plainva/ui");
    const { unconfirmedSyncSlots } = await import("./fileSyncAccess");
    const settings = new Map<string, unknown>();
    let previous: ReturnType<typeof getPlatformServices> | undefined;
    try {
      previous = getPlatformServices();
    } catch {
      previous = undefined;
    }
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
    const webdav = { url: "http://192.168.1.5/dav", user: "marco", pass: "pw" };
    const slots = { ...empty, webdav };
    const unconfirmed = await unconfirmedSyncSlots("/v", { s3: null, webdav });
    expect(unconfirmed).toEqual({ webdav: true });
    expect(resolveFileSyncAccess(slots, { drive: false, onedrive: false }, unconfirmed)).toMatchObject({ blocked: "webdav", signedOut: true, unconfirmed: true });
    await confirmEndpointsIn("/v", ["http://192.168.1.5:80"]);
    expect(await unconfirmedSyncSlots("/v", { s3: null, webdav })).toEqual({});
  });
});
