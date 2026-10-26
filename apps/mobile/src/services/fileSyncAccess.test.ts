import { describe, expect, it } from "vitest";
import { mobileSyncStart, resolveMobileFileAccess } from "./fileSyncAccess";
import type { MobileSyncProvider } from "./syncService";

const drive = (refreshToken: string): MobileSyncProvider => ({
  provider: "drive",
  creds: { clientId: "c", clientSecret: "s", refreshToken, rootFolderName: "Plainva" },
});

describe("whether this device reaches the vault's file provider", () => {
  it("says nothing when no provider is configured at all", () => {
    // "No sync set up" is a state, not a failure — the card must stay quiet.
    expect(resolveMobileFileAccess(undefined, null, false)).toEqual({ ready: false, blocked: false });
  });

  it("reports a configured provider whose slot is gone as BLOCKED, not as off", () => {
    // The failure this exists for: the registry knows the provider, so every
    // surface said "connected" while the credential slot held nothing.
    expect(resolveMobileFileAccess("drive", null, false)).toEqual({ ready: false, blocked: true });
  });

  it("counts the account-wide token for a broker family", () => {
    // Stage B leaves the per-service refresh token empty ON PURPOSE. Demanding
    // one here declared exactly the unified accounts unreachable.
    expect(resolveMobileFileAccess("drive", drive(""), true)).toEqual({ ready: true, blocked: false });
    expect(resolveMobileFileAccess("drive", drive(""), false)).toEqual({ ready: false, blocked: true });
  });

  it("does not let the broker rescue Dropbox — it has no broker family", () => {
    const dropbox: MobileSyncProvider = { provider: "dropbox", creds: { appKey: "k", refreshToken: "" } };
    expect(resolveMobileFileAccess("dropbox", dropbox, true).ready).toBe(false);
  });

  it("treats a slot for a DIFFERENT provider as no slot", () => {
    // Two providers can never share a vault, so this is a leftover, not access.
    expect(resolveMobileFileAccess("onedrive", drive("r"), false)).toEqual({ ready: false, blocked: true });
  });

  it("asks WebDAV and S3 for what they actually need", () => {
    const webdav: MobileSyncProvider = { provider: "webdav", creds: { url: "https://dav", user: "u", pass: "p" } };
    expect(resolveMobileFileAccess("webdav", webdav, false).ready).toBe(true);
    const s3: MobileSyncProvider = {
      provider: "s3",
      creds: { endpoint: "e", bucket: "b", region: "r", accessKeyId: "a", secretAccessKey: "" },
    };
    // An empty secret alone is no sign-out (review finding 2): blocked, but not "signed out".
    expect(resolveMobileFileAccess("s3", s3, false)).toEqual({ ready: false, blocked: true });
  });

  it("says a password account signed out on this device needs a sign-in", () => {
    const webdav = { provider: "webdav", creds: { url: "https://dav", user: "u", pass: "", signedOutHere: true } } as MobileSyncProvider;
    expect(resolveMobileFileAccess("webdav", webdav, false)).toEqual({ ready: false, blocked: true, signedOut: true });
    const dropbox = { provider: "dropbox", creds: { appKey: "k", refreshToken: "", signedOutHere: true } } as MobileSyncProvider;
    expect(resolveMobileFileAccess("dropbox", dropbox, false).signedOut).toBe(true);
  });

  it("keeps a WebDAV vault set up without a password syncing (review finding 2)", () => {
    const webdav: MobileSyncProvider = { provider: "webdav", creds: { url: "https://dav", user: "", pass: "" } };
    expect(resolveMobileFileAccess("webdav", webdav, false)).toEqual({ ready: true, blocked: false });
    const lapsed: MobileSyncProvider = { provider: "dropbox", creds: { appKey: "k", refreshToken: "" } };
    expect(resolveMobileFileAccess("dropbox", lapsed, false)).toEqual({ ready: false, blocked: true });
  });
});

describe("whether the vault's sync worker starts", () => {
  const webdav = (creds: Record<string, unknown>) => ({ provider: "webdav", creds: { url: "https://dav", user: "u", ...creds } }) as MobileSyncProvider;

  it("does not start for a vault signed out on this phone, and says why (review finding 3)", () => {
    expect(mobileSyncStart({ filesOff: false, entryProvider: "webdav", stored: webdav({ pass: "", signedOutHere: true }) }))
      .toEqual({ start: false, status: "error", messageKey: "deviceSignIn.needed", queueLocalChanges: true });
  });

  it("starts for a WebDAV vault without a password (review finding 2)", () => {
    expect(mobileSyncStart({ filesOff: false, entryProvider: "webdav", stored: webdav({ pass: "" }) })).toEqual({ start: true });
  });

  it("stays paused while the person paused it, whatever the app does with its own pause (review finding 5b)", () => {
    expect(mobileSyncStart({ paused: false, pausedHere: true, filesOff: false, entryProvider: "webdav", stored: webdav({ pass: "x" }) }))
      .toEqual({ start: false, status: "off", messageKey: null, queueLocalChanges: true });
  });

  it("stands still without a word when files are off for the vault, and says so when nothing here opens the slot", () => {
    // ...and goes on queueing what changes here, so turning files on again sends it (review finding 4).
    expect(mobileSyncStart({ filesOff: true, entryProvider: "webdav", stored: webdav({ pass: "x" }) })).toEqual({ start: false, status: "off", messageKey: null, queueLocalChanges: true });
    expect(mobileSyncStart({ filesOff: false, entryProvider: "webdav", stored: null })).toEqual({ start: false, status: "error", messageKey: "cloudAccounts.filesNoAccess", queueLocalChanges: true });
    expect(mobileSyncStart({ filesOff: false, stored: null })).toEqual({ start: false, status: "off", messageKey: null, queueLocalChanges: false });
  });
});
