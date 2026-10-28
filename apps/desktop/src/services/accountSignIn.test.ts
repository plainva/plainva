import { describe, expect, it } from "vitest";
import {
  adoptFilesSignIn,
  bindSignedInAccount,
  completeSignIn,
  grantedServices,
  needsConsent,
  prepareSignIn,
  readPreparedSignIn,
  resolveOAuthAccess,
  signInResultRows,
  SignInCardChangedError,
  SignInNothingGrantedError,
  SignInWrongAccountError,
  unionScope,
  type CloudAccountRecord,
  type OAuthAccess,
  type StoredAccountToken,
} from "@plainva/ui";
import { FakeOAuthProvider } from "@plainva/ui/testing";
import { DRIVE_DEFAULT_SCOPE, GOOGLE_CALENDAR_SCOPES } from "@plainva/core";

const OWN_DESKTOP: OAuthAccess = {
  family: "google", source: "own", clientId: "own-desktop.apps.googleusercontent.com", clientSecret: "own-secret", flow: "loopback", mail: true,
};
const ALICE = { subject: "sub-alice", email: "alice@example.com" };
const BOB = { subject: "sub-bob", email: "bob@example.com" };

function google(): FakeOAuthProvider {
  return new FakeOAuthProvider({ family: "google", accounts: [ALICE, BOB], clients: [{ clientId: OWN_DESKTOP.clientId, clientSecret: "own-secret" }] });
}

function world(cards: CloudAccountRecord[] = []) {
  const saved: { cardId: string; token: StoredAccountToken }[] = [];
  let id = 0;
  return {
    saved,
    cards,
    ports: (provider: FakeOAuthProvider) => ({
      fetch: provider.fetch,
      loadCards: async () => cards,
      saveGrant: async (cardId: string, token: StoredAccountToken) => { saved.push({ cardId, token }); },
      newCardId: () => `card-${++id}`,
      now: () => 1000,
    }),
  };
}

/** The platform step as a browser would do it, against the fake provider. */
function consentWith(provider: FakeOAuthProvider, scope: string, choice: Parameters<FakeOAuthProvider["consent"]>[1] = {}, loginHint?: string) {
  const code = provider.consent({ clientId: OWN_DESKTOP.clientId, scope, loginHint }, choice);
  const answer = provider.exchange({ code, clientId: OWN_DESKTOP.clientId, clientSecret: OWN_DESKTOP.clientSecret });
  return { refreshToken: answer.refresh_token, accessToken: answer.access_token, grantedScope: answer.scope };
}

const card = (over: Partial<CloudAccountRecord> = {}): CloudAccountRecord => ({
  id: "card-a", family: "google", label: ALICE.email, verifiedProviderIdentity: { issuer: "google", subject: ALICE.subject },
  services: { files: { provider: "drive" } }, ...over,
});

