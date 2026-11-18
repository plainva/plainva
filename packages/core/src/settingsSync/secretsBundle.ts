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
import { openBlob, sealBlob } from "../crypto/sealedBlob.js";
import type { MasterKeyBundle } from "../crypto/keyfile.js";
import { utf8Decode, utf8Encode } from "../crypto/cryptoPrimitives.js";
import { trimEndChars } from "../textScan.js";

/** The static, shareable secret types. Everything else is refused. */
export const SHAREABLE_SECRET_TYPES = ["caldav-password", "imap-password"] as const;
export type ShareableSecretType = (typeof SHAREABLE_SECRET_TYPES)[number];

export function isShareableSecretType(type: string): type is ShareableSecretType {
  return (SHAREABLE_SECRET_TYPES as readonly string[]).includes(type);
}

/**
 * Secret types emitted by older clients that a current client may still have
 * to open and preserve verbatim. They are never applied to a local credential
 * slot and never originate in a current export.
 */
export const LEGACY_SECRET_TYPES = ["google-pim-client"] as const;
export type LegacySecretType = (typeof LEGACY_SECRET_TYPES)[number];
export type SecretType = ShareableSecretType | LegacySecretType;

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
   * (`secretBindingUser`). Clients up to 0.8.7 wrote it lower-cased; such an
   * entry is still read (see `isLegacyLowerCaseUser`).
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
  /**
   * Written by a device that names the user by its exact spelling (review
   * 2026-11-18, O1). An entry without it comes from a device up to 0.8.7,
   * which lower-cased every user: only such an entry can be the OLD name of
   * an account (`isLegacyLowerCaseUser`). The spelling alone never says so —
   * "alice" is also the exact name of an account of its own. A device up to
   * 0.8.7 passes the field on unchanged (`mergeSecretEntries` keeps entries
   * whole).
   */
  exactUser?: boolean;
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
  const user = bindingUserKey(binding.service, binding.user);
  const folded = user.toLowerCase();
  // A user written in lower case keeps the name it always had, so nothing a
  // device on 0.8.7 knows is renamed — and renaming would retire the old name,
  // which such a device applies by deleting a working password. Any other
  // spelling gets its own name beside it ("#" never occurs in an encoded
  // component): "Alice" and "alice" are two accounts on a server that tells
  // them apart, and one name for both let the second password overwrite the
  // first in the bundle and land in the other row's slot (GitHub issue 174).
  const exact = user === folded ? "" : `#${encodeURIComponent(user)}`;
  return `s1:${binding.service}:${binding.secretType}:${encodeURIComponent(folded)}${exact}@${encodeURIComponent(endpoint)}`;
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

/**
 * Whether a binding's user is in lower case, the only form clients up to 0.8.7
 * wrote. Such an entry may stand for a user in any case; it is applied to a
 * local account whose user is not lower case only when that account is the
 * single one it could mean.
 */
export function isLegacyLowerCaseUser(binding: Pick<SecretBinding, "user">): boolean {
  return binding.user === binding.user.toLowerCase();
}

/**
 * Whether an entry can be an account's OLD name: written by a device up to
 * 0.8.7 (no `exactUser`), with the user as it wrote every user — lower-cased.
 */
export function isOldNameEntry(entry: Pick<SecretEntry, "binding" | "exactUser">): boolean {
  return !entry.exactUser && isLegacyLowerCaseUser(entry.binding);
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
      (candidate.exactUser !== undefined && typeof candidate.exactUser !== "boolean") ||
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

/**
 * Seals a bundle under K_secrets.
 *
 * The sync step separately validates every LOCAL export with `assertShareable`.
 * The serializer accepts any structurally valid entry so a current client can
 * preserve a legacy or future remote entry without applying it locally.
 */
export function sealSecretsBundle(mk: MasterKeyBundle, bundle: SecretsBundle): Uint8Array {
  assertSecretsBundleStructure(bundle);
  return sealBlob(mk, utf8Encode(JSON.stringify(bundle)), "secrets");
}

/** Opens and parses a sealed secrets bundle. */
export function openSecretsBundle(mk: MasterKeyBundle, bytes: Uint8Array): SecretsBundle {
  const bundle = parseSecretsBundle(utf8Decode(openBlob(mk, bytes, "secrets")));
  if (!bundle) throw new SecretPolicyError("secrets bundle is malformed");
  return bundle;
}
