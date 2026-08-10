import { getPlatformServices } from "../platform/services";
import { buildRulesSection, type RuleMailboxes, type SkipReason } from "./sieveRules";
import { applySieve, buildVacationBody, type VacationSettings } from "./sieveScript";
import { listMailRules, type MailRule } from "./rules";
import { mailTransport } from "./transport";

/**
 * Writing Plainva's Sieve section (S15).
 *
 * There is exactly ONE section (E4) and two features that want to write it: the
 * out-of-office notice and the rules. If each composed the section on its own,
 * the last one to save would wipe the other — switching the notice off would
 * silently delete every server-side rule. So every write renders the WHOLE
 * section from both halves, and this module is the only place that does it.
 *
 * That has a consequence worth naming: Plainva has to know both halves at write
 * time, and it does not parse them back out of the script (a Sieve parser kept
 * in step with every server's dialect is a liability, not a feature). So it
 * keeps its own record of what it wrote, per account, next to the rules. The
 * script stays the server's truth for EXECUTION; the record is Plainva's truth
 * for COMPOSITION. Where the two disagree, the marker already says which wins:
 * "do not edit this section".
 */

export interface SieveWriteResult {
  ok: boolean;
  /** Rules that stayed local, with the reason. */
  skipped: { id: string; reason: SkipReason }[];
  /** True when the script holds a Plainva marker that cannot be parsed — the
   * one case where writing nothing is the right answer. */
  unreadable?: boolean;
}

const vacationKey = (vaultPath: string, accountId: string) =>
  `mailVacation_${accountId}_${btoa(unescape(encodeURIComponent(vaultPath)))}`;

/** What Plainva last wrote as the notice. Empty when it never wrote one. */
export async function readStoredVacation(vaultPath: string, accountId: string): Promise<VacationSettings> {
  const store = await getPlatformServices().loadSettings();
  const raw = await store.get<VacationSettings>(vacationKey(vaultPath, accountId));
  return raw && typeof raw === "object" && typeof raw.message === "string" ? raw : { enabled: false, message: "" };
}

export async function saveStoredVacation(vaultPath: string, accountId: string, settings: VacationSettings): Promise<void> {
  const store = await getPlatformServices().loadSettings();
  await store.set(vacationKey(vaultPath, accountId), settings);
  await store.save();
}

/** Named apart from the protocol client's `SieveCreds`: this one travels
 * through the transport, that one opens a socket. */
export interface SieveAccess {
  host: string;
  port: number;
  user: string;
  pass: string;
}

/**
 * Renders and uploads the whole section.
 *
 * Both halves are passed in explicitly rather than defaulted, because a default
 * here is precisely the bug this module exists to prevent: a caller that forgot
 * one half would delete it.
 */
export async function writeSieveState(
  server: { host: string; port: number },
  creds: SieveAccess,
  state: { vacation: VacationSettings; rules: readonly MailRule[]; mailboxes?: RuleMailboxes }
): Promise<SieveWriteResult> {
  const transport = mailTransport();
  if (!transport.sieveGet || !transport.sievePut) return { ok: false, skipped: [] };

  const { name, body, capabilities } = await transport.sieveGet(creds, server);
  const vacationPart = buildVacationBody(state.vacation);
  const rulesPart = buildRulesSection(state.rules, state.mailboxes ?? {}, capabilities);

  const next = applySieve(body, {
    vacationBody: vacationPart?.body ?? null,
    rulesBody: rulesPart.body || null,
    extensions: [...(vacationPart?.extensions ?? []), ...rulesPart.extensions],
  });
  if (next === null) return { ok: false, skipped: rulesPart.skipped, unreadable: true };

  await transport.sievePut(creds, { ...server, name, body: next });
  return { ok: true, skipped: rulesPart.skipped };
}

/** Convenience for the rules card: it knows the rules, and reads the notice
 * from Plainva's own record so it cannot drop it. */
export async function writeSieveRules(
  vaultPath: string,
  accountId: string,
  server: { host: string; port: number },
  creds: SieveAccess,
  rules: readonly MailRule[],
  mailboxes?: RuleMailboxes
): Promise<SieveWriteResult> {
  const vacation = await readStoredVacation(vaultPath, accountId);
  return writeSieveState(server, creds, { vacation, rules, mailboxes });
}

/** Convenience for the vacation card: it knows the notice, and reads the rules
 * from the store so it cannot drop them. */
export async function writeSieveVacation(
  vaultPath: string,
  accountId: string,
  server: { host: string; port: number },
  creds: SieveAccess,
  vacation: VacationSettings,
  mailboxes?: RuleMailboxes
): Promise<SieveWriteResult> {
  const rules = await listMailRules(vaultPath);
  const result = await writeSieveState(server, creds, { vacation, rules, mailboxes });
  if (result.ok) await saveStoredVacation(vaultPath, accountId, vacation);
  return result;
}