describe("one sign-in for every service (finding 2026-10-23, plan § 1.1)", () => {
  it("asks once for files, calendar and mail and keeps what was granted", async () => {
    const provider = google();
    const w = world();
    const prepared = prepareSignIn({ vaultId: "v", family: "google", add: ["files", "calendar", "mail"], access: OWN_DESKTOP });
    expect(prepared.requested).toEqual(["files", "calendar", "mail"]);
    expect(prepared.scope.split(" ")).toEqual(expect.arrayContaining(["https://www.googleapis.com/auth/drive", "https://mail.google.com/", "openid", "email"]));
    const done = await completeSignIn(prepared, consentWith(provider, prepared.scope), w.ports(provider));
    expect(done).toMatchObject({ cardId: "card-1", isNewCard: true, email: ALICE.email, granted: ["files", "calendar", "mail"], notGranted: [] });
    expect(w.saved).toHaveLength(1);
    expect(w.saved[0].token).toMatchObject({ clientId: OWN_DESKTOP.clientId, clientSecret: "own-secret", providerIdentity: { issuer: "google", subject: ALICE.subject } });
    expect(provider.log.filter((entry) => entry.kind === "consent")).toHaveLength(1);
  });

  it("names a permission the person unticked instead of dropping it silently", async () => {
    const provider = google();
    const w = world();
    const prepared = prepareSignIn({ vaultId: "v", family: "google", add: ["files", "calendar"], access: OWN_DESKTOP });
    const untick = GOOGLE_CALENDAR_SCOPES.split(" ").filter((scope) => scope.startsWith("https://"));
    const done = await completeSignIn(prepared, consentWith(provider, prepared.scope, { untick }), w.ports(provider));
    expect(done.granted).toEqual(["files"]);
    expect(done.notGranted).toEqual(["calendar"]);
    expect(signInResultRows(prepared, done)).toEqual([
      { service: "files", state: "active" },
      { service: "calendar", state: "notGranted" },
    ]);
  });

  it("keeps existing sign-ins when nothing was granted", async () => {
    const provider = google();
    const w = world();
    const prepared = prepareSignIn({ vaultId: "v", family: "google", add: ["files"], access: OWN_DESKTOP });
    const untick = DRIVE_DEFAULT_SCOPE.split(" ").filter((scope) => scope.startsWith("https://"));
    await expect(completeSignIn(prepared, consentWith(provider, prepared.scope, { untick }), w.ports(provider))).rejects.toBeInstanceOf(SignInNothingGrantedError);
    expect(w.saved).toHaveLength(0);
  });
});

describe("one account, one card (finding 2026-10-23, plan § 1.3)", () => {
  it("joins a new connection of a known account to its card", async () => {
    const provider = google();
    const w = world([card()]);
    const prepared = prepareSignIn({ vaultId: "v", family: "google", add: ["mail"], access: OWN_DESKTOP });
    const done = await completeSignIn(prepared, consentWith(provider, prepared.scope), w.ports(provider));
    expect(done).toMatchObject({ cardId: "card-a", isNewCard: false, joinedExistingCard: true, granted: ["mail"] });
  });

  it("mints a card for another account", async () => {
    const provider = google();
    const w = world([card()]);
    const prepared = prepareSignIn({ vaultId: "v", family: "google", add: ["files"], access: OWN_DESKTOP });
    const done = await completeSignIn(prepared, consentWith(provider, prepared.scope, { account: BOB.email }), w.ports(provider));
    expect(done).toMatchObject({ cardId: "card-1", isNewCard: true, email: BOB.email });
  });
});

describe("signing a card in again (finding 2026-10-23, plan § 1.4)", () => {
  it("asks for everything the card carries plus what is added, with the card's address as hint", () => {
    const record = card({ services: { files: { provider: "drive" }, calendar: { pimAccountId: "p" } } });
    const prepared = prepareSignIn({ vaultId: "v", family: "google", cardId: "card-a", add: ["mail"], access: OWN_DESKTOP }, { record });
    expect(prepared.carried).toEqual(["files", "calendar"]);
    expect(prepared.requested).toEqual(["files", "calendar", "mail"]);
    expect(prepared.loginHint).toBe(ALICE.email);
  });

  it("refuses another account and saves nothing", async () => {
    const provider = google();
    const w = world([card()]);
    const prepared = prepareSignIn({ vaultId: "v", family: "google", cardId: "card-a", add: [], access: OWN_DESKTOP }, { record: card() });
    const failure = completeSignIn(prepared, consentWith(provider, prepared.scope, { account: BOB.email }), w.ports(provider));
    await expect(failure).rejects.toBeInstanceOf(SignInWrongAccountError);
    await expect(failure).rejects.toMatchObject({ expected: ALICE.email, actual: BOB.email });
    expect(w.saved).toHaveLength(0);
  });

  it("refuses when the card vanished during the consent", async () => {
    const provider = google();
    const w = world([]);
    const prepared = prepareSignIn({ vaultId: "v", family: "google", cardId: "card-a", add: [], access: OWN_DESKTOP }, { record: card() });
    await expect(completeSignIn(prepared, consentWith(provider, prepared.scope), w.ports(provider))).rejects.toBeInstanceOf(SignInCardChangedError);
  });

  it("an app-password mailbox is no reason for a consent", () => {
    const record = card({ services: { mail: { mailAccountId: "m" } } });
    const prepared = prepareSignIn({ vaultId: "v", family: "google", cardId: "card-a", add: [], access: OWN_DESKTOP }, { record, mailKind: "imap" });
    expect(needsConsent(prepared)).toBe(false);
  });
});

