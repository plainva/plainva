import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatformServices } from "@plainva/ui";
import {
  forgetAllGraphMailRuntimes, forgetGraphMailRuntime, getMailPassword,
  mailAccessTokenFor, mailAccountsKey, mailSecretKey, saveMailAccount,
  saveMailRefreshToken, saveMicrosoftMailAccount, setMailTokenResolver,
  setMailPlatform, type MailTransport, type MailAccountConfig,
} from "@plainva/ui/mail";
import { refreshOneDriveAccessToken } from "@plainva/core";

vi.mock("@plainva/core", async (original) => ({
  ...await original<typeof import("@plainva/core")>(),
  refreshOneDriveAccessToken: vi.fn(),
}));

const values = new Map<string, unknown>();
const secrets = new Map<string, unknown>();
let failWrite = false;
const account: MailAccountConfig = {
  id: "same-profile-id", label: "Mailbox", host: "imap.example.invalid", port: 993,
  user: "person@example.invalid", kind: "microsoft", clientId: "client",
};
const credentials = {
  readSecret: async <T,>(key: string) => (secrets.get(key) as T) ?? null,
  writeSecret: async <T,>(key: string, value: T) => {
    if (failWrite) throw new Error("secure storage unavailable");
    secrets.set(key, structuredClone(value));
  },
  removeSecret: async (key: string) => { secrets.delete(key); },
};

beforeEach(() => {
  values.clear(); secrets.clear(); failWrite = false;
  setMailPlatform({ transport: {} as MailTransport, http: { api: fetch, token: fetch } });
  forgetAllGraphMailRuntimes(); setMailTokenResolver(null);
  vi.mocked(refreshOneDriveAccessToken).mockReset();
  setPlatformServices({
    loadSettings: async () => ({
      get: async <T,>(key: string) => values.get(key) as T | undefined,
      set: async (key: string, value: unknown) => { values.set(key, structuredClone(value)); },
      delete: async (key: string) => values.delete(key), keys: async () => [...values.keys()], save: async () => {},
    }), credentials, openExternal: async () => {},
  });
});

describe("mail credential isolation through the actual shared writers and runtime", () => {
  it.each([undefined, "imap"] as const)("preserves an IMAP password when OAuth cleanup reaches a %s mailbox", async (kind) => {
    await saveMailAccount("vault-A", { ...account, kind }, "test-app-password");
    await expect(saveMailRefreshToken("vault-A", account.id, "")).rejects.toThrow(/password/);
    await expect(getMailPassword("vault-A", account.id)).resolves.toBe("test-app-password");
    expect(secrets.get(mailSecretKey("vault-A", account.id))).toEqual({ pass: "test-app-password" });
  });

  it("does not create an OAuth slot for an unknown mailbox", async () => {
    await expect(saveMailRefreshToken("vault-A", account.id, "rotated")).rejects.toThrow();
    expect(secrets.size).toBe(0);
  });

  it("rotates only the selected Microsoft mailbox in its vault", async () => {
    await saveMicrosoftMailAccount("vault-A", account, "old-A");
    await saveMicrosoftMailAccount("vault-B", account, "old-B");
    await saveMailRefreshToken("vault-B", account.id, "new-B");
    expect(secrets.get(mailSecretKey("vault-A", account.id))).toEqual({ refreshToken: "old-A" });
    expect(secrets.get(mailSecretKey("vault-B", account.id))).toEqual({ refreshToken: "new-B" });
  });

  it("resolves and forgets the same imported mailbox ID separately in each vault", async () => {
    await saveMicrosoftMailAccount("vault-A", account, "old-A");
    await saveMicrosoftMailAccount("vault-B", account, "old-B");
    const resolver = vi.fn(async (vault: string) => async () => `access-${vault}`);
    setMailTokenResolver(resolver);
    expect(await Promise.all([
      mailAccessTokenFor("vault-A", account.id), mailAccessTokenFor("vault-B", account.id),
      mailAccessTokenFor("vault-A", account.id),
    ])).toEqual(["access-vault-A", "access-vault-B", "access-vault-A"]);
    expect(resolver).toHaveBeenCalledTimes(2);
    forgetGraphMailRuntime("vault-B", account.id);
    await mailAccessTokenFor("vault-A", account.id);
    await mailAccessTokenFor("vault-B", account.id);
    expect(resolver.mock.calls.map(([vault]) => vault)).toEqual(["vault-A", "vault-B", "vault-B"]);
  });

  it("an older failed initialization cannot evict its replacement after reconnect", async () => {
    await saveMicrosoftMailAccount("vault-A", account, "");
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const resolver = vi.fn().mockImplementationOnce(async () => { await waiting; return undefined; })
      .mockImplementation(async () => async () => "new-access");
    setMailTokenResolver(resolver);
    const first = mailAccessTokenFor("vault-A", account.id);
    const failure = expect(first).rejects.toThrow(/no stored sign-in/);
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(1));
    forgetGraphMailRuntime("vault-A", account.id);
    await expect(mailAccessTokenFor("vault-A", account.id)).resolves.toBe("new-access");
    release(); await failure;
    await expect(mailAccessTokenFor("vault-A", account.id)).resolves.toBe("new-access");
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("does not cache a successful access token before its rotated credential is saved", async () => {
    await saveMicrosoftMailAccount("vault-A", account, "old");
    vi.mocked(refreshOneDriveAccessToken).mockResolvedValue({ accessToken: "access", refreshToken: "new", expiresIn: 3600 });
    failWrite = true;
    await expect(mailAccessTokenFor("vault-A", account.id)).rejects.toThrow(/secure storage/);
    await expect(mailAccessTokenFor("vault-A", account.id)).rejects.toThrow(/secure storage/);
    expect(secrets.get(mailSecretKey("vault-A", account.id))).toEqual({ refreshToken: "old" });
    failWrite = false;
    await expect(mailAccessTokenFor("vault-A", account.id)).resolves.toBe("access");
    expect(secrets.get(mailSecretKey("vault-A", account.id))).toEqual({ refreshToken: "new" });
    expect(values.get(mailAccountsKey("vault-A"))).toEqual([account]);
  });
});
