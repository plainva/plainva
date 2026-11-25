import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
      .toEqual({ start: false, status: "error", messageKey: "deviceSignIn.needed", queueLocalChanges: true, signInNeeded: true });
  });

  it("starts for a WebDAV vault without a password (review finding 2)", () => {
    expect(mobileSyncStart({ filesOff: false, entryProvider: "webdav", stored: webdav({ pass: "" }) })).toEqual({ start: true, settingsOnly: false });
  });

  it("stays paused while the person paused it, whatever the app does with its own pause (review finding 5b)", () => {
    expect(mobileSyncStart({ pausedHere: true, filesOff: false, entryProvider: "webdav", stored: webdav({ pass: "x" }) }))
      .toEqual({ start: false, status: "off", messageKey: null, queueLocalChanges: true });
    // Paused here stops the settings too, also while files are off for the vault (second review, B3).
    expect(mobileSyncStart({ pausedHere: true, filesOff: true, entryProvider: "webdav", stored: webdav({ pass: "x" }) }))
      .toEqual({ start: false, status: "off", messageKey: null, queueLocalChanges: true });
  });

  it("keeps only the settings travelling while files are off for the vault (second review, B3), and says so when nothing here opens the slot", () => {
    expect(mobileSyncStart({ filesOff: true, entryProvider: "webdav", stored: webdav({ pass: "x" }) })).toEqual({ start: true, settingsOnly: true });
    // A device signed out here stays still, settings included.
    expect(mobileSyncStart({ filesOff: true, entryProvider: "webdav", stored: webdav({ pass: "", signedOutHere: true }) }))
      .toEqual({ start: false, status: "error", messageKey: "deviceSignIn.needed", queueLocalChanges: true, signInNeeded: true });
    expect(mobileSyncStart({ filesOff: false, entryProvider: "webdav", stored: null })).toEqual({ start: false, status: "error", messageKey: "cloudAccounts.filesNoAccess", queueLocalChanges: true });
    expect(mobileSyncStart({ filesOff: false, stored: null })).toEqual({ start: false, status: "off", messageKey: null, queueLocalChanges: false });
  });
});

describe("every way a sync starts on the phone (second review, B2)", () => {
  it("goes through the one decision - no path starts a worker past it", () => {
    const source = readFileSync(join(__dirname, "syncService.ts"), "utf8");
    const decided = source.slice(source.indexOf("async function startSyncDecided("), source.indexOf("\n}\n", source.indexOf("async function startSyncDecided(")));
    // The worker and the settings-only sync are started in exactly one place each: the decided start.
    expect(source.match(/await startWorker\(/g)).toHaveLength(1);
    expect(source.match(/await startSettingsOnly\(/g)).toHaveLength(1);
    expect(decided).toMatch(/await startWorker\(v, stored, generation\)/);
    expect(decided).toMatch(/await startSettingsOnly\(v, stored, generation\)/);
    expect(decided).toMatch(/await decideStart\(v\)/);
    const decide = source.slice(source.indexOf("async function decideStart("), source.indexOf("\n}\n", source.indexOf("async function decideStart(")));
    expect(decide).toMatch(/mobileSyncStart\(/);
    expect(source.match(/mobileSyncStart\(/g)).toHaveLength(1);
    // Nothing else in the app builds a sync worker of its own.
    const others = ["vaultService.ts", "accountPassword.ts", "accountSignIn.ts", "serviceSwitches.ts"].map((file) => readFileSync(join(__dirname, file), "utf8"));
    for (const other of others) expect(other).not.toMatch(/new (SyncWorker|EncryptedWorkspaceWorker|SettingsOnlySync)\(/);
  });

  it("lets no sign-in, password change or switch end the person's pause (B4a)", () => {
    const files = readdirSync(join(__dirname)).filter((name) => /\.tsx?$/.test(name) && !name.includes(".test."));
    const writers = files.filter((file) => /pausedHere: false/.test(readFileSync(join(__dirname, file), "utf8")));
    expect(writers).toEqual(["syncService.ts"]);
    const sync = readFileSync(join(__dirname, "syncService.ts"), "utf8");
    // Only "Resume" and taking the files out of the vault end it.
    expect((sync.match(/pausedHere: false/g) ?? []).length).toBe(2);
    expect(sync).not.toMatch(/paused: (true|false)/);
  });
});

describe("the sync state belongs to the folder, not the account (third review, finding 1)", () => {
  it("is bound to the target in the one place a file worker is built, and nothing else clears it", () => {
    const sync = readFileSync(join(__dirname, "syncService.ts"), "utf8");
    const worker = sync.slice(sync.indexOf("async function startWorker("), sync.indexOf("const w = new SyncWorker(", sync.indexOf("async function startWorker(")));
    expect(worker).toMatch(/await bindMobileSyncState\(v, p\)/);
    // The reset is the binding's; removing an account or opening a vault clears nothing.
    expect((sync.match(/\.clearAll\(\)/g) ?? []).length).toBe(2);
    const open = readFileSync(join(__dirname, "vaultService.ts"), "utf8");
    expect(open).not.toMatch(/clearAll\(\)/);
  });
});


describe("an S3 or WebDAV address this phone has not confirmed (F57; review of F57, O3/O4)", () => {
  const s3: MobileSyncProvider = { provider: "s3", creds: { endpoint: "http://192.168.1.7:9000", region: "us-east-1", bucket: "b", accessKeyId: "k", secretAccessKey: "s" } } as MobileSyncProvider;

  it("stands still, names the address and asks for Confirm, never for a sign-in", () => {
    expect(mobileSyncStart({ filesOff: false, entryProvider: "s3", stored: s3, unconfirmed: true })).toMatchObject({
      start: false, status: "error", messageKey: "cloudAccounts.confirmAddress", messageParams: { address: "http://192.168.1.7:9000" }, confirmEndpoint: "http://192.168.1.7:9000",
    });
    expect(mobileSyncStart({ filesOff: false, entryProvider: "s3", stored: s3, unconfirmed: true })).not.toHaveProperty("signInNeeded");
  });

  it("opens no folder picker with the stored keys until it is confirmed", async () => {
    const { confirmEndpointsIn, getPlatformServices, setPlatformServices } = await import("@plainva/ui");
    const { folderPickAllowed } = await import("./fileSyncAccess");
    const settings = new Map<string, unknown>();
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
    expect(await folderPickAllowed("v", s3)).toBe(false);
    await confirmEndpointsIn("v", ["http://192.168.1.7:9000"]);
    expect(await folderPickAllowed("v", s3)).toBe(true);
  });
});
