import { loadMailAccountAliases } from "@plainva/ui/mail";
import { mailVaultId } from "./mailRuntime";

/**
 * Removed ids of folded mailboxes → the kept one, for the open vault (finding
 * 2026-11-06, M2). Never throws: without a vault or a store there is nothing
 * folded to resolve.
 */
export async function mobileMailAccountAliases(): Promise<Record<string, string>> {
  try {
    const vaultId = mailVaultId();
    return vaultId ? await loadMailAccountAliases(vaultId) : {};
  } catch {
    return {};
  }
}
