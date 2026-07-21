/**
 * Account-secrets bundle `.plainva/sync/secrets.enc` (v3 §3.4). One encrypted
 * document (sealed under K_secrets) that carries ONLY shareable static secrets —
 * CalDAV/IMAP app passwords and optionally the user's own static Google PIM app
 * credentials. Every OAuth refresh/access token (Microsoft, Google OAuth,
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

/** The static, shareable secret types. Everything else is refused. */
export const SHAREABLE_SECRET_TYPES = ["caldav-password", "imap-password", "google-pim-client"] as const;
export type ShareableSecretType = (typeof SHAREABLE_SECRET_TYPES)[number];

export function isShareableSecretType(type: string): type is ShareableSecretType {
  return (SHAREABLE_SECRET_TYPES as readonly string[]).includes(type);
}

/** Cryptographic-ish binding that gates an import against the local account. */
export interface SecretBinding {
  family: string;
  service: "calendar" | "mail" | "files";
  secretType: ShareableSecretType;
  /** Lowercased user/login. */
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
  const path = parsed.pathname.replace(/\/+$/, "") || "";
  return `${scheme}//${host}${port}${path}`;
}

/** True when a synced entry's binding matches an observed local account. */
export function bindingMatches(binding: SecretBinding, observed: { family: string; service: SecretBinding["service"]; user: string; endpoint: string }): boolean {
  let observedEndpoint: string;
  try {
    observedEndpoint = canonicalizeEndpoint(observed.endpoint);
  } catch {
    return false;
  }
  return (
    binding.family === observed.family &&
    binding.service === observed.service &&
    binding.user === observed.user.trim().toLowerCase() &&
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

export function parseSecretsBundle(json: string): SecretsBundle | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const b = parsed as SecretsBundle;
  if (!b || b.format !== "plainva-secrets" || b.version !== 1 || !b.entries || typeof b.entries !== "object") return null;
  return b;
}

/** Seals a bundle under K_secrets (rejects any non-shareable entry first). */
export function sealSecretsBundle(mk: MasterKeyBundle, bundle: SecretsBundle): Uint8Array {
  for (const entry of Object.values(bundle.entries)) if (!entry.tombstone) assertShareable(entry);
  return sealBlob(mk, utf8Encode(JSON.stringify(bundle)), "secrets");
}

/** Opens and parses a sealed secrets bundle. */
export function openSecretsBundle(mk: MasterKeyBundle, bytes: Uint8Array): SecretsBundle {
  const bundle = parseSecretsBundle(utf8Decode(openBlob(mk, bytes, "secrets")));
  if (!bundle) throw new SecretPolicyError("secrets bundle is malformed");
  return bundle;
}
