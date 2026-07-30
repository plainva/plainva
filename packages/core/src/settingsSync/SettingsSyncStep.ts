/**
 * Sideband profile-sync step (settings-sync plan P1). Runs once per sync cycle,
 * OUTSIDE the file queue/reconcile/merge path: it downloads/uploads the small
 * `.plainva/sync/settings.json` directly through the sync target and reads/writes
 * the local copy through the worker's raw adapter (never the conflict-aware app
 * adapter — that would create sync_state rows and `.CONFLICT` copies of the
 * settings file). The shell provides a `ProfileSettingsPort` that maps the
 * logical values to and from its native settings store (re-keying).
 *
 * Since the bars plan (P6) the profile can be SPLIT: everything personal goes
 * into the signed-in member's own partition, everything vault-wide stays in the
 * shared file. Without a member id — one person, several devices — there is one
 * file and the behaviour is exactly as before.
 */
import type { IVaultAdapter } from "../vault/IVaultAdapter.js";
import type { ISyncTarget } from "../sync/ISyncTarget.js";
import {
  PROFILE_SYNC_PATH,
  filterEntries,
  entriesOf,
  parseProfile,
  preferNewerProfile,
  reconcileProfile,
  serializeProfile,
  type ProfileDoc,
} from "./profileFile.js";
import { SETTINGS_ENC_PATH, memberProfilePath } from "./paths.js";
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
  /**
   * The signed-in member of an encrypted workspace (bars plan P6). With it,
   * personal settings move into that member's own partition; without it there
   * is one shared file, which is right for one person on several devices.
   */
  memberId?: string;
  /**
   * Which logical fields are personal. Only consulted when a member id exists;
   * the core deliberately does not know the field names.
   */
  isMemberField?: (logical: string) => boolean;
  /**
   * Reports what a cycle actually exchanged. Without it a device cannot tell a
   * working sync from one that never ran — the three silent states (switch off,
   * vault locked, no cycle yet) look identical from the outside.
   */
  onExchange?: (info: SettingsExchangeInfo) => void;
}

/** What one settings-sync cycle moved. */
export interface SettingsExchangeInfo {
  /** Fields this device published. */
  exported: number;
  /** Fields written back into the local store (0 = nothing changed). */
  imported: number;
  /** The device the adopted values came from, when the document named one. */
  peerDeviceId?: string;
  /** The logical names behind `exported`. */
  exportedNames: string[];
  /**
   * The fields that actually DIFFERED from what this device published — the
   * reason an apply happened at all. A count cannot distinguish "settings
   * arrived" from "this device keeps re-publishing the same value"; a name can.
   */
  changedNames: string[];
}

interface PartitionResult {
  /** The complete desired state of THIS partition after reconciling. */
  desired: Record<string, unknown>;
  adoptedFrom?: string;
}

/** Runs the profile-sync sideband against a target + raw vault adapter. */
export class SettingsSyncStep {
  constructor(private readonly options: SettingsSyncStepOptions) {}

  private get sealed(): boolean {
    return !!this.options.profileCrypto;
  }

  /** The shared file — vault-wide conventions (and everything, without a member). */
  private get path(): string {
    return this.sealed ? SETTINGS_ENC_PATH : PROFILE_SYNC_PATH;
  }

  /** Active only while a member is signed in to an encrypted workspace. */
  private get memberPath(): string | null {
    const id = this.options.memberId;
    return id ? memberProfilePath(id, this.sealed) : null;
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
    const memberPath = this.memberPath;
    const isMember = this.options.isMemberField ?? (() => false);
    const current = await this.options.port.exportValues();

    // Without a member partition every field belongs to the shared file, which
    // is the single-person case and byte-for-byte the previous behaviour.
    const belongsToMember = memberPath ? isMember : () => false;
    const sharedValues: Record<string, unknown> = {};
    const memberValues: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(current)) {
      if (belongsToMember(key)) memberValues[key] = value;
      else sharedValues[key] = value;
    }

    const results: PartitionResult[] = [];
    results.push(
      await this.runPartition(target, vault, this.path, sharedValues, {
        // A shared file written before the split still carries personal fields.
        // They are filtered out rather than tombstoned: a tombstone would tell
        // the OTHER members to drop their own value, and the field has simply
        // moved house.
        keep: (logical) => !belongsToMember(logical),
        cleanupPlaintext: true,
      }),
    );
    if (memberPath) {
      results.push(
        await this.runPartition(target, vault, memberPath, memberValues, {
          keep: belongsToMember,
          cleanupPlaintext: false,
        }),
      );
    }

