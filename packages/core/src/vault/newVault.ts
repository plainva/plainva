import type { ISyncTarget } from "../sync/ISyncTarget.js";

/** A create-online flow must establish an empty destination before any local
 * template files can be queued. Opening a remote vault never uses this path. */
export async function assertEmptyRemoteVault(target: Pick<ISyncTarget, "pull">): Promise<void> {
  const inventory = await target.pull();
  if (!(inventory?.etagMap instanceof Map) || inventory.needsFullListing ||
    inventory.etagMap.size > 0 || (inventory.folders?.length ?? 0) > 0 || (inventory.deleted?.length ?? 0) > 0) {
    throw new Error("Vault templates require a new, empty cloud folder.");
  }
}
