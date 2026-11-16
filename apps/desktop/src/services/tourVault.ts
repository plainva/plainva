import { documentDir, homeDir, join } from "@tauri-apps/api/path";
import { exists } from "@tauri-apps/plugin-fs";
import { isVaultFolderEmpty } from "./vaultTemplates";

/**
 * Where "Try it with the tour" puts its vault (plan Oberfläche, O8, mockup M8).
 *
 * The tour is the welcome's main action, so it is ONE click: no place step,
 * no template step, no folder dialog. The folder it makes is named on the
 * welcome before the click (the tour card says where), so nothing happens
 * behind the user's back, and the folder is an ordinary one they can move or
 * delete like any other.
 *
 * The folder is named after the tour in the app language ("Plainva Tour",
 * "Plainva-Tour", …) inside the user's Documents — the home folder when the
 * system has none. A name that is taken by something with content gets a
 * number ("Plainva Tour 2"); an existing EMPTY folder of that name that no
 * vault uses is taken as it is. A vault's folder is never reused: scaffolding
 * only ever writes into an empty, unknown folder (`isVaultFolderEmpty`).
 */

/** Characters no file system takes in a folder name, and control characters. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]/g;

/** The folder name for the tour, safe on every platform. */
export function tourFolderName(templateName: string, attempt: number): string {
  let cleaned = templateName.replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  // Windows refuses a folder name that ends in a dot or a space.
  while (cleaned.endsWith(".") || cleaned.endsWith(" ")) cleaned = cleaned.slice(0, -1);
  const base = cleaned || "Plainva Tour";
  return attempt <= 1 ? base : `${base} ${attempt}`;
}

/** The checks the search needs — injected so the rule is testable without Tauri. */
export interface TourFolderProbe {
  parent: () => Promise<string>;
  join: (parent: string, name: string) => Promise<string>;
  exists: (path: string) => Promise<boolean>;
  isEmptyUnknownFolder: (path: string) => Promise<boolean>;
}

/** Give up after this many taken names rather than loop over a whole disk. */
const MAX_ATTEMPTS = 50;

/**
 * The first folder the tour may be written into, or `null` when fifty names in
 * a row are taken. Reads only; nothing is created here.
 */
export async function findTourFolder(templateName: string, probe: TourFolderProbe): Promise<string | null> {
  const parent = await probe.parent();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const candidate = await probe.join(parent, tourFolderName(templateName, attempt));
    if (!(await probe.exists(candidate))) return candidate;
    if (await probe.isEmptyUnknownFolder(candidate)) return candidate;
  }
  return null;
}

/** The Tauri implementation: Documents, else the home folder. */
export const tauriTourFolderProbe: TourFolderProbe = {
  parent: async () => {
    try {
      return await documentDir();
    } catch {
      return homeDir();
    }
  },
  join: (parent, name) => join(parent, name),
  exists: (path) => exists(path),
  isEmptyUnknownFolder: (path) => isVaultFolderEmpty(path),
};
