import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { QueueLedgerStore } from "@plainva/core";
import { atomicWriteText } from "../platform/atomicFile";
import { removeDataFile, stillInData } from "../platform/dataFiles";

/**
 * Where the phone keeps a vault's queue ledger (`QueueLedger`, stability plan
 * R5): the sync entries of the changes made while the vault's database did
 * not open. Beside the drafts and the journals, outside every vault container
 * — it is this device's record, never part of the vault — and written through
 * `atomicWriteText`, so a process that dies mid-write leaves the old ledger or
 * the new one, never half of one.
 */
export const queueLedgerPath = (vaultId: string) => `queue-ledger/${vaultId}.json`;

export function queueLedgerStore(vaultId: string): QueueLedgerStore {
  const path = queueLedgerPath(vaultId);
  return {
    async load() {
      try {
        const read = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 });
        return typeof read.data === "string" ? read.data : await read.data.text();
      } catch (error) {
        // No ledger is the usual case; one that is there and cannot be read is a failure.
        if (await stillInData(path)) throw error;
        return null;
      }
    },
    save: (text) => atomicWriteText(path, text),
    clear: () => removeDataFile(path),
  };
}