describe("Gmail outside the consent (E5)", () => {
  it("asks for an app password at the same card when the access cannot carry mail", () => {
    const access: OAuthAccess = { ...OWN_DESKTOP, source: "plainva", mail: false };
    const prepared = prepareSignIn({ vaultId: "v", family: "google", add: ["files", "mail"], access });
    expect(prepared.requested).toEqual(["files"]);
    expect(prepared.outside).toEqual(["mail"]);
    expect(prepared.scope).not.toContain("mail.google.com");
    expect(signInResultRows(prepared, { granted: ["files"], notGranted: [] })).toEqual([
      { service: "files", state: "active" },
      { service: "mail", state: "needsPassword" },
    ]);
  });

  it("takes Gmail outside the consent when the person chooses the app password, although the access could carry it", () => {
    const prepared = prepareSignIn({ vaultId: "v", family: "google", add: ["files", "mail"], access: OWN_DESKTOP, outside: ["mail"] });
    expect(prepared.requested).toEqual(["files"]);
    expect(prepared.outside).toEqual(["mail"]);
    expect(prepared.scope).not.toContain("mail.google.com");
  });

  it("replaces a Gmail mailbox Google refused with an app password - no consent, the other services are left alone (E7)", () => {
    const record = card({ services: { files: { provider: "drive" }, mail: { mailAccountId: "m-oauth" } } });
    const prepared = prepareSignIn({ vaultId: "v", family: "google", cardId: "card-a", add: ["mail"], access: OWN_DESKTOP, outside: ["mail"] }, { record, mailKind: "gmail" });
    expect(prepared.carried).toEqual(["files"]);
    expect(needsConsent(prepared)).toBe(false);
    expect(prepared.outside).toEqual(["mail"]);
  });

  it("without that choice a carried Gmail mailbox stays in the consent", () => {
    const record = card({ services: { files: { provider: "drive" }, mail: { mailAccountId: "m-oauth" } } });
    const prepared = prepareSignIn({ vaultId: "v", family: "google", cardId: "card-a", add: [], access: OWN_DESKTOP }, { record, mailKind: "gmail" });
    expect(prepared.requested).toEqual(["files", "mail"]);
  });
});

describe("what the provider says it granted", () => {
  it("Microsoft may omit the scope when it equals the request", () => {
    const scope = unionScope("microsoft", ["files", "mail"]);
    expect(grantedServices("microsoft", ["files", "mail"], scope, undefined).granted).toEqual(["files", "mail"]);
  });

  it("a Google answer that names nothing grants nothing", () => {
    expect(grantedServices("google", ["files"], unionScope("google", ["files"]), undefined).granted).toEqual([]);
  });
});

describe("the fake provider behaves like the real ones", () => {
  it("Google ignores the scope of a renewal; Microsoft rotates the refresh token", () => {
    const g = google();
    const code = g.consent({ clientId: OWN_DESKTOP.clientId, scope: unionScope("google", ["files"]) });
    const first = g.exchange({ code, clientId: OWN_DESKTOP.clientId, clientSecret: "own-secret" });
    const renewed = g.refresh({ refreshToken: first.refresh_token, clientId: OWN_DESKTOP.clientId, scope: "https://mail.google.com/" });
    expect(renewed.scope).toBe(first.scope);
    expect(renewed.refresh_token).toBeUndefined();

    const m = new FakeOAuthProvider({ family: "microsoft", accounts: [ALICE], clients: [{ clientId: "ms" }] });
    const msCode = m.consent({ clientId: "ms", scope: unionScope("microsoft", ["files"]) });
    const msFirst = m.exchange({ code: msCode, clientId: "ms" });
    const msRenewed = m.refresh({ refreshToken: msFirst.refresh_token, clientId: "ms" });
    expect(msRenewed.refresh_token).not.toBe(msFirst.refresh_token);
    expect(() => m.refresh({ refreshToken: msFirst.refresh_token, clientId: "ms" })).toThrow(/invalid_grant/);
  });

  it("a project in Testing lets a refresh token lapse after seven days", () => {
    let now = 0;
    const g = new FakeOAuthProvider({ family: "google", accounts: [ALICE], clients: [{ clientId: "c" }], testing: true, now: () => now });
    const first = g.exchange({ code: g.consent({ clientId: "c", scope: "openid email" }), clientId: "c" });
    now = 8 * 24 * 60 * 60 * 1000;
    expect(() => g.refresh({ refreshToken: first.refresh_token, clientId: "c" })).toThrow(/invalid_grant/);
  });
});

