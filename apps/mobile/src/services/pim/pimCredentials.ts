import { getPlatformServices } from "@plainva/ui";

/**
 * Per-account PIM credential slots on mobile (mirrors the desktop keychain
 * slots, ADR 0005). Secrets live in the native SecureStore via the platform
 * credential store; the non-secret account list lives in the vault's
 * pim_accounts cache table. Keyed by vault id + account id so connections in
 * different vaults never collide.
 */

export type PimStoredCredentials =
  | { kind: "caldav"; url: string; user: string; pass: string }
  | { kind: "google"; clientId: string; clientSecret: string; refreshToken: string }
  | { kind: "microsoft"; clientId: string; refreshToken: string };

const key = (vaultId: string, accountId: string) => `pim_${vaultId}_${accountId}`;

export async function getPimCredentials(vaultId: string, accountId: string): Promise<PimStoredCredentials | null> {
  return getPlatformServices().credentials.readSecret<PimStoredCredentials>(key(vaultId, accountId));
}

export async function savePimCredentials(vaultId: string, accountId: string, creds: PimStoredCredentials): Promise<void> {
  await getPlatformServices().credentials.writeSecret(key(vaultId, accountId), creds);
}

export async function clearPimCredentials(vaultId: string, accountId: string): Promise<void> {
  await getPlatformServices().credentials.removeSecret(key(vaultId, accountId));
}
