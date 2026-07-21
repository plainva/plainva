/**
 * Sideband profile-sync step (settings-sync plan P1). Runs once per sync cycle,
 * OUTSIDE the file queue/reconcile/merge path: it downloads/uploads the small
 * `.plainva/sync/settings.json` directly through the sync target and reads/writes
 * the local copy through the worker's raw adapter (never the conflict-aware app
 * adapter — that would create sync_state rows and `.CONFLICT` copies of the
 * settings file). The shell provides a `ProfileSettingsPort` that maps the
 * logical values to and from its native settings store (re-keying).
 */
import type { IVaultAdapter } from "../vault/IVaultAdapter.js";
import type { ISyncTarget } from "../sync/ISyncTarget.js";
import { PROFILE_SYNC_PATH, parseProfile, reconcileProfile, serializeProfile } from "./profileFile.js";

/** Shell-implemented bridge between the profile document and the native store. */
export interface ProfileSettingsPort {
  /** Reads the syncable settings as logical name -> value. */
  exportValues(): Promise<Record<string, unknown>>;
  /** Writes imported values back into the native store and fires live-apply events. */
  applyValues(values: Record<string, unknown>): Promise<void>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface SettingsSyncStepOptions {
  port: ProfileSettingsPort;
  /** Stable per-device id (LWW tiebreak + adoption notice). */
  deviceId: string;
  /** Injectable clock (ISO). Default: now. */
  now?: () => string;
  /** Called when settings were adopted from another device. */
  onAdopted?: (fromDeviceId: string) => void;
}

/** Runs the profile-sync sideband against a target + raw vault adapter. */
export class SettingsSyncStep {
  constructor(private readonly options: SettingsSyncStepOptions) {}

  async run(target: ISyncTarget, vault: IVaultAdapter): Promise<void> {
    const current = await this.options.port.exportValues();

    const localText = (await vault.exists(PROFILE_SYNC_PATH)) ? await vault.readTextFile(PROFILE_SYNC_PATH) : null;
    const local = parseProfile(localText);

    const remoteBytes = await target.download(PROFILE_SYNC_PATH);
    const remote = parseProfile(remoteBytes ? decoder.decode(remoteBytes as BufferSource) : null);

    const decision = reconcileProfile({
      current,
      local,
      remote,
      deviceId: this.options.deviceId,
      now: (this.options.now ?? (() => new Date().toISOString()))(),
    });

    if (decision.applyToStore) await this.options.port.applyValues(decision.applyToStore);
    if (decision.writeLocal) await vault.writeTextFile(PROFILE_SYNC_PATH, serializeProfile(decision.writeLocal));
    if (decision.upload) {
      await target.push({
        id: 0,
        file_path: PROFILE_SYNC_PATH,
        operation: "write",
        content: encoder.encode(serializeProfile(decision.upload)),
        retry_count: 0,
        next_retry_at: 0,
        queued_at: 0,
      });
    }
    if (decision.adoptedFrom) this.options.onAdopted?.(decision.adoptedFrom);
  }
}
