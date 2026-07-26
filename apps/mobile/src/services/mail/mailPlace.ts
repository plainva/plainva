import { getMobileSettings, updateMobileSettings } from "../mobileSettings";

/**
 * Which mailbox the phone last had open (device report B1, 2026-07-26).
 *
 * Account and folder used to be plain component state in `MailListScreen`.
 * Opening a message replaces the list — the component unmounts — so going back
 * rebuilt it from scratch and landed in the first account's inbox. Whoever read
 * mail in a second account, or in Archive, was thrown out of it by pressing
 * back, which is the one gesture that must not lose your place.
 *
 * The remembered pair lives in the vault-scoped settings, so it also survives
 * an app restart — what any mail client does. The resolution below is pure and
 * tested: a remembered account that no longer exists falls back to the first,
 * and nothing else does.
 */

export interface MailPlace {
  accountId: string | null;
  mailbox: string | null;
}

/** The stored pair, empty strings normalised to null. */
export function rememberedMailPlace(): MailPlace {
  const s = getMobileSettings();
  return { accountId: s.mailAccountId || null, mailbox: s.mailMailbox || null };
}

/**
 * The account to show: keep the current/remembered one while it still exists,
 * otherwise the first available. Returns null when there is no account at all.
 */
export function resolveMailAccount(current: string | null, accounts: readonly { id: string }[]): string | null {
  if (current && accounts.some((a) => a.id === current)) return current;
  return accounts[0]?.id ?? null;
}

/**
 * The folder to show: keep the current/remembered one while the server still
 * lists it, otherwise the inbox (or, failing that, the first folder).
 */
export function resolveMailbox(current: string | null, names: readonly string[]): string | null {
  if (current && names.includes(current)) return current;
  return names.find((n) => n.toLowerCase() === "inbox") ?? names[0] ?? null;
}

/** Persists the pair — a no-op when nothing changed, so switching folders does
 *  not write the settings store on every render. */
export async function rememberMailPlace(place: MailPlace): Promise<void> {
  const s = getMobileSettings();
  const accountId = place.accountId ?? "";
  const mailbox = place.mailbox ?? "";
  if (s.mailAccountId === accountId && s.mailMailbox === mailbox) return;
  await updateMobileSettings({ mailAccountId: accountId, mailMailbox: mailbox });
}
