import { announceMailAccounts, MAIL_ACCOUNTS_EVENT, type MailAccountsChange } from "@plainva/ui/mail";
import { getWindowBus } from "../windowBus";

/** The domain of the app-wide `settings-changed` channel that carries it. */
const DOMAIN = "mail-accounts";

/**
 * Passes "the mailbox list of this vault was written" on to every other window
 * (Sammelplan § 3.47 (d)).
 *
 * The list is written in one window — the settings, the sign-in wizard — and a
 * composer that changed windows, or a mail tab in a second full window, holds
 * its own copy in another webview, which a window event does not reach. The
 * store is one per process, so the other window only has to be told to read.
 *
 * Installed once per window. A change that came over the bus is said here as
 * `relayed` and never sent back, so two windows cannot bounce it forever.
 * Fire-and-forget: a window without a bus (browser tests) keeps the local event.
 */
export async function installMailAccountsRelay(): Promise<void> {
  const bus = await getWindowBus();
  window.addEventListener(MAIL_ACCOUNTS_EVENT, (event) => {
    const detail = (event as CustomEvent<MailAccountsChange | undefined>).detail;
    if (!detail?.vaultPath || detail.relayed) return;
    void bus.broadcast("settings-changed", { domain: DOMAIN }, detail.vaultPath).catch(() => {
      /* no other window to tell */
    });
  });
  await bus.onBroadcast("settings-changed", (payload, _from, vaultPath) => {
    if (payload.domain !== DOMAIN || !vaultPath) return;
    announceMailAccounts(vaultPath, true);
  });
}
