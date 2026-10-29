import { withServiceOff, type CloudAccountRecord, type CloudServiceId, type SyncProviderId } from "@plainva/ui";
import { listMailAccounts } from "@plainva/ui/mail";
import i18n from "@plainva/ui/i18n";
import type { AccountCard } from "./cloudAccountCards";
import { loadCloudAccounts, saveCloudAccounts } from "./cloudAccountsStore";
import { readStoredProvider } from "./fileSyncAccess";
import { readSyncRootFolder } from "./syncRootFolder";
import { getPimCredentials } from "./pim/pimCredentials";
import { listPimCalendars, listPimTaskLists } from "./pim/pimService";

/**
 * What the phone's account page shows of one account besides its state (plan
 * "Verbinden", V2): who signs in where (section 3), one live line per service
 * (section 2). Nothing secret leaves here.
 */
export interface MobileAccountFacts {
  user?: string;
  server?: string;
  accessKeyId?: string;
  summaries: Partial<Record<CloudServiceId, string>>;
}

export async function readMobileAccountFacts(vaultId: string, card: AccountCard): Promise<MobileAccountFacts> {
  const facts: MobileAccountFacts = { summaries: {} };
  if (card.services.includes("files") && card.vaultId) {
    const stored = await readStoredProvider(card.vaultId);
    if (stored?.provider === "webdav") { facts.user = stored.creds.user; facts.server = stored.creds.url; }
    if (stored?.provider === "s3") { facts.accessKeyId = stored.creds.accessKeyId; facts.server = stored.creds.endpoint; }
    const folder = stored ? await readSyncRootFolder(card.vaultId, stored.provider, stored).catch(() => "") : "";
    facts.summaries.files = folder ? i18n.t("cloudAccounts.filesSummary", { folder }) : card.subtitle ?? i18n.t("connection.connected");
  }
  if (card.pimAccountId) {
    const creds = await getPimCredentials(vaultId, card.pimAccountId).catch(() => null);
    if (creds?.kind === "caldav") { facts.user ??= creds.user; facts.server ??= creds.url; }
    const [calendars, lists] = await Promise.all([listPimCalendars().catch(() => []), listPimTaskLists().catch(() => [])]);
    facts.summaries.calendar = i18n.t("cloudAccounts.calendarSummary", {
      calendars: calendars.filter((calendar) => calendar.accountId === card.pimAccountId && calendar.selected).length,
      lists: lists.filter((list) => list.accountId === card.pimAccountId && list.selected).length,
    });
  }
  if (card.mailAccountId) {
    const mailbox = (await listMailAccounts(vaultId).catch(() => [])).find((entry) => entry.id === card.mailAccountId);
    if (mailbox) {
      facts.summaries.mail = mailbox.user;
      if ((mailbox.kind ?? "imap") === "imap") { facts.user ??= mailbox.user; facts.server ??= `${mailbox.host}:${mailbox.port}`; }
    }
  }
  return facts;
}

/**
 * The registry record of a card - made when the card has none yet.
 *
 * A calendar or mailbox connected on the phone alone can be a card without a
 * record; the account page now acts on every card the same way (switch a
 * service off, check, sign out, remove), and those acts are written on the
 * record (plan "Verbinden", V2). Made once, from what the card shows.
 */
export async function ensureCardRecord(vaultId: string, card: AccountCard): Promise<CloudAccountRecord> {
  if (card.record) return card.record;
  const files = card.services.includes("files") && card.vaultId ? await filesProviderOf(card.vaultId) : null;
  const record: CloudAccountRecord = {
    id: crypto.randomUUID(),
    family: card.family,
    label: card.label,
    ...(card.verifiedProviderIdentity ? { verifiedProviderIdentity: card.verifiedProviderIdentity } : {}),
    services: {
      // The provider the vault really syncs through - never a guess (review finding 6).
      ...(files ? { files: { provider: files } } : {}),
      ...(card.pimAccountId ? { calendar: { pimAccountId: card.pimAccountId } } : {}),
      ...(card.mailAccountId ? { mail: { mailAccountId: card.mailAccountId } } : {}),
    },
  };
  await saveCloudAccounts(vaultId, [...(await loadCloudAccounts(vaultId)), record]);
  return record;
}

/** The vault's file provider: its slot's, else the registry's; null when neither says. */
async function filesProviderOf(vaultId: string): Promise<SyncProviderId | null> {
  const stored = (await readStoredProvider(vaultId).catch(() => null))?.provider;
  if (stored) return stored as SyncProviderId;
  const { getVaultEntry } = await import("./vaultRegistry");
  return ((await getVaultEntry(vaultId).catch(() => null))?.provider as SyncProviderId | undefined) ?? null;
}

/** A service switched on or off for the vault (E3); the binding and what it left in the vault stay. */
export async function setMobileServiceOff(vaultId: string, card: AccountCard, service: CloudServiceId, off: boolean): Promise<void> {
  const record = await ensureCardRecord(vaultId, card);
  await saveCloudAccounts(vaultId, (await loadCloudAccounts(vaultId)).map((entry) => (entry.id === record.id ? withServiceOff(entry, service, off) : entry)));
  // The last settings push before the file sync stops, so the other devices learn of it (review finding 4).
  if (service === "files" && off) {
    const { getActiveVaultEntry } = await import("./vaultRegistry");
    if ((await getActiveVaultEntry()).id === vaultId) await (await import("./syncService")).pushSettingsNow().catch(() => undefined);
  }
  const { applyMobileServiceSwitches } = await import("./serviceSwitches");
  await applyMobileServiceSwitches(vaultId);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("m-pim-changed"));
    window.dispatchEvent(new CustomEvent("m-vaults-changed"));
  }
}
