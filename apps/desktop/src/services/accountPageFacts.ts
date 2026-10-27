import type { CloudAccountRecord, CloudServiceId } from "@plainva/ui";
import { listMailAccounts } from "@plainva/ui/mail";
import i18n from "@plainva/ui/i18n";
import { credentialManager } from "./CredentialManager";
import { getSyncRootFolder } from "./cloudAccountsActions";
import { getPimCredentials } from "./pim/pimCredentials";
import type { PimRuntime } from "./pim/pimRuntime";

/**
 * What the desktop's account page shows of one account besides its state
 * (plan "Verbinden", V2): who signs in and where (section 3), and one live
 * line per service (section 2). Read from this device's slots and caches;
 * nothing secret leaves here - a password is only ever "set" or "not set".
 */
export interface AccountPageFacts {
  user?: string;
  server?: string;
  accessKeyId?: string;
  /** The own app key of a Dropbox account, when one is stored. */
  appKey?: string;
  summaries: Partial<Record<CloudServiceId, string>>;
}

export async function readAccountPageFacts(vaultPath: string, record: CloudAccountRecord, runtime: PimRuntime | null): Promise<AccountPageFacts> {
  const facts: AccountPageFacts = { summaries: {} };
  const files = record.services.files?.provider;
  if (files === "webdav") {
    const creds = await credentialManager.getWebDavCredentials(vaultPath).catch(() => null);
    if (creds) { facts.user = creds.user; facts.server = creds.url; }
  } else if (files === "s3") {
    const creds = await credentialManager.getS3Credentials(vaultPath).catch(() => null);
    if (creds) { facts.accessKeyId = creds.accessKeyId; facts.server = creds.endpoint; }
  } else if (files === "dropbox") {
    const creds = await credentialManager.getDropboxCredentials(vaultPath).catch(() => null);
    if (creds?.appKey) facts.appKey = creds.appKey;
  }
  if (files) {
    const folder = await getSyncRootFolder(vaultPath, files).catch(() => "");
    facts.summaries.files = folder ? i18n.t("cloudAccounts.filesSummary", { folder }) : i18n.t("connection.connected");
  }
  const pimId = record.services.calendar?.pimAccountId;
  if (pimId) {
    const creds = await getPimCredentials(vaultPath, pimId).catch(() => null);
    if (creds?.kind === "caldav") {
      facts.user ??= creds.user;
      facts.server ??= creds.url;
    }
    if (runtime?.isActive()) {
      const [calendars, lists] = await Promise.all([
        runtime.cache.listCalendars(pimId).catch(() => []),
        runtime.cache.listTaskLists(pimId).catch(() => []),
      ]);
      facts.summaries.calendar = i18n.t("cloudAccounts.calendarSummary", {
        calendars: calendars.filter((calendar) => calendar.selected).length,
        lists: lists.filter((list) => list.selected).length,
      });
    }
  }
  const mailId = record.services.mail?.mailAccountId;
  if (mailId) {
    const mailbox = (await listMailAccounts(vaultPath).catch(() => [])).find((entry) => entry.id === mailId);
    if (mailbox) {
      facts.summaries.mail = mailbox.user;
      if ((mailbox.kind ?? "imap") === "imap") {
        facts.user ??= mailbox.user;
        facts.server ??= `${mailbox.host}:${mailbox.port}`;
      }
    }
  }
  return facts;
}