describe("access per device (E3)", () => {
  const env = {
    VITE_PLAINVA_GOOGLE_DESKTOP_CLIENT_ID: "plainva-desktop.apps.googleusercontent.com",
    VITE_PLAINVA_GOOGLE_DESKTOP_CLIENT_SECRET: "plainva-secret",
    VITE_PLAINVA_GOOGLE_ANDROID_CLIENT_ID: "plainva-android.apps.googleusercontent.com",
    VITE_PLAINVA_GOOGLE_IOS_CLIENT_ID: "plainva-ios.apps.googleusercontent.com",
  };

  it("uses Plainva's client by default, and the system sheet on Android", () => {
    expect(resolveOAuthAccess("google", "desktop", null, env)).toMatchObject({ ok: true, access: { source: "plainva", clientId: "plainva-desktop.apps.googleusercontent.com", clientSecret: "plainva-secret", flow: "loopback", mail: false } });
    expect(resolveOAuthAccess("google", "android", null, env)).toMatchObject({ ok: true, access: { flow: "system" } });
    expect(resolveOAuthAccess("google", "ios", null, env)).toMatchObject({ ok: true, access: { flow: "browser" } });
    expect(resolveOAuthAccess("google", "desktop", null, { ...env, VITE_PLAINVA_GOOGLE_MAIL_STATE: "testing" })).toMatchObject({ ok: true, access: { mail: true } });
  });

  it("says so when the build ships no client, instead of falling back to another", () => {
    expect(resolveOAuthAccess("google", "desktop", null, {})).toEqual({ ok: false, problem: "noPlainvaClient" });
  });

  it("asks a desktop for the secret of its own client and a phone for none", () => {
    const own = { source: "own" as const, clientId: "mine.apps.googleusercontent.com" };
    expect(resolveOAuthAccess("google", "desktop", own, env)).toEqual({ ok: false, problem: "ownSecretMissing" });
    const phone = resolveOAuthAccess("google", "android", own, env);
    expect(phone).toMatchObject({ ok: true, access: { source: "own", flow: "browser" } });
    expect(phone.ok && "clientSecret" in phone.access).toBe(false);
    expect(resolveOAuthAccess("google", "desktop", { ...own, clientSecret: "s" }, env)).toMatchObject({ ok: true, access: { clientSecret: "s", mail: true } });
    expect(resolveOAuthAccess("google", "desktop", { source: "own", clientId: "nonsense" }, env)).toEqual({ ok: false, problem: "ownClientInvalid" });
  });

  it("Microsoft always has Plainva's client", () => {
    expect(resolveOAuthAccess("microsoft", "android", null, {})).toMatchObject({ ok: true, access: { flow: "browser", mail: true } });
  });
});

describe("a stored request after a cold start", () => {
  it("expires after ten minutes", () => {
    const prepared = prepareSignIn({ vaultId: "v", family: "google", add: ["files"], access: OWN_DESKTOP }, undefined, 0);
    expect(readPreparedSignIn(JSON.parse(JSON.stringify(prepared)), 60_000)).not.toBeNull();
    expect(readPreparedSignIn(prepared, 11 * 60_000)).toBeNull();
    expect(readPreparedSignIn({ nonsense: true }, 0)).toBeNull();
  });
});

