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
    const access = resolveFileSyncAccess(empty, false);
    expect(access.provider).toBeNull();
    expect(access.blocked).toBeNull();
  });

  it("accepts a broker-backed account whose own token is empty by design", () => {
    const slots = { ...empty, drive: drive({ refreshToken: "" }) };

    expect(resolveFileSyncAccess(slots, true).provider).toBe("drive");
    expect(resolveFileSyncAccess(slots, true).blocked).toBeNull();
  });

  it("reports the configured provider as blocked when nothing opens it", () => {
    // Exactly Marco's vault after the reconnect: the slot is there, the account
    // card said "connected", and no token on this device could open it.
    const slots = { ...empty, drive: drive({ refreshToken: "" }) };

    const access = resolveFileSyncAccess(slots, false);
    expect(access.provider).toBeNull();
    expect(access.blocked).toBe("drive");
    expect(access.ready.drive).toBe(false);
  });

  it("never routes Dropbox through the broker", () => {
    // Dropbox has no broker family — a token that exists for Google/Microsoft
    // must not make a tokenless Dropbox slot look usable.
    const slots = { ...empty, dropbox: { appKey: "k", refreshToken: "" } as SyncSlots["dropbox"] };

    expect(resolveFileSyncAccess(slots, true).blocked).toBe("dropbox");
  });

  it("keeps the settings form's provider precedence", () => {
    const slots = {
      ...empty,
      drive: drive(),
      webdav: { url: "https://cloud.example/dav", user: "u", pass: "p" } as SyncSlots["webdav"],
    };

    expect(resolveFileSyncAccess(slots, false).provider).toBe("drive");
  });

  it("treats a half-filled slot as blocked, not as absent", () => {
    // A vault whose S3 credentials lost their region is misconfigured, not
    // unconfigured — silence would leave the user without a single hint.
    const slots = {
      ...empty,
      s3: { endpoint: "e", bucket: "b", accessKeyId: "a", secretAccessKey: "s", region: "" } as SyncSlots["s3"],
    };

    const access = resolveFileSyncAccess(slots, false);
    expect(access.provider).toBeNull();
    expect(access.blocked).toBe("s3");
  });
});
