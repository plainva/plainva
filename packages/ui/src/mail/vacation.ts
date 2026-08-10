import { graphGetAutoReply, graphSetAutoReply } from "./graphMail";
import { mailAccountKind, type MailAccountConfig } from "./mailAccounts";
import { applyVacation, type VacationSettings } from "./sieveScript";
import { writeSieveVacation } from "./sieveSync";
import { mailTransport } from "./transport";

/**
 * The out-of-office notice, whichever way the provider offers it (S13).
 *
 * The rule that decides everything here: **it is only offered where it survives
 * the machine being switched off.** An auto-reply that needs Plainva running is
 * not an auto-reply, it is a promise that breaks the moment someone closes the
 * lid — so an account with neither Sieve nor Graph gets no switch at all, and
 * the interface says why instead of pretending.
 *
 * Two backends, one shape:
 *   - **Sieve** (mailbox.org, Fastmail, Nextcloud, Mailcow, …) — Plainva writes
 *     its own marked section of the script and leaves everything else alone.
 *   - **Microsoft Graph** — a mailbox setting; there is nothing to parse and
 *     nothing of anyone else's to damage.
 */

/** The default ManageSieve port (RFC 5804). */
export const SIEVE_PORT = 4190;

export type VacationSupport =
  | { kind: "sieve"; host: string; port: number }
  | { kind: "graph" }
  /** No server-side auto-reply: the switch is not offered. */
  | { kind: "none" };

/**
 * Whether this account can hold a notice, and how.
 *
 * A Sieve server is not guessed from the IMAP host: `sieveHost` is set when the
 * account was told about one. Guessing would produce a switch that looks like it
 * works and silently writes nowhere — the exact failure this feature must not
 * have.
 */
export function vacationSupport(account: MailAccountConfig): VacationSupport {
  if (mailAccountKind(account) === "microsoft") return { kind: "graph" };
  if (account.sieveHost) return { kind: "sieve", host: account.sieveHost, port: account.sievePort ?? SIEVE_PORT };
  return { kind: "none" };
}

export interface VacationState extends VacationSettings {
  /** True when the script carries a section Plainva did not write and cannot
   * safely parse — the caller refuses to save rather than overwrite it. */
  scriptUnreadable?: boolean;
}

/** Reads the notice as the server currently has it. */
export async function readVacation(
  vaultPath: string,
  account: MailAccountConfig,
  creds: { host: string; port: number; user: string; pass: string }
): Promise<VacationState> {
  const support = vacationSupport(account);
  if (support.kind === "graph") {
    const reply = await graphGetAutoReply(vaultPath, account);
    return { enabled: reply.enabled, message: reply.message, from: reply.from?.slice(0, 10), to: reply.to?.slice(0, 10) };
  }
  if (support.kind === "sieve") {
    const transport = mailTransport();
    if (!transport.sieveGet) return { enabled: false, message: "" };
    const { body } = await transport.sieveGet(creds, { host: support.host, port: support.port });
    // Reading only reports whether Plainva's section is there and parseable —
    // the settings themselves live in the form, not in a Sieve parser Plainva
    // would have to keep in step with every server's dialect.
    const unreadable = applyVacation(body, { enabled: false, message: "" }) === null;
    return { enabled: body.includes("vacation"), message: "", scriptUnreadable: unreadable };
  }
  return { enabled: false, message: "" };
}

/**
 * Writes the notice. Returns false when the script must not be touched —
 * an unterminated Plainva marker, i.e. a file in a state Plainva did not
 * produce.
 */
export async function writeVacation(
  vaultPath: string,
  account: MailAccountConfig,
  creds: { host: string; port: number; user: string; pass: string },
  settings: VacationSettings
): Promise<boolean> {
  const support = vacationSupport(account);
  if (support.kind === "graph") {
    await graphSetAutoReply(vaultPath, account, {
      enabled: settings.enabled,
      message: settings.message,
      from: settings.from ? `${settings.from}T00:00:00` : undefined,
      to: settings.to ? `${settings.to}T23:59:59` : undefined,
    });
    return true;
  }
  if (support.kind !== "sieve") return false;

  // Not `applyVacation`: the section is shared with the rules (S15), and
  // composing this half alone would delete them. One place renders both.
  const result = await writeSieveVacation(
    vaultPath,
    account.id,
    { host: support.host, port: support.port },
    creds,
    settings
  );
  return result.ok;
}
