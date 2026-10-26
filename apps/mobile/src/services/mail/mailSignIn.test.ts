import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GOOGLE_MAIL_SCOPES, GRAPH_MAIL_SCOPES, setPlatformServices, type CloudAccountRecord } from "@plainva/ui";
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

/**
 * Which sign-in a mailbox works with — asked of the resolver the phone
 * REGISTERS, with two mailboxes (finding 2026-10-12).
 *
 * The broker could always tell two mailboxes apart: asked for a mailbox, it
 * answers only from the card that points at it (`accountBroker.test.ts`).
 * What nothing held was the question itself. `main.tsx` registered `(vault)
 * => brokerTokenProvider(vault, "mail")` — valid TypeScript, the mailbox
 * simply not passed on — and the broker then answered every mailbox of the
 * vault from the first card that carried mail. In the built app, with two
 * Microsoft mailboxes behind the local fixture, every request of the second
 * one and its `POST /me/sendMail` carried the access token of the first.
 *
 * So nothing here calls the broker. Each case registers what the app
 * registers (`registerMobileMailPlatform`, `registerMailSignIn`) and then asks
 * the shared mail module for a mailbox's access token, the way every mail
 * request does. Below the seam everything is the app's own; only storage and
 * the network are local, and the network answers a refresh token with an
 * access token that names it — so an assertion says whose sign-in travelled.
 *
 * The desktop holds the same cases against its own broker
 * (`apps/desktop/src/services/mail/mailSignIn.test.ts`).
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

vi.mock("../../platform/secureStore", () => ({
  secureCredentialStore: {
    readSecret: async (key: string) => state.secrets.get(key) ?? null,
    writeSecret: async (key: string, value: unknown) => void state.secrets.set(key, structuredClone(value)),
    removeSecret: async (key: string) => void state.secrets.delete(key),
  },
}));
vi.mock("../cloudAccountsStore", () => ({ loadCloudAccounts: async () => state.records }));
// The phone's one HTTP function: both token endpoints and the identity
// question the adoption asks go through it.
vi.mock("../../adapters/webdavHttp", () => ({
  webdavFetch: async (url: unknown, init?: { body?: unknown; headers?: Record<string, string> }) => {
    const target = String(url);
    if (target.includes("/oauth2/v2.0/token") || target.includes("oauth2.googleapis.com/token")) {
      const body = new URLSearchParams(String(init?.body ?? ""));
      const refreshToken = body.get("refresh_token") ?? "";
      state.refreshed.push(refreshToken);
      const prefix = target.includes("googleapis") ? "google-access:" : "access:";
      return new Response(
        JSON.stringify({ access_token: `${prefix}${refreshToken}`, expires_in: 3600, ...(body.get("scope") ? { scope: body.get("scope") } : {}) }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (target === "https://graph.microsoft.com/v1.0/me") {
      const profile = state.profiles.get(String(init?.headers?.Authorization ?? "").replace(/^Bearer /, ""));
      return profile
        ? new Response(JSON.stringify({ id: profile.id, mail: profile.mail, userPrincipalName: profile.mail }), { status: 200 })
        : new Response("{}", { status: 401 });
    }
    return new Response("{}", { status: 404 });
  },
}));

import { accountSecretKey, forgetAccountBroker, microsoftScopeFor } from "../accountBroker";
import { registerMobileMailPlatform } from "./mobileMailPlatform";
import { registerMailSignIn } from "./mailSignIn";

const VAULT = "local";

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

beforeEach(() => {
  state.secrets.clear();
  state.settings.clear();
  state.records = [];
  state.refreshed.length = 0;
  state.profiles.clear();
  forgetAllGraphMailRuntimes();
  for (const id of ["card-a", "card-b", "card-g"]) forgetAccountBroker(VAULT, id);
  // What `main.tsx` hands the shared layer: this shell's settings and its
  // credential store. No slot namer — the phone keeps the legacy slot names.
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
  });
  setMailTokenResolver(null);
  setMailLookupNote(null);
  // The two lines of `main.tsx`; the second is the one under test.
  registerMobileMailPlatform();
  registerMailSignIn();
});

describe("the sign-in a mailbox works with, as the phone registers it", () => {
  it("gives each of two Microsoft mailboxes the sign-in of its own account", async () => {
    await saveBrokerMailAccount(VAULT, FIRST, "connect");
    await saveBrokerMailAccount(VAULT, SECOND, "connect");
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
    await saveBrokerMailAccount(VAULT, FIRST, "connect");
    await saveBrokerMailAccount(VAULT, SECOND, "connect");
    state.records = [card("card-b", SECOND.user, SECOND.id), card("card-a", FIRST.user, FIRST.id)];
    grant("card-a", "sign-in-a");
    grant("card-b", "sign-in-b");

    await expect(mailAccessTokenFor(VAULT, FIRST.id)).resolves.toBe("access:sign-in-a");
    await expect(mailAccessTokenFor(VAULT, SECOND.id)).resolves.toBe("access:sign-in-b");
  });

  it("leaves a mailbox no card points at on its own sign-in", async () => {
    // The phone's ordinary second mailbox: connected from the mail settings,
    // its sign-in in its own slot, and no card — nothing reconciles the
    // registry here. This is the state the built app was seen in.
    await saveBrokerMailAccount(VAULT, FIRST, "connect");
    await saveMicrosoftMailAccount(VAULT, SECOND, "own-sign-in-b", "connect");
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
    await saveBrokerMailAccount(VAULT, FIRST, "connect");
    await saveMicrosoftMailAccount(VAULT, SECOND, "own-sign-in-b", "connect");
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
    await saveMicrosoftMailAccount(VAULT, SECOND, "own-sign-in-b", "connect");
    state.records = [card("card-b", "someone-else@example.net", SECOND.id)];
    state.profiles.set("access:own-sign-in-b", { id: "provider-id-b", mail: SECOND.user });

    await expect(mailAccessTokenFor(VAULT, SECOND.id)).resolves.toBe("access:own-sign-in-b");
    expect(state.secrets.get(mailSecretKey(VAULT, SECOND.id))).toEqual({ refreshToken: "own-sign-in-b" });
    expect(state.secrets.has(accountSecretKey(VAULT, "card-b"))).toBe(false);
  });

  it("gives a mailbox without a sign-in none — not the first account's — and says whose is missing", async () => {
    // What the settings sync leaves on this device: the mailbox and its card
    // arrive, the sign-in does not. It used to show the first account's mail
    // under this mailbox's name.
    await saveBrokerMailAccount(VAULT, FIRST, "connect");
    await saveBrokerMailAccount(VAULT, SECOND, "connect");
    state.records = [card("card-a", FIRST.user, FIRST.id), card("card-b", SECOND.user, SECOND.id)];
    grant("card-a", "sign-in-a");

    const failure = mailAccessTokenFor(VAULT, SECOND.id);
    await expect(failure).rejects.toThrow(/no_stored_sign_in/);
    // The sentence is about THIS mailbox's card, which holds no sign-in — the
    // phone used to say nothing more than that a sign-in was missing.
    await expect(failure).rejects.toThrow(/1 cloud account\(s\) carry this service, but none holds the shared sign-in/);
    expect(state.refreshed).toEqual([]);
    // … and the first mailbox is untouched by its neighbour's state.
    await expect(mailAccessTokenFor(VAULT, FIRST.id)).resolves.toBe("access:sign-in-a");
  });

  it("says that no card carries a mailbox when none points at it", async () => {
    await saveBrokerMailAccount(VAULT, FIRST, "connect");
    await saveBrokerMailAccount(VAULT, SECOND, "connect");
    state.records = [card("card-a", FIRST.user, FIRST.id)];
    grant("card-a", "sign-in-a");

    await expect(mailAccessTokenFor(VAULT, SECOND.id)).rejects.toThrow(/no_stored_sign_in.*no cloud account carries it/);
    expect(state.refreshed).toEqual([]);
  });

  it("gives a Gmail mailbox its Google sign-in beside a Microsoft account", async () => {
    // Two cards of two families that both carry mail: the one that is not
    // first was handed the other family's token, which its server refuses.
    const gmail = mailbox("box-g", "anna@gmail.com", "gmail");
    await saveBrokerMailAccount(VAULT, FIRST, "connect");
    await saveBrokerMailAccount(VAULT, gmail, "connect");
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
});

/**
 * The registration is one function, and the entry calls it.
 *
 * The cases above ask `registerMailSignIn`. They would hold nothing if
 * `main.tsx` registered a resolver of its own again — which is exactly how the
 * fault stood beside a broker that was tested for it. A scan, not a type: a
 * resolver that takes fewer arguments is valid TypeScript.
 */
describe("who registers the mail sign-in", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
  const REGISTERS = /\bsetMail(TokenResolver|LookupNote)\s*\(/;

  it("is this function, called by the entry and by nothing of its own there", () => {
    const main = read("main.tsx");
    expect(main).toMatch(/\bregisterMailSignIn\(\);/);
    expect(main).not.toMatch(REGISTERS);
  });

  it("asks the broker for the mailbox", () => {
    const text = read("services/mail/mailSignIn.ts");
    expect(text).toContain('brokerTokenProvider(vaultId, "mail", accountId)');
    expect(text).toContain('describeBrokerLookup(vaultId, "mail", accountId)');
  });
});

describe("the scopes the cases grant", () => {
  it("are the ones a mailbox asks for", () => {
    // A grant that did not cover mail would be skipped for another reason and
    // make the cases above prove nothing.
    expect(microsoftScopeFor("mail")).toBe(GRAPH_MAIL_SCOPES);
  });
});
