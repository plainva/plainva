/**
 * The secrets sync of a device on Plainva 0.9.0, frozen from the tag `v0.9.0`
 * (`packages/core/src/settingsSync/secretsBundle.ts`, the types of
 * `packages/core/src/settingsSync/SecretsSyncStep.ts`,
 * `packages/ui/src/lib/secretsMark.ts` and `packages/ui/src/lib/secretsPort.ts`
 * at that tag; `main` carried the same code until the removal rules of
 * 2026-11-25). Tests run devices of this version beside current ones and
 * beside 0.8.7 (`secretsV087.ts`) to hold what a mixed fleet does. Only the
 * sealing of the bundle is left out, the imports are inlined and the
 * diagnostics line is a no-op; nothing else is changed. Never edit this file
 * to make a test pass: it is what is out there.
 */

// ---- packages/core/src/textScan.ts (v0.9.0), the one helper used below
function trimEndChars(text: string, chars: string): string {
  let end = text.length;
  while (end > 0 && chars.includes(text[end - 1])) end--;
  return text.slice(0, end);
}

// ---- packages/core/src/settingsSync/profileFile.ts (v0.9.0)
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

// ---- packages/ui/src/platform/settings.ts (v0.9.0), the store interface
interface ISettingsStore {
  get<T>(key: string): Promise<T | undefined | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  keys(): Promise<string[]>;
  save(): Promise<void>;
}

// ---- packages/ui/src/services/diagnosticsLog.ts, the one call used below (a no-op here)
function logDiagnosticCounted(_area: string, _message: string): void {}

// ---- packages/core/src/settingsSync/secretsBundle.ts (v0.9.0), without sealing
/**
 * Account-secrets bundle `.plainva/sync/secrets.enc` (v3 §3.4). One encrypted
 * document (sealed under K_secrets) that carries ONLY shareable static secrets —
 * CalDAV/IMAP app passwords. OAuth client registrations, refresh/access tokens
 * (Microsoft, Google OAuth,
 * OneDrive, Dropbox), session cookie and short-lived code is HARD-excluded by a
 * code allowlist plus negative tests, because those rotate and a shared copy
 * would break both devices.
 *
 * Each entry binds account id, provider/family, service, secret type,
 * normalized user and a canonical endpoint fingerprint; an import only proceeds
 * when the locally validated account metadata matches, so a tampered server
 * address can never redirect a real password to a foreign host (v3 §3.6). Entries
 * carry their own revision/tombstone/provenance and merge per entry — bundle-LWW
 * never loses an independent secret change.
 */

/**
 * The static, shareable secret types a current device writes. Everything else
 * is refused for an export.
 *
 * They are their own types, not the ones clients up to 0.8.7 write (review
 * 2026-11-18, round six): such a client lower-cases every user and writes an
 * entry it reads back unchanged, but without anything a newer device adds to
 * it — so whether an entry is old or new can only be told by its PLACE, which
 * an old client neither removes nor adds. An old client passes an entry of a
 * type it does not know through unchanged: it never applies it, never keeps it
 * and never writes a tombstone for it (it counts it as "rejected" in its
 * diagnostics). A current device in turn reads the old types
 * (`BRIDGE_SECRET_TYPES`) and never writes them. The cost, named for the
 * release texts: a device on 0.8.7 receives no password from an updated one.
 */
export const SHAREABLE_SECRET_TYPES = ["caldav-password-2", "imap-password-2"] as const;
export type ShareableSecretType = (typeof SHAREABLE_SECRET_TYPES)[number];

export function isShareableSecretType(type: string): type is ShareableSecretType {
  return (SHAREABLE_SECRET_TYPES as readonly string[]).includes(type);
}

/**
 * The types clients up to 0.8.7 wrote, with the user lower-cased. A current
 * device reads them for the single account each can mean and never writes one
 * — not as a value, not as a tombstone.
 */
export const BRIDGE_SECRET_TYPES = ["caldav-password", "imap-password"] as const;
export type BridgeSecretType = (typeof BRIDGE_SECRET_TYPES)[number];

export function isBridgeSecretType(type: string): type is BridgeSecretType {
  return (BRIDGE_SECRET_TYPES as readonly string[]).includes(type);
}

/** The type an entry of a client up to 0.8.7 has for a current device, and back. */
export function currentSecretTypeOf(type: BridgeSecretType): ShareableSecretType {
  return type === "caldav-password" ? "caldav-password-2" : "imap-password-2";
}
export function bridgeSecretTypeOf(type: ShareableSecretType): BridgeSecretType {
  return type === "caldav-password-2" ? "caldav-password" : "imap-password";
}

/**
 * Secret types emitted by older clients that a current client may still have
 * to open and preserve verbatim. They are never applied to a local credential
 * slot and never originate in a current export.
 */
export const LEGACY_SECRET_TYPES = ["google-pim-client"] as const;
export type LegacySecretType = (typeof LEGACY_SECRET_TYPES)[number];
export type SecretType = ShareableSecretType | BridgeSecretType | LegacySecretType;

export function isLegacySecretType(type: string): type is LegacySecretType {
  return (LEGACY_SECRET_TYPES as readonly string[]).includes(type);
}

/** Cryptographic-ish binding that gates an import against the local account. */
export interface SecretBinding {
  family: string;
  service: "calendar" | "mail" | "files";
  secretType: SecretType;
  /**
   * The user/login exactly as the account signs in with it, only trimmed
   * (`secretBindingUser`); a mail user lower-cased. Clients up to 0.8.7 wrote
   * every user lower-cased, in the old types (`BRIDGE_SECRET_TYPES`).
   */
  user: string;
  /** Canonical endpoint fingerprint (see canonicalizeEndpoint). */
  endpoint: string;
}

export interface SecretEntry {
  entryRev: number;
  updatedAt: string;
  deviceId: string;
  /** A tombstone carries no secret. */
  tombstone?: boolean;
  binding: SecretBinding;
  /** The actual secret payload (e.g. {pass} or {clientId, clientSecret}). Absent for tombstones. */
  secret?: Record<string, string>;
}

export interface SecretsBundle {
  format: "plainva-secrets";
  version: 1;
  bundleRev: number;
  updatedAt: string;
  entries: Record<string, SecretEntry>;
}

export class SecretPolicyError extends Error {
  constructor(message: string) {
    super(`secret policy violation: ${message}`);
    this.name = "SecretPolicyError";
  }
}

/** Throws if an entry carries a non-shareable secret type (defense in depth). */
export function assertShareable(entry: SecretEntry): void {
  if (!isShareableSecretType(entry.binding.secretType)) {
    throw new SecretPolicyError(`secret type "${entry.binding.secretType}" is never synced`);
  }
}

/**
 * Canonicalizes an account endpoint URL to a stable fingerprint: lowercase
 * scheme + IDNA host, default port dropped, non-default port kept, TLS implied by
 * scheme; userinfo and fragment are forbidden; path trailing slash trimmed.
 * Throws on anything unparseable or containing credentials.
 */
export function canonicalizeEndpoint(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new SecretPolicyError("endpoint is not a valid URL");
  }
  if (parsed.username || parsed.password) throw new SecretPolicyError("endpoint must not contain credentials");
  if (parsed.hash) throw new SecretPolicyError("endpoint must not contain a fragment");
  const scheme = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const defaultPort = scheme === "https:" ? "443" : scheme === "http:" ? "80" : "";
  const port = parsed.port && parsed.port !== defaultPort ? `:${parsed.port}` : "";
  const path = trimEndChars(parsed.pathname, "/") || "";
  return `${scheme}//${host}${port}${path}`;
}

/**
 * The name every device agrees on for ONE credential.
 *
 * A logical id used to be derived from the LOCAL account id, so each device
 * minted its own name for the same password. The maintainer's bundle held six
 * ids for a single Gmail app password (2026-08-10), five of them already
 * tombstoned and one at entryRev 214 from the resulting ping-pong; the two
 * shells could not even agree by accident, because their keychain slots are
 * built differently (`pim_<account>_<b64 path>` on the desktop,
 * `pim_<vaultId>_<account>` on the phone). Deriving the name from the binding
 * instead makes it a property of the CREDENTIAL, which is the thing that is
 * actually shared.
 *
 * The family is deliberately excluded. It is a catalog label — the same
 * self-hosted server is "nextcloud" on a device that has it in its cloud
 * registry and "webdav" on one that only knows the host table — and the import
 * already tolerates a family-only difference (bindingMatchesExceptFamily).
 * Including it would recreate exactly the disagreement this removes.
 *
 * Everything that decides WHERE a password would be sent is included, so two
 * different accounts can never collide on one name.
 *
 * A malformed endpoint falls back to its trimmed raw form rather than throwing:
 * an id is needed for every candidate, and a binding that cannot be
 * canonicalized is rejected by the import on its own merits anyway.
 */
export function canonicalSecretId(
  binding: Pick<SecretBinding, "service" | "secretType" | "user" | "endpoint">,
): string {
  let endpoint: string;
  try {
    endpoint = canonicalizeEndpoint(binding.endpoint);
  } catch {
    endpoint = binding.endpoint.trim();
  }
  // An old type is named as clients up to 0.8.7 name it, the user
  // lower-cased. A current type names the user as the account signs in with
  // it: "Alice" and "alice" are two accounts on a server that tells them
  // apart, and one name for both let the second password overwrite the first
  // and land in the other row's slot (GitHub issue 174).
  const user = isBridgeSecretType(binding.secretType)
    ? binding.user.trim().toLowerCase()
    : bindingUserKey(binding.service, binding.user);
  return `s1:${binding.service}:${binding.secretType}:${encodeURIComponent(user)}@${encodeURIComponent(endpoint)}`;
}

/** The user as a binding carries it: exactly as the account signs in with it, only trimmed. */
export function secretBindingUser(user: string): string {
  return user.trim();
}

/**
 * The user as the secret rules compare it. A mailbox is one account in any
 * case of its address (`mailIdentity`), so a mail user is folded; a calendar or
 * files user is compared exactly — "Alice" and "alice" may be two accounts of
 * one CalDAV server.
 */
