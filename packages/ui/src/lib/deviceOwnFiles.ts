/**
 * The app's files of ONE device under `.plainva/` (decision E7 of the bug
 * clearing plan 2026-10-30, Sammelplan § 3.127 Nr. 3).
 *
 * `.plainva/` never travels with Plainva's own sync, so the pins of the map and
 * the recently opened notes were always meant to be a device's own. A vault
 * folder that a file service carries (Dropbox, iCloud Drive, a network share)
 * carries `.plainva/` along anyway, and then several devices wrote ONE
 * `recents.json` and ONE `graph.json`: whoever wrote last had the file, and the
 * other device's pins and entries were gone. Each device now writes its own
 * file, named by the device id the sync sidebands already use
 * (`recents.<device>.json`, `graph.<device>.json`), and reads only that one.
 *
 * Nothing of what a vault has is lost on the way: a device that has no file
 * of its own yet starts from the shared file of older versions — every device
 * does, so every device keeps what it showed before. The shared file itself is
 * never written and never deleted here: an older Plainva on another device
 * still reads and writes it, and keeps working with it.
 */

import type { IVaultAdapter } from "@plainva/core";
import { getPlatformServices, hasPlatformServices } from "../platform/services";

/** The app's per-device files: their shared name of older versions is `.plainva/<kind>.json`. */
export type DeviceOwnFileKind = "recents" | "graph";

/** The one file all devices shared before (and an older version still writes). */
export function sharedDeviceFilePath(kind: DeviceOwnFileKind): string {
  return `.plainva/${kind}.json`;
}

/** A device id as a file-name part: the same rule as the comment files of a device. */
function safeDeviceName(deviceId: string): string {
  return deviceId.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** This device's own file of `kind`. */
export function deviceOwnFilePath(kind: DeviceOwnFileKind, deviceId: string): string {
  return `.plainva/${kind}.${safeDeviceName(deviceId)}.json`;
}

/**
 * Where this device keeps its `kind`: its own file — or, in a host that has no
 * device at all (a test, a tool), the shared file of older versions.
 */
export async function ownDeviceFilePath(kind: DeviceOwnFileKind): Promise<string> {
  const source = hasPlatformServices() ? getPlatformServices().deviceId : undefined;
  if (!source) return sharedDeviceFilePath(kind);
  const id = (await source()).trim();
  return id ? deviceOwnFilePath(kind, id) : sharedDeviceFilePath(kind);
}

/**
 * The text this device starts from: its own file, or — where it has none yet —
 * the shared file the vault had before. Throws when neither is there (the
 * caller's "nothing yet"), and when its own file is there but cannot be read:
 * an own file that exists is never replaced by the shared one.
 */
export async function readDeviceOwnText(
  adapter: Pick<IVaultAdapter, "readTextFile" | "exists">,
  kind: DeviceOwnFileKind,
  ownPath?: string,
): Promise<{ text: string; from: "own" | "shared" }> {
  const own = ownPath ?? (await ownDeviceFilePath(kind));
  const shared = sharedDeviceFilePath(kind);
  if (own !== shared) {
    try {
      return { text: await adapter.readTextFile(own), from: "own" };
    } catch (error) {
      // Only an own file that is NOT there falls back; one that is there and
      // cannot be read is the caller's problem, not a reason to start over.
      let there = true;
      try {
        there = await adapter.exists(own);
      } catch {
        /* cannot tell — treat as there */
      }
      if (there) throw error;
    }
  }
  return { text: await adapter.readTextFile(shared), from: "shared" };
}

/** Runs `work` after every earlier change of the same file has landed (one process). */
const lanes = new Map<string, Promise<unknown>>();
const laneIds = new WeakMap<object, number>();
let nextLaneId = 0;
export function onDeviceFileLane<T>(adapter: object, path: string, work: () => Promise<T>): Promise<T> {
  let id = laneIds.get(adapter);
  if (id === undefined) {
    id = nextLaneId++;
    laneIds.set(adapter, id);
  }
  const key = `${id}\u0000${path}`;
  const run = (lanes.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  lanes.set(key, run);
  void run
    .finally(() => {
      if (lanes.get(key) === run) lanes.delete(key);
    })
    .catch(() => {});
  return run;
}
