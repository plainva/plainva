import { refreshDriveAccessToken, refreshOneDriveAccessToken, type FetchFn } from "@plainva/core";
import { accountServices, type CloudAccountRecord, type CloudServiceId } from "./cloudAccounts";
import { oauthScopeFor, oauthScopesCover, type OAuthFamily } from "./oauthScopes";
import type { OAuthAccess } from "./oauthAccess";
import type { StoredAccountToken } from "./tokenBroker";
import {
  normalizeVerifiedProviderIdentity,
  parseGoogleUserInfo,
  parseMicrosoftMe,
  verifiedProviderIdentityKey,
  type VerifiedProviderIdentity,
} from "./accountProfile";

/**
 * The ONE way an account signs in (account sign-in plan E1/E2).
 *
 * Connecting an account, adding a service to it and signing it in again are
 * the same act: ask the provider once for everything the card carries plus
 * what is being added, keep what the provider actually granted, recognise the
 * account by the provider's own subject, and write the sign-in to the card.
 * Services never own a sign-in; they ask the broker for their card's.
 *
 * Before this, three flows did the same thing three ways on the desktop and a
 * fourth way on the phone, and the sign-ins lay in three places (the files
 * slot, the calendar row, the mailbox). Every round since June fixed one place
 * that read something other than what another wrote; the places stayed. The
 * findings of 2026-10-23 were four more of the same kind (plan § 1).
 *
 * The flow is split in two because on a phone the consent leaves the app: the
 * prepared request is stored, the browser returns (maybe into a cold start),
 * and the completion runs from what was stored. On the desktop both halves run
 * back to back around the loopback listener.
 */

export type SignInService = CloudServiceId;

export interface SignInIntent {
  vaultId: string;
  family: OAuthFamily;
  /** The card being signed in again or extended. Absent for a new connection. */
  cardId?: string;
  /** Services to ADD to the card. Empty when only signing in again. */
  add: SignInService[];
  access: OAuthAccess;
}

export interface PreparedSignIn {
  intent: SignInIntent;
  /** OAuth services the card already carries; the consent must keep them. */
  carried: SignInService[];
  /** Every service the consent asks for, in files → calendar → mail order. */
  requested: SignInService[];
  /** Services that are added but cannot be part of this consent (Gmail without a mail-enabled access). */
  outside: SignInService[];
  /** The union scope, identity scopes included. */
  scope: string;
  expectedIdentity?: VerifiedProviderIdentity;
  /** The card's address, so the provider can preselect the right account. */
  loginHint?: string;
  createdAt: number;
}

/** What the platform step returns, whatever the platform. */
export interface SignInConsent {
  /** Empty for Android's system sheet, which keeps the renewal itself. */
  refreshToken: string;
  accessToken: string;
  /** The provider's own statement of what it granted; absent when it said nothing. */
  grantedScope?: string;
  nativeGoogle?: { email: string };
}

export interface CompletedSignIn {
  cardId: string;
  /** True when no card of this provider account existed in the vault. */
  isNewCard: boolean;
  /** True when the sign-in was matched to an existing card the caller did not name. */
  joinedExistingCard: boolean;
  identity: VerifiedProviderIdentity;
  /** The account's address as the provider reports it. */
  email: string;
  /** Requested services the provider granted. */
  granted: SignInService[];
  /** Requested services the person left unticked on the consent screen. */
  notGranted: SignInService[];
  token: StoredAccountToken;
}

export class SignInWrongAccountError extends Error {
  constructor(readonly expected: string, readonly actual: string) {
    super("A different provider account was selected. Existing sign-ins were kept.");
    this.name = "SignInWrongAccountError";
  }
}

export class SignInNothingGrantedError extends Error {
  constructor(readonly requested: readonly SignInService[]) {
    super("The provider granted none of the requested services. Existing sign-ins were kept.");
    this.name = "SignInNothingGrantedError";
  }
}

export class SignInCardChangedError extends Error {
  constructor() {
    super("The account changed during sign-in. Open its current settings and try again.");
    this.name = "SignInCardChangedError";
  }
}

