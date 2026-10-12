import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_MAIL_SCOPES,
  GRAPH_MAIL_SCOPES,
  keychainSlotName,
  setPlatformServices,
  type CloudAccountRecord,
} from "@plainva/ui";
import {
  forgetAllGraphMailRuntimes,
  mailAccessTokenFor,
  mailSecretKey,
  saveBrokerMailAccount,
  saveMicrosoftMailAccount,
  setMailLookupNote,
  setMailTokenResolver,
  type MailAccountConfig,
} from "@plainva/ui/mail";
import { shippedSources } from "../../test-sourceTree";

/**
 * Which sign-in a mailbox works with — asked of the resolver the main window
 * REGISTERS, with two mailboxes (finding 2026-10-12).
 *
 * The broker could always tell two mailboxes apart: asked for a mailbox, it
 * answers only from the card that points at it, and `accountBroker.test.ts`
 * has held that since the calendar needed it. What nothing held was the
 * question itself. `main.tsx` registered `(vault) => brokerTokenProvider(vault,
 * "mail")` — valid TypeScript, the mailbox simply not passed on — and the
 * broker then answered every mailbox of the vault from the first card that
 * carried mail. With two Microsoft mailboxes the second one listed, opened,
 * moved and SENT with the sign-in of the first.
 *
 * So nothing here calls the broker. Each case registers what the app
 * registers (`registerDesktopMailPlatform`, `registerMailSignIn`) and then
 * asks the shared mail module for a mailbox's access token, the way every
 * mail request does. Below the seam
 * everything is the app's own: the broker, the stage-B adoption of a
 * mailbox's own sign-in, the mail module's own refresh. Only storage and the
 * network are local, and the network answers a refresh token with an access
 * token that names it — so an assertion says whose sign-in travelled.
 */

const state = vi.hoisted(() => ({
  secrets: new Map<string, unknown>(),
  settings: new Map<string, unknown>(),
  records: [] as unknown[],
  /** Refresh tokens the token endpoints were asked to renew, in order. */
  refreshed: [] as string[],
  /** `/me` by access token — what the provider says the token belongs to. */
  profiles: new Map<string, { id: string; mail: string }>(),
}));

/** A token endpoint that answers with an access token naming the sign-in it renewed. */
const tokenEndpoint = vi.hoisted(() => (prefix: string) => async (_url: unknown, init?: { body?: unknown }) => {
  const body = new URLSearchParams(String(init?.body ?? ""));
  const refreshToken = body.get("refresh_token") ?? "";
  state.refreshed.push(refreshToken);
  return new Response(
    JSON.stringify({ access_token: `${prefix}${refreshToken}`, expires_in: 3600, ...(body.get("scope") ? { scope: body.get("scope") } : {}) }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});

vi.mock("../CredentialManager", () => ({
  credentialManager: {
    readSecret: async (key: string) => state.secrets.get(key) ?? null,
    writeSecret: async (key: string, value: unknown) => void state.secrets.set(key, structuredClone(value)),
    removeSecret: async (key: string) => void state.secrets.delete(key),
  },
}));
vi.mock("../cloudAccounts", () => ({ loadCloudAccounts: async () => state.records }));
vi.mock("../settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async (key: string) => state.settings.get(key),
    set: async (key: string, value: unknown) => void state.settings.set(key, structuredClone(value)),
    save: async () => {},
  }),
}));
// Microsoft's token endpoint, as the broker reaches it (the Origin-free relay).
vi.mock("../authFetch", () => ({ microsoftAuthFetch: tokenEndpoint("access:") }));
// Google's token endpoint, and the identity question the adoption asks.
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: async (url: unknown, init?: { body?: unknown; headers?: Record<string, string> }) => {
    if (String(url).includes("oauth2.googleapis.com/token")) return tokenEndpoint("google-access:")(url, init);
    if (String(url) === "https://graph.microsoft.com/v1.0/me") {
      const profile = state.profiles.get(String(init?.headers?.Authorization ?? "").replace(/^Bearer /, ""));
      return profile
        ? new Response(JSON.stringify({ id: profile.id, mail: profile.mail, userPrincipalName: profile.mail }), { status: 200 })
        : new Response("{}", { status: 401 });
    }
    return new Response("{}", { status: 404 });
  },
}));

