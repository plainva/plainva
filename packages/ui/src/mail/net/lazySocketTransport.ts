import type { MailTransport } from "../transport";

/** Every method of the socket transport (`createSocketMailTransport`); a test holds the two lists together. */
export const SOCKET_TRANSPORT_METHODS = [
  "bulkAction",
  "checkLogin",
  "listEnvelopes",
  "fetchMessage",
  "fetchRaw",
  "fetchAttachment",
  "fetchAttachments",
  "appendDraft",
  "setSeen",
  "setFlagged",
  "moveMessage",
  "setJunk",
  "createMailbox",
  "sieveGet",
  "sievePut",
  "deleteMessage",
  "searchEnvelopes",
  "listFlaggedEnvelopes",
  "send",
  "releaseSessions",
] as const satisfies readonly (keyof MailTransport)[];

/**
 * The socket transport, loaded with its first call (performance plan L5): IMAP, SMTP, MIME and the HTML reading of
 * a message are a chunk of their own, which a phone without a mailbox never loads. It offers exactly the methods of
 * the socket transport — the mail client asks for the optional ones by their presence — and each one waits for the
 * load, then is the socket transport's own.
 */
export function createLazySocketMailTransport(): MailTransport {
  let real: Promise<MailTransport> | null = null;
  const load = () => (real ??= import("./socketTransport").then((module) => module.createSocketMailTransport()));
  const transport: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const method of SOCKET_TRANSPORT_METHODS) {
    transport[method] = (...args) => load().then((loaded) => (loaded[method] as (...a: unknown[]) => Promise<unknown>)(...args));
  }
  return transport as unknown as MailTransport;
}
