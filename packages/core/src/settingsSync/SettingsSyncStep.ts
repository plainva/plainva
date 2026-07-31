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
  entriesOf,
  filterEntries,
  hasCurrentProfileCapabilities,
  parseProfile,
  preferNewerProfile,
  reconcileProfile,
  serializeProfile,
  stableStringify,
  valuesOf,
  withCurrentProfileCapabilities,
  type ProfileDoc,
  type ProfileEntry,
} from "./profileFile.js";
import { SETTINGS_ENC_PATH, memberProfilePath } from "./paths.js";
import { FatalSyncProtocolError } from "./errors.js";

/** Shell-implemented bridge between the profile document and the native store. */
export interface ProfileSettingsPort {
  /** Reads the syncable settings as logical name -> value. */
  exportValues(): Promise<Record<string, unknown>>;
  /** Writes imported values back into the native store and fires live-apply events. */
  applyValues(values: Record<string, unknown>): Promise<void>;
  /**
   * Optional shell-owned domain canonicalizer. The core invokes the same
   * function for live, local and remote values before comparing them, so a
   * legacy list order cannot look like a new edit before the import side has a
   * chance to normalize it.
   */
  normalizeValues?(values: Record<string, unknown>): Record<string, unknown>;
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
  /**
   * Called when settings were adopted from another device. The changed field
   * names come along so a shell can decide whether the arrival is worth an
   * interruption — see `shouldAnnounceProfileImport`.
   */
  onAdopted?: (fromDeviceId: string, changedNames: readonly string[]) => void;
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
  onExchange?: (info: SettingsExchangeInfo) => void | Promise<void>;
  /**
   * Reports a profile written before the canonical account projection. The
   * payload is redacted: no values or field names leave the profile step.
   */
  onLegacyProfile?: (info: LegacyProfileInfo) => void;
}

export interface LegacyProfileInfo {
  source: "local" | "remote" | "stale-plaintext";
  capabilityVersion: number | null;
}

/** What one successfully completed settings-sync cycle actually did. */
export interface SettingsExchangeInfo {
  /** Local projection examined during the cycle. This is explicitly not a send. */
  checked: ProfileExchangeFields;
  /** Remote profile document actually downloaded, when one existed. */
  downloaded?: ProfileExchangeFields;
  /** Fields that actually changed in the shell-owned local store. */
  applied?: ProfileExchangeFields;
  /** Profile document successfully written through `target.push`. */
  uploaded?: ProfileExchangeFields;
}

export interface ProfileExchangeFields {
  fields: number;
  names: string[];
  /** Present only when one unambiguous source device supplied the event. */
  deviceId?: string;
}

interface PartitionResult {
  /** The complete desired state of THIS partition after reconciling. */
  desired: Record<string, unknown>;
  adoptedFrom?: string;
  downloaded?: ProfileExchangeFields;
  uploaded?: ProfileExchangeFields;
}

/** Runs the profile-sync sideband against a target + raw vault adapter. */
export class SettingsSyncStep {
  private readonly reportedLegacyProfiles = new Set<string>();

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
    const current = this.normalizeValues(await this.options.port.exportValues());

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
      .filter((k) => !(k in current) || stableStringify(desired[k]) !== stableStringify(current[k]))
      .concat(Object.keys(current).filter((k) => !(k in desired)))
      .sort();
    const changed = changedNames.length > 0;
    if (changed) await this.options.port.applyValues(desired);

