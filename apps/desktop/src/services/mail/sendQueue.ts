import { toast } from "@plainva/ui";
import { HeldSends, UndoSendQueue, secondsLeft, listMailAccounts, mailErrorText, sendMail, appendDraft, utf8ToBase64, type MailAttachment } from "@plainva/ui/mail";
import i18n from "@plainva/ui/i18n";
import { isOwnerWindow } from "../windowContext";
import { getWindowBus } from "../windowBus";
import type { ComposeSnapshot } from "./composeHandoff";

/**
 * Sending a message, from whichever window wrote it (multi-window P3).
 *
 * Three things live here that used to live inside the compose component, or
 * nowhere:
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
 * 3. **A refused message.** By the time the mail server answers, the composer
 *    is closed. A message it refuses is kept and comes back in a compose
 *    window, with everything it was sent with (`refusedSends`).
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

/** A message on its way: what was asked for, and the call that hands it over. */
interface QueuedSend {
  req: MailSendRequest;
  deliver: () => Promise<void>;
}

let undoToastId: number | null = null;
let queue: UndoSendQueue<QueuedSend> | null = null;
let refused: HeldSends<MailSendRequest> | null = null;

/** `i18n.t` in the shape the shared mail texts take. */
const say = (key: string, options?: Record<string, unknown>): string => i18n.t(key, options ?? {});

/**
 * The messages the mail server refused (`HeldSends`): kept here, where the
 * queue lives, until a composer has them again.
 *
 * A refused message comes back as a compose WINDOW of the vault it was written
 * in — the way a popped-out composer opens. The central window may be showing
 * another vault by then, and whatever draft floats there stays untouched. The
 * queue lets go of the message when that window has collected it
 * (`releaseRefusedSend`, called where the owner answers `compose-draft`).
 */
function refusedSends(): HeldSends<MailSendRequest> {
  refused ??= new HeldSends<MailSendRequest>({
    text: (reason) => ({ message: i18n.t("mail.sendFailed", { reason }), action: i18n.t("mail.sendReopen") }),
    open: async (id, req) => {
      try {
        // Loaded on demand: the window manager is the owner's, and a compose
        // window that only sends has no use for it.
        const { openComposeWindow } = await import("../windowManager");
        await openComposeWindow({
          vaultPath: req.vaultPath,
          snapshot: refusedSnapshot(id, req),
          title: req.subject.trim() || i18n.t("mail.composeTitle"),
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
        throw e;
      }
    },
    // `open` is over when the window EXISTS; the message is its only once it
    // has collected the draft, and until then the notice still stands. A new
    // window takes its time to start, longer with megabytes to fetch, and the
    // fetch itself gives up after fifteen seconds. Answering the notice again
    // any sooner would bring the same message up in a second window — and a
    // message in two windows is a message that can be sent twice.
    settleMs: 20_000,
  });
  return refused;
}

/**
 * A refused message as the state a composer opens with.
 *
 * It opens as it was SENT: the files that went along are its files (one that
 * stayed behind was agreed to), and an invitation is an invitation again. Its
 * opened state is an empty composer, so closing the window asks — a message
 * that was not sent is unsaved work, whoever typed how much of it.
 */
function refusedSnapshot(id: number, req: MailSendRequest): ComposeSnapshot {
  const invitation: MailAttachment[] = req.calendar
    ? [{ name: "invite.ics", mime: `text/calendar; method=${req.calendar.method ?? "REQUEST"}`, contentBase64: utf8ToBase64(req.calendar.ics) }]
    : [];
  return {
    accountId: req.accountId,
    fromAddress: req.fromAddress ?? "",
    to: req.to,
    cc: req.cc ?? "",
    bcc: req.bcc ?? "",
    showCc: !!(req.cc || req.bcc),
    subject: req.subject,
    body: req.body,
    attachments: [...req.attachments, ...invitation],
    mailbox: "",
    opened: { to: "", cc: "", bcc: "", subject: "", body: "", attachments: [] },
    refused: id,
  };
}

/** The compose window of a refused message has collected it: it lives there now. */
export function releaseRefusedSend(id: number | undefined): void {
  refused?.claim(id);
}

/**
 * Built on first use, not while the module loads (C20): this file is reachable
 * from the owner bus, so it is evaluated early in the bundle — and constructing
 * a class from another package at load time is the shape that shipped a white
 * window twice. Nothing can be queued before this ran, so the flush listener
 * is registered here too.
 */
function undoQueue(): UndoSendQueue<QueuedSend> {
  if (queue) return queue;
  queue = new UndoSendQueue<QueuedSend>(async ({ req, deliver }) => {
    // The notice ends WITH the window, before the transport is asked. Whatever
    // brought the message here — the timer, Plainva closing, a second message
    // pushing this one out — "Undo" can no longer stop it, and the notice is
    // persistent: nothing but this takes it down. It is also the last moment
    // the id still names THIS message's notice; by the time the transport has
    // answered, a message sent in between has its own behind it. The outcome
    // is therefore said on its own, as the phone says it.
    if (undoToastId !== null) toast.dismiss(undoToastId);
    undoToastId = null;
    try {
      await deliver();
      toast.success(i18n.t("mail.sent"));
    } catch (e) {
      // The composer closed eight seconds ago. Until 2026-10 the refusal was
      // one line of text and the message was gone; now it is kept, and the
      // notice that says why is its way back.
      refusedSends().hold(req, mailErrorText(e, say));
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

/**
 * Puts a message into the owner's delayed-send queue and raises the undo toast.
 *
 * `delivered` is told once the transport TOOK the message — not now, when it
 * is only queued: a send that is undone or that the server refuses tells
 * nothing. Whoever keeps the text until it is really out (a draft the
 * assistant wrote, AI harness P5-6) can then still offer it.
 */
export async function enqueueSend(req: MailSendRequest, delivered?: () => void): Promise<void> {
  const account = await accountOf(req.vaultPath, req.accountId);
  const q = undoQueue();
  const entry = q.enqueue({
    req,
    deliver: async () => {
      await sendMail(
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
      );
      delivered?.();
    },
  });
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
 *
 * `delivered` — see `enqueueSend`. A function does not cross windows: from a
 * window that is not the owner, all this side learns is that the owner's queue
 * has the message, and that is when it is told.
 */
export async function submitSend(req: MailSendRequest, delivered?: () => void): Promise<void> {
  if (isOwnerWindow()) return enqueueSend(req, delivered);
  const bus = await getWindowBus();
  await bus.request("mail-send", req);
  delivered?.();
}

/** Save as draft from wherever the writer is (same routing as `submitSend`). */
export async function submitDraft(req: MailDraftRequest): Promise<void> {
  if (isOwnerWindow()) return appendDraftFor(req);
  const bus = await getWindowBus();
  await bus.request("mail-draft", req);
}
