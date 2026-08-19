import { describe, expect, it } from "vitest";
import { resolveMobileFileAccess } from "./fileSyncAccess";
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
    expect(resolveMobileFileAccess("s3", s3, false)).toEqual({ ready: false, blocked: true });
  });
});
