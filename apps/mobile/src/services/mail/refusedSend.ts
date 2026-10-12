import i18n from "@plainva/ui/i18n";
import { HeldSends, type MailAttachment } from "@plainva/ui/mail";

/**
 * A message the mail server refused, on the phone: kept until the composer has
 * it again (the shared rule is `HeldSends`).
 *
 * The composer closes when a message is sent, and the server answers eight
 * seconds later. A refusal used to be one line of text; the message — and on a
 * phone the files it had fetched over a mobile connection — was gone.
 *
 * It comes back as a pushed compose screen. The message does NOT travel in the
 * nav path, which is read on every render: the path names it by its id, and
 * the screen reads it from here.
 */

/** A message as the composer sent it: everything it takes to open it again. */
export interface RefusedMessage {
  accountId: string;
  fromAddress: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  attachments: MailAttachment[];
}

type Opener = (id: number) => Promise<void> | void;

let refused: HeldSends<RefusedMessage> | null = null;
let opener: Opener | null = null;

/**
 * The shell says how a refused message comes back: it owns the nav stack, and
 * the question of whatever screen stands on top.
 */
export function setRefusedSendOpener(open: Opener | null): void {
  opener = open;
}

// Built on first use, not while the module loads: a class from another package
// constructed at load time is the shape `moduleInitBoundary.test.ts` forbids.
function refusedSends(): HeldSends<RefusedMessage> {
  refused ??= new HeldSends<RefusedMessage>({
    text: (reason) => ({ message: i18n.t("mail.sendFailed", { reason }), action: i18n.t("mail.sendReopen") }),
    open: async (id) => {
      await opener?.(id);
    },
    // The compose screen mounts in the same breath as the push.
    settleMs: 300,
  });
  return refused;
}

/** Keeps a refused message and raises the notice that is its way back. */
export function holdRefusedSend(message: RefusedMessage, reason: string): number {
  return refusedSends().hold(message, reason);
}

/** The message held under an id. A read: a screen that renders twice gets it twice. */
export function readRefusedSend(id: number | undefined): RefusedMessage | undefined {
  return refused?.read(id);
}

/** The compose screen has the message: it is that screen's from here on. */
export function claimRefusedSend(id: number | undefined): void {
  refused?.claim(id);
}
