import {
  canonicalizeEndpoint,
  sealSecretsBundle,
  type MasterKeyBundle,
  type ProfileDoc,
  type SecretsBundle,
} from "../../src/index.js";

/**
 * Sanitized v0.6.0-era account-sync fixtures.
 *
 * Every hostname is reserved for documentation, every identifier is synthetic,
 * and the payload strings are assembled at runtime to prevent a fixture or
 * scanner report from looking like a usable credential.
 */
export const V060_LOGICAL_IDS = {
  pim: "logical-google-calendar",
  mail: "logical-imap-mail",
  cloud: "logical-cloud-card",
} as const;

const fixtureOnly = (...parts: string[]): string => parts.join("-");

export const V060_PROFILE_VALUES: Record<string, unknown> = {
  dailyNotesFolder: "Journal",
  syncIntervalSeconds: 30,
  pimAccounts: [
    {
      id: V060_LOGICAL_IDS.pim,
      provider: "google",
      label: "person@example.invalid",
      config: {
        user: "person@example.invalid",
        clientId: fixtureOnly("legacy", "desktop", "client", "id", "invalid"),
      },
      enabled: true,
    },
  ],
  mailAccounts: [
    {
      id: V060_LOGICAL_IDS.mail,
      label: "Mail",
      host: "imap.example.invalid",
      port: 993,
      user: "person@example.invalid",
    },
  ],
  cloudAccounts: [
    {
      id: V060_LOGICAL_IDS.cloud,
      family: "google",
      label: "person@example.invalid",
      byoClientId: fixtureOnly("legacy", "desktop", "client", "id", "invalid"),
      services: {
        calendar: { pimAccountId: V060_LOGICAL_IDS.pim },
        mail: { mailAccountId: V060_LOGICAL_IDS.mail },
      },
    },
  ],
};

export const V060_PROFILE_DOC: ProfileDoc = {
  format: "plainva-profile",
  version: 2,
  rev: 17,
  updatedAt: "2026-07-30T18:00:00.000Z",
  deviceId: "fixture-desktop",
  values: V060_PROFILE_VALUES,
  entries: Object.fromEntries(
    Object.entries(V060_PROFILE_VALUES).map(([key, value]) => [
      key,
      {
        value,
        rev: 17,
        updatedAt: "2026-07-30T18:00:00.000Z",
        deviceId: "fixture-desktop",
      },
    ]),
  ),
};

export const V060_FIXTURE_KEY: MasterKeyBundle = {
  keyId: "f1f2f3f4f5f6f7f8",
  masterKey: new Uint8Array(32).fill(0x5a),
};

/** Plain bundle exists only in memory; callers persist/use the encrypted bytes. */
export function createV060SecretsBundleFixture(): SecretsBundle {
  return {
    format: "plainva-secrets",
    version: 1,
    bundleRev: 4,
    updatedAt: "2026-07-30T18:00:00.000Z",
    entries: {
      [V060_LOGICAL_IDS.pim]: {
        entryRev: 4,
        updatedAt: "2026-07-30T18:00:00.000Z",
        deviceId: "fixture-desktop",
        binding: {
          family: "google",
          service: "calendar",
          secretType: "google-pim-client",
          user: "person@example.invalid",
          endpoint: canonicalizeEndpoint("https://accounts.google.com"),
        },
        secret: {
          clientId: fixtureOnly("legacy", "desktop", "client", "id", "invalid"),
          clientSecret: fixtureOnly("fixture", "only", "not", "a", "credential"),
        },
      },
      [V060_LOGICAL_IDS.mail]: {
        entryRev: 2,
        updatedAt: "2026-07-30T17:00:00.000Z",
        deviceId: "fixture-desktop",
        binding: {
          family: "imap",
          service: "mail",
          secretType: "imap-password",
          user: "person@example.invalid",
          endpoint: canonicalizeEndpoint("imaps://imap.example.invalid:993"),
        },
        secret: { pass: fixtureOnly("fixture", "only", "not", "a", "password") },
      },
    },
  };
}

/** Real `secrets.enc` bytes under a deterministic, test-only master key. */
export function createV060SecretsEncFixture(): Uint8Array {
  return sealSecretsBundle(V060_FIXTURE_KEY, createV060SecretsBundleFixture());
}