describe("binding after the sign-in (E2: write everything, then reload once)", () => {
  function bindPorts(cards: CloudAccountRecord[], fail: Partial<Record<"files" | "calendar" | "mail", Error>> = {}) {
    const events: string[] = [];
    let stored = cards;
    return {
      events,
      stored: () => stored,
      ports: {
        loadCards: async () => stored,
        saveCards: async (records: CloudAccountRecord[]) => { events.push("save"); stored = records; },
        setPending: (cardId: string | null) => { events.push(`pending:${cardId}`); },
        bindFiles: async () => { events.push("files"); if (fail.files) throw fail.files; return { provider: "drive" as const }; },
        bindCalendar: async (_card: string, _done: unknown, existing?: string) => { events.push(`calendar:${existing ?? "new"}`); if (fail.calendar) throw fail.calendar; return { pimAccountId: existing ?? "pim-1" }; },
        bindMail: async (_card: string, _done: unknown, existing?: string) => { events.push(`mail:${existing ?? "new"}`); if (fail.mail) throw fail.mail; return { mailAccountId: existing ?? "mail-1" }; },
        afterBinding: async (change: { filesChanged: boolean }) => { events.push(`reload:${change.filesChanged}`); },
        describeFailure: (error: unknown) => (error as Error).message,
      },
    };
  }
  const completedFor = (granted: ("files" | "calendar" | "mail")[], cardId = "card-1") => ({
    cardId, isNewCard: cardId === "card-1", joinedExistingCard: false, identity: { issuer: "google" as const, subject: ALICE.subject },
    email: ALICE.email, granted, notGranted: [], token: { clientId: "c", refreshToken: "r" },
  });

  it("binds every granted service, writes the card once and reloads once at the end", async () => {
    const prepared = prepareSignIn({ vaultId: "v", family: "google", add: ["files", "calendar", "mail"], access: OWN_DESKTOP });
    const b = bindPorts([]);
    const done = await bindSignedInAccount(prepared, completedFor(["files", "calendar", "mail"]), b.ports);
    expect(b.events).toEqual(["pending:card-1", "files", "calendar:new", "mail:new", "save", "reload:true", "pending:null"]);
    expect(done.record).toMatchObject({ id: "card-1", label: ALICE.email, services: { files: { provider: "drive" }, calendar: { pimAccountId: "pim-1" }, mail: { mailAccountId: "mail-1" } } });
    expect(done.rows.map((row) => row.state)).toEqual(["active", "active", "active"]);
  });

  it("a failing service says why and does not stop the next one", async () => {
    const prepared = prepareSignIn({ vaultId: "v", family: "google", add: ["files", "calendar", "mail"], access: OWN_DESKTOP });
    const b = bindPorts([], { calendar: new Error("pim runtime changed") });
    const done = await bindSignedInAccount(prepared, completedFor(["files", "calendar", "mail"]), b.ports);
    expect(done.rows).toEqual([
      { service: "files", state: "active" },
      // The failure itself rides along, so the wizard can name its sender.
      { service: "calendar", state: "failed", detail: "pim runtime changed", error: new Error("pim runtime changed") },
      { service: "mail", state: "active" },
    ]);
    expect(done.record.services.calendar).toBeUndefined();
  });

  it("moves the files reference off every other card", async () => {
    const other: CloudAccountRecord = { id: "other", family: "microsoft", label: "x@y.z", services: { files: { provider: "onedrive" }, calendar: { pimAccountId: "p" } } };
    const prepared = prepareSignIn({ vaultId: "v", family: "google", add: ["files"], access: OWN_DESKTOP });
    const b = bindPorts([other]);
    await bindSignedInAccount(prepared, completedFor(["files"]), b.ports);
    expect(b.stored().find((record) => record.id === "other")?.services).toEqual({ files: undefined, calendar: { pimAccountId: "p" } });
  });

  it("signing in again rebinds the services the card already has, in place", async () => {
    const existing = card({ services: { files: { provider: "drive" }, calendar: { pimAccountId: "pim-old" } } });
    const prepared = prepareSignIn({ vaultId: "v", family: "google", cardId: "card-a", add: [], access: OWN_DESKTOP }, { record: existing });
    const b = bindPorts([existing]);
    const done = await bindSignedInAccount(prepared, completedFor(["files", "calendar"], "card-a"), b.ports);
    expect(b.events).toContain("calendar:pim-old");
    expect(b.events).toContain("reload:false");
    expect(b.stored()).toHaveLength(1);
    expect(done.record.services.calendar).toEqual({ pimAccountId: "pim-old" });
  });
});

