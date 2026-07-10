/**
 * Platform-neutral secret storage (ADR 0011). The desktop shell implements
 * this in its CredentialManager (OS keychain with an encrypted-store
 * fallback, ADR 0005); the mobile shell will use the iOS Keychain /
 * Android Keystore. Values are JSON-serializable credential objects keyed
 * by provider-and-vault-specific names.
 */
export interface ICredentialStore {
  readSecret<T>(key: string): Promise<T | null>;
  writeSecret<T>(key: string, value: T): Promise<void>;
  removeSecret(key: string): Promise<void>;
}
