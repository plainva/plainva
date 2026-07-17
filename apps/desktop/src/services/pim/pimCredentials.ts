import { credentialManager } from "../CredentialManager";

/**
 * Per-ACCOUNT credential slots for PIM connections (a vault can hold several
 * calendar accounts, unlike the one-provider file sync). Secrets live in the
 * OS keychain via CredentialManager (ADR 0005); the non-secret account list
 * lives in the pim_accounts cache table. Key shape mirrors the per-vault
 * store-key convention (base64 vault suffix) plus the account id.
 */

export type PimStoredCredentials =
  | { kind: "caldav"; url: string; user: string; pass: string }
  | { kind: "google"; clientId: string; clientSecret: string; refreshToken: string }
  | { kind: "microsoft"; clientId: string; refreshToken: string };

function pimSecretKey(vaultPath: string, accountId: string): string {
  return `pim_${accountId}_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
}

export async function getPimCredentials(vaultPath: string, accountId: string): Promise<PimStoredCredentials | null> {
  return credentialManager.readSecret<PimStoredCredentials>(pimSecretKey(vaultPath, accountId));
}

export async function savePimCredentials(vaultPath: string, accountId: string, creds: PimStoredCredentials): Promise<void> {
  await credentialManager.writeSecret(pimSecretKey(vaultPath, accountId), creds);
}

export async function clearPimCredentials(vaultPath: string, accountId: string): Promise<void> {
  await credentialManager.removeSecret(pimSecretKey(vaultPath, accountId));
}