import {
  accountSecretKey,
  claimPendingMailbox,
  forgetAccountBroker,
  microsoftScopeFor,
  resetGrantSharingForTests,
  setPendingBrokerAccount,
} from "../accountBroker";
import { registerMailSignIn } from "./mailSignIn";
import { registerDesktopMailPlatform } from "./tauriMailTransport";

const VAULT = "/vault";

const mailbox = (id: string, user: string, kind: "microsoft" | "gmail" = "microsoft"): MailAccountConfig =>
  kind === "gmail"
    ? { id, label: user, host: "imap.gmail.com", port: 993, user, smtpHost: "smtp.gmail.com", smtpPort: 465, kind }
    : { id, label: user, host: "", port: 0, user, kind, clientId: "client" };

const card = (id: string, label: string, mailAccountId: string, family: "microsoft" | "google" = "microsoft"): CloudAccountRecord => ({
  id,
  family,
  label,
  services: { mail: { mailAccountId } },
});

/** The shared sign-in of a card, granted for mail. */
function grant(cardId: string, refreshToken: string): void {
  state.secrets.set(accountSecretKey(VAULT, cardId), { clientId: "client", refreshToken, scopes: microsoftScopeFor("mail") });
}

const FIRST = mailbox("box-a", "anna@example.org");
const SECOND = mailbox("box-b", "privat@example.net");

beforeEach(async () => {
  state.secrets.clear();
  state.settings.clear();
  state.records = [];
  state.refreshed.length = 0;
  state.profiles.clear();
  forgetAllGraphMailRuntimes();
  for (const id of ["card-a", "card-b", "card-g", "card-new"]) forgetAccountBroker(VAULT, id);
  resetGrantSharingForTests();
  setPendingBrokerAccount(null);
  // What `main.tsx` hands the shared layer: this shell's settings, its
  // credential store and its slot names.
  setPlatformServices({
    loadSettings: async () => ({
      get: async <T,>(key: string) => state.settings.get(key) as T | undefined,
      set: async (key: string, value: unknown) => void state.settings.set(key, structuredClone(value)),
      delete: async (key: string) => state.settings.delete(key),
      keys: async () => [...state.settings.keys()],
      save: async () => {},
    }),
    credentials: {
      readSecret: async <T,>(key: string) => (state.secrets.get(key) as T) ?? null,
      writeSecret: async <T,>(key: string, value: T) => void state.secrets.set(key, structuredClone(value)),
      removeSecret: async (key: string) => void state.secrets.delete(key),
    },
    openExternal: async () => {},
    keychainSlotName,
  });
  setMailTokenResolver(null);
  setMailLookupNote(null);
  // The two lines of `main.tsx`; the second is the one under test.
  registerDesktopMailPlatform();
  registerMailSignIn();
});

afterEach(() => setPendingBrokerAccount(null));

