import { accountCheckDiagnostic, accountServices, checkAccountConnection, logDiagnostic, serviceConnectionMessage, type CloudAccountRecord, type ServiceCheck } from "@plainva/ui";
import { checkMailbox, listMailAccounts } from "@plainva/ui/mail";
import i18n from "@plainva/ui/i18n";
import { getAccountToken } from "./accountBroker";
import { getStoredProvider, listProviderFolders } from "./syncService";
import { checkPimAccount } from "./pim/pimService";

/**
 * "Check connection" on the phone (account sign-in plan E6): the same check as
 * on the desktop, with the phone's reads - the vault's sync provider, the
 * calendar runtime, the mailbox. Nothing is changed; the result is one line in
 * the diagnostics.
 */
export async function checkMobileAccount(vaultId: string, record: CloudAccountRecord): Promise<ServiceCheck[]> {
  const family = record.family === "google" || record.family === "microsoft" ? record.family : null;
  const mailbox = record.services.mail ? (await listMailAccounts(vaultId)).find((entry) => entry.id === record.services.mail!.mailAccountId) : undefined;
  const results = await checkAccountConnection({
    services: accountServices(record),
    covered: async (service) => {
      if (!family) return null;
      if (service === "mail" && family === "google" && mailbox?.kind !== "gmail") return null;
      return !!(await getAccountToken(vaultId, record.id, service, family).catch(() => null));
    },
    probe: async (service) => {
      if (service === "files") {
        const provider = await getStoredProvider(vaultId);
        if (!provider) throw new Error(i18n.t("connection.notConnected"));
        await listProviderFolders(provider, "");
      } else if (service === "calendar") {
        await checkPimAccount(vaultId, record.services.calendar!.pimAccountId);
      } else {
        if (!mailbox) throw new Error(i18n.t("connection.notConnected"));
        await checkMailbox(vaultId, mailbox);
      }
    },
    describe: (error) => serviceConnectionMessage(error, (key, options) => i18n.t(key, options)),
  });
  logDiagnostic("accounts", accountCheckDiagnostic(record.family, results));
  return results;
}