export class SignInIdentityError extends Error {
  constructor() {
    super("The provider account could not be verified. Existing sign-ins were kept.");
    this.name = "SignInIdentityError";
  }
}

const ORDER: SignInService[] = ["files", "calendar", "mail"];

function ordered(services: Iterable<SignInService>): SignInService[] {
  const set = new Set(services);
  return ORDER.filter((service) => set.has(service));
}

/**
 * The OAuth services a card carries. Google mail counts only when the mailbox
 * signs in with OAuth; a Gmail mailbox with an app password belongs to the
 * card but not to its consent.
 */
export function cardOAuthServices(record: CloudAccountRecord, mailKind?: string): SignInService[] {
  if (record.family !== "google" && record.family !== "microsoft") return [];
  return accountServices(record).filter((service) => service !== "mail" || record.family === "microsoft" || mailKind === "gmail");
}

/** Unique scopes of the services, in a stable order. Identity scopes are part of every service scope. */
export function unionScope(family: OAuthFamily, services: readonly SignInService[]): string {
  const parts = new Set<string>();
  for (const service of ordered(services)) {
    for (const scope of (oauthScopeFor(family, service) ?? "").split(/\s+/)) if (scope) parts.add(scope);
  }
  return [...parts].join(" ");
}

/** Whether a service can be part of a consent with this access. */
export function consentCovers(access: OAuthAccess, service: SignInService): boolean {
  return service !== "mail" || access.family === "microsoft" || access.mail;
}

export function prepareSignIn(
  intent: SignInIntent,
  card?: { record: CloudAccountRecord; mailKind?: string },
  now: number = Date.now(),
): PreparedSignIn {
  if (intent.access.family !== intent.family) throw new Error("access of another provider");
  if (intent.cardId && (!card || card.record.id !== intent.cardId || card.record.family !== intent.family)) throw new SignInCardChangedError();
  const carried = card ? cardOAuthServices(card.record, card.mailKind) : [];
  const added = ordered(intent.add);
  const outside = added.filter((service) => !consentCovers(intent.access, service));
  // May be empty: a Google card that only gains a Gmail app password needs no
  // consent at all. The caller asks `needsConsent` instead of trying one.
  const requested = ordered([...carried, ...added.filter((service) => consentCovers(intent.access, service))]);
  const expected = normalizeVerifiedProviderIdentity(card?.record.verifiedProviderIdentity);
  const label = card?.record.label?.trim() ?? "";
  return {
    intent: { ...intent, add: added },
    carried,
    requested,
    outside,
    scope: unionScope(intent.family, requested),
    ...(expected ? { expectedIdentity: expected } : {}),
    ...(label.includes("@") ? { loginHint: label } : {}),
    createdAt: now,
  };
}

/** Whether the prepared sign-in has anything to ask the provider for. */
export function needsConsent(prepared: PreparedSignIn): boolean {
  return prepared.requested.length > 0;
}

export interface CompleteSignInPorts {
  fetch: FetchFn;
  /** The vault's cards as they are NOW (the consent may have taken minutes). */
  loadCards(): Promise<CloudAccountRecord[]>;
  /** Merges the grant into the card's credential document (compare-and-set). */
  saveGrant(cardId: string, token: StoredAccountToken): Promise<void>;
  newCardId(): string;
  now?(): number;
}

