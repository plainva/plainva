import type { MailEnvelope } from "@plainva/ui/mail";

/**
 * The mail search that is showing, kept across the list's rebuild.
 *
 * Opening a message replaces the list — the component unmounts (see
 * `mailPlace.ts`, device report B1) — so going back rebuilt it from scratch.
 * The folder survives that through the remembered place; the search did not:
 * whoever opened the first hit came back to the plain folder and had to search
 * again for the second (TestFlight 02.10.2026). A search is a place too.
 *
 * Session memory only, deliberately: a search is a question asked now, not a
 * setting. It belongs to ONE account and ONE folder, and is dropped as soon as
 * either changes or the search is cleared.
 */
export interface MailSearchSession {
  accountId: string;
  mailbox: string;
  query: string;
  /** The hits as last shown — put back at once, then asked for again. */
  rows: MailEnvelope[];
}

let session: MailSearchSession | null = null;

/** The kept search, if it belongs to this account and folder. */
export function keptMailSearch(accountId: string | null, mailbox: string | null): MailSearchSession | null {
  if (!session || !accountId || !mailbox) return null;
  return session.accountId === accountId && session.mailbox === mailbox ? session : null;
}

export function keepMailSearch(next: MailSearchSession): void {
  session = next;
}

export function forgetMailSearch(): void {
  session = null;
}