    const adopted = results.find((r) => r.adoptedFrom);
    if (adopted?.adoptedFrom) this.options.onAdopted?.(adopted.adoptedFrom, changedNames);
    const downloaded = this.combinePartitionEvents(results.map((result) => result.downloaded));
    const uploaded = this.combinePartitionEvents(results.map((result) => result.uploaded));
    await this.options.onExchange?.({
      checked: {
        fields: Object.keys(current).length,
        names: Object.keys(current).sort(),
      },
      ...(downloaded ? { downloaded } : {}),
      ...(changed
        ? {
            applied: {
              fields: changedNames.length,
              names: changedNames,
              ...(adopted?.adoptedFrom ? { deviceId: adopted.adoptedFrom } : {}),
            },
          }
        : {}),
      ...(uploaded ? { uploaded } : {}),
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
    const parsedLocal = parseProfile(localText);
    const localNeedsCapability = !!parsedLocal && !hasCurrentProfileCapabilities(parsedLocal);
    if (localNeedsCapability) this.reportLegacyProfile(path, "local", parsedLocal);
    const scopedLocal = this.scoped(parsedLocal, opts.keep);
    const local = this.normalizeProfile(scopedLocal);
    if (localText && !parsedLocal) {
      throw new FatalSyncProtocolError("manifest-invalid", `local settings profile ${path} is malformed`);
    }

    const remoteBytes = await target.download(path);
    const remoteText = this.readProfileText(remoteBytes);
    const parsedRemote = parseProfile(remoteText);
    if (remoteText && !parsedRemote) {
      throw new FatalSyncProtocolError("manifest-invalid", `remote settings profile ${path} is malformed`);
    }
    const remoteNeedsCapability = !!parsedRemote && !hasCurrentProfileCapabilities(parsedRemote);
    if (remoteNeedsCapability) this.reportLegacyProfile(path, "remote", parsedRemote);
    const scopedRemote = this.scoped(parsedRemote, opts.keep);
    const downloadedNames = new Set(scopedRemote ? Object.keys(entriesOf(scopedRemote)) : []);
    const downloadedDevices = new Set(parsedRemote?.deviceId ? [parsedRemote.deviceId] : []);
    // A file written before the split still lists fields that now live in the
    // other partition. They are ignored above; here we note it so the file is
    // rewritten without them — otherwise one member's personal settings would
    // sit in the shared file forever, readable and misleading.
    const remoteCarriesForeignFields = !!parsedRemote && scopedRemote !== parsedRemote;
    let remote = this.normalizeProfile(scopedRemote);

    // A leftover PLAINTEXT profile beside the sealed one is a second, competing
    // truth: a device that cannot seal (locked, no passphrase here) keeps writing
    // it, while a sealed device never reads it. Reported 2026-07-27 with both
    // files sitting side by side for two days — the PLAINTEXT one newer.
    //
    // So it is read as a candidate rather than ignored (deleting it unread would
    // discard whatever that device wrote), and removed further down once its
    // content is safely inside the sealed file.
    let stalePlaintext: ProfileDoc | null = null;
    let stalePlaintextNeedsCapability = false;
    if (sealed && opts.cleanupPlaintext) {
      const legacyBytes = await target.download(PROFILE_SYNC_PATH);
      const parsedPlaintext = parseProfile(legacyBytes ? decoder.decode(legacyBytes as BufferSource) : null);
      stalePlaintextNeedsCapability = !!parsedPlaintext && !hasCurrentProfileCapabilities(parsedPlaintext);
      if (stalePlaintextNeedsCapability && parsedPlaintext) {
        this.reportLegacyProfile(PROFILE_SYNC_PATH, "stale-plaintext", parsedPlaintext);
      }
      stalePlaintext = this.normalizeProfile(this.scoped(parsedPlaintext, opts.keep));
      if (stalePlaintext) {
        for (const name of Object.keys(entriesOf(stalePlaintext))) downloadedNames.add(name);
        if (parsedPlaintext?.deviceId) downloadedDevices.add(parsedPlaintext.deviceId);
        remote = preferNewerProfile(remote, stalePlaintext);
      }
    }
    const plaintextWon = !!stalePlaintext && remote === stalePlaintext;

    const decision = reconcileProfile({
      current,
      local,
      remote,
      deviceId: this.options.deviceId,
      now: (this.options.now ?? (() => new Date().toISOString()))(),
    });

    const localWriteBase =
      decision.writeLocal
      ?? (localNeedsCapability ? (local ?? undefined) : undefined);
    const localWrite = localWriteBase ? withCurrentProfileCapabilities(localWriteBase) : undefined;
    if (localWrite) {
      const text = serializeProfile(localWrite);
      if (sealed) await vault.writeBinaryFile(path, this.encodeProfile(text));
      else await vault.writeTextFile(path, text);
    }
    // An adopted plaintext state must reach the SEALED file before the plaintext
    // copy is removed below — otherwise deleting it would drop the newer state.
    const forcedUpload =
      plaintextWon
      || remoteCarriesForeignFields
      || remoteNeedsCapability
      || (stalePlaintextNeedsCapability && plaintextWon);
    const uploadBase =
      decision.upload
      ?? (forcedUpload ? (decision.writeLocal ?? localWrite ?? local ?? remote ?? undefined) : undefined);
    const upload = uploadBase ? withCurrentProfileCapabilities(uploadBase) : undefined;
    let uploaded: ProfileExchangeFields | undefined;
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
      const names = Object.keys(entriesOf(upload)).sort();
      uploaded = { fields: names.length, names };
    }
    // Cleanup runs whenever a plaintext copy is present — not only on an upload
    // cycle. Tying it to `decision.upload` meant a converged pair of files was
    // never cleaned up, which is exactly how the split survived for days.
    if (sealed && opts.cleanupPlaintext && stalePlaintext) await this.dropStalePlaintext(target, vault);
    const downloaded = downloadedNames.size > 0 || parsedRemote || stalePlaintext
      ? {
          fields: downloadedNames.size,
          names: [...downloadedNames].sort(),
          ...(downloadedDevices.size === 1 ? { deviceId: [...downloadedDevices][0] } : {}),
        }
      : undefined;
    return {
      desired: decision.applyToStore ?? current,
      adoptedFrom: decision.adoptedFrom,
      ...(downloaded ? { downloaded } : {}),
      ...(uploaded ? { uploaded } : {}),
    };
  }

