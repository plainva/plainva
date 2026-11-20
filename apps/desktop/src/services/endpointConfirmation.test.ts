import { beforeEach, describe, expect, it } from "vitest";
import {
  assertEndpointConfirmed,
  confirmTypedEndpointsIn,
  getPlatformServices,
  isEndpointConfirmedIn,
  serviceConnectionMessage,
  setPlatformServices,
  unconfirmedEndpointOf,
  confirmEndpoints,
  confirmationEndpoint,
  EndpointNotConfirmedError,
  isEndpointConfirmed,
  isInsecurePublicUrl,
  mailConfirmationEndpoint,
  settleEndpointConfirmations,
  type EndpointConfirmationResources,
} from "@plainva/ui";
import { MailEndpointNotConfirmedError, checkMailbox, getMailPassword, mailErrorText, setMailPlatform, signInMailboxHere } from "@plainva/ui/mail";

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

  it("knows every way of writing a private address, and the names routers give themselves (review of F57, finding 5)", () => {
    for (const host of [
      "[::ffff:192.168.1.10]", "[::ffff:c0a8:10a]", "[::ffff:7f00:1]", "[::ffff:10.0.0.1]", "0.0.0.0", "[::]", "[fec0::1]", "[fef0::1]",
      "3232235786", "0xc0a8010a", "0300.0250.1.10", "fritz.box", "nas.fritz.box", "speedport.ip", "router.home.arpa",
    ]) {
      expect(confirmationEndpoint(`https://${host}/dav`), host).not.toBeNull();
    }
    for (const host of ["[::ffff:8.8.8.8]", "my.box", "example.box", "fritz.box.example.org", "[2001:db8::1]"]) {
      expect(confirmationEndpoint(`https://${host}/dav`), host).toBeNull();
    }
    // A mail host is no URL: written as a number or mapped, it is still the private address it reads as.
    for (const host of ["3232235786", "::ffff:192.168.1.10", "[::ffff:192.168.1.10]", "::ffff:c0a8:10a", "0.0.0.0", "::", "fec0::1", "nas.fritz.box"]) {
      expect(mailConfirmationEndpoint("imap", host, 993), host).not.toBeNull();
    }
    expect(mailConfirmationEndpoint("imap", "3232235786", 993)).toBe("imap://192.168.1.10:993");
    expect(mailConfirmationEndpoint("imap", "::ffff:8.8.8.8", 993)).toBeNull();
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

  it("a switch-over that cannot read what it needs confirms nothing and runs again at the next start (review of F57, O1)", async () => {
    const res = memoryStore();
    await expect(settleEndpointConfirmations(res, async () => {
      throw new Error("keychain locked");
    })).rejects.toThrow("keychain locked");
    expect(await isEndpointConfirmed(res, "http://192.168.1.5:80")).toBe(false);
    let asked = 0;
    await settleEndpointConfirmations(res, async () => {
      asked++;
      return ["http://192.168.1.5:80"];
    });
    expect([asked, await isEndpointConfirmed(res, "http://192.168.1.5:80")]).toEqual([1, true]);
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

describe("a form confirms only what was typed in it (review of F57, O3)", () => {
  const settings = new Map<string, unknown>();
  const secrets = new Map<string, unknown>();
  beforeEach(() => {
    settings.clear();
    secrets.clear();
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
      credentials: {
        readSecret: async (k: string) => secrets.get(k) ?? null,
        writeSecret: async (k: string, v: unknown) => void secrets.set(k, v),
        removeSecret: async (k: string) => void secrets.delete(k),
      },
    } as unknown as Parameters<typeof setPlatformServices>[0]);
  });

  it("a path, a user or a spelling changed under the endpoint the form came with confirms nothing and lets nothing go", async () => {
    const before = confirmationEndpoint("http://192.168.1.10/dav");
    const after = confirmationEndpoint("http://192.168.1.10/dav2");
    await expect(confirmTypedEndpointsIn("v", [after], [before])).rejects.toMatchObject({ name: "EndpointNotConfirmedError", endpoint: "http://192.168.1.10:80" });
    expect(await isEndpointConfirmedIn("v", before)).toBe(false);
  });

  it("another endpoint typed in the form is confirmed by sending — that one, never the one it came with", async () => {
    await confirmTypedEndpointsIn("v", [confirmationEndpoint("http://192.168.1.11/dav")], [confirmationEndpoint("http://192.168.1.10/dav")]);
    expect(await isEndpointConfirmedIn("v", "http://192.168.1.11:80")).toBe(true);
    expect(await isEndpointConfirmedIn("v", "http://192.168.1.10:80")).toBe(false);
  });

  it("a form that started empty confirms what it sends; a kept endpoint already confirmed goes through", async () => {
    await confirmTypedEndpointsIn("v", ["imap://192.168.1.20:993", "smtp://192.168.1.20:587"], []);
    expect(await isEndpointConfirmedIn("v", "smtp://192.168.1.20:587")).toBe(true);
    await expect(confirmTypedEndpointsIn("v", ["imap://192.168.1.20:993"], ["imap://192.168.1.20:993"])).resolves.toBeUndefined();
  });

  it("a password typed to sign a mailbox in goes to no server it came with until that one is confirmed (O3)", async () => {
    const logins: string[] = [];
    setMailPlatform({ transport: { checkLogin: async (creds: { host: string }) => { logins.push(creds.host); return []; } } } as never);
    const account = { id: "mb", label: "anna", kind: "imap" as const, host: "192.168.1.20", port: 993, user: "anna" };
    await expect(signInMailboxHere("v", account, "typed")).rejects.toMatchObject({ name: "EndpointNotConfirmedError", endpoint: "imap://192.168.1.20:993" });
    expect(logins).toEqual([]);
    expect(await getMailPassword("v", "mb")).toBeFalsy();
    expect(await isEndpointConfirmedIn("v", "imap://192.168.1.20:993")).toBe(false);
    const { confirmEndpointsIn } = await import("@plainva/ui");
    await confirmEndpointsIn("v", ["imap://192.168.1.20:993"]);
    await signInMailboxHere("v", account, "typed");
    expect(logins).toEqual(["192.168.1.20"]);
    expect(await getMailPassword("v", "mb")).toBe("typed");
  });

  it("a mailbox with its password but an unconfirmed server sends nothing and names the server, which every surface says as Confirm address", async () => {
    const account = { id: "mb", label: "anna", kind: "imap" as const, host: "192.168.1.20", port: 993, user: "anna", smtpHost: "192.168.1.20", smtpPort: 587 };
    const { mailSecretKey } = await import("@plainva/ui/mail");
    secrets.set(mailSecretKey("v", "mb"), { pass: "pw" });
    const logins: string[] = [];
    setMailPlatform({ transport: { checkLogin: async (creds: { host: string }) => { logins.push(creds.host); return []; } } } as never);
    const refused = await checkMailbox("v", account).catch((e: unknown) => e);
    expect(logins).toEqual([]);
    expect(refused).toBeInstanceOf(MailEndpointNotConfirmedError);
    expect(unconfirmedEndpointOf(refused)).toBe("imap://192.168.1.20:993");
    const t = (key: string, opts?: Record<string, unknown>) => `${key}${opts?.address ? `:${String(opts.address)}` : ""}`;
    expect(mailErrorText(refused, t)).toBe("cloudAccounts.confirmAddress:imap://192.168.1.20:993");
    expect(serviceConnectionMessage(new EndpointNotConfirmedError("http://192.168.1.5:80"), t)).toBe("cloudAccounts.confirmAddress:http://192.168.1.5:80");
    // Confirmed on this device: the password goes there.
    const { confirmEndpointsIn } = await import("@plainva/ui");
    await confirmEndpointsIn("v", ["imap://192.168.1.20:993", "smtp://192.168.1.20:587"]);
    await checkMailbox("v", account);
    expect(logins).toEqual(["192.168.1.20"]);
  });
});
