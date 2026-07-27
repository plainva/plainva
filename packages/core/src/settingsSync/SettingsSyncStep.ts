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
import {
  PROFILE_SYNC_PATH,
  parseProfile,
  preferNewerProfile,
  reconcileProfile,
  serializeProfile,
  type ProfileDoc,
} from "./profileFile.js";
import { SETTINGS_ENC_PATH } from "./paths.js";
import { FatalSyncProtocolError } from "./errors.js";

/** Shell-implemented bridge between the profile document and the native store. */
export interface ProfileSettingsPort {
  /** Reads the syncable settings as logical name -> value. */
  exportValues(): Promise<Record<string, unknown>>;
  /** Writes imported values back into the native store and fires live-apply events. */
  applyValues(values: Record<string, unknown>): Promise<void>;
}

/**
 * Sealed-profile crypto, injected by the shell once a master key exists (E3
 * hybrid). Keeps the core crypto-agnostic in signature: `seal` produces the
 * `settings.enc` bytes (a PVE1 blob under K_settings), `open` reverses it.
 */
export interface ProfileCrypto {
  seal(plaintext: Uint8Array): Uint8Array;
  open(bytes: Uint8Array): Uint8Array;
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
  /**
   * When present, the profile is sealed as `settings.enc` (K_settings) instead
   * of plaintext `settings.json`. A one-time upload-verify-delete of the stale
   * plaintext variant runs on the first sealed cycle (E3: never two active
   * truths). Absent = plaintext mode (unchanged P1 behavior).
   */
  profileCrypto?: ProfileCrypto;
}

/** Runs the profile-sync sideband against a target + raw vault adapter. */
export class SettingsSyncStep {
  constructor(private readonly options: SettingsSyncStepOptions) {}

  private get path(): string {
    return this.options.profileCrypto ? SETTINGS_ENC_PATH : PROFILE_SYNC_PATH;
  }

  private readProfileText(bytes: Uint8Array | null): string | null {
    if (!bytes) return null;
    if (this.options.profileCrypto) {
      try {
        return decoder.decode(this.options.profileCrypto.open(bytes) as BufferSource);
      } catch (error) {
        throw new FatalSyncProtocolError(
          "key-mismatch",
          `sealed settings profile cannot be opened: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
    }
    return decoder.decode(bytes as BufferSource);
  }

  private encodeProfile(text: string): Uint8Array {
    const plain = encoder.encode(text);
    return this.options.profileCrypto ? this.options.profileCrypto.seal(plain) : plain;
  }

  async run(target: ISyncTarget, vault: IVaultAdapter): Promise<void> {
    const path = this.path;
    const sealed = !!this.options.profileCrypto;
    const current = await this.options.port.exportValues();

    // Local copy: sealed mode reads the ciphertext bytes; plaintext mode reads text.
    let localText: string | null = null;
    if (await vault.exists(path)) {
      localText = sealed ? this.readProfileText(await vault.readBinaryFile(path)) : await vault.readTextFile(path);
    }
    const local = parseProfile(localText);
    if (localText && !local) {
      throw new FatalSyncProtocolError("manifest-invalid", `local settings profile ${path} is malformed`);
    }

    const remoteBytes = await target.download(path);
    const remoteText = this.readProfileText(remoteBytes);
    let remote = parseProfile(remoteText);
    if (remoteText && !remote) {
      throw new FatalSyncProtocolError("manifest-invalid", `remote settings profile ${path} is malformed`);
    }

    // A leftover PLAINTEXT profile beside the sealed one is a second, competing
    // truth: a device that cannot seal (locked, no passphrase here) keeps writing
    // it, while a sealed device never reads it. Reported 2026-07-27 with both
    // files sitting side by side for two days — the PLAINTEXT one newer.
    //
    // So it is read as a candidate rather than ignored (deleting it unread would
    // discard whatever that device wrote), and removed further down once its
    // content is safely inside the sealed file.
    let stalePlaintext: ProfileDoc | null = null;
    if (sealed) {
      const legacyBytes = await target.download(PROFILE_SYNC_PATH);
      stalePlaintext = parseProfile(legacyBytes ? decoder.decode(legacyBytes as BufferSource) : null);
      if (stalePlaintext) remote = preferNewerProfile(remote, stalePlaintext);
    }
    const plaintextWon = !!stalePlaintext && remote === stalePlaintext;

    const decision = reconcileProfile({
      current,
      local,
      remote,
      deviceId: this.options.deviceId,
      now: (this.options.now ?? (() => new Date().toISOString()))(),
    });

    if (decision.applyToStore) await this.options.port.applyValues(decision.applyToStore);
    if (decision.writeLocal) {
      const text = serializeProfile(decision.writeLocal);
      if (sealed) await vault.writeBinaryFile(path, this.encodeProfile(text));
      else await vault.writeTextFile(path, text);
    }
    // An adopted plaintext state must reach the SEALED file before the plaintext
    // copy is removed below — otherwise deleting it would drop the newer state.
    const upload = decision.upload ?? (plaintextWon ? (decision.writeLocal ?? remote ?? undefined) : undefined);
    if (upload) {
      await target.push({
        id: 0,
        file_path: path,
        operation: "write",
        content: this.encodeProfile(serializeProfile(upload)),
        retry_count: 0,
        next_retry_at: 0,
        queued_at: 0,
      });
    }
    // Cleanup runs whenever a plaintext copy is present — not only on an upload
    // cycle. Tying it to `decision.upload` meant a converged pair of files was
    // never cleaned up, which is exactly how the split survived for days.
    if (sealed && stalePlaintext) await this.dropStalePlaintext(target, vault);
    if (decision.adoptedFrom) this.options.onAdopted?.(decision.adoptedFrom);
  }

  /** Best-effort removal of a leftover plaintext `settings.json` after going sealed. */
  private async dropStalePlaintext(target: ISyncTarget, vault: IVaultAdapter): Promise<void> {
    try {
      if (await vault.exists(PROFILE_SYNC_PATH)) await vault.deleteItem(PROFILE_SYNC_PATH);
      await target.push({
        id: 0,
        file_path: PROFILE_SYNC_PATH,
        operation: "delete",
        retry_count: 0,
        next_retry_at: 0,
        queued_at: 0,
      });
    } catch {
      // A leftover plaintext copy is a hygiene warning, not a failure.
    }
  }
}