function bindingUserKey(service: SecretBinding["service"], user: string): string {
  const exact = secretBindingUser(user);
  return service === "mail" ? exact.toLowerCase() : exact;
}

/** True when a synced entry's binding matches an observed local account. */
export function bindingMatches(binding: SecretBinding, observed: { family: string; service: SecretBinding["service"]; user: string; endpoint: string }): boolean {
  return bindingMatchesExceptFamily(binding, observed) && binding.family === observed.family;
}

/**
 * The same match WITHOUT the provider family.
 *
 * The family is a catalog label, not part of the account's identity: the same
 * self-hosted CalDAV server is "nextcloud" on a device that has it in its cloud
 * registry and "webdav" on one that only has the host table. Service, secret
 * type, user and endpoint still have to agree exactly — those are what actually
 * decide WHERE a password would be sent, so a looser match cannot redirect a
 * credential to a foreign host.
 *
 * Used as a fallback after the exact match, so two devices that label the same
 * server differently still recognise each other instead of refusing forever.
 */
export function bindingMatchesExceptFamily(
  binding: SecretBinding,
  observed: { service: SecretBinding["service"]; user: string; endpoint: string },
  userCase: "exact" | "fold" = "exact",
): boolean {
  let observedEndpoint: string;
  try {
    observedEndpoint = canonicalizeEndpoint(observed.endpoint);
  } catch {
    return false;
  }
  const user = bindingUserKey(binding.service, binding.user);
  const observedUser = bindingUserKey(observed.service, observed.user);
  return (
    binding.service === observed.service &&
    (userCase === "exact" ? user === observedUser : user.toLowerCase() === observedUser.toLowerCase()) &&
    binding.endpoint === observedEndpoint
  );
}

/** Picks the winner between two versions of the same entry (per-entry LWW). */
export function mergeSecretEntries(a: SecretEntry | undefined, b: SecretEntry | undefined): SecretEntry {
  if (!a) return b!;
  if (!b) return a;
  if (a.entryRev !== b.entryRev) return a.entryRev > b.entryRev ? a : b;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return a.deviceId >= b.deviceId ? a : b;
}

/** Merges two bundles entry-by-entry (never bundle-LWW). */
export function mergeSecretsBundles(local: SecretsBundle | null, remote: SecretsBundle | null, now: string): SecretsBundle {
  const entries: Record<string, SecretEntry> = {};
  const ids = new Set<string>([...Object.keys(local?.entries ?? {}), ...Object.keys(remote?.entries ?? {})]);
  for (const id of ids) entries[id] = mergeSecretEntries(local?.entries[id], remote?.entries[id]);
  return {
    format: "plainva-secrets",
    version: 1,
    bundleRev: Math.max(local?.bundleRev ?? 0, remote?.bundleRev ?? 0) + (local && remote ? 1 : 0),
    updatedAt: now,
    entries,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/**
 * Validates the complete decrypted document before any shell can touch a
 * credential slot. Secret-type policy deliberately does not live here:
 * structurally valid legacy/future entries are isolated by the import port,
 * while malformed cryptographic plaintext rejects the whole bundle.
 */
export function assertSecretsBundleStructure(value: unknown): asserts value is SecretsBundle {
  if (!isRecord(value)) throw new SecretPolicyError("secrets bundle root is malformed");
  if (value.format !== "plainva-secrets" || value.version !== 1) {
    throw new SecretPolicyError("secrets bundle header is malformed");
  }
  if (!isNonNegativeInteger(value.bundleRev) || !isNonEmptyString(value.updatedAt) || !isRecord(value.entries)) {
    throw new SecretPolicyError("secrets bundle metadata is malformed");
  }

  for (const [logicalId, candidate] of Object.entries(value.entries)) {
    if (!isNonEmptyString(logicalId) || !isRecord(candidate)) {
      throw new SecretPolicyError("secrets bundle entry is malformed");
    }
    if (
      !isNonNegativeInteger(candidate.entryRev) ||
      !isNonEmptyString(candidate.updatedAt) ||
      !isNonEmptyString(candidate.deviceId) ||
      (candidate.tombstone !== undefined && typeof candidate.tombstone !== "boolean") ||
      !isRecord(candidate.binding)
    ) {
      throw new SecretPolicyError("secrets bundle entry metadata is malformed");
    }
    const binding = candidate.binding;
    if (
      !isNonEmptyString(binding.family) ||
      (binding.service !== "calendar" && binding.service !== "mail" && binding.service !== "files") ||
      !isNonEmptyString(binding.secretType) ||
      typeof binding.user !== "string" ||
      !isNonEmptyString(binding.endpoint)
    ) {
      throw new SecretPolicyError("secrets bundle binding is malformed");
    }

    if (candidate.tombstone) {
      if (candidate.secret !== undefined) {
        throw new SecretPolicyError("secrets bundle tombstone carries a payload");
      }
      continue;
    }
    if (!isRecord(candidate.secret) || Object.values(candidate.secret).some((part) => typeof part !== "string")) {
      throw new SecretPolicyError("secrets bundle secret payload is malformed");
    }
  }
}

export function parseSecretsBundle(json: string): SecretsBundle | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  try {
    assertSecretsBundleStructure(parsed);
    return parsed;
  } catch {
    return null;
  }
}

// ---- packages/core/src/settingsSync/SecretsSyncStep.ts (v0.9.0), the types
export type SecretImportStatus = "imported" | "unchanged" | "rejected" | "stale" | "error";

export type SecretImportReason =
  | "already-current"
  | "binding-mismatch"
  | "legacy-secret-type"
  | "local-secret-conflict"
  | "local-secret-protected"
  | "older-entry"
  | "slot-read-failed"
  | "slot-write-failed"
  | "superseded-by-exact-entry"
  | "superseded-by-later-entry"
  | "old-name-not-taken"
  | "tombstone-no-local-secret"
  | "unknown-account"
  | "unsupported-secret-type"
  | "version-collision";

export interface SecretImportEntryResult {
  logicalId: string;
  status: SecretImportStatus;
  /** Stable, non-sensitive code. Raw errors and secret material stay local. */
  reason?: SecretImportReason;
}

/** Structured outcome of an import, without credential values or raw errors. */
export interface SecretsImportResult {
  entries: SecretImportEntryResult[];
  imported: string[];
  unchanged: string[];
  rejected: string[];
  stale: string[];
  errors: string[];
  /**
   * Ids whose account is unknown HERE — skipped, not failed. They apply on a
   * later cycle once the account metadata has arrived through the profile.
   */
  unknownAccounts: string[];
  /** Known obsolete entries that were intentionally not applied locally. */
  legacyEntries: string[];
  /**
   * Nothing to do: the port already took this document, against these
   * accounts and slots, in an earlier round that left nothing open. The step
   * reports nothing for it, so a round without a change writes nothing
   * (review 2026-11-18, round seven).
   */
  settled?: boolean;
}

/** Shell bridge between the OS keychain and the shareable secrets bundle. */
export interface SecretsPort {
  /** The device's current shareable secrets (CalDAV/IMAP passwords only). */
  exportBundle(): Promise<SecretsBundle>;
  /** Apply isolated, snapshot-protected write groups (binding-checked). */
  importBundle(bundle: SecretsBundle): Promise<SecretsImportResult>;
  /**
   * Whether the last export left records waiting for the shared document
   * (a lost mark key, round twelve): then the document is imported even when
   * the merge changed nothing, since only an import that read it ends them.
   */
  awaitsDocument?(): boolean;
}

// ---- packages/ui/src/lib/secretsMark.ts (v0.9.0)

/**
 * The marks the secrets sync keeps about a password (review 2026-11-18,
 * rounds eight and nine, F67).
 *
 * To tell "unchanged" from "changed", the port remembers each password it
 * published or took as a mark of its binding and secret. Up to now that mark
 * was the text itself — `stableStringify({ binding, secret })` — kept in the
 * ordinary settings store (`plainva-settings.json` on the desktop, the app's
 * settings on the phone, which the system backup copies), so every password
 * stood there in plain text, since 0.5.0.
 *
 * A mark is now `m1:<key id>.<HMAC-SHA-256>` of that same text under a random
 * key of this device. The key lives where the passwords live, in the
 * credentials store (`SECRETS_MARK_KEY_SLOT`), never in the settings store.
 * Because the input is exactly the old text, an old mark turns into the new
 * mark of the same pair (`sealSecretsMeta`): no revision moves, no time, no
 * upload.
 *
 * Knowledge is never thrown away and never guessed:
 *  - A credentials store that does not answer is an error, not "no key": the
 *    port does not run and nothing is sealed; the next start tries again, and
 *    the old marks stay as they are until then.
 *  - Only a key that is missing on a device without any mark is made fresh.
 *    A key missing while marks of it exist (the store lost that one item) is
 *    made anew too — the port needs one — but every mark of the lost key is
 *    known by its key id as knowledge this device lost (`ownsMark`), and the
 *    port restores it from the shared document instead of taking anything as
 *    a change (`secretsPort.ts`).
 *  - An empty slot has its own mark, the mark of no secret: a password typed
 *    later is a change made here.
 *
 * The records also move to a new name in the settings store
 * (`secretsMetaStorageKey`): a device that goes back to 0.8.7 finds no record
 * under the name that version reads and starts like a new device — revision 1
 * from its own slots, which beats nothing newer. Coming back to this version,
 * what 0.8.7 knew in between is taken in (`mergeLegacySecretsMeta`).
 */
export const SECRETS_MARK_KEY_SLOT = "settingsSyncSecretsMarkKey";

const PREFIX = "m1:";

export interface SecretsMarker {
  (text: string): Promise<string>;
  /** Whether a mark was made with this device's current key. */
  owns(mark: string): boolean;
}

/** Where the key is kept: the same credentials store the passwords use. */
export interface SecretsMarkSlots {
  readSlot(slot: string): Promise<unknown>;
  writeSlot(slot: string, value: unknown): Promise<void>;
  /**
   * A desktop: the key belongs to the app process, which looks for it, makes
   * it from `fresh` where there is none and notes its one place — keychain or
   * credentials file — under one lock for every window of the app (round
   * fourteen, `apps/desktop/src-tauri/src/secure_store.rs`). Throws when its
   * store does not answer. A host without it (the phone, one web view) reads
   * and writes the key through its slots.
   */
  ownedKey?(fresh: string, marksOnDevice: boolean): Promise<string>;
  /**
   * Whether any record on this device, of any vault, holds marks of a key
   * (round twelve): a device has one key, and while any of its records was
   * made with it, a store that does not answer never makes a second one.
   */
  marksOnDevice?(): Promise<boolean>;
}

/** A mark as this file writes it, with any key; anything else that is not "" is an old plain mark. */
export const isSecretsMark = (value: string): boolean => value.startsWith(PREFIX);

const HEX_KEY = /^[0-9a-f]{64}$/;

/**
 * Whether a record holds marks made with a key — knowledge a new key would
 * lose. An old plain mark is none (round eleven): it is sealed with whatever
 * key there is, nothing of it is lost.
 */
export const holdsSecretsMarks = (meta: SecretsPortMeta | null | undefined): boolean =>
  !!meta &&
  (Object.values(meta.entries ?? {}).some((entry) => typeof entry?.hash === "string" && isSecretsMark(entry.hash)) ||
    (typeof meta.settled === "string" && isSecretsMark(meta.settled)));

// A device that cannot say whether it holds marks is taken to hold some.
const marksOnDevice = async (slots: SecretsMarkSlots): Promise<boolean> => {
  if (!slots.marksOnDevice) return false;
  try {
    return await slots.marksOnDevice();
  } catch {
    return true;
  }
};

/**
 * Whether any record in a device's settings store — every vault, under either
 * name (`isRecord`) — holds marks made with a key (`holdsSecretsMarks`).
 */
export async function storeHoldsSecretsMarks(store: ISettingsStore, isRecord: (key: string) => boolean): Promise<boolean> {
  for (const key of (await store.keys()).filter(isRecord)) {
    if (holdsSecretsMarks(await store.get<SecretsPortMeta>(key))) return true;
  }
  return false;
}

// The first two callers on a fresh device must not each make a key: the
// second would overwrite the first, and every mark made with it would be
// wrong. Key reads and the one creation run one after the other — within
// this web view; across the windows of a desktop the app process owns it
// (`ownedKey`).
let keyQueue: Promise<unknown> = Promise.resolve();

const freshKey = (): string => [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const validKey = (stored: unknown): string | null => {
  if (typeof stored === "string" && HEX_KEY.test(stored)) return stored;
  if (stored !== null && stored !== undefined) throw new Error("secrets mark key is unreadable");
  return null;
};

async function deviceKey(slots: SecretsMarkSlots, marksExist: boolean): Promise<string> {
  const run = async (): Promise<string> => {
    if (slots.ownedKey) {
      const owned = validKey(await slots.ownedKey(freshKey(), marksExist || (await marksOnDevice(slots))));
      if (!owned) throw new Error("secrets mark key could not be stored");
      return owned;
    }
    let stored: unknown;
    try {
      stored = await slots.readSlot(SECRETS_MARK_KEY_SLOT);
    } catch (error) {
      // Not answering is not "no key". Only where there is no mark to lose —
      // a first run on a device whose keychain is not reachable at all, where
      // the passwords live in the credentials file — is a key made anyway.
      if (marksExist || (await marksOnDevice(slots))) throw error;
      stored = null;
    }
    const valid = validKey(stored);
    if (valid) return valid;
    const fresh = freshKey();
    await slots.writeSlot(SECRETS_MARK_KEY_SLOT, fresh);
    // Read back: a store that took the write but returns something else
    // (or nothing) gives no key to mark with.
    const back = await slots.readSlot(SECRETS_MARK_KEY_SLOT);
    if (back !== fresh) throw new Error("secrets mark key could not be stored");
    return fresh;
  };
  const next = keyQueue.then(run, run);
  keyQueue = next.catch(() => undefined);
  return next;
}

const base64url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=$/, "").replace(/=$/, "");
};

