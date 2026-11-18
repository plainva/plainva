import { describe, expect, it } from "vitest";
import {
  assertEndpointConfirmed,
  confirmEndpoints,
  confirmationEndpoint,
  EndpointNotConfirmedError,
  isEndpointConfirmed,
  isInsecurePublicUrl,
  mailConfirmationEndpoint,
  settleEndpointConfirmations,
  type EndpointConfirmationResources,
} from "@plainva/ui";

/**
 * No stored password to an address without TLS, or in a private network, that
 * this device never confirmed (maintainer, 2026-11-18, F57). The shared rule is
 * `packages/ui/src/lib/endpointConfirmation.ts`; both shells ask it.
 */

function memoryStore(): EndpointConfirmationResources & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    storeKey: "endpointConfirmations:vault-a",
    store: {
      get: async <T,>(key: string) => data.get(key) as T | undefined,
      set: async (key: string, value: unknown) => void data.set(key, structuredClone(value)),
      delete: async (key: string) => void data.delete(key),
      keys: async () => [...data.keys()],
      save: async () => undefined,
    } as unknown as EndpointConfirmationResources["store"],
  };
}

describe("which addresses need this device's confirmation", () => {
  it("every http address, and https only in a private network", () => {
    expect(confirmationEndpoint("http://cloud.example.org/remote.php/dav")).toBe("http://cloud.example.org:80");
    expect(confirmationEndpoint("https://cloud.example.org/remote.php/dav")).toBeNull();
    for (const host of [
      "10.0.0.5", "172.16.1.1", "172.31.255.1", "192.168.1.5", "127.0.0.1", "169.254.3.4", "100.64.0.1", "100.127.9.9",
      "[fd12:3456::1]", "[fe80::1]", "[::1]",
      "nas.local", "nas.lan", "nas.home.arpa", "nas.internal", "nas",
    ]) {
      expect(confirmationEndpoint(`https://${host}:8443/dav`), host).not.toBeNull();
    }
    for (const host of ["172.32.0.1", "100.128.0.1", "8.8.8.8", "[2001:db8::1]", "cloud.example.org", "home.arpa.example.org"]) {
      expect(confirmationEndpoint(`https://${host}/dav`), host).toBeNull();
    }
  });

  it("is the scheme, host and port — never the path or the user", () => {
    expect(confirmationEndpoint("http://alice:pw@192.168.1.5:8080/remote.php/dav/files/alice")).toBe("http://192.168.1.5:8080");
    expect(confirmationEndpoint("https://NAS.Local/dav")).toBe("https://nas.local:443");
    expect(confirmationEndpoint("https://[FD00::1]:5006/")).toBe("https://[fd00::1]:5006");
    expect(confirmationEndpoint("not an address")).toBeNull();
    expect(confirmationEndpoint("")).toBeNull();
  });

  it("mail: only a private host, since IMAP runs over TLS and SMTP refuses without STARTTLS", () => {
    expect(mailConfirmationEndpoint("imap", "imap.example.org", 993)).toBeNull();
    expect(mailConfirmationEndpoint("imap", "192.168.1.5", 993)).toBe("imap://192.168.1.5:993");
    expect(mailConfirmationEndpoint("smtp", "mail.home.arpa", 587)).toBe("smtp://mail.home.arpa:587");
  });

  it("leaves the http warning as it was", () => {
    expect(isInsecurePublicUrl("http://nas.home.arpa/dav")).toBe(true);
    expect(isInsecurePublicUrl("http://192.168.1.5/dav")).toBe(false);
  });
});

describe("the confirmed list of this device", () => {
  it("sends nothing to an unconfirmed address, and does once it is confirmed", async () => {
    const res = memoryStore();
    const endpoint = confirmationEndpoint("http://192.168.1.5:8080/dav");
    await expect(assertEndpointConfirmed(res, endpoint)).rejects.toBeInstanceOf(EndpointNotConfirmedError);
    await expect(assertEndpointConfirmed(res, endpoint)).rejects.toMatchObject({ status: 401 });
    await confirmEndpoints(res, [endpoint]);
    await expect(assertEndpointConfirmed(res, endpoint)).resolves.toBeUndefined();
    await expect(assertEndpointConfirmed(res, null)).resolves.toBeUndefined();
  });

  it("a list that cannot be read confirms nothing", async () => {
    const res = memoryStore();
    res.store.get = async () => {
      throw new Error("store locked");
    };
    expect(await isEndpointConfirmed(res, "http://192.168.1.5:80")).toBe(false);
  });

  it("the switch-over takes what this device proved once, and never again", async () => {
    const res = memoryStore();
    let asked = 0;
    await settleEndpointConfirmations(res, async () => {
      asked++;
      return ["http://192.168.1.5:80", null];
    });
    await settleEndpointConfirmations(res, async () => {
      asked++;
      return ["http://10.0.0.9:80"];
    });
    expect(asked).toBe(1);
    expect(await isEndpointConfirmed(res, "http://192.168.1.5:80")).toBe(true);
    expect(await isEndpointConfirmed(res, "http://10.0.0.9:80")).toBe(false);
  });
});

describe("the desktop file sync with an unconfirmed address", () => {
  it("reads as signed out: no target, the settings profile included", async () => {
    const { resolveFileSyncAccess } = await import("./fileSyncAccess");
    const slots = { drive: null, onedrive: null, dropbox: null, s3: null, webdav: { url: "http://192.168.1.5/dav", user: "anna", pass: "pw" } };
    expect(resolveFileSyncAccess(slots, { drive: false, onedrive: false }, { webdav: true })).toMatchObject({ provider: null, blocked: "webdav", signedOut: true, unconfirmed: true });
    expect(resolveFileSyncAccess(slots, { drive: false, onedrive: false })).toMatchObject({ provider: "webdav", blocked: null });
  });
});