describe("the sign-in a mailbox works with, as the main window registers it", () => {
  it("gives each of two Microsoft mailboxes the sign-in of its own account", async () => {
    await saveBrokerMailAccount(VAULT, FIRST);
    await saveBrokerMailAccount(VAULT, SECOND);
    state.records = [card("card-a", FIRST.user, FIRST.id), card("card-b", SECOND.user, SECOND.id)];
    grant("card-a", "sign-in-a");
    grant("card-b", "sign-in-b");

    await expect(mailAccessTokenFor(VAULT, FIRST.id)).resolves.toBe("access:sign-in-a");
    // The whole finding in one line: this answered "access:sign-in-a".
    await expect(mailAccessTokenFor(VAULT, SECOND.id)).resolves.toBe("access:sign-in-b");
    // And the first card's sign-in was never renewed on the second one's behalf.
    expect(state.refreshed).toEqual(["sign-in-a", "sign-in-b"]);
  });

  it("answers the same whichever card is stored first", async () => {
    await saveBrokerMailAccount(VAULT, FIRST);
    await saveBrokerMailAccount(VAULT, SECOND);
    state.records = [card("card-b", SECOND.user, SECOND.id), card("card-a", FIRST.user, FIRST.id)];
    grant("card-a", "sign-in-a");
    grant("card-b", "sign-in-b");

    await expect(mailAccessTokenFor(VAULT, FIRST.id)).resolves.toBe("access:sign-in-a");
    await expect(mailAccessTokenFor(VAULT, SECOND.id)).resolves.toBe("access:sign-in-b");
  });

  it("leaves a mailbox no card points at on its own sign-in", async () => {
    await saveBrokerMailAccount(VAULT, FIRST);
    await saveMicrosoftMailAccount(VAULT, SECOND, "own-sign-in-b");
    state.records = [card("card-a", FIRST.user, FIRST.id)];
    grant("card-a", "sign-in-a");

    await expect(mailAccessTokenFor(VAULT, FIRST.id)).resolves.toBe("access:sign-in-a");
    await expect(mailAccessTokenFor(VAULT, SECOND.id)).resolves.toBe("access:own-sign-in-b");
    // Its sign-in stays where it was: no card adopted it.
    expect(state.secrets.get(mailSecretKey(VAULT, SECOND.id))).toEqual({ refreshToken: "own-sign-in-b" });
  });

  it("moves a second mailbox's own sign-in into ITS card, like the first one's", async () => {
    // Stage B adopts a mailbox's own sign-in into the card that points at it.
    // For every mailbox after the first that never ran: the first card
    // answered before the second was looked at.
    await saveBrokerMailAccount(VAULT, FIRST);
    await saveMicrosoftMailAccount(VAULT, SECOND, "own-sign-in-b");
    state.records = [card("card-a", FIRST.user, FIRST.id), card("card-b", SECOND.user, SECOND.id)];
    grant("card-a", "sign-in-a");
    state.profiles.set("access:own-sign-in-b", { id: "provider-id-b", mail: SECOND.user });

    await expect(mailAccessTokenFor(VAULT, SECOND.id)).resolves.toBe("access:own-sign-in-b");
    expect(state.secrets.get(accountSecretKey(VAULT, "card-b"))).toMatchObject({
      refreshToken: "own-sign-in-b",
      providerIdentity: { issuer: "microsoft", subject: "provider-id-b" },
    });
    // The mailbox's own slot is dormant now; the first card was not touched.
    expect(state.secrets.get(mailSecretKey(VAULT, SECOND.id))).toEqual({ refreshToken: "" });
    expect(state.secrets.get(accountSecretKey(VAULT, "card-a"))).toMatchObject({ refreshToken: "sign-in-a" });
    expect(state.refreshed).not.toContain("sign-in-a");
  });

  it("keeps a mailbox on its own sign-in when its card belongs to another account", async () => {
    // The card says one address, the provider answers with another: the
    // adoption refuses, and the mailbox goes on with what it has.
    await saveMicrosoftMailAccount(VAULT, SECOND, "own-sign-in-b");
    state.records = [card("card-b", "someone-else@example.net", SECOND.id)];
    state.profiles.set("access:own-sign-in-b", { id: "provider-id-b", mail: SECOND.user });

    await expect(mailAccessTokenFor(VAULT, SECOND.id)).resolves.toBe("access:own-sign-in-b");
    expect(state.secrets.get(mailSecretKey(VAULT, SECOND.id))).toEqual({ refreshToken: "own-sign-in-b" });
    expect(state.secrets.has(accountSecretKey(VAULT, "card-b"))).toBe(false);
  });

  it("gives a mailbox without a sign-in none — not the first account's — and says whose is missing", async () => {
    // What the settings sync leaves on a second device: the mailbox and its
    // card arrive, the sign-in does not. It used to show the first account's
    // mail under this mailbox's name.
    await saveBrokerMailAccount(VAULT, FIRST);
    await saveBrokerMailAccount(VAULT, SECOND);
    state.records = [card("card-a", FIRST.user, FIRST.id), card("card-b", SECOND.user, SECOND.id)];
    grant("card-a", "sign-in-a");

    const failure = mailAccessTokenFor(VAULT, SECOND.id);
    await expect(failure).rejects.toThrow(/no_stored_sign_in/);
    // The sentence is about THIS mailbox's card, which holds no sign-in …
    await expect(failure).rejects.toThrow(/1 cloud account\(s\) carry this service, but none holds the shared sign-in/);
    expect(state.refreshed).toEqual([]);
    // … and the first mailbox is untouched by its neighbour's state.
    await expect(mailAccessTokenFor(VAULT, FIRST.id)).resolves.toBe("access:sign-in-a");
  });

  it("says that no card carries a mailbox when none points at it", async () => {
    await saveBrokerMailAccount(VAULT, FIRST);
    await saveBrokerMailAccount(VAULT, SECOND);
    state.records = [card("card-a", FIRST.user, FIRST.id)];
    grant("card-a", "sign-in-a");

    await expect(mailAccessTokenFor(VAULT, SECOND.id)).rejects.toThrow(/no_stored_sign_in.*no cloud account carries it/);
    expect(state.refreshed).toEqual([]);
  });

  it("gives a Gmail mailbox its Google sign-in beside a Microsoft account", async () => {
    // Two cards of two families that both carry mail: the one that is not
    // first was handed the other family's token, which its server refuses.
    const gmail = mailbox("box-g", "anna@gmail.com", "gmail");
    await saveBrokerMailAccount(VAULT, FIRST);
    await saveBrokerMailAccount(VAULT, gmail);
    state.records = [card("card-a", FIRST.user, FIRST.id), card("card-g", gmail.user, gmail.id, "google")];
    grant("card-a", "sign-in-a");
    state.secrets.set(accountSecretKey(VAULT, "card-g"), {
      clientId: "google-client",
      clientSecret: "google-secret",
      refreshToken: "sign-in-g",
      scopes: GOOGLE_MAIL_SCOPES,
    });

    await expect(mailAccessTokenFor(VAULT, gmail.id)).resolves.toBe("google-access:sign-in-g");
    await expect(mailAccessTokenFor(VAULT, FIRST.id)).resolves.toBe("access:sign-in-a");
  });

  describe("while another account is being connected", () => {
    beforeEach(async () => {
      await saveBrokerMailAccount(VAULT, FIRST);
      state.records = [card("card-a", FIRST.user, FIRST.id)];
      grant("card-a", "sign-in-a");
      // The wizard has the new account's sign-in, and no card yet.
      grant("card-new", "sign-in-new");
      setPendingBrokerAccount({ vaultPath: VAULT, accountId: "card-new", family: "microsoft" });
    });

    it("leaves a mailbox that has its card on its own account", async () => {
      // Without the mailbox the question counted as part of the connect, and
      // every OAuth mailbox of the vault drew the token just minted.
      await expect(mailAccessTokenFor(VAULT, FIRST.id)).resolves.toBe("access:sign-in-a");
    });

    it("still serves the mailbox the connect is creating", async () => {
      const fresh = mailbox("box-new", "neu@example.org");
      // The wizard names the mailbox, saves it, then reads its address.
      claimPendingMailbox(VAULT, fresh.id);
      await saveBrokerMailAccount(VAULT, fresh);
      await expect(mailAccessTokenFor(VAULT, fresh.id)).resolves.toBe("access:sign-in-new");
    });

    it("serves it even when a card was just written for it", async () => {
      // The registry reconcile runs on its own events and writes a card for
      // every mailbox it finds — also for the one the wizard saved a moment
      // ago, before the wizard's own card exists. That card holds no sign-in,
      // and it must not turn the connect's own mailbox away.
      const fresh = mailbox("box-new", "neu@example.org");
      claimPendingMailbox(VAULT, fresh.id);
      await saveBrokerMailAccount(VAULT, fresh);
      state.records = [...state.records, card("card-found", "", fresh.id)];
      await expect(mailAccessTokenFor(VAULT, fresh.id)).resolves.toBe("access:sign-in-new");
    });

    it("keeps a mailbox no card points at on its own sign-in, not on the new account's", async () => {
      // No card claims it — which is not the same as being part of the connect.
      await saveMicrosoftMailAccount(VAULT, SECOND, "own-sign-in-b");
      await expect(mailAccessTokenFor(VAULT, SECOND.id)).resolves.toBe("access:own-sign-in-b");
      expect(state.refreshed).not.toContain("sign-in-new");
    });

    it("and gives one without a sign-in none, not the new account's", async () => {
      await saveBrokerMailAccount(VAULT, SECOND);
      await expect(mailAccessTokenFor(VAULT, SECOND.id)).rejects.toThrow(/no_stored_sign_in/);
      expect(state.refreshed).toEqual([]);
    });
  });
});