/**
 * The marker of this device. `marksExist`: whether the records it will read
 * hold marks — then a store that does not answer is an error.
 */
export async function secretsMarker(slots: SecretsMarkSlots, marksExist = true): Promise<SecretsMarker> {
  const hex = await deviceKey(slots, marksExist);
  const raw = new Uint8Array(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const encoder = new TextEncoder();
  const sign = async (text: string) => new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
  const id = base64url(await sign("plainva secrets mark key id")).slice(0, 8);
  const own = `${PREFIX}${id}.`;
  const mark = async (text: string) => own + base64url(await sign(text));
  return Object.assign(mark, { owns: (value: string) => value.startsWith(own) });
}

/**
 * Turns every old plain mark of one vault's record into the mark of the same
 * pair. True when anything changed. A mark of another key is left as it is:
 * it is knowledge this device lost, which the port restores (`ownsMark`).
 */
export async function sealSecretsMeta(meta: SecretsPortMeta, mark: SecretsMarker): Promise<boolean> {
  let changed = false;
  for (const entry of Object.values(meta.entries)) {
    if (!entry.hash || isSecretsMark(entry.hash)) continue;
    entry.hash = await mark(entry.hash);
    changed = true;
  }
  return changed;
}

/**
 * What 0.8.7 knew, under its own name for the record, taken into this
 * version's record when both are there (a device that went back to 0.8.7 and
 * came forward again): the entries of the old types and their marks of having
 * been received are the newer word, since only 0.8.7 wrote them meanwhile;
 * everything of the current types stays. Either alone is returned as it is.
 */
export function mergeLegacySecretsMeta(current: SecretsPortMeta | null, legacy: SecretsPortMeta | null): SecretsPortMeta | null {
  if (!legacy) return current;
  if (!current) return legacy;
  const out: SecretsPortMeta = { ...current, entries: { ...current.entries }, imported: { ...current.imported }, quarantine: { ...current.quarantine, ...legacy.quarantine } };
  const legacyTypes = new Set(["caldav-password", "imap-password"]);
  for (const [id, entry] of Object.entries(current.entries)) {
    if (legacyTypes.has(entry.binding.secretType)) {
      delete out.entries[id];
      delete out.imported[id];
    }
  }
  for (const [id, entry] of Object.entries(legacy.entries ?? {})) {
    if (!legacyTypes.has(entry.binding.secretType)) continue;
    out.entries[id] = entry;
    if (legacy.imported?.[id]) out.imported[id] = true;
  }
  return out;
}

export interface SecretsMetaStorage {
  /** The name this version keeps a vault's record under. */
  current(legacyKey: string): string;
  /** Whether a store key is a record under the name 0.8.7 reads. */
  isLegacy(key: string): boolean;
}

/**
 * At start, before any secrets round: every record of this device — every
 * vault, open or not — under the name 0.8.7 reads is sealed, taken into the
 * record under this version's name and removed, and the store is written
 * once. Without a key nothing is touched; the caller reports it and the next
 * start tries again. Returns how many records it moved.
 */
export async function sealSecretsMetaInStore(store: ISettingsStore, storage: SecretsMetaStorage, slots: SecretsMarkSlots): Promise<number> {
  const keys = (await store.keys()).filter(storage.isLegacy);
  if (keys.length === 0) return 0;
  const legacy: Array<[string, SecretsPortMeta]> = [];
  for (const key of keys) {
    const meta = await store.get<SecretsPortMeta>(key);
    if (meta && typeof meta === "object" && meta.entries && typeof meta.entries === "object") legacy.push([key, meta]);
  }
  const currents = new Map<string, SecretsPortMeta | null>();
  for (const [key] of legacy) currents.set(key, (await store.get<SecretsPortMeta>(storage.current(key))) ?? null);
  const marksExist = [...currents.values()].some(holdsSecretsMarks) || legacy.some(([, meta]) => holdsSecretsMarks(meta));
  const mark = await secretsMarker(slots, marksExist);
  for (const [key, meta] of legacy) {
    await sealSecretsMeta(meta, mark);
    const merged = mergeLegacySecretsMeta(currents.get(key) ?? null, meta)!;
    await sealSecretsMeta(merged, mark);
    await store.set(storage.current(key), merged);
    await store.delete(key);
  }
  await store.save();
  return legacy.length;
}

// ---- packages/ui/src/lib/secretsPort.ts (v0.9.0)

/**
 * The keychain side of the encrypted secrets sideband, written ONCE for both
 * shells (H2c).
 *
 * This is the most dangerous code in the settings sync: it decides when a
 * credential from another device may replace one on this device, and a mistake
 * either overwrites a working password or leaks one into the wrong account. The
 * desktop had a careful ~250-line implementation of it; porting a second copy
 * to mobile would have meant maintaining that judgement twice. Instead the
 * judgement lives here and each shell supplies only what is genuinely
 * platform-specific: how to reach its keychain, its settings store, and its
 * list of accounts.
 *
 * The rules:
 *
 *  - **The complete decrypted structure is validated BEFORE the keychain is
 *    touched.** Cryptographic/structural failure rejects the whole bundle.
 *  - **A local secret is never silently overwritten.** If this device has its
 *    own value for an account it did not import, an incoming different value is
 *    rejected for that entry without blocking independent accounts.
 *  - **Bindings must match.** An entry is only ever applied to an account with
 *    the same service, secret type, user and endpoint — so a password cannot
 *    land on a different server that happens to share an id. The user is
 *    compared exactly; an entry of a client up to 0.8.7 (an old type, the user
 *    lower-cased) reaches the single account it can mean, and none when two
 *    could. The provider
 *    family is compared too, but a family-only difference is tolerated (see
 *    bindingMatchesExceptFamily): it is a catalog label, not an address.
 *  - **An account this device does not know yet is SKIPPED, not fatal.** That is
 *    the normal state of a new device, not a policy violation; refusing the whole
 *    bundle for it meant a fresh device received nothing at all. The skipped ids
 *    are reported so the shell can say so.
 *  - **Deletions are tombstones, and only remove what WE imported.** A device's
 *    own, never-imported credential is not deleted by someone else's tombstone.
 *  - **Each write group has a snapshot.** A slot failure rolls back that group;
 *    a metadata-commit failure rolls back every successful group in the run.
 */

/** Local account this device could contribute a secret for, or receive one into. */
export interface LocalSecretCandidate {
  /** Stable id across devices (the account id, or its mapped logical id). */
  logicalId: string;
  /** Keychain slot name on THIS device. */
  slot: string;
  binding: SecretBinding;
  /** The shareable payload this device holds, or null when it has none. */
  secret: Record<string, string> | null;
  /** Builds the value to store from an incoming payload (keeps device-local
   *  fields such as OAuth refresh tokens intact). */
  apply(secret: Record<string, string>): unknown;
}

export interface SecretsPortMeta {
  entries: Record<
    string,
    {
      hash: string;
      entryRev: number;
      updatedAt: string;
      deviceId: string;
      binding: SecretBinding;
      tombstone?: boolean;
      alias?: boolean;
      /**
       * A local conflict held after a lost key (round twelve): the mark of
       * the slot when the shared document had the same revision with another
       * password. The slot is neither overwritten nor published until the
       * document brings what it holds, or a newer entry it follows, or a
       * password is typed here.
       */
      held?: string;
      /**
       * The newest revision seen in the shared document while this device
       * could not tell its slot from what it knew: a password typed here later
       * goes out above it.
       */
      heldRev?: number;
      /**
       * Taken from the slot after the key of the marks was lost (round
       * twelve, the baseline): what this device holds is taken as unchanged
       * until an import has read the shared document. Until then the record
       * is not published; a slot that differs from it later is a change made
       * here.
       */
      sinceLoss?: true;
      /**
       * A baseline the document did not confirm when the loss ended: it had
       * nothing for the account, or only an older entry. What this device
       * holds goes out with the revision it knew, a moment before the time
       * it knew — so the real entry of that version, should any device still
       * have it, always wins over it — until the document brings the same
       * version (restored, or held) or a password is typed here.
       */
      unconfirmed?: true;
    }
  >;
  /** Entries written BY an import — only these may be removed by a tombstone. */
  imported: Record<string, boolean>;
  /**
   * Redacted evidence that a retired credential was observed. It deliberately
   * excludes binding values, publisher ids and credential payloads.
   */
  quarantine: Record<
    string,
    {
      reason: "legacy-secret-type";
      secretType: string;
      entryRev: number;
      updatedAt: string;
    }
  >;
  /**
   * Accounts "Remove account" took out on this device, by their exact name
   * (`retireSecret`). The next export writes their tombstone from that act,
   * not from comparing lists — which cannot tell "gone" from "alice" beside a
   * removed "Alice", or the last account from a runtime still booting.
   */
  retired?: Record<string, SecretBinding>;
  /**
   * Tombstones seen under an account's OLD name (review 2026-11-18, O1), by id
   * with their time. Never applied — a device up to 0.8.7 cannot say which of
   * two spellings it removed — but remembered: a later value under that name
   * puts nothing into the slot of an account here.
   */
  oldNameTombstones?: Record<string, string>;
  /**
   * Old names this device closed when "Remove account" took the account out
   * (`closeOldName`), by id with the time. A value a device up to 0.8.7 writes
   * under one later reaches no other account here. The lock is the removed
   * account's: it ends when that same account is on this device again
   * (review 2026-11-18, round seven).
   */
  closedOldNames?: Record<string, string>;
  /**
   * The document, accounts and slots the last import took with nothing left
   * open, as a mark (`settledKey`). The same again is settled: nothing is
   * written and nothing reported (round seven).
   */
  settled?: string;
}

/** What a shell must provide; everything else is decided above. */
export interface SecretsPortHost {
  deviceId(): Promise<string>;
  readMeta(): Promise<SecretsPortMeta | null>;
  writeMeta(meta: SecretsPortMeta): Promise<void>;
  /** The device's accounts, with the secret each currently holds. */
  candidates(): Promise<LocalSecretCandidate[]>;
  /**
   * Whether `candidates()` currently reflects the FULL truth of this device.
   *
   * A mobile account list is served by a runtime that boots in parallel with the
   * sync worker, so a cycle can catch it empty. Without this, an empty list is
   * indistinguishable from "the user deleted everything" and export would write
   * a tombstone per account — which the other device then applies by DELETING a
   * working password. Answering false suppresses tombstoning for that run;
   * everything else still works.
   */
  accountsReady?(): Promise<boolean>;
  readSlot(slot: string): Promise<unknown>;
  /** The key of the marks from the app process, for every window at once (`secretsMark.ts`). */
  ownedKey?(fresh: string, marksOnDevice: boolean): Promise<string>;
  /** Whether any record on this device, of any vault, holds marks of a key (`secretsMark.ts`). */
  marksOnDevice?(): Promise<boolean>;
  writeSlot(slot: string, value: unknown): Promise<void>;
  removeSlot(slot: string): Promise<void>;
  /** Injectable for tests; defaults to the wall clock. */
  now?(): string;
}

/**
 * The binding of a CalDAV password, built ONCE for both shells: the user
 * exactly as typed — "Alice" and "alice" may be two accounts of one server, and
 * one secret name for both put one password into the other's slot (GitHub
 * issue 174, see `canonicalSecretId`). Throws on an endpoint that cannot be
 * canonicalized, as before.
 */
export function calDavSecretBinding(family: string, url: string, user: string): SecretBinding {
  return {
    family,
    service: "calendar",
    secretType: "caldav-password-2",
    user: secretBindingUser(user),
    endpoint: canonicalizeEndpoint(url),
  };
}

/**
 * The binding of an IMAP password. A mailbox is one account in any case of its
 * address (`mailIdentity`), so its user stays lower-cased.
 */
export function imapSecretBinding(family: string, host: string, port: number, user: string): SecretBinding {
  const scheme = port === 993 ? "imaps" : "imap+starttls";
  return {
    family,
    service: "mail",
    secretType: "imap-password-2",
    user: secretBindingUser(user).toLowerCase(),
    endpoint: canonicalizeEndpoint(`${scheme}://${host}:${port}`),
  };
}

const cloneMeta = (source: SecretsPortMeta | null): SecretsPortMeta => ({
  entries: Object.fromEntries(
    Object.entries(source?.entries ?? {}).map(([id, entry]) => [
      id,
      { ...entry, binding: { ...entry.binding } },
    ]),
  ),
  imported: { ...(source?.imported ?? {}) },
  quarantine: Object.fromEntries(
    Object.entries(source?.quarantine ?? {}).map(([id, entry]) => [id, { ...entry }]),
  ),
  ...(source?.retired ? { retired: Object.fromEntries(Object.entries(source.retired).map(([id, binding]) => [id, { ...binding }])) } : {}),
  ...(source?.oldNameTombstones ? { oldNameTombstones: { ...source.oldNameTombstones } } : {}),
  ...(source?.closedOldNames ? { closedOldNames: { ...source.closedOldNames } } : {}),
  ...(source?.settled ? { settled: source.settled } : {}),
});

/**
 * "Remove account" took this account out (review 2026-11-18): its entry is
 * tombstoned by the next export, under its name in the current type. Its old
 * name, under which a device up to 0.8.7 may still hold it, is never written.
 * An account that comes back before then keeps its entry.
 */
export async function retireSecret(host: Pick<SecretsPortHost, "readMeta" | "writeMeta">, binding: SecretBinding): Promise<void> {
  await serialized(async () => {
    const meta = cloneMeta(await host.readMeta());
    meta.retired = { ...(meta.retired ?? {}), [canonicalSecretId(binding)]: { ...binding } };
    await host.writeMeta(meta);
  });
}

/**
 * Every read-modify-write of the secrets metadata — export, import and
 * `retireSecret` — runs one after the other (review 2026-11-18): a removal
 * written while an export ran was otherwise overwritten by the export's
 * older copy, and its tombstone never went out.
 */
let metaQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(run: () => Promise<T>): Promise<T> {
  const next = metaQueue.then(run, run);
  metaQueue = next.catch(() => undefined);
  return next;
}

/**
 * The start of the app puts the sealing of the marks (`secretsMark.ts`,
 * `sealSecretsMetaInStore`) into the same line as every export and import,
 * first (review 2026-11-18, round nine): called before any vault opens, no
 * secrets round begins before it and none runs while it reads and writes the
 * store. `run` must not call `serialized` itself.
 */
export function sealSecretsAtStart<T>(run: () => Promise<T>): Promise<T> {
  return serialized(run);
}

/**
 * Behind the sealing at start, in the same line (review of F57, round three,
 * O-C): the switch-over of the confirmed addresses runs here, so the home of
 * the key of the marks is decided before it reads a slot. `run` must not call
 * `serialized` itself.
 */
export function afterSecretsSeal<T>(run: () => Promise<T>): Promise<T> {
  return serialized(run);
}

const emptyImportResult = (): SecretsImportResult => ({
  entries: [],
  imported: [],
  unchanged: [],
  rejected: [],
  stale: [],
  errors: [],
  unknownAccounts: [],
  legacyEntries: [],
});

function recordImportResult(
  result: SecretsImportResult,
  logicalId: string,
  status: SecretImportStatus,
  reason?: SecretImportReason,
): void {
  result.entries.push({ logicalId, status, ...(reason ? { reason } : {}) });
  if (status === "error") result.errors.push(logicalId);
  else result[status].push(logicalId);
}

function compareEntryVersion(
  incoming: SecretEntry,
  previous: Pick<SecretEntry, "entryRev" | "updatedAt" | "deviceId">,
): number {
  if (incoming.entryRev !== previous.entryRev) return incoming.entryRev > previous.entryRev ? 1 : -1;
  if (incoming.updatedAt !== previous.updatedAt) return incoming.updatedAt > previous.updatedAt ? 1 : -1;
  if (incoming.deviceId !== previous.deviceId) return incoming.deviceId > previous.deviceId ? 1 : -1;
  return 0;
}

/**
 * The mark of a binding and its secret (`secretsMark.ts`): what this file
 * keeps to tell an unchanged password from a changed one, never the password.
 */
const pairMark = (mark: SecretsMarker, binding: SecretBinding, secret: unknown): Promise<string> =>
  mark(stableStringify({ binding, secret }));

const entryHash = async (mark: SecretsMarker, entry: SecretEntry): Promise<string> =>
  entry.tombstone ? "" : pairMark(mark, entry.binding, entry.secret);

/**
 * Rewrites a shell's own bookkeeping from the old per-device names to the
 * canonical one derived from the binding (P4c).
 *
 * Called by each shell when it READS its metadata, not by the port: the port is
 * deliberately agnostic about how its host names candidates — it only ever
 * compares the names it is given. A shell that has switched to
 * `canonicalSecretId` uses this so its stored metadata follows.
 *
 * Without it the first export after the update would find no `previous` for the
 * canonical id and restart its revision at 1, while the stale ids kept being
 * carried through the tombstone loop forever. It converges either way — the
 * merge picks the higher revision — but this saves a cycle and, more
 * importantly, stops the old names from accumulating locally.
 *
 * **Tombstones are deliberately left alone.** Moving one onto the canonical id
 * would hand a deletion to a device that has not been updated yet and still
 * addresses that credential under the old name — it would apply it by removing
 * a working password. An old tombstone whose binding still matches a live
 * candidate is already ignored by the export (P4b) and simply dies out.
 *
 * Nothing is merged: when the canonical id is already taken, the current entry
 * wins and the stale one is dropped. It is the same credential by definition;
 * the surviving entry is the one a current export or import wrote.
 */
export function migrateSecretsMetaToCanonicalIds<T extends SecretsPortMeta | null>(meta: T): T {
  if (!meta) return meta;
  for (const [id, entry] of Object.entries(meta.entries)) {
    if (entry.tombstone) continue;
    // The old types too: what a device up to 0.8.7 knew, under the name that
    // version gives it, so `carryOldKnowledge` finds it after the update.
    if (!isShareableSecretType(entry.binding.secretType) && !isBridgeSecretType(entry.binding.secretType)) continue;
    const canonical = canonicalSecretId(entry.binding);
    if (canonical === id) continue;
    if (!meta.entries[canonical]) meta.entries[canonical] = entry;
    delete meta.entries[id];
    if (meta.imported[id]) {
      meta.imported[canonical] = true;
      delete meta.imported[id];
    }
  }
  return meta;
}

/**
 * The name a device up to 0.8.7 knows this account's password by: the old
 * type, the user lower-cased (`BRIDGE_SECRET_TYPES`) — unless a second account
 * of the same kind on the same server has a user that differs only in case;
 * then that name can mean either and is read for neither. The bridge is
 * ONE-WAY (review 2026-11-18, fourth and sixth round): this name is never
 * written — a mirror under it undid a newer password everywhere and, once a
 * twin was gone, handed one account's password to the other. An entry a device
 * up to 0.8.7 wrote under it is read for this one account, when it is newer
 * than the entry in the current type or there is none, and never after a
 * tombstone for the old name. A password changed on an updated device does not
 * reach a device on 0.8.7 (named limit, release texts). "Newer" compares
 * `updatedAt`, the clocks of two devices: a device on 0.8.7 whose clock runs
 * ahead can cover a password changed on an updated device, for the other
 * devices on 0.8.7 and for updated ones (named limit, review 2026-11-18).
 */
function oldNameId(candidate: LocalSecretCandidate, candidates: readonly LocalSecretCandidate[]): string | null {
  if (!isShareableSecretType(candidate.binding.secretType)) return null;
  const twin = candidates.some(
    (other) =>
      other !== candidate &&
      other.binding.secretType === candidate.binding.secretType &&
      bindingMatchesExceptFamily(other.binding, candidate.binding, "fold"),
  );
  if (twin) return null;
  return bridgeIdOf(candidate.binding);
}

/**
 * The move into the current type is no change (review 2026-11-18, round
 * seven). What this device knew about an account's password under its old
 * name — the revision, time and device of that entry, whether it came in
 * through the sync — holds for the account's name in the current type, once,
 * when that name has no record here yet. The entry the device then publishes
 * in the current place carries the order of the knowledge it comes from, never
 * the time of the update, so a newer entry in the old place still wins against
 * an older password moved here; and a device that received its password
 * follows a change made elsewhere as before the update. Twins carry nothing:
 * their old name means neither (`oldNameId`). The old record stays, for the
 * entries a device on 0.8.7 keeps writing under that name.
 */
async function carryOldKnowledge(meta: SecretsPortMeta, candidates: readonly LocalSecretCandidate[], mark: SecretsMarker): Promise<boolean> {
  let carried = false;
  for (const candidate of candidates) {
    if (!isShareableSecretType(candidate.binding.secretType) || meta.entries[candidate.logicalId]) continue;
    const old = oldNameId(candidate, candidates);
    const known = old ? meta.entries[old] : undefined;
    if (!old || !known || known.tombstone || known.alias || !isBridgeSecretType(known.binding.secretType)) continue;
    // A record of a lost key is no knowledge to carry (round eleven).
    if (isLostMark(mark, known.hash)) continue;
    // What this device knew about an account it removed is no knowledge
    // about another one under the same old name (round eight, O1): a closed
    // old name, a tombstone seen under it, or a removal still to be written
    // stops the move.
    if (meta.closedOldNames?.[old] !== undefined || meta.oldNameTombstones?.[old] !== undefined) continue;
    if (Object.values(meta.retired ?? {}).some((binding) => bridgeIdOf(binding) === old)) continue;
    meta.entries[candidate.logicalId] = {
      hash: await movedHash(mark, known, candidate),
      entryRev: known.entryRev,
      updatedAt: known.updatedAt,
      deviceId: known.deviceId,
      binding: candidate.binding,
    };
    if (meta.imported[old]) meta.imported[candidate.logicalId] = true;
    carried = true;
  }
  return carried;
}

/**
 * The mark of a moved record under the current binding. The secret comes from
 * the slot, never from a mark (F67): when the slot holds what the old record
 * names, the same password under the current binding; when it holds another,
 * a mark that matches no pair, so the next export sees a change made here;
 * with an empty slot, the mark of no secret, so a password typed later is a
 * change (round nine). A record of a lost key is never moved
 * (`carryOldKnowledge`).
 */
async function movedHash(mark: SecretsMarker, known: { hash: string; binding: SecretBinding }, candidate: LocalSecretCandidate): Promise<string> {
  if (!candidate.secret) return pairMark(mark, candidate.binding, null);
  if (known.hash !== (await pairMark(mark, known.binding, candidate.secret))) return mark("plainva: changed on this device");
  return pairMark(mark, candidate.binding, candidate.secret);
}

/**
 * The baseline after a lost key (round twelve): every record made with a
 * key this device no longer has takes the mark of its slot as it is now —
 * or of no secret, where the account or its slot is not here — keeping its
 * revision, time, device and its mark of having been received, which no key
 * holds. Done in the run that finds the loss, export or import, offline
 * too. A local conflict held with the lost key is held again with the slot.
 * Records under an old name are left to `dropLostOldNames`.
 */
async function baselineAfterLoss(meta: SecretsPortMeta, candidates: readonly LocalSecretCandidate[], mark: SecretsMarker): Promise<boolean> {
  let changed = false;
  for (const [id, record] of Object.entries(meta.entries)) {
    if (record.tombstone || isBridgeSecretType(record.binding.secretType)) continue;
    const hashLost = isLostMark(mark, record.hash);
    const heldLost = !!record.held && isLostMark(mark, record.held);
    if (!hashLost && !heldLost) continue;
    const candidate = candidates.find((item) => item.logicalId === id);
    const slot = candidate ? await pairMark(mark, candidate.binding, candidate.secret) : await pairMark(mark, record.binding, null);
    meta.entries[id] = { ...record, ...(hashLost ? { hash: slot } : {}), ...(heldLost ? { held: slot } : {}), sinceLoss: true };
    changed = true;
  }
  return changed;
}

/** A moment before a time: what an unconfirmed baseline goes out with (`unconfirmed`). */
function justBefore(time: string): string {
  const at = Date.parse(time);
  return Number.isFinite(at) ? new Date(at - 1).toISOString() : time;
}

/** A mark made with a key this device no longer has: what it knew is lost, not changed. */
const isLostMark = (mark: SecretsMarker, hash: string | undefined): boolean => !!hash && isSecretsMark(hash) && !mark.owns(hash);

/**
 * A record under an old name made with a lost key goes (round eleven): no
 * document restores a name this device never writes, and kept, it would wait
 * for ever. The device is as without a record for that name.
 */
function dropLostOldNames(meta: SecretsPortMeta, mark: SecretsMarker): void {
  for (const [id, entry] of Object.entries(meta.entries)) {
    if (entry.tombstone || !isBridgeSecretType(entry.binding.secretType) || !isLostMark(mark, entry.hash)) continue;
    delete meta.entries[id];
    delete meta.imported[id];
  }
}

/**
 * Whether a password may have come through the settings sync from another
 * device, not typed here (F57). The mark hangs at the password, not at the
 * address: any import mark of the same account — same service, the same type
 * under its name now or the one 0.8.7 gave it, the same user — counts,
 * whatever address it was taken under. A mailbox whose server was changed
 * after the import (on another device, through the profile) is still the
 * imported password (review of F57, rounds two and three, O-1, O-A). A mark
 * this cannot read is doubt, and doubt asks: it counts as imported.
 */
export function secretImportedFor(meta: SecretsPortMeta | null | undefined, binding: SecretBinding): boolean {
  if (!meta) return false;
  if (meta.imported[canonicalSecretId(binding)]) return true;
  const old = bridgeIdOf(binding);
  if (old && meta.imported[old]) return true;
  const types = new Set<string>([binding.secretType]);
  if (isShareableSecretType(binding.secretType)) types.add(bridgeSecretTypeOf(binding.secretType));
  const user = binding.user.trim().toLowerCase();
  for (const [id, on] of Object.entries(meta.imported)) {
    if (!on) continue;
    const parsed = /^s1:([^:]+):([^:]+):([^@]*)@/.exec(id);
    if (!parsed) return true;
    let marked: string;
    try {
      marked = decodeURIComponent(parsed[3]).trim().toLowerCase();
    } catch {
      return true;
    }
    if (parsed[1] === binding.service && types.has(parsed[2]) && marked === user) return true;
  }
  return false;
}

/** The name a device up to 0.8.7 gave this binding's password (the old type, the user lower-cased). */
function bridgeIdOf(binding: SecretBinding): string | null {
  if (!isShareableSecretType(binding.secretType)) return null;
  return canonicalSecretId({ ...binding, secretType: bridgeSecretTypeOf(binding.secretType), user: binding.user.toLowerCase() });
}

/** An old name closed by "Remove account" opens again when that same account is here again (`closedOldNames`). */
function reopenOldNames(meta: SecretsPortMeta, candidates: readonly LocalSecretCandidate[]): boolean {
  if (!meta.closedOldNames) return false;
  let reopened = false;
  for (const candidate of candidates) {
    if (!isShareableSecretType(candidate.binding.secretType) || candidate.binding.user !== candidate.binding.user.toLowerCase()) continue;
    const old = canonicalSecretId({ ...candidate.binding, secretType: bridgeSecretTypeOf(candidate.binding.secretType) });
    if (meta.closedOldNames[old] === undefined) continue;
    delete meta.closedOldNames[old];
    reopened = true;
  }
  if (Object.keys(meta.closedOldNames).length === 0) delete meta.closedOldNames;
  return reopened;
}

/**
 * The mark of what an import decides from: the document (which carries the
 * passwords) and every account here with its slot. Kept as a mark of this
 * device's key (`secretsMark.ts`), like every other value of this file that is
 * made from a password.
 */
function settledKey(mark: SecretsMarker, bundle: SecretsBundle, candidates: readonly LocalSecretCandidate[]): Promise<string> {
  return mark(
    stableStringify({
      entries: bundle.entries,
      candidates: candidates.map((candidate) => [candidate.logicalId, candidate.slot, candidate.binding, candidate.secret]),
    }),
  );
}

export function createSecretsPort(host: SecretsPortHost): SecretsPort {
  const now = () => (host.now ? host.now() : new Date().toISOString());
  // One read of the key per port, not one per half of a round.
  let marker: Promise<SecretsMarker> | null = null;
  const markerFor = (read: SecretsPortMeta | null) => {
    marker ??= secretsMarker(host, holdsSecretsMarks(read)).catch((error) => {
      marker = null;
      throw error;
    });
    return marker;
  };

  // Records of a lost key the last export left waiting (`awaitsDocument`).
  let waiting = false;

  return {
    exportBundle: () => serialized(() => exportBundle()),
    importBundle: (bundle: SecretsBundle) => serialized(() => importBundle(bundle)),
    awaitsDocument: () => waiting,
  };

  async function exportBundle(): Promise<SecretsBundle> {
      const deviceId = await host.deviceId();
      const stamp = now();
      const read = await host.readMeta();
      const mark = await markerFor(read);
      // Written back only when this round changed it (round eight, F68).
      const asRead = read ? stableStringify(read) : null;
      const meta = cloneMeta(read);
      await sealSecretsMeta(meta, mark);
      dropLostOldNames(meta, mark);
      // OAuth registrations may still be exposed by an older shell adapter,
      // but the shared port is the final policy boundary for every platform.
      const candidates = (await host.candidates()).filter((candidate) =>
        isShareableSecretType(candidate.binding.secretType)
      );
      await baselineAfterLoss(meta, candidates, mark);
      // The key of the marks was lost while marks of it were here: said in
      // the diagnostics, every round until an import has read the document.
      // A held conflict does not wait; it ends with that import too.
      waiting = Object.values(meta.entries).some((entry) => entry.sinceLoss);
      const lostRecords = Object.values(meta.entries).filter((entry) => entry.sinceLoss && !entry.held).length;
      if (lostRecords > 0) logDiagnosticCounted("settings-sync", `secrets: ${lostRecords} record(s) made with a lost mark key, restored from the shared document`);
      await carryOldKnowledge(meta, candidates, mark);
      reopenOldNames(meta, candidates);
      const currentIds = new Set(candidates.filter((c) => c.secret).map((c) => c.logicalId));
      // Every account this device KNOWS, with or without a stored secret.
      //
      // "Account here, slot empty" is not a removal — it is the ordinary state of
      // a device that has not signed in yet: the account arrives with the
      // settings profile, the credential deliberately does not (see
      // `replaceMailAccounts`). Publishing a tombstone for it deleted a WORKING
      // password on every other device. Reported 2026-08-10: five tombstones for
      // one Gmail app password across three devices, one at entryRev 214 from the
      // resulting ping-pong. Only an account that is GONE may be tombstoned.
      const knownIds = new Set(candidates.map((c) => c.logicalId));
      const entries: Record<string, SecretEntry> = {};

      for (const candidate of candidates) {
        if (!candidate.secret) continue;
        const hash = await pairMark(mark, candidate.binding, candidate.secret);
        const previous: SecretsPortMeta["entries"][string] | undefined = meta.entries[candidate.logicalId];
        const live = !!previous && !previous.tombstone;
        // A local conflict held here is not published while the slot holds
        // it; and a slot as it was when the key was lost goes out only after
        // an import has read the document (round twelve), then with the
        // revision and time this device knew — never one above. A slot that
        // differs from either is a password typed here: a change, above all
        // this device knew and saw.
        if (live && previous!.held === hash) continue;
        if (live && !previous!.held && previous!.sinceLoss && previous!.hash === hash) continue;
        // The revision only moves when the secret actually changed — otherwise
        // two devices would ping-pong revisions on every cycle.
        const changed = !previous || previous.tombstone || !!previous.held || previous.hash !== hash;
        const entryRev = changed || !previous ? Math.max(previous?.entryRev ?? 0, previous?.heldRev ?? 0) + 1 : previous.entryRev;
        const updatedAt = changed || !previous ? stamp : previous.updatedAt;
        // An unconfirmed baseline goes out just below the version it knew.
        const below = !changed && !!previous?.unconfirmed;
        entries[candidate.logicalId] = {
          entryRev,
          updatedAt: below ? justBefore(updatedAt) : updatedAt,
          deviceId: changed || !previous || below ? deviceId : previous.deviceId,
          binding: candidate.binding,
          secret: candidate.secret,
        };
        meta.entries[candidate.logicalId] = {
          // Unchanged, the record keeps what it knew besides (the revision seen).
          ...(changed || !previous ? {} : previous),
          hash,
          entryRev,
          updatedAt,
          deviceId: below ? previous!.deviceId : entries[candidate.logicalId].deviceId,
          binding: candidate.binding,
        };
      }

      // An account that vanished here becomes a tombstone, so the other device
      // learns it was removed rather than resurrecting it on the next cycle.
      //
      // But a tombstone DELETES a credential on every other device, so it must
      // never be guesswork. Two guards: the host says its account list is ready,
      // and a list that came back completely empty while we know of accounts is
      // treated as "not ready" regardless — that shape is a runtime that has not
      // booted yet, and the cost of being wrong is a destroyed password.
      // What "Remove account" took out here is tombstoned whatever the lists
      // say — it is known, not inferred (`retireSecret`).
      // An account in lower case had ONE name until the current types (its
      // old name was its name): what removed it here also closes its old name
      // here, so a value a device on 0.8.7 writes under it later reaches no
      // other account ("Alice" beside a removed "alice"). Remembered on this
      // device only (`closedOldNames`), never written, and only until the
      // same account is here again (`reopenOldNames`).
      const closeOldName = (binding: SecretBinding) => {
        if (!isShareableSecretType(binding.secretType) || binding.user !== binding.user.toLowerCase()) return;
        const old = canonicalSecretId({ ...binding, secretType: bridgeSecretTypeOf(binding.secretType) });
        meta.closedOldNames = { ...(meta.closedOldNames ?? {}), [old]: stamp };
      };
      const tombstone = (id: string, removed?: SecretBinding) => {
        let previous = meta.entries[id];
        // Removed before any export of this version moved the record to the
        // account's current name: what this device knew under its old name
        // is what it knew about this account (round twelve, as on main) —
        // unless another account here still goes by that old name.
        const old = !previous && removed ? bridgeIdOf(removed) : null;
        const known = old ? meta.entries[old] : undefined;
        if (known && !known.tombstone && !known.alias && isBridgeSecretType(known.binding.secretType) && !candidates.some((candidate) => bridgeIdOf(candidate.binding) === old)) {
          previous = { ...known, binding: removed! };
        }
        if (!previous || previous.tombstone || currentIds.has(id)) return;
        if (!isShareableSecretType(previous.binding.secretType)) return;
        const entryRev = previous.entryRev + 1;
        entries[id] = { entryRev, updatedAt: stamp, deviceId, binding: previous.binding, tombstone: true };
        meta.entries[id] = { ...previous, hash: "", entryRev, updatedAt: stamp, deviceId, tombstone: true };
        closeOldName(previous.binding);
      };
      for (const [id, removed] of Object.entries(meta.retired ?? {})) {
        delete meta.retired![id];
        if (knownIds.has(id)) continue;
        tombstone(id, removed);
      }
      if (meta.retired && Object.keys(meta.retired).length === 0) delete meta.retired;

      const ready = host.accountsReady ? await host.accountsReady() : true;
      const looksUnavailable = candidates.length === 0 && Object.keys(meta.entries).length > 0;
      if (ready && !looksUnavailable) {
        for (const [id, previous] of Object.entries(meta.entries)) {
          // Never turn retired Google client metadata into a tombstone. An old
          // client could interpret that tombstone by deleting its still-needed
          // local registration. S9 handles explicit quarantine/migration.
          if (!isShareableSecretType(previous.binding.secretType)) continue;
          // An old name read for an account here (`oldNameId`) is never
          // written back, not as a tombstone either.
          if (previous.alias) continue;
          if (currentIds.has(id)) continue;
          // The account is still here, only its secret is missing on THIS device.
          // Leave the remote entry untouched: the merge then carries the
          // credential back to us instead of destroying it everywhere.
          if (knownIds.has(id)) continue;
          // The same credential under a DIFFERENT name. A logical id is derived
          // from the local account id, so every device minted its own for one and
          // the same password — six of them for a single Gmail app password in
          // the maintainer's bundle (2026-08-10), five already tombstoned.
          // Tombstoning a foreign id destroys precisely the credential this
          // device still holds, merely under the other device's name for it. The
          // import side has resolved entries by binding for a while; the export
          // side has to apply the same yardstick.
          //
          // Users are compared without regard to case here, and only here: an
          // entry a device up to 0.8.7 named for a user in capitals carries
          // the user lower-cased, and the account is still on this device
          // under its exact spelling. A tombstone in doubt is never written.
          if (candidates.some((candidate) => bindingMatchesExceptFamily(previous.binding, candidate.binding, "fold"))) continue;
          const entryRev = previous.tombstone ? previous.entryRev : previous.entryRev + 1;
          const updatedAt = previous.tombstone ? previous.updatedAt : stamp;
          // A tombstone known already goes out as it is, with the device that
          // wrote it (round eleven): taking it as this device's flipped its
          // device against the document every round, and wrote every round.
          const by = previous.tombstone ? previous.deviceId : deviceId;
          entries[id] = { entryRev, updatedAt, deviceId: by, binding: previous.binding, tombstone: true };
          meta.entries[id] = { ...previous, hash: "", entryRev, updatedAt, deviceId: by, tombstone: true };
          if (!previous.tombstone) closeOldName(previous.binding);
        }
      } else {
        // Re-publish what we still know unchanged, so this cycle neither deletes
        // nor resurrects anything while the device is still coming up.
        for (const [id, previous] of Object.entries(meta.entries)) {
          if (currentIds.has(id) || entries[id]) continue;
          // An entry of an old type is never written, not as a tombstone either.
          if (!isShareableSecretType(previous.binding.secretType)) continue;
          if (previous.tombstone) {
            entries[id] = { entryRev: previous.entryRev, updatedAt: previous.updatedAt, deviceId: previous.deviceId, binding: previous.binding, tombstone: true };
          }
        }
      }

      if (stableStringify(meta) !== asRead) await host.writeMeta(meta);
      return {
        format: "plainva-secrets",
        version: 1,
        bundleRev: Math.max(0, ...Object.values(entries).map((e) => e.entryRev)),
        updatedAt: stamp,
        entries,
      };
  }

  async function importBundle(bundle: SecretsBundle): Promise<SecretsImportResult> {
      // Fatal boundary: validate the complete decrypted document before reading
      // candidates or touching metadata/keychain state.
      assertSecretsBundleStructure(bundle);

      const originalMeta = await host.readMeta();
      const mark = await markerFor(originalMeta);
      const meta = cloneMeta(originalMeta);
      const sealed = await sealSecretsMeta(meta, mark);
      dropLostOldNames(meta, mark);
      const candidates = await host.candidates();
      await baselineAfterLoss(meta, candidates, mark);
      const key = await settledKey(mark, bundle, candidates);
      const afterLoss = Object.values(meta.entries).some((entry) => entry.sinceLoss);
      if (meta.settled === key && !sealed && !afterLoss) return { ...emptyImportResult(), settled: true };
      const byId = new Map(candidates.map((candidate) => [candidate.logicalId, candidate]));
      const operations: Array<{
        logicalId: string;
        entry: SecretEntry;
        candidate: LocalSecretCandidate;
        viaOldName: boolean;
      }> = [];
      const result = emptyImportResult();
      await carryOldKnowledge(meta, candidates, mark);
      reopenOldNames(meta, candidates);
      const closedOldName = (id: string) => !!meta.oldNameTombstones?.[id] || !!meta.closedOldNames?.[id];
      // What this device knew under each old name when the round began. An
      // entry under an old name that carries the password the device already
      // knew there is no news (round nine): a device back on 0.8.7 publishes
      // it again with its own time, and that time must not cover a newer
      // password in the current place.
      const before = cloneMeta(meta);
      const knownUnderOldName = async (id: string, entry: SecretEntry): Promise<boolean> => {
        const known = before.entries[id];
        // The same password at no later revision: a device back on 0.8.7
        // publishing it again. A later revision with that password is a real
        // change back to it on 0.8.7 (round eleven) and is news.
        return (
          !!known && !known.tombstone && !entry.tombstone && mark.owns(known.hash) &&
          entry.entryRev <= known.entryRev && known.hash === (await entryHash(mark, entry))
        );
      };

      const rememberEntry = async (logicalId: string, entry: SecretEntry, alias = false) => {
        meta.entries[logicalId] = {
          hash: await entryHash(mark, entry),
          entryRev: entry.entryRev,
          updatedAt: entry.updatedAt,
          deviceId: entry.deviceId,
          binding: entry.binding,
          tombstone: entry.tombstone,
          ...(alias ? { alias: true } : {}),
        };
      };

      // A password read under the account's old name holds under its current
      // name with the version of the entry it came from — never as a change
      // made here (round eight, R1): no way makes an older password newer. A
      // new revision, time and device come only from a password typed on this
      // device; a newer entry seen later, in either place, wins.
      const recordCurrent = async (candidate: LocalSecretCandidate, entry: SecretEntry) => {
        const hash = await pairMark(mark, candidate.binding, entry.secret);
        const existing = meta.entries[candidate.logicalId];
        if (existing && !existing.tombstone && existing.hash === hash) return;
        meta.entries[candidate.logicalId] = {
          hash,
          entryRev: entry.entryRev,
          updatedAt: entry.updatedAt,
          deviceId: entry.deviceId,
          binding: candidate.binding,
        };
      };

      const rememberOldNameTombstone = (logicalId: string, entry: SecretEntry) => {
        if (meta.oldNameTombstones?.[logicalId] === entry.updatedAt) return;
        meta.oldNameTombstones = { ...(meta.oldNameTombstones ?? {}), [logicalId]: entry.updatedAt };
      };

      // Isolate policy outcomes and build safe write groups. No write can
      // precede a later malformed entry because the full structure is already
      // validated above.
      for (const [logicalId, entry] of Object.entries(bundle.entries)) {
        if (isLegacySecretType(entry.binding.secretType)) {
          const quarantined = {
            reason: "legacy-secret-type" as const,
            secretType: entry.binding.secretType,
            entryRev: entry.entryRev,
            updatedAt: entry.updatedAt,
          };
          if (stableStringify(meta.quarantine[logicalId]) !== stableStringify(quarantined)) {
            meta.quarantine[logicalId] = quarantined;
          }
          result.legacyEntries.push(logicalId);
          recordImportResult(result, logicalId, "rejected", "legacy-secret-type");
          continue;
        }
        const bridged = isBridgeSecretType(entry.binding.secretType);
        if (!isShareableSecretType(entry.binding.secretType) && !bridged) {
          recordImportResult(result, logicalId, "rejected", "unsupported-secret-type");
          continue;
        }

        const previous: SecretsPortMeta["entries"][string] | undefined = meta.entries[logicalId];
        // The slot as it was when the key was lost (`baselineAfterLoss`):
        // taken as unchanged, as on a device whose key is whole.
        const atLoss = !!previous && !previous.tombstone && !!(previous.sinceLoss || previous.unconfirmed) && !previous.held;
        const order = previous ? compareEntryVersion(entry, previous) : 1;
        if (previous) {
          if (order < 0) {
            recordImportResult(result, logicalId, "stale", "older-entry");
            continue;
          }
          if (order === 0) {
            const hash = await entryHash(mark, entry);
            // An empty slot here has the mark of no secret: the entry it came
            // with is the same entry, the slot simply holds nothing.
            const same =
              previous.hash === hash ||
              (!previous.tombstone && !entry.tombstone && previous.hash === (await pairMark(mark, previous.binding, null)));
            const emptyAtLoss = atLoss && !entry.tombstone && previous.hash === (await pairMark(mark, (byId.get(logicalId) ?? previous).binding, null));
            if (emptyAtLoss) {
              // An empty slot after a lost key (a device moved without its
              // keychain) takes the password of the version it knew.
            } else if (same && Boolean(previous.tombstone) === Boolean(entry.tombstone)) {
              // The document has the version this device knew, with what it holds: confirmed.
              if (previous.unconfirmed || previous.sinceLoss) {
                const { unconfirmed: _u, sinceLoss: _s, ...rest } = previous;
                meta.entries[logicalId] = rest;
              }
              recordImportResult(result, logicalId, "unchanged", "already-current");
              continue;
            } else if (atLoss) {
              // The same version with another password than the slot holds
              // after a lost key: held here, neither overwritten nor
              // published (round twelve).
              meta.entries[logicalId] = { ...previous, held: previous.hash, heldRev: Math.max(previous.heldRev ?? 0, entry.entryRev) };
              recordImportResult(result, logicalId, "rejected", "local-secret-conflict");
              continue;
            } else {
              recordImportResult(result, logicalId, "rejected", "version-collision");
              continue;
            }
          }
        }

        // The type of a local account this entry may speak for: its own, or —
        // for an entry of a client up to 0.8.7 — the current one of that kind.
        const localType = bridged ? currentSecretTypeOf(entry.binding.secretType as Parameters<typeof currentSecretTypeOf>[0]) : entry.binding.secretType;
        const sameType = (item: LocalSecretCandidate) => item.binding.secretType === localType;
        // An id match is never sufficient by itself: type and endpoint binding
        // must still agree. Family alone may differ because it is a catalog
        // label rather than a credential destination.
        const direct = bridged ? undefined : byId.get(logicalId);
        const exactCandidate = bridged
          ? undefined
          : (direct && sameType(direct) && bindingMatchesExceptFamily(entry.binding, direct.binding) ? direct : undefined) ??
            candidates.find((item) => sameType(item) && bindingMatches(entry.binding, item.binding)) ??
            candidates.find((item) => sameType(item) && bindingMatchesExceptFamily(entry.binding, item.binding));
        // An entry of a client up to 0.8.7 carries the user lower-cased,
        // whatever its spelling was. It reaches the account it names when
        // exactly one account here could be meant — never one of two that
        // differ only in case. Whether an entry is old is said by its type,
        // its place in the document, never by the spelling of its user: an
        // old client keeps the type of every entry it writes back, and a
        // current one never writes an old type (review 2026-11-18, round six).
        const foldMatches = bridged
          ? candidates.filter((item) => sameType(item) && bindingMatchesExceptFamily(entry.binding, item.binding, "fold"))
          : [];
        // Two accounts here that differ only in case: an entry from 0.8.7
        // cannot say which one it means, so it is read for neither. A tombstone
        // among them is remembered, not applied.
        if (foldMatches.length > 1) {
          if (entry.tombstone) rememberOldNameTombstone(logicalId, entry);
          recordImportResult(result, logicalId, "unchanged", "old-name-not-taken");
          continue;
        }
        const legacyCandidate = foldMatches.length === 1 ? foldMatches[0] : undefined;
        // ...and only as its old name, one way (`oldNameId`): never a
        // tombstone, never after a tombstone for that name was seen here, and
        // only when it is newer than the current entry of that account. On a
        // tie the current entry stands.
        if (legacyCandidate) {
          const exact = bundle.entries[legacyCandidate.logicalId];
          const retiredName = meta.entries[logicalId]?.tombstone === true || closedOldName(logicalId);
          if (entry.tombstone) rememberOldNameTombstone(logicalId, entry);
          if (entry.tombstone || retiredName || (exact && !(entry.updatedAt > exact.updatedAt))) {
            recordImportResult(result, logicalId, "unchanged", exact ? "superseded-by-exact-entry" : "old-name-not-taken");
            continue;
          }
          if (exact && (await knownUnderOldName(logicalId, entry))) {
            recordImportResult(result, logicalId, "unchanged", "already-current");
            continue;
          }
        }
        // The current entry of an account whose old name carries a NEWER
        // password (a device up to 0.8.7 changed it): that one is read.
        const oldName = exactCandidate ? oldNameId(exactCandidate, candidates) : null;
        const oldEntry = oldName ? bundle.entries[oldName] : undefined;
        if (
          oldEntry && isBridgeSecretType(oldEntry.binding.secretType) && !oldEntry.tombstone &&
          meta.entries[oldName!]?.tombstone !== true && !closedOldName(oldName!) &&
          oldEntry.updatedAt > entry.updatedAt &&
          !(await knownUnderOldName(oldName!, oldEntry))
        ) {
          recordImportResult(result, logicalId, "unchanged", "superseded-by-later-entry");
          continue;
        }
        const candidate = exactCandidate ?? legacyCandidate;
        const viaOldName = !!candidate && candidate.logicalId !== logicalId && !exactCandidate;
        // The old name and the exact one of one account share one record of having been imported.
        const pairImported = !!meta.imported[logicalId] || (!!candidate && !!meta.imported[candidate.logicalId]);

        if (!candidate && entry.tombstone) {
          await rememberEntry(logicalId, entry);
          delete meta.imported[logicalId];
          recordImportResult(result, logicalId, "unchanged", "tombstone-no-local-secret");
          continue;
        }
        if (!candidate) {
          // An entry of a client up to 0.8.7 beside the current one of the
          // same account waits with it, not as a second account.
          const waitsWithCurrent =
            bridged &&
            Object.values(bundle.entries).some(
              (other) => other.binding.secretType === localType && bindingMatchesExceptFamily(other.binding, entry.binding, "fold"),
            );
          if (!waitsWithCurrent) result.unknownAccounts.push(logicalId);
          recordImportResult(
            result,
            logicalId,
            "rejected",
            direct ? "binding-mismatch" : "unknown-account",
          );
          continue;
        }

        if (entry.tombstone && !pairImported) {
          await rememberEntry(logicalId, entry);
          if (candidate.secret) {
            recordImportResult(result, logicalId, "rejected", "local-secret-protected");
          } else {
            recordImportResult(result, logicalId, "unchanged", "tombstone-no-local-secret");
          }
          continue;
        }
        if (!entry.tombstone && candidate.secret && !pairImported) {
          if (stableStringify(candidate.secret) !== stableStringify(entry.secret)) {
            // Seen and not taken: a password typed here later goes out above
            // it — after a lost key, beside a held slot, or beside this
            // device's own password (round twelve; F73).
            if (previous && entry.entryRev > (previous.heldRev ?? 0)) {
              meta.entries[logicalId] = { ...previous, heldRev: entry.entryRev };
            }
            recordImportResult(result, logicalId, "rejected", "local-secret-conflict");
            continue;
          }
          await rememberEntry(logicalId, entry, viaOldName);
          if (viaOldName) await recordCurrent(candidate, entry);
          recordImportResult(result, logicalId, "unchanged", "already-current");
          continue;
        }
        operations.push({ logicalId, entry, candidate, viaOldName });
      }

      // Apply each independent slot group against its own snapshot. The first
      // snapshot per slot is retained so a metadata failure can roll back every
      // successful group as one transaction.
      const initialSnapshots = new Map<string, unknown>();
      const successfulSlots = new Set<string>();
      const restoreSlot = async (slot: string, previous: unknown) => {
        if (previous == null) await host.removeSlot(slot);
        else await host.writeSlot(slot, previous);
      };

      for (const { logicalId, entry, candidate, viaOldName } of operations) {
        let previous: unknown;
        try {
          previous = await host.readSlot(candidate.slot);
        } catch {
          recordImportResult(result, logicalId, "error", "slot-read-failed");
          continue;
        }
        if (!initialSnapshots.has(candidate.slot)) {
          initialSnapshots.set(candidate.slot, previous);
        }

        try {
          if (entry.tombstone) {
            await host.removeSlot(candidate.slot);
            delete meta.imported[logicalId];
          } else {
            await host.writeSlot(candidate.slot, candidate.apply(entry.secret!));
            meta.imported[logicalId] = true;
            // Read under its old name (`oldNameId`): the account's exact name was written with it.
            if (viaOldName) meta.imported[candidate.logicalId] = true;
          }
          await rememberEntry(logicalId, entry, viaOldName);
          if (viaOldName && !entry.tombstone) await recordCurrent(candidate, entry);
          successfulSlots.add(candidate.slot);
          recordImportResult(result, logicalId, "imported");
        } catch {
          try {
            await restoreSlot(candidate.slot, previous);
          } catch {
            throw new SecretPolicyError("secret slot rollback failed");
          }
          recordImportResult(result, logicalId, "error", "slot-write-failed");
        }
      }

      // Settled when nothing is left open: no slot failed, no account is
      // waiting, no retired entry asks to be reported again.
      const open = result.errors.length > 0 || result.unknownAccounts.length > 0 || result.legacyEntries.length > 0;
      // Taken against the slots as they are now: what this import wrote is the
      // state the next round finds.
      const settled = open ? undefined : successfulSlots.size > 0 ? await settledKey(mark, bundle, await host.candidates()) : key;
      if (meta.settled !== settled) {
        if (settled) meta.settled = settled;
        else delete meta.settled;
      }
      // The loss ends with this import, which read the document (round
      // twelve): what is held stays held, an ordinary local conflict; a
      // baseline the document has nothing as new for is unconfirmed.
      for (const [id, record] of Object.entries(meta.entries)) {
        if (!record.sinceLoss) continue;
        const { sinceLoss: _ended, ...rest } = record;
        const entry = bundle.entries[id];
        const unconfirmed = !record.held && !record.tombstone && (!entry || compareEntryVersion(entry, record) < 0);
        meta.entries[id] = unconfirmed ? { ...rest, unconfirmed: true } : rest;
      }
      // A round that changes nothing writes nothing (round eleven, F68):
      // compared, not assumed.
      if (stableStringify(meta) === stableStringify(originalMeta)) return result;

      try {
        await host.writeMeta(meta);
      } catch {
        let rollbackFailed = false;
        for (const slot of [...successfulSlots].reverse()) {
          try {
            await restoreSlot(slot, initialSnapshots.get(slot));
          } catch {
            rollbackFailed = true;
          }
        }
        throw new SecretPolicyError(
          rollbackFailed
            ? "secret metadata write and credential rollback failed"
            : "secret metadata write failed; credential writes rolled back",
        );
      }
      return result;
  }
}

// ---- SecretsSyncStep.run (v0.9.0) without sealing: one settings round of a device.
export async function runV090Round(port: SecretsPort, remote: SecretsBundle | null, now: string): Promise<{ remote: SecretsBundle; pushed: boolean; reported: boolean }> {
  const local = await port.exportBundle();
  for (const entry of Object.values(local.entries)) {
    if (!entry.tombstone) assertShareable(entry);
  }
  const merged = mergeSecretsBundles(local, remote, now);
  let reported = false;
  if (stableStringify(merged.entries) !== stableStringify(local.entries) || port.awaitsDocument?.()) {
    const result = await port.importBundle(merged);
    reported = !result.settled;
  }
  const pushed = !remote || stableStringify(merged.entries) !== stableStringify(remote.entries);
  return { remote: pushed ? merged : remote!, pushed, reported };
}
