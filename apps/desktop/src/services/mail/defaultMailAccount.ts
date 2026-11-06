import { getSettingsStore } from "../settingsStore";

/**
 * Where the desktop keeps the vault's default mailbox (finding 2026-11-06, M1):
 * the device-local id, per vault, in the settings store - the profile field
 * `defaultMailAccount` carries it to the other devices. The rule that reads it
 * is shared (`pickDefaultMailAccount`).
 */
const b64 = (value: string) => btoa(unescape(encodeURIComponent(value)));

export const defaultMailAccountKey = (vaultPath: string) => `defaultMailAccount_${b64(vaultPath)}`;

/** Said in this window after the default changed, here or by a profile import. */
export const DEFAULT_MAIL_ACCOUNT_EVENT = "plainva-default-mail-account-changed";

export async function loadDefaultMailAccount(vaultPath: string): Promise<string> {
  const value = await (await getSettingsStore()).get<string>(defaultMailAccountKey(vaultPath));
  return typeof value === "string" ? value : "";
}

export async function saveDefaultMailAccount(vaultPath: string, accountId: string): Promise<void> {
  const store = await getSettingsStore();
  await store.set(defaultMailAccountKey(vaultPath), accountId);
  await store.save();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(DEFAULT_MAIL_ACCOUNT_EVENT, { detail: { vaultPath } }));
}
