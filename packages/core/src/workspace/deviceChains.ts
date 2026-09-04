/**
 * Per-device operation chains (finding 2026-09-03: a cascade is a cascade).
 *
 * Every device numbers its operations 1, 2, 3, … and names its predecessor's
 * hash. One gap - a missing number, a predecessor that is not the one on
 * record - invalidates everything the device wrote after it, because nothing
 * behind the gap can be trusted to stand on what it claims to stand on. The
 * worker quarantined all of them with the same sentence, so twelve identical
 * rows told the reader nothing about the ONE thing that went wrong.
 *
 * This keeps the rule and changes the record: the first broken operation
 * carries the gap (what was expected, what was found), every later one says
 * it is blocked behind that gap and points at its entry. A screen can then
 * show one group with a count, and a retry that closes the gap frees the
 * rest on the same pull.
 */
export interface DeviceChainItem {
  document: { payload: { deviceId: string; sequence: number; previousDeviceOperationHash: string | null } };
  hash: string;
  key: string;
}

/** What this device already holds of one device's chain, or null when nothing. */
export interface DeviceChainAnchor {
  sequence: number;
  operationHash: string;
}

export const CHAIN_GAP_MESSAGE = "device operation chain has a gap or predecessor mismatch";
export const CHAIN_BLOCKED_MESSAGE = "device operation chain is blocked behind an earlier gap";

export interface BrokenChainItem<T> {
  item: T;
  reason: string;
  details: Record<string, unknown>;
}

export function splitDeviceChains<T extends DeviceChainItem>(
  operations: T[],
  naming: {
    deviceName(deviceId: string): string | null;
    quarantineId(item: T): string;
    /**
     * The last operation of that device this workspace already holds (finding
     * 2026-09-04).
     *
     * The rule used to be "the listing starts at sequence 1 with an empty
     * predecessor" - which is only true for a device that never synced and for
     * a listing that still holds every operation ever written. Neither is
     * general: anything dropped earlier in the same pull, pruned, or simply not
     * uploaded yet turned into a PERMANENT gap that no retry could close. The
     * chain is now anchored where this device actually stands, and what lies at
     * or below that anchor is known, not missing.
     */
    knownHead?(deviceId: string): DeviceChainAnchor | null;
  },
): { valid: T[]; broken: BrokenChainItem<T>[] } {
  const byDevice = new Map<string, T[]>();
  for (const operation of operations) {
    const items = byDevice.get(operation.document.payload.deviceId) ?? [];
    items.push(operation);
    byDevice.set(operation.document.payload.deviceId, items);
  }
  const valid: T[] = [];
  const broken: BrokenChainItem<T>[] = [];
  for (const [deviceId, items] of byDevice) {
    items.sort((left, right) => left.document.payload.sequence - right.document.payload.sequence);
    const deviceName = naming.deviceName(deviceId);
    const anchor = naming.knownHead?.(deviceId) ?? null;
    // Where the chain continues: behind what we hold, or at one with no
    // predecessor when we hold nothing of this device.
    let expectedSequence = anchor ? anchor.sequence + 1 : 1;
    let expectedHash: string | null = anchor ? anchor.operationHash : null;
    let gapId: string | null = null;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      // At or below the anchor: this workspace has been here. Re-judging it
      // would quarantine its own history on every pull.
      if (anchor && item.document.payload.sequence <= anchor.sequence) continue;
      if (gapId !== null) {
        broken.push({ item, reason: CHAIN_BLOCKED_MESSAGE, details: { deviceId, deviceName, sequence: item.document.payload.sequence, blockedBy: gapId } });
        continue;
      }
      if (item.document.payload.sequence !== expectedSequence || item.document.payload.previousDeviceOperationHash !== expectedHash) {
        gapId = naming.quarantineId(item);
        broken.push({
          item,
          reason: CHAIN_GAP_MESSAGE,
          details: { deviceId, deviceName, expectedSequence, foundSequence: item.document.payload.sequence, predecessorMatches: item.document.payload.previousDeviceOperationHash === expectedHash },
        });
        continue;
      }
      valid.push(item);
      expectedHash = item.hash;
      expectedSequence += 1;
    }
  }
  return { valid, broken };
}
