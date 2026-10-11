import { lazy, Suspense, useEffect, useState } from "react";
import type { MailAttachment } from "@plainva/ui/mail";
import { useVault } from "../../contexts/VaultContext";
import { popOutCompose } from "../../services/mail/composeWindow";

const MailDraftModal = lazy(() => import("./MailDraftModal").then((m) => ({ default: m.MailDraftModal })));

/**
 * The floating composer of a window that draws the whole shell — the central
 * window and a full second one (finding 2026-10-09).
 *
 * It stands NEXT to the shell, under the vault's provider, and that place is
 * the point. The composer used to be rendered inside `AppShell`, and the shell
 * is not always there: whenever the vault is loaded again, the central window
 * shows the loading screen in its place (`App.tsx`), and everything the shell
 * held is gone when it comes back. "Rebuild the index" does that, and so does
 * every reload nobody thinks of as one — a changed password, a newly connected
 * sync, a different sync interval, and with an encrypted workspace locking or
 * unlocking it or a key arriving from another device. A message written beside
 * the settings went with it, without a word, and most of these cannot be asked
 * about first: the password is saved by then, and some of them happen by
 * themselves.
 *
 * So the composer does not ask here, it stays. While the vault loads it waits
 * out of sight and out of reach (`suspended`), and it stands there again with
 * everything in it when the shell is back.
 *
 * What it does NOT outlive is its vault. The provider above is keyed by the
 * vault, so switching or closing it takes this host down too — the draft
 * belongs to that vault's mailboxes — and that step asks first
 * (`AppContext`, through `windowCloseGuard`).
 *
 * An auxiliary window hosts its composer itself (`useAuxBridge`): it has no
 * loading screen to outlive.
 */
export function MailComposeHost() {
  const { vaultPath, isLoading } = useVault();
  // Mail-raus (stage 6) / compose (mail-client E5): the composer is prefilled
  // from what asked for it — a note, a reply, an invitation —, optionally with
  // a file already attached.
  const [mailDraft, setMailDraft] = useState<{ subject: string; markdown: string; attachments?: MailAttachment[]; to?: string } | null>(null);
  useEffect(() => {
    // Compose mail from anywhere (mail-client E5: editor ⋮ send / send as
    // attachment, the mail view, an event's invitation, the command palette).
    const onComposeMail = (e: Event) => {
      const detail = (e as CustomEvent).detail as { subject?: string; markdown?: string; attachments?: MailAttachment[]; to?: string } | undefined;
      if (detail) setMailDraft({ subject: detail.subject ?? "", markdown: detail.markdown ?? "", attachments: detail.attachments, to: detail.to });
    };
    window.addEventListener("plainva-compose-mail", onComposeMail);
    return () => window.removeEventListener("plainva-compose-mail", onComposeMail);
  }, []);

  if (!mailDraft || !vaultPath) return null;
  return (
    <Suspense fallback={null}>
      <MailDraftModal
        subject={mailDraft.subject}
        markdown={mailDraft.markdown}
        attachments={mailDraft.attachments}
        initialTo={mailDraft.to}
        suspended={isLoading}
        onPopOut={(snap) => void popOutCompose(vaultPath, snap)}
        onClose={() => setMailDraft(null)}
      />
    </Suspense>
  );
}
