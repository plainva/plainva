import { accountCheckDiagnostic, accountServices, checkAccountConnection, hasStoredAccountGrant, logDiagnostic, serviceConnectionMessage, ServiceCheckError, type CloudAccountRecord, type CloudServiceId, type ServiceCheck } from "@plainva/ui";
import { checkMailbox, listMailAccounts } from "@plainva/ui/mail";
import i18n from "@plainva/ui/i18n";
import { getAccountToken } from "./accountBroker";
import { listStoredProviderFolders } from "./syncService";
import { checkPimAccount } from "./pim/pimService";

/** What the card shows of the account, where it differs from the registry record. */
export interface CheckedCard {
  /** The services the card shows. */
  services?: readonly CloudServiceId[];
  /** The calendar row the card shows - this phone's own id for it. */
  pimAccountId?: string;
  mailAccountId?: string;
}

const ORDER: readonly CloudServiceId[] = ["files", "calendar", "mail"];

/**
 * "Check connection" on the phone (account sign-in plan E6): the same check as
 * on the desktop, with the phone's reads - the vault's sync provider, the
 * calendar runtime, the mailbox. Nothing is changed; the result is one line in
 * the diagnostics.
 *
 * It checks what the CARD shows (plan "Verbinden", V0): the calendar row the
 * account page names, not the id in the registry's service entry, which the
 * card's fold can have matched to another row of this phone. And files read
 * through the card's sign-in, as the sync does.
 */
export async function checkMobileAccount(vaultId: string, record: CloudAccountRecord, card: CheckedCard = {}): Promise<ServiceCheck[]> {
  const family = record.family === "google" || record.family === "microsoft" ? record.family : null;
  const pimAccountId = card.pimAccountId ?? record.services.calendar?.pimAccountId;
  const mailAccountId = card.mailAccountId ?? record.services.mail?.mailAccountId;
  // What the card shows AND what the registry says it carries: a service the
  // registry names but this phone does not run is "not connected", not absent.
  const services = ORDER.filter((service) => card.services?.includes(service) || accountServices(record).includes(service));
  const mailbox = mailAccountId ? (await listMailAccounts(vaultId)).find((entry) => entry.id === mailAccountId) : undefined;
  const results = await checkAccountConnection({
    services,
    cardSignedIn: async () => (family ? hasStoredAccountGrant(await getAccountToken(vaultId, record.id).catch(() => null)) : null),
    covered: async (service) => {
      if (!family) return null;
      if (service === "mail" && family === "google" && mailbox?.kind !== "gmail") return null;
      return !!(await getAccountToken(vaultId, record.id, service, family).catch(() => null));
    },
    probe: async (service) => {
      if (service === "files") {
        await listStoredProviderFolders(vaultId, "");
      } else if (service === "calendar") {
        if (!pimAccountId) throw new ServiceCheckError("failed", "connection.notConnected");
        await checkPimAccount(vaultId, pimAccountId);
      } else {
        if (!mailbox) throw new ServiceCheckError("failed", "connection.notConnected");
        await checkMailbox(vaultId, mailbox);
      }
    },
    describe: (error) => serviceConnectionMessage(error, (key, options) => i18n.t(key, options)),
  });
  logDiagnostic("accounts", accountCheckDiagnostic(record.family, results));
  return results;
}
