import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatformServices } from "@plainva/ui";
import { listMailAccounts, setMailPlatform, mailSecretKey } from "@plainva/ui/mail";
import type { MailTransport } from "@plainva/ui/mail";
import { connectMicrosoftMail, listMobileMailAccounts, startMobileMail, stopMobileMail } from "./mailRuntime";
import { handlePimOAuthRedirect } from "../pim/pimOAuth";

/**
 * The one integration risk of G1: a Microsoft consent started for MAIL must
 * end up as a mail account — not as a calendar account. Both flows share a
 * single custom-scheme redirect and a single handler (feinplan G0.2), so this
 * drives the real modules end to end and only fakes the network.
 */

const { opened } = vi.hoisted(() => ({ opened: [] as string[] }));
vi.mock("@capacitor/browser", () => ({
  Browser: {
    open: async ({ url }: { url: string }) => {
      opened.push(url);
    },
    close: async () => {},
  },
}));

// Hoisted: vi.mock factories run before module-level consts exist.
const { addPimAccount } = vi.hoisted(() => ({ addPimAccount: vi.fn() }));
vi.mock("../pim/pimService", () => ({ addPimAccount }));

vi.mock("@plainva/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plainva/core")>()),
  exchangeOneDriveCode: async () => ({ refreshToken: "refresh-1", accessToken: "access-1" }),
}));

const settings = new Map<string, unknown>();
const secrets = new Map<string, unknown>();

function installPlatform(): void {
  setPlatformServices({
    loadSettings: async () => ({
      get: async <T,>(k: string) => settings.get(k) as T | undefined,
      set: async (k: string, v: unknown) => void settings.set(k, v),
      delete: async (k: string) => settings.delete(k),
      keys: async () => [...settings.keys()],
      save: async () => {},
    }),
    credentials: {
      readSecret: async <T,>(k: string) => (secrets.get(k) ?? null) as T | null,
      writeSecret: async (k: string, v: unknown) => void secrets.set(k, v),
      removeSecret: async (k: string) => void secrets.delete(k),
    },
    openExternal: async () => {},
  });
  // Graph answers /me with the mailbox address; the IMAP half must never be
  // touched on this path, so it throws if anything reaches for it.
  const throwing = new Proxy({} as MailTransport, {
    get: () => () => {
      throw new Error("the Microsoft path must not use the IMAP transport");
    },
  });
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const api: typeof fetch = async () => json({ mail: "someone@contoso.com" });
  // The token endpoint answers like the real one. It used to hand back the
  // Graph body, i.e. no access_token at all — which only worked because the
  // code accepted that and sent "Bearer undefined" to a fake that did not care
  // (finding 2026-07-30).
  const token: typeof fetch = async () => json({ access_token: "at-1", refresh_token: "refresh-1", expires_in: 3600 });
  setMailPlatform({ transport: throwing, http: { api, token } });
}

// The runtime and the OAuth handler both announce themselves with a DOM
// event; these tests run in node, so give them somewhere to fire.
if (typeof globalThis.window === "undefined") {
  const stub = Object.assign(new EventTarget(), {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });
  Object.defineProperty(globalThis, "window", { value: stub, configurable: true });
}

describe("mobile mail runtime", () => {
  beforeEach(() => {
    settings.clear();
    secrets.clear();
    opened.length = 0;
    addPimAccount.mockClear();
    installPlatform();
  });

  it("turns a Microsoft consent started for mail into a mail account, not a calendar account", async () => {
    startMobileMail({ vaultId: "v1" } as never);
    await connectMicrosoftMail();

    // The consent asks for the MAIL scopes, not the calendar ones.
    expect(opened).toHaveLength(1);
    const authUrl = new URL(opened[0]);
    expect(authUrl.searchParams.get("scope")).toContain("Mail.ReadWrite");
    const state = authUrl.searchParams.get("state")!;

    const consumed = await handlePimOAuthRedirect(`com.plainva.app://oauth?code=abc&state=${state}`);
    expect(consumed).toBe(true);

    const accounts = await listMobileMailAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].kind).toBe("microsoft");
    // Named after the mailbox it can actually read — not the placeholder.
    expect(accounts[0].label).toBe("someone@contoso.com");
    expect(accounts[0].user).toBe("someone@contoso.com");
    // The refresh token landed in the slot the shared code reads.
    expect(secrets.get(mailSecretKey("v1", accounts[0].id))).toEqual({ refreshToken: "refresh-1" });
    // …and no calendar account was created by the same redirect.
    expect(addPimAccount).not.toHaveBeenCalled();
  });

  it("keeps mail accounts out of the vault they do not belong to", async () => {
    startMobileMail({ vaultId: "v1" } as never);
    settings.set(`mailAccounts_${btoa("v1")}`, [{ id: "a1", label: "A", host: "", port: 0, user: "", kind: "microsoft" }]);
    settings.set(`mailAccounts_${btoa("v2")}`, [{ id: "b1", label: "B", host: "", port: 0, user: "", kind: "microsoft" }]);

    expect((await listMobileMailAccounts()).map((a) => a.id)).toEqual(["a1"]);

    startMobileMail({ vaultId: "v2" } as never);
    expect((await listMobileMailAccounts()).map((a) => a.id)).toEqual(["b1"]);

    // No vault open: no accounts, rather than the last vault's list.
    stopMobileMail();
    expect(await listMobileMailAccounts()).toEqual([]);
    expect(await listMailAccounts("v1")).toHaveLength(1); // the store itself is untouched
  });
});