async function readIdentity(family: OAuthFamily, accessToken: string, fetchFn: FetchFn): Promise<{ identity: VerifiedProviderIdentity; email: string }> {
  if (!accessToken) throw new SignInIdentityError();
  const response = await fetchFn(family === "google" ? "https://openidconnect.googleapis.com/v1/userinfo" : "https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new SignInIdentityError();
  const profile = family === "google" ? parseGoogleUserInfo(await response.json()) : parseMicrosoftMe(await response.json());
  if (!profile) throw new SignInIdentityError();
  return { identity: profile.identity, email: profile.label ?? "" };
}

/**
 * What the provider granted, per requested service. Microsoft may omit the
 * scope when it equals the request; Google's answer always names it, and an
 * answer that names nothing grants nothing.
 */
export function grantedServices(family: OAuthFamily, requested: readonly SignInService[], requestedScope: string, grantedScope: string | undefined): { scopes: string; granted: SignInService[]; notGranted: SignInService[] } {
  const scopes = (grantedScope === undefined ? (family === "microsoft" ? requestedScope : "") : grantedScope).trim();
  const granted: SignInService[] = [];
  const notGranted: SignInService[] = [];
  for (const service of ordered(requested)) {
    const required = oauthScopeFor(family, service);
    (required && oauthScopesCover(scopes, required, family) ? granted : notGranted).push(service);
  }
  return { scopes, granted, notGranted };
}

export async function completeSignIn(prepared: PreparedSignIn, consent: SignInConsent, ports: CompleteSignInPorts): Promise<CompletedSignIn> {
  const { intent } = prepared;
  const family = intent.family;
  if (typeof consent.refreshToken !== "string" || (!consent.refreshToken && !consent.nativeGoogle)) {
    throw new Error("the provider returned an incomplete sign-in");
  }
  const { identity, email } = await readIdentity(family, consent.accessToken, ports.fetch);
  const key = verifiedProviderIdentityKey(identity);
  const cards = await ports.loadCards();

  let cardId: string;
  let isNewCard = false;
  let joinedExistingCard = false;
  if (intent.cardId) {
    const card = cards.find((record) => record.id === intent.cardId);
    if (!card || card.family !== family) throw new SignInCardChangedError();
    const expected = normalizeVerifiedProviderIdentity(card.verifiedProviderIdentity) ?? prepared.expectedIdentity;
    if (expected && verifiedProviderIdentityKey(expected) !== key) {
      throw new SignInWrongAccountError(card.label || prepared.loginHint || "", email);
    }
    cardId = card.id;
  } else {
    // A new connection of an account the vault already has extends that card
    // instead of minting a second one (finding 2026-10-23: "E-Mail" added by
    // hand became an account of its own).
    const existing = cards.find((record) => record.family === family
      && normalizeVerifiedProviderIdentity(record.verifiedProviderIdentity)
      && verifiedProviderIdentityKey(normalizeVerifiedProviderIdentity(record.verifiedProviderIdentity)!) === key);
    if (existing) {
      cardId = existing.id;
      joinedExistingCard = true;
    } else {
      cardId = ports.newCardId();
      isNewCard = true;
    }
  }

  const { scopes, granted, notGranted } = grantedServices(family, prepared.requested, prepared.scope, consent.grantedScope);
  if (granted.length === 0) throw new SignInNothingGrantedError(prepared.requested);

  const token: StoredAccountToken = {
    clientId: intent.access.clientId,
    refreshToken: consent.refreshToken,
    ...(intent.access.clientSecret ? { clientSecret: intent.access.clientSecret } : {}),
    scopes,
    providerIdentity: identity,
    ...(consent.nativeGoogle ? { nativeGoogle: consent.nativeGoogle } : {}),
    verifiedAt: ports.now?.() ?? Date.now(),
  };
  await ports.saveGrant(cardId, token);
  return { cardId, isNewCard, joinedExistingCard, identity, email, granted, notGranted, token };
}

/** Per-service result a surface shows after a sign-in (mockup view 2). */
export type ServiceSignInState = "active" | "notGranted" | "needsPassword" | "failed";
export interface ServiceSignInResult {
  service: SignInService;
  state: ServiceSignInState;
  /** Shown under the row; already a sentence for the person. */
  detail?: string;
}

/**
 * The rows a surface shows: every service of the card after this sign-in.
 * A service that was asked for and not granted says so; a service outside the
 * consent (Gmail without a mail-enabled access) asks for an app password.
 */
export function signInResultRows(prepared: PreparedSignIn, completed: Pick<CompletedSignIn, "granted" | "notGranted">, failed: Partial<Record<SignInService, string>> = {}): ServiceSignInResult[] {
  const rows: ServiceSignInResult[] = [];
  for (const service of ORDER) {
    if (failed[service]) rows.push({ service, state: "failed", detail: failed[service] });
    else if (completed.granted.includes(service)) rows.push({ service, state: "active" });
    else if (completed.notGranted.includes(service)) rows.push({ service, state: "notGranted" });
    else if (prepared.outside.includes(service)) rows.push({ service, state: "needsPassword" });
  }
  return rows;
}

/** Keeps the stored request small and checkable after a cold start. */
export function readPreparedSignIn(value: unknown, now: number = Date.now(), ttlMs = 10 * 60_000): PreparedSignIn | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as PreparedSignIn;
  if (!raw.intent || (raw.intent.family !== "google" && raw.intent.family !== "microsoft")) return null;
  if (typeof raw.scope !== "string" || !Array.isArray(raw.requested) || typeof raw.createdAt !== "number") return null;
  if (now - raw.createdAt > ttlMs || raw.createdAt > now + 60_000) return null;
  return raw;
}

