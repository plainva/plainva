import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { capacitorSettingsStore } from "./capacitorPlatform";

/**
 * Where the app keeps what it records about itself for the diagnostics - the
 * system's exits with their frames, the largest bridge messages (release list
 * F51): a place no backup takes along. The settings (Capacitor's Preferences)
 * are in the Android cloud backup and device transfer
 * (`data_extraction_rules.xml`) and in the iPhone's iCloud backup, so these
 * records do not live there. Android: `files/diagnostics/`, which the backup
 * rules (a list of what is included) leave out; iOS:
 * `Library/PlainvaDiagnostics`, which the app marks as excluded from backup
 * at every start (`ProcessExitPlugin.swift`). They leave the device only in the
 * export the person shares.
 */

function placeOf(name: string): { path: string; directory: Directory } {
  return Capacitor.getPlatform() === "ios"
    ? { path: `PlainvaDiagnostics/${name}.json`, directory: Directory.Library }
    : { path: `diagnostics/${name}.json`, directory: Directory.Data };
}

/**
 * A record, or `undefined` where there is none. A record an older version kept
 * in the settings under `legacyKey` moves here once and leaves the settings.
 */
export async function readDiagnosticsRecord<T>(name: string, legacyKey?: string): Promise<T | undefined> {
  try {
    const { data } = await Filesystem.readFile({ ...placeOf(name), encoding: Encoding.UTF8 });
    return JSON.parse(String(data)) as T;
  } catch {
    // No file yet: the settings may still hold what an older version kept there.
  }
  if (!legacyKey) return undefined;
  try {
    const legacy = await capacitorSettingsStore.get<T>(legacyKey);
    if (legacy === undefined || legacy === null) return undefined;
    await writeDiagnosticsRecord(name, legacy);
    await capacitorSettingsStore.delete(legacyKey);
    return legacy;
  } catch {
    return undefined;
  }
}

/** Replaces a record; a record that cannot be written is left out of the next export, never an error of its own. */
export async function writeDiagnosticsRecord(name: string, value: unknown): Promise<void> {
  await Filesystem.writeFile({ ...placeOf(name), data: JSON.stringify(value), encoding: Encoding.UTF8, recursive: true });
}