    // ONE apply call for both partitions. An absent key means "reset to the
    // default", so each partition reports its COMPLETE desired state and the
    // union is what the store should hold — applying them one after the other
    // would have each partition wipe the other's settings.
    const desired: Record<string, unknown> = {};
    for (const r of results) Object.assign(desired, r.desired);
    // Named, not counted: which fields differ is the difference between "the
    // sync works" and "this device re-publishes the same value every cycle".
    const changedNames = Object.keys(desired)
      .filter((k) => !(k in current) || JSON.stringify(desired[k]) !== JSON.stringify(current[k]))
      .concat(Object.keys(current).filter((k) => !(k in desired)))
      .sort();
    const changed = changedNames.length > 0;
    if (changed) await this.options.port.applyValues(desired);

    const adopted = results.find((r) => r.adoptedFrom);
    if (adopted?.adoptedFrom) this.options.onAdopted?.(adopted.adoptedFrom);
    this.options.onExchange?.({
      exported: Object.keys(current).length,
      imported: changed ? Object.keys(desired).length : 0,
      ...(adopted?.adoptedFrom ? { peerDeviceId: adopted.adoptedFrom } : {}),
      exportedNames: Object.keys(current).sort(),
      changedNames,
    });
  }

  /** One document: read local + remote, reconcile, write back. */
  private async runPartition(
    target: ISyncTarget,
    vault: IVaultAdapter,
    path: string,
    current: Record<string, unknown>,
    opts: { keep: (logical: string) => boolean; cleanupPlaintext: boolean },
  ): Promise<PartitionResult> {
    const sealed = this.sealed;

    // Local copy: sealed mode reads the ciphertext bytes; plaintext mode reads text.
    let localText: string | null = null;
    if (await vault.exists(path)) {
      localText = sealed ? this.readProfileText(await vault.readBinaryFile(path)) : await vault.readTextFile(path);
    }
    const local = this.scoped(parseProfile(localText), opts.keep);
    if (localText && !local) {
      throw new FatalSyncProtocolError("manifest-invalid", `local settings profile ${path} is malformed`);
    }

    const remoteBytes = await target.download(path);
    const remoteText = this.readProfileText(remoteBytes);
    const parsedRemote = parseProfile(remoteText);
    if (remoteText && !parsedRemote) {
      throw new FatalSyncProtocolError("manifest-invalid", `remote settings profile ${path} is malformed`);
    }
    let remote = this.scoped(parsedRemote, opts.keep);
    // A file written before the split still lists fields that now live in the
    // other partition. They are ignored above; here we note it so the file is
    // rewritten without them — otherwise one member's personal settings would
    // sit in the shared file forever, readable and misleading.
    const remoteCarriesForeignFields = !!parsedRemote && remote !== parsedRemote;

    // A leftover PLAINTEXT profile beside the sealed one is a second, competing
    // truth: a device that cannot seal (locked, no passphrase here) keeps writing
    // it, while a sealed device never reads it. Reported 2026-07-27 with both
    // files sitting side by side for two days — the PLAINTEXT one newer.
    //
    // So it is read as a candidate rather than ignored (deleting it unread would
    // discard whatever that device wrote), and removed further down once its
    // content is safely inside the sealed file.
    let stalePlaintext: ProfileDoc | null = null;
    if (sealed && opts.cleanupPlaintext) {
      const legacyBytes = await target.download(PROFILE_SYNC_PATH);
      stalePlaintext = this.scoped(parseProfile(legacyBytes ? decoder.decode(legacyBytes as BufferSource) : null), opts.keep);
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

    if (decision.writeLocal) {
      const text = serializeProfile(decision.writeLocal);
      if (sealed) await vault.writeBinaryFile(path, this.encodeProfile(text));
      else await vault.writeTextFile(path, text);
    }
    // An adopted plaintext state must reach the SEALED file before the plaintext
    // copy is removed below — otherwise deleting it would drop the newer state.
    const upload =
      decision.upload
      ?? ((plaintextWon || remoteCarriesForeignFields) ? (decision.writeLocal ?? remote ?? undefined) : undefined);
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
    if (sealed && opts.cleanupPlaintext && stalePlaintext) await this.dropStalePlaintext(target, vault);
    return { desired: decision.applyToStore ?? current, adoptedFrom: decision.adoptedFrom };
  }

  /**
   * Narrows a document to the fields this partition owns. A shared file written
   * before the split still lists personal fields; ignoring them here is what
   * lets them move into the member partition without a migration pass.
   */
  private scoped(doc: ProfileDoc | null, keep: (logical: string) => boolean): ProfileDoc | null {
    if (!doc) return null;
    const entries = filterEntries(entriesOf(doc), keep);
    if (Object.keys(entries).length === Object.keys(entriesOf(doc)).length) return doc;
    const values: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(entries)) if (!entry.deleted) values[key] = entry.value;
    return { ...doc, values, entries };
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
