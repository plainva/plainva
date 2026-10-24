import type { CloudAccountRecord } from "./cloudAccounts";
import { hasStoredAccountGrant, sameOAuthClient, tokenCoversService, type StoredAccountToken } from "./tokenBroker";

export interface FileBrokerBinding {
  provider: "drive" | "onedrive";
  clientId: string;
  clientSecret?: string;
  accountId?: string;
}

export function fileBrokerMatches(record: CloudAccountRecord, binding: FileBrokerBinding): boolean {
  return record.family === (binding.provider === "drive" ? "google" : "microsoft")
    && record.services.files?.provider === binding.provider
    && (!binding.accountId || record.id === binding.accountId);
}

/** No first-card fallback: two usable accounts of the same client are ambiguous. */
export async function resolveFileBrokerAccount(
  records: readonly CloudAccountRecord[],
  binding: FileBrokerBinding,
  read: (id: string) => Promise<StoredAccountToken | null>,
): Promise<CloudAccountRecord | undefined> {
  const matches: CloudAccountRecord[] = [];
  for (const record of records) {
    if (!fileBrokerMatches(record, binding)) continue;
    const token = await read(record.id);
    // A grant through Android's system sheet has no refresh token; the broker
    // renews it there. Asking for a refresh token here left such a Drive vault
    // without access once its slot was handed to the card.
    if (hasStoredAccountGrant(token) && sameOAuthClient(token, binding)
      && tokenCoversService(token, "files", binding.provider === "drive" ? "google" : "microsoft")) matches.push(record);
  }
  return matches.length === 1 ? matches[0] : undefined;
}