/** The per-service steps a shell supplies after a sign-in (E2). */
export interface BindSignInPorts {
  loadCards(): Promise<CloudAccountRecord[]>;
  saveCards(records: CloudAccountRecord[]): Promise<void>;
  /**
   * Lets services validated DURING the binding find the card's sign-in before
   * the card is written (the broker's pending marker). `null` clears it.
   */
  setPending(cardId: string | null, family: OAuthFamily): void;
  /** Files: point the vault's files slot at the card (no token of its own). */
  bindFiles(cardId: string, completed: CompletedSignIn, existing: boolean): Promise<{ provider: "drive" | "onedrive" }>;
  /** Calendar: create the calendar account, or move an existing one onto the card. */
  bindCalendar(cardId: string, completed: CompletedSignIn, existingPimAccountId?: string): Promise<{ pimAccountId: string; label?: string }>;
  /** Mail through the consent (Microsoft, or Gmail with a mail-enabled access). */
  bindMail(cardId: string, completed: CompletedSignIn, existingMailAccountId?: string): Promise<{ mailAccountId: string }>;
  /**
   * Mail outside the consent (Gmail with an app password, E5): binds the
   * mailbox the person entered, or returns null when no password was given -
   * the row then asks for one at the card.
   */
  bindMailPassword?(cardId: string, completed: CompletedSignIn, existingMailAccountId?: string): Promise<{ mailAccountId: string } | null>;
  /**
   * ONE reload after everything is written. The desktop used to reload the
   * vault after the files step and so stopped the calendar runtime under the
   * calendar step that came next (finding 2026-10-23, plan § 1.1).
   */
  afterBinding(change: { cardId: string; filesChanged: boolean; calendarAccountId?: string }): Promise<void>;
  /** A sentence for a failed service step. */
  describeFailure(error: unknown): string;
}

export interface FinishedSignIn {
  record: CloudAccountRecord;
  rows: ServiceSignInResult[];
}

/**
 * Binds every granted service to the card, writes the card ONCE and reloads
 * ONCE. A service that fails does not stop the others: each says its own
 * result, so "three ticked, one active" can no longer happen silently.
 */
