import {
  PROFILE_SYNC_PATH,
  SettingsSyncStep,
  type ISyncTarget,
  type IVaultAdapter,
  type ProfileSettingsPort,
  type PullResult,
  type PushResult,
  type SettingsExchangeInfo,
  type SyncOperation,
} from "../../src/index.js";

/**
 * Shared, shell-neutral transport harness for profile convergence contracts.
 *
 * Desktop and mobile tests deliberately use this exact target implementation.
 * Counting fields exported by a port is not evidence of network activity; only
 * a write operation against the profile path increments `profileUploads`.
 */
export class CountingSyncTarget implements ISyncTarget {
  readonly remote = new Map<string, Uint8Array>();
  downloads = 0;
  successfulDownloads = 0;
  profileDownloads = 0;
  secretDownloads = 0;
  profileUploads = 0;
  secretUploads = 0;
  deletes = 0;

  async download(path: string): Promise<Uint8Array | null> {
    this.downloads += 1;
    const value = this.remote.get(path) ?? null;
    if (value) {
      this.successfulDownloads += 1;
      if (path === PROFILE_SYNC_PATH || path.endsWith("/settings.enc")) this.profileDownloads += 1;
      else if (path.endsWith("/secrets.enc")) this.secretDownloads += 1;
    }
    return value;
  }

  async push(operation: SyncOperation): Promise<PushResult | void> {
    if (operation.operation === "write" && operation.content) {
      this.remote.set(operation.file_path, operation.content);
      if (operation.file_path === PROFILE_SYNC_PATH || operation.file_path.endsWith("/settings.enc")) {
        this.profileUploads += 1;
      } else if (operation.file_path.endsWith("/secrets.enc")) {
        this.secretUploads += 1;
      }
      return;
    }
    if (operation.operation === "delete") {
      this.remote.delete(operation.file_path);
      this.deletes += 1;
    }
  }

  async pull(): Promise<PullResult> {
    return { etagMap: new Map() };
  }
}

/** Minimal raw vault required by the settings sideband. */
export class MemoryProfileVault {
  readonly text = new Map<string, string>();
  readonly binary = new Map<string, Uint8Array>();

  async exists(path: string): Promise<boolean> {
    return this.text.has(path) || this.binary.has(path);
  }

  async readTextFile(path: string): Promise<string> {
    const value = this.text.get(path);
    if (value === undefined) throw new Error(`missing fixture file: ${path}`);
    return value;
  }

  async writeTextFile(path: string, value: string): Promise<void> {
    this.text.set(path, value);
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    const value = this.binary.get(path);
    if (value === undefined) throw new Error(`missing fixture file: ${path}`);
    return value;
  }

  async writeBinaryFile(path: string, value: Uint8Array): Promise<void> {
    this.binary.set(path, value);
  }

  async deleteItem(path: string): Promise<void> {
    this.text.delete(path);
    this.binary.delete(path);
  }
}

export interface ProfileHarnessDevice {
  deviceId: string;
  port: ProfileSettingsPort;
  vault: MemoryProfileVault;
  exchanges: SettingsExchangeInfo[];
}

/** In-memory keychain edge with explicit write/removal counts. */
export class CountingSecretSlots {
  readonly values = new Map<string, unknown>();
  writes = 0;
  removals = 0;

  async read(slot: string): Promise<unknown> {
    return this.values.get(slot) ?? null;
  }

  async write(slot: string, value: unknown): Promise<void> {
    this.writes += 1;
    this.values.set(slot, value);
  }

  async remove(slot: string): Promise<void> {
    this.removals += 1;
    this.values.delete(slot);
  }
}

export function profileHarnessDevice(deviceId: string, port: ProfileSettingsPort): ProfileHarnessDevice {
  return { deviceId, port, vault: new MemoryProfileVault(), exchanges: [] };
}

/** Runs one real SettingsSyncStep cycle and returns actual upload deltas. */
export async function runProfileCycle(
  target: CountingSyncTarget,
  device: ProfileHarnessDevice,
  now = "2026-07-31T12:00:00.000Z",
): Promise<{ profileUploads: number; downloads: number }> {
  const beforeUploads = target.profileUploads;
  const beforeDownloads = target.downloads;
  await new SettingsSyncStep({
    port: device.port,
    deviceId: device.deviceId,
    now: () => now,
    onExchange: (exchange) => { device.exchanges.push(exchange); },
  }).run(target, device.vault as unknown as IVaultAdapter);
  return {
    profileUploads: target.profileUploads - beforeUploads,
    downloads: target.downloads - beforeDownloads,
  };
}
