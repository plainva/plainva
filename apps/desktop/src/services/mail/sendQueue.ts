import { toast } from "@plainva/ui";
import { UndoSendQueue, secondsLeft, listMailAccounts, sendMail, appendDraft, type MailAttachment } from "@plainva/ui/mail";
import i18n from "@plainva/ui/i18n";
import { isOwnerWindow } from "../windowContext";
import { getWindowBus } from "../windowBus";

/**
 * Sending a message, from whichever window wrote it (multi-window P3).
 *
 * Two things live here that used to live inside the compose component:
 *
 * 1. **The delayed send.** "Undo send" is a DELAY, not a recall — once SMTP has
 *    the message there is no taking it back. The compose window closes the
 *    moment the writer hits send, so the timer has to outlive it, and closing
 *    Plainva FLUSHES rather than drops: a message someone asked to send must
 *    not vanish (S23).
 * 2. **Whose timer it is.** The queue belongs to the CENTRAL window (plan
 *    §12.4). It hangs on `beforeunload`, and a compose window is the most
 *    likely window in the whole app to be closed while a timer runs — if the
 *    queue lived there, closing it would decide between sending and losing.
 *    A compose window therefore hands the message over and closes; the undo
 *    toast appears where the user keeps working.
 *
 * Callers do not choose: `submitSend`/`submitDraft` route by window role, so
 * the compose form is the same component in both places.
 */

export interface MailSendRequest {
  vaultPath: string;
  accountId: string;
  /** Comma-joined recipient lists, as the send path takes them. */
  to: string;
  subject: string;
  body: string;
  attachments: MailAttachment[];
  /** Inline iMIP invitation ("send event by mail"), not a plain attachment. */
  calendar?: { ics: string; method?: string };
  cc?: string;
  bcc?: string;
  /** Chosen sender address within the account (an alias, or its own). */
  fromAddress?: string;
}

export interface MailDraftRequest extends Omit<MailSendRequest, "calendar" | "fromAddress"> {
  mailbox: string;
}

let undoToastId: number | null = null;
let queue: UndoSendQueue<() => Promise<void>> | null = null;

/**
 * Built on first use, not while the module loads (C20): this file is reachable
 * from the owner bus, so it is evaluated early in the bundle — and constructing
 * a class from another package at load time is the shape that shipped a white
 * window twice. Nothing can be queued before this ran, so the flush listener
 * is registered here too.
 */
function undoQueue(): UndoSendQueue<() => Promise<void>> {
  if (queue) return queue;
  queue = new UndoSendQueue<() => Promise<void>>(async (deliver) => {
    try {
      await deliver();
      if (undoToastId !== null) toast.dismiss(undoToastId);
      undoToastId = null;
    } catch (e) {
      if (undoToastId !== null) toast.dismiss(undoToastId);
      undoToastId = null;
      toast.error(e instanceof Error ? e.message : String(e));
    }
  });
  // Closing Plainva must not lose a message someone asked to send.
  if (typeof window !== "undefined") window.addEventListener("beforeunload", () => void queue?.flush());
  return queue;
}

async function accountOf(vaultPath: string, accountId: string) {
  const accounts = await listMailAccounts(vaultPath);
  const account = accounts.find((a) => a.id === accountId);
  if (!account) throw new Error(`unknown mail account ${accountId}`);
  return account;
}

/** Puts a message into the owner's delayed-send queue and raises the undo toast. */
export async function enqueueSend(req: MailSendRequest): Promise<void> {
  const account = await accountOf(req.vaultPath, req.accountId);
  const q = undoQueue();
  const entry = q.enqueue(() =>
    sendMail(
      req.vaultPath,
      account,
      req.to,
      req.subject,
      req.body,
      req.attachments,
      req.calendar,
      req.cc ?? "",
      req.bcc ?? "",
      req.fromAddress,
    ),
  );
  undoToastId = toast.progress(i18n.t("mail.sendingWithUndo", { seconds: secondsLeft(entry) }), {
    label: i18n.t("common.undo"),
    run: () => {
      if (q.cancel(entry.id)) toast.info(i18n.t("mail.sendCancelled"));
      if (undoToastId !== null) toast.dismiss(undoToastId);
      undoToastId = null;
    },
  });
}

/** Appends the message as a \Draft into the account's drafts mailbox. */
export async function appendDraftFor(req: MailDraftRequest): Promise<void> {
  const account = await accountOf(req.vaultPath, req.accountId);
  await appendDraft(
    req.vaultPath,
    account,
    req.mailbox,
    req.to,
    req.subject,
    req.body,
    req.attachments,
    req.cc ?? "",
    req.bcc ?? "",
  );
}

/**
 * Send from wherever the writer is. In the central window that is the queue
 * above; in a compose window it is the same queue, one process away.
 */
export async function submitSend(req: MailSendRequest): Promise<void> {
  if (isOwnerWindow()) return enqueueSend(req);
  const bus = await getWindowBus();
  await bus.request("mail-send", req);
}

/** Save as draft from wherever the writer is (same routing as `submitSend`). */
export async function submitDraft(req: MailDraftRequest): Promise<void> {
  if (isOwnerWindow()) return appendDraftFor(req);
  const bus = await getWindowBus();
  await bus.request("mail-draft", req);
}