  /** Combines shared/member partition facts without double-counting field names. */
  private combinePartitionEvents(events: Array<ProfileExchangeFields | undefined>): ProfileExchangeFields | undefined {
    const present = events.filter((event): event is ProfileExchangeFields => !!event);
    if (present.length === 0) return undefined;
    const names = [...new Set(present.flatMap((event) => event.names))].sort();
    const devices = [...new Set(present.flatMap((event) => event.deviceId ? [event.deviceId] : []))];
    return {
      fields: names.length,
      names,
      ...(devices.length === 1 ? { deviceId: devices[0] } : {}),
    };
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

  private normalizeValues(values: Record<string, unknown>): Record<string, unknown> {
    return this.options.port.normalizeValues?.(values) ?? values;
  }

  private reportLegacyProfile(path: string, source: LegacyProfileInfo["source"], doc: ProfileDoc): void {
    const key = `${source}:${path}`;
    if (this.reportedLegacyProfiles.has(key)) return;
    this.reportedLegacyProfiles.add(key);
    this.options.onLegacyProfile?.({
      source,
      capabilityVersion: doc.capabilities?.version ?? null,
    });
  }

  /**
   * Applies the shell's domain normalization without inventing a new edit.
   * Existing field stamps survive; a value that canonicalizes to absence
   * becomes an equally stamped tombstone. This lets legacy documents compare
   * by meaning while the next real edit naturally writes the canonical shape.
   */
  private normalizeProfile(doc: ProfileDoc | null): ProfileDoc | null {
    if (!doc || !this.options.port.normalizeValues) return doc;
    const source = entriesOf(doc);
    const normalizedValues = this.normalizeValues(valuesOf(source));
    const entries: Record<string, ProfileEntry> = {};
    for (const [key, entry] of Object.entries(source)) {
      if (entry.deleted) {
        entries[key] = entry;
      } else if (Object.prototype.hasOwnProperty.call(normalizedValues, key)) {
        entries[key] = { ...entry, value: normalizedValues[key] };
      } else {
        const { value: _value, ...stamp } = entry;
        entries[key] = { ...stamp, deleted: true };
      }
    }
    for (const [key, value] of Object.entries(normalizedValues)) {
      if (key in entries) continue;
      entries[key] = {
        value,
        rev: doc.rev,
        updatedAt: doc.updatedAt,
        deviceId: doc.deviceId,
      };
    }
    return { ...doc, version: 2, values: valuesOf(entries), entries };
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