export async function bindSignedInAccount(prepared: PreparedSignIn, completed: CompletedSignIn, ports: BindSignInPorts): Promise<FinishedSignIn> {
  const family = prepared.intent.family;
  const cardId = completed.cardId;
  const failed: Partial<Record<SignInService, string>> = {};
  const before = (await ports.loadCards()).find((record) => record.id === cardId);
  const services = { ...before?.services };
  let calendarAccountId: string | undefined;
  let filesChanged = false;
  let label: string | undefined;
  ports.setPending(cardId, family);
  try {
    for (const service of completed.granted) {
      try {
        if (service === "files") {
          const bound = await ports.bindFiles(cardId, completed, !!services.files);
          filesChanged = !services.files || services.files.provider !== bound.provider;
          services.files = { provider: bound.provider };
        } else if (service === "calendar") {
          const bound = await ports.bindCalendar(cardId, completed, services.calendar?.pimAccountId);
          services.calendar = { pimAccountId: bound.pimAccountId };
          calendarAccountId = bound.pimAccountId;
          label ??= bound.label;
        } else {
          const bound = await ports.bindMail(cardId, completed, services.mail?.mailAccountId);
          services.mail = { mailAccountId: bound.mailAccountId };
        }
      } catch (error) {
        failed[service] = ports.describeFailure(error);
      }
    }
    let passwordMail = false;
    if (prepared.outside.includes("mail") && ports.bindMailPassword) {
      try {
        const bound = await ports.bindMailPassword(cardId, completed, services.mail?.mailAccountId);
        if (bound) {
          services.mail = { mailAccountId: bound.mailAccountId };
          passwordMail = true;
        }
      } catch (error) {
        failed.mail = ports.describeFailure(error);
      }
    }
    const current = await ports.loadCards();
    const latest = current.find((record) => record.id === cardId);
    const record: CloudAccountRecord = {
      ...(latest ?? before ?? {}),
      id: cardId,
      family,
      label: latest?.label || before?.label || completed.email || label || "",
      verifiedProviderIdentity: completed.identity,
      services: { ...latest?.services, ...services },
    };
    // The vault syncs through one account: a newly bound files service moves
    // the reference off every other card.
    const others = current.filter((entry) => entry.id !== cardId)
      .map((entry) => (filesChanged && entry.services.files ? { ...entry, services: { ...entry.services, files: undefined } } : entry));
    await ports.saveCards([...others, record]);
    await ports.afterBinding({ cardId, filesChanged, ...(calendarAccountId ? { calendarAccountId } : {}) });
    const rows = signInResultRows(prepared, completed, failed)
      .map((row) => (row.service === "mail" && passwordMail && row.state === "needsPassword" ? { ...row, state: "active" as const } : row));
    return { record, rows };
  } finally {
    ports.setPending(null, family);
  }
}

/**
 * A files sign-in that ran before its vault existed, turned into a card like
 * any other (account sign-in plan K4b).
 *
 * "Open an online vault" on the desktop and "Add vault" from a cloud on the
 * phone ask for the consent first, browse the cloud folder with it and create
 * the vault only after the folder is picked - there is no vault to hold a card
 * while the browser is open. Until now that sign-in ended in the files slot,
 * with no identity and no card; the next refresh derived a card without one,
 * and "Sign in again" there had nothing to compare the account with.
 *
 * The consent was given with this device's access for `unionScope(family,
 * ["files"])`. Here the grant is renewed once - which also says what it covers
 * and yields an access token for the identity, however long the folder pick
 * took - and then goes through the same `completeSignIn` and
 * `bindSignedInAccount` as every other sign-in. The shell's `bindFiles` finds
 * the files slot already written with the picked folder and points it at the
 * card.
 */
export interface PreVaultSignIn {
  vaultId: string;
  family: OAuthFamily;
  access: OAuthAccess;
  /**
   * What the consent left: a refresh token to renew, or - for Android's
   * system sheet, which keeps the renewal itself - a consent the shell has
   * just renewed silently.
   */
  grant: { refreshToken: string } | { consent: SignInConsent };
}

export async function adoptFilesSignIn(
  input: PreVaultSignIn,
  ports: CompleteSignInPorts & BindSignInPorts,
): Promise<FinishedSignIn & { completed: CompletedSignIn }> {
  const prepared = prepareSignIn({ vaultId: input.vaultId, family: input.family, add: ["files"], access: input.access });
  const completed = await completeSignIn(prepared, "consent" in input.grant ? input.grant.consent : await renewPreVaultGrant(input, input.grant.refreshToken, prepared.scope, ports.fetch), ports);
  const finished = await bindSignedInAccount(prepared, completed, ports);
  return { ...finished, completed };
}

async function renewPreVaultGrant(input: PreVaultSignIn, refreshToken: string, scope: string, fetchFn: FetchFn): Promise<SignInConsent> {
  const { clientId, clientSecret } = input.access;
  const renewed = input.family === "google"
    ? await refreshDriveAccessToken({ clientId, clientSecret: clientSecret ?? "", refreshToken }, fetchFn)
    : await refreshOneDriveAccessToken({ clientId, refreshToken, scope }, fetchFn);
  return {
    // Microsoft rotates the refresh token; the card keeps the newest.
    refreshToken: renewed.refreshToken || refreshToken,
    accessToken: renewed.accessToken,
    ...(renewed.scope !== undefined ? { grantedScope: renewed.scope } : {}),
  };
}
