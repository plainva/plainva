import { assertConnectionIdentity, ServiceConnectionError, type CloudServiceId, type CloudAccountRecord, type SyncProviderId, type ServiceConnectionContext, type VerifiedProviderIdentity } from "@plainva/ui";
import type { AccountCard } from "./cloudAccountCards";
import { loadCloudAccounts, saveCloudAccounts } from "./cloudAccountsStore";
import { startConnectQueue } from "./connectQueue";
import { getActiveVaultEntry } from "./vaultRegistry";

/** A legacy derived card is made explicit using its subsystem bindings,
 * never by merging it with another card that happens to have the same label. */
export async function startAccountService(card: AccountCard, service: CloudServiceId): Promise<CloudServiceId | null> {
  const vault = await getActiveVaultEntry();
  if (card.recordVaultId && card.recordVaultId !== vault.id) throw new ServiceConnectionError("accountChanged");
  const records = await loadCloudAccounts(vault.id);
  let record = card.record ? records.find(r => r.id === card.record!.id) : undefined;
  if (!record) {
    const matches = records.filter(r => (card.pimAccountId && r.services.calendar?.pimAccountId === card.pimAccountId) || (card.mailAccountId && r.services.mail?.mailAccountId === card.mailAccountId));
    if (matches.length > 1) throw new ServiceConnectionError("accountChanged");
    record = matches[0];
  }
  if (!record) {
    record = { id: crypto.randomUUID(), family: card.family, label: card.label, ...(card.verifiedProviderIdentity ? { verifiedProviderIdentity: card.verifiedProviderIdentity } : {}), services: {
      ...(card.pimAccountId ? { calendar: { pimAccountId: card.pimAccountId } } : {}),
      ...(card.mailAccountId ? { mail: { mailAccountId: card.mailAccountId } } : {}),
      ...(card.services.includes("files") && vault.provider ? { files: { provider: vault.provider as SyncProviderId } } : {}),
    } };
    await saveCloudAccounts(vault.id, [...records, record]);
  }
  return startConnectQueue(card.family, [service], { vaultId: vault.id, cloudAccountId: record.id, expectedIdentity: record.verifiedProviderIdentity });
}

export async function bindMailToConnection(context: ServiceConnectionContext | undefined, bindingId: string, identity?: VerifiedProviderIdentity): Promise<void> {
  if (!context?.cloudAccountId) return;
  const records = await loadCloudAccounts(context.vaultId);
  const record = records.find(r => r.id === context.cloudAccountId);
  if (!record || (record.services.mail && record.services.mail.mailAccountId !== bindingId)) throw new ServiceConnectionError("accountChanged");
  if (identity) assertConnectionIdentity(record.verifiedProviderIdentity ?? context.expectedIdentity, identity);
  const next: CloudAccountRecord = { ...record, ...(identity ? { verifiedProviderIdentity: identity } : {}), services: { ...record.services, mail: { mailAccountId: bindingId } } };
  await saveCloudAccounts(context.vaultId, records.map(r => r.id === record.id ? next : r));
  if ((await loadCloudAccounts(context.vaultId)).find(r => r.id === record.id)?.services.mail?.mailAccountId !== bindingId) throw new ServiceConnectionError("storageFailed");
}
