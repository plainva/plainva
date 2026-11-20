/**
 * The secrets sync of a device on Plainva 0.8.7, frozen from the tag `v0.8.7`
 * (`packages/core/src/settingsSync/secretsBundle.ts`,
 * `packages/core/src/settingsSync/SecretsSyncStep.ts` and
 * `packages/ui/src/lib/secretsPort.ts` at that tag; `main` carried the same
 * code until the accounts round of 2026-11-18). Tests run devices of this
 * version beside current ones to hold what a mixed fleet does. Only the
 * sealing is left out, and the imports are inlined; nothing else is changed.
 * Never edit this file to make a test pass: it is what is out there.
 */

// ---- packages/core/src/textScan.ts (v0.8.7), the one helper used below
function trimEndChars(text: string, chars: string): string {
  let end = text.length;
  while (end > 0 && chars.includes(text[end - 1])) end--;
  return text.slice(0, end);
}

// ---- packages/core/src/settingsSync/profileFile.ts (v0.8.7)
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

// ---- packages/core/src/settingsSync/secretsBundle.ts (v0.8.7), without sealing

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
  const user = binding.user.trim().toLowerCase();
  return `s1:${binding.service}:${binding.secretType}:${encodeURIComponent(user)}@${encodeURIComponent(endpoint)}`;
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
  observed: { service: SecretBinding["service"]; user: string; endpoint: string }
): boolean {
  let observedEndpoint: string;
  try {
    observedEndpoint = canonicalizeEndpoint(observed.endpoint);
  } catch {
    return false;
  }
  return (
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

// ---- packages/core/src/settingsSync/SecretsSyncStep.ts (v0.8.7), the types
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
}

/** Shell bridge between the OS keychain and the shareable secrets bundle. */
export interface SecretsPort {
  /** The device's current shareable secrets (CalDAV/IMAP passwords only). */
  exportBundle(): Promise<SecretsBundle>;
  /** Apply isolated, snapshot-protected write groups (binding-checked). */
  importBundle(bundle: SecretsBundle): Promise<SecretsImportResult>;
}

// ---- packages/ui/src/lib/secretsPort.ts (v0.8.7)

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
 *    land on a different server that happens to share an id. The provider
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
    { hash: string; entryRev: number; updatedAt: string; deviceId: string; binding: SecretBinding; tombstone?: boolean }
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
  writeSlot(slot: string, value: unknown): Promise<void>;
  removeSlot(slot: string): Promise<void>;
  /** Injectable for tests; defaults to the wall clock. */
  now?(): string;
}

const emptyMeta = (): SecretsPortMeta => ({ entries: {}, imported: {}, quarantine: {} });

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
});

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

const entryHash = (entry: SecretEntry): string =>
  entry.tombstone ? "" : stableStringify({ binding: entry.binding, secret: entry.secret });

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
    if (!isShareableSecretType(entry.binding.secretType)) continue;
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