/**
 * The registration is one function, and the main window calls it.
 *
 * The cases above ask `registerMailSignIn`. They would hold nothing if
 * `main.tsx` registered a resolver of its own again — which is exactly how the
 * fault stood for two months beside a broker that was tested for it. A scan,
 * not a type: a resolver that takes fewer arguments is valid TypeScript.
 */
describe("who registers the mail sign-in", () => {
  // Both shells: the phone registered the same line, and its own test
  // (`apps/mobile/src/services/mail/mailSignIn.test.ts`) asks its resolver.
  const sources = shippedSources(["apps/desktop/src", "apps/mobile/src"]);
  const REGISTERS = /\bsetMail(TokenResolver|LookupNote)\s*\(/;
  const textOf = (rel: string) => sources.find((source) => source.rel === rel)?.text ?? "";

  it.each(["apps/desktop/src/main.tsx", "apps/mobile/src/main.tsx"])("is this function, called by %s", (entry) => {
    expect(textOf(entry)).toMatch(/\bregisterMailSignIn\(\);/);
    expect(textOf(entry)).not.toMatch(REGISTERS);
  });

  it("and nothing else but the auxiliary window's bus resolver", () => {
    const registering = sources.filter(({ text }) => REGISTERS.test(text)).map(({ rel }) => rel).sort();
    expect(registering).toEqual([
      "apps/desktop/src/services/mail/mailSignIn.ts",
      // An auxiliary window asks the owner over the bus, with the mailbox.
      "apps/desktop/src/services/mail/tauriMailTransport.ts",
      "apps/mobile/src/services/mail/mailSignIn.ts",
    ]);
  });

  it("asks for the mailbox in every one of them", () => {
    expect(textOf("apps/desktop/src/services/mail/mailSignIn.ts")).toContain('brokerTokenProvider(vaultPath, "mail", accountId)');
    expect(textOf("apps/desktop/src/services/mail/mailSignIn.ts")).toContain('describeBrokerLookup(vaultPath, "mail", accountId)');
    expect(textOf("apps/mobile/src/services/mail/mailSignIn.ts")).toContain('brokerTokenProvider(vaultId, "mail", accountId)');
    expect(textOf("apps/mobile/src/services/mail/mailSignIn.ts")).toContain('describeBrokerLookup(vaultId, "mail", accountId)');
    expect(textOf("apps/desktop/src/services/mail/tauriMailTransport.ts")).toContain('bus.request("mail-token", { vaultPath, accountId, force })');
  });
});

describe("the scopes the cases grant", () => {
  it("are the ones a mailbox asks for", () => {
    // A grant that did not cover mail would be skipped for another reason and
    // make the cases above prove nothing.
    expect(microsoftScopeFor("mail")).toBe(GRAPH_MAIL_SCOPES);
  });
});