describe("a sign-in made before its vault existed becomes a card (plan K4b)", () => {
  // "Open an online vault" and the phone's "Add vault" ask for the consent,
  // browse the cloud folder and make the vault only then. The sign-in used to
  // end in the files slot with no identity and no card.
  function adoptPorts(provider: FakeOAuthProvider, initial: CloudAccountRecord[] = []) {
    const state = { cards: initial, bound: [] as string[] };
    let id = 0;
    return {
      state,
      ports: {
        fetch: provider.fetch,
        loadCards: async () => state.cards,
        saveGrant: async () => undefined,
        newCardId: () => `card-${++id}`,
        saveCards: async (records: CloudAccountRecord[]) => { state.cards = records; },
        setPending: () => undefined,
        bindFiles: async (cardId: string) => { state.bound.push(cardId); return { provider: "drive" as const }; },
        bindCalendar: () => Promise.reject(new Error("no calendar here")),
        bindMail: () => Promise.reject(new Error("no mail here")),
        afterBinding: async () => undefined,
        describeFailure: (error: unknown) => String(error),
      },
    };
  }

  it("renews the grant once, reads the identity and writes a card that carries the files", async () => {
    const provider = google();
    const consent = consentWith(provider, unionScope("google", ["files"]));
    const { state, ports } = adoptPorts(provider);
    const finished = await adoptFilesSignIn({ vaultId: "new-vault", family: "google", access: OWN_DESKTOP, grant: { refreshToken: consent.refreshToken } }, ports);
    expect(finished.record).toMatchObject({
      family: "google", label: ALICE.email, verifiedProviderIdentity: { issuer: "google", subject: ALICE.subject }, services: { files: { provider: "drive" } },
    });
    expect(finished.rows).toEqual([{ service: "files", state: "active" }]);
    expect(state.bound).toEqual([finished.record.id]);
    expect(state.cards).toHaveLength(1);
    expect(provider.log.filter((entry) => entry.kind === "refresh")).toHaveLength(1);
  });

  it("joins the card the vault already has for the same account", async () => {
    const provider = google();
    const consent = consentWith(provider, unionScope("google", ["files"]));
    const { state, ports } = adoptPorts(provider, [card({ id: "card-a", services: {} })]);
    const finished = await adoptFilesSignIn({ vaultId: "v", family: "google", access: OWN_DESKTOP, grant: { refreshToken: consent.refreshToken } }, ports);
    expect(finished.completed.joinedExistingCard).toBe(true);
    expect(state.cards.map((entry) => entry.id)).toEqual(["card-a"]);
    expect(state.cards[0].services.files).toEqual({ provider: "drive" });
  });

  it("takes a consent the shell renewed itself - Android's system sheet holds no refresh token", async () => {
    const provider = google();
    const consent = consentWith(provider, unionScope("google", ["files"]));
    const { state, ports } = adoptPorts(provider);
    await adoptFilesSignIn({
      vaultId: "v", family: "google", access: OWN_DESKTOP,
      grant: { consent: { refreshToken: "", accessToken: consent.accessToken, grantedScope: consent.grantedScope, nativeGoogle: { email: ALICE.email } } },
    }, ports);
    expect(state.cards[0]).toMatchObject({ verifiedProviderIdentity: { subject: ALICE.subject }, services: { files: { provider: "drive" } } });
    expect(provider.log.filter((entry) => entry.kind === "refresh")).toHaveLength(0);
  });
});