export function createSecretsPort(host: SecretsPortHost): SecretsPort {
  const now = () => (host.now ? host.now() : new Date().toISOString());

  return {
    async exportBundle(): Promise<SecretsBundle> {
      const deviceId = await host.deviceId();
      const stamp = now();
      const meta = (await host.readMeta()) ?? emptyMeta();
      // OAuth registrations may still be exposed by an older shell adapter,
      // but the shared port is the final policy boundary for every platform.
      const candidates = (await host.candidates()).filter((candidate) =>
        isShareableSecretType(candidate.binding.secretType)
      );
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
        const hash = stableStringify({ binding: candidate.binding, secret: candidate.secret });
        const previous = meta.entries[candidate.logicalId];
        // The revision only moves when the secret actually changed — otherwise
        // two devices would ping-pong revisions on every cycle.
        const changed = !previous || previous.hash !== hash || previous.tombstone;
        const entryRev = changed ? (previous?.entryRev ?? 0) + 1 : previous.entryRev;
        const updatedAt = changed ? stamp : previous.updatedAt;
        entries[candidate.logicalId] = {
          entryRev,
          updatedAt,
          deviceId: changed ? deviceId : previous.deviceId,
          binding: candidate.binding,
          secret: candidate.secret,
        };
        meta.entries[candidate.logicalId] = {
          hash,
          entryRev,
          updatedAt,
          deviceId: entries[candidate.logicalId].deviceId,
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
      const ready = host.accountsReady ? await host.accountsReady() : true;
      const looksUnavailable = candidates.length === 0 && Object.keys(meta.entries).length > 0;
      if (ready && !looksUnavailable) {
        for (const [id, previous] of Object.entries(meta.entries)) {
          // Never turn retired Google client metadata into a tombstone. An old
          // client could interpret that tombstone by deleting its still-needed
          // local registration. S9 handles explicit quarantine/migration.
          if (!isShareableSecretType(previous.binding.secretType)) continue;
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
          if (candidates.some((candidate) => bindingMatches(previous.binding, candidate.binding))) continue;
          const entryRev = previous.tombstone ? previous.entryRev : previous.entryRev + 1;
          const updatedAt = previous.tombstone ? previous.updatedAt : stamp;
          entries[id] = { entryRev, updatedAt, deviceId, binding: previous.binding, tombstone: true };
          meta.entries[id] = { ...previous, hash: "", entryRev, updatedAt, deviceId, tombstone: true };
        }
      } else {
        // Re-publish what we still know unchanged, so this cycle neither deletes
        // nor resurrects anything while the device is still coming up.
        for (const [id, previous] of Object.entries(meta.entries)) {
          if (currentIds.has(id) || entries[id]) continue;
          if (previous.tombstone) {
            entries[id] = { entryRev: previous.entryRev, updatedAt: previous.updatedAt, deviceId: previous.deviceId, binding: previous.binding, tombstone: true };
          }
        }
      }

      await host.writeMeta(meta);
      return {
        format: "plainva-secrets",
        version: 1,
        bundleRev: Math.max(0, ...Object.values(entries).map((e) => e.entryRev)),
        updatedAt: stamp,
        entries,
      };
    },

    async importBundle(bundle: SecretsBundle): Promise<SecretsImportResult> {
      // Fatal boundary: validate the complete decrypted document before reading
      // candidates or touching metadata/keychain state.
      assertSecretsBundleStructure(bundle);

      const originalMeta = await host.readMeta();
      const meta = cloneMeta(originalMeta);
      const candidates = await host.candidates();
      const byId = new Map(candidates.map((candidate) => [candidate.logicalId, candidate]));
      const operations: Array<{
        logicalId: string;
        entry: SecretEntry;
        candidate: LocalSecretCandidate;
      }> = [];
      const result = emptyImportResult();
      let metaDirty = false;

      const rememberEntry = (logicalId: string, entry: SecretEntry) => {
        meta.entries[logicalId] = {
          hash: entryHash(entry),
          entryRev: entry.entryRev,
          updatedAt: entry.updatedAt,
          deviceId: entry.deviceId,
          binding: entry.binding,
          tombstone: entry.tombstone,
        };
        metaDirty = true;
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
            metaDirty = true;
          }
          result.legacyEntries.push(logicalId);
          recordImportResult(result, logicalId, "rejected", "legacy-secret-type");
          continue;
        }
        if (!isShareableSecretType(entry.binding.secretType)) {
          recordImportResult(result, logicalId, "rejected", "unsupported-secret-type");
          continue;
        }

        const previous = meta.entries[logicalId];
        if (previous) {
          const order = compareEntryVersion(entry, previous);
          if (order < 0) {
            recordImportResult(result, logicalId, "stale", "older-entry");
            continue;
          }
          if (order === 0) {
            if (
              previous.hash === entryHash(entry) &&
              Boolean(previous.tombstone) === Boolean(entry.tombstone)
            ) {
              recordImportResult(result, logicalId, "unchanged", "already-current");
            } else {
              recordImportResult(result, logicalId, "rejected", "version-collision");
            }
            continue;
          }
        }

        // An id match is never sufficient by itself: type and endpoint binding
        // must still agree. Family alone may differ because it is a catalog
        // label rather than a credential destination.
        const direct = byId.get(logicalId);
        const candidate =
          (direct &&
          direct.binding.secretType === entry.binding.secretType &&
          bindingMatchesExceptFamily(entry.binding, direct.binding)
            ? direct
            : undefined) ??
          candidates.find(
            (item) =>
              item.binding.secretType === entry.binding.secretType &&
              bindingMatches(entry.binding, item.binding),
          ) ??
          candidates.find(
            (item) =>
              item.binding.secretType === entry.binding.secretType &&
              bindingMatchesExceptFamily(entry.binding, item.binding),
          );

        if (!candidate && entry.tombstone) {
          rememberEntry(logicalId, entry);
          delete meta.imported[logicalId];
          recordImportResult(result, logicalId, "unchanged", "tombstone-no-local-secret");
          continue;
        }
        if (!candidate) {
          result.unknownAccounts.push(logicalId);
          recordImportResult(
            result,
            logicalId,
            "rejected",
            direct ? "binding-mismatch" : "unknown-account",
          );
          continue;
        }

        if (entry.tombstone && !meta.imported[logicalId]) {
          rememberEntry(logicalId, entry);
          if (candidate.secret) {
            recordImportResult(result, logicalId, "rejected", "local-secret-protected");
          } else {
            recordImportResult(result, logicalId, "unchanged", "tombstone-no-local-secret");
          }
          continue;
        }
        if (!entry.tombstone && candidate.secret && !meta.imported[logicalId]) {
          if (stableStringify(candidate.secret) !== stableStringify(entry.secret)) {
            recordImportResult(result, logicalId, "rejected", "local-secret-conflict");
            continue;
          }
          rememberEntry(logicalId, entry);
          recordImportResult(result, logicalId, "unchanged", "already-current");
          continue;
        }
        operations.push({ logicalId, entry, candidate });
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

      for (const { logicalId, entry, candidate } of operations) {
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
          }
          rememberEntry(logicalId, entry);
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

      if (!metaDirty) return result;

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
    },
  };
}

// ---- SecretsSyncStep.run (v0.8.7) without sealing: one settings round of a device.
/** Returns the shared document after the round and whether this device uploaded it. */
export async function runV087Round(port: SecretsPort, remote: SecretsBundle | null, now: string): Promise<{ remote: SecretsBundle; pushed: boolean }> {
  const local = await port.exportBundle();
  for (const entry of Object.values(local.entries)) {
    if (!entry.tombstone) assertShareable(entry);
  }
  const merged = mergeSecretsBundles(local, remote, now);
  if (stableStringify(merged.entries) !== stableStringify(local.entries)) {
    await port.importBundle(merged);
  }
  const pushed = !remote || stableStringify(merged.entries) !== stableStringify(remote.entries);
  return { remote: pushed ? merged : remote!, pushed };
}
