import { documentDir, homeDir, join } from "@tauri-apps/api/path";
import { exists } from "@tauri-apps/plugin-fs";
import { isVaultFolderFreeFor } from "./vaultTemplates";
import type { ScaffoldPlan } from "@plainva/ui";
import { vaultHasAppData } from "./vaultForget";

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
 * vault uses is taken as it is, and so is one holding nothing but what a
 * failed tour left (fourth review of O8). A vault's folder is never reused:
 * scaffolding only ever writes into an unknown folder that holds nothing else
 * (`isVaultFolderFreeFor`) — and
 * the PLACE of a vault Plainva still knows is skipped even when its folder is
 * gone: a tour made there would inherit that vault's settings, layout and
 * index (review of O8, 2026-11-17).
 *
 * Nothing here runs before the click: looking into "Documents" is what makes
 * macOS ask for access, and the welcome must not ask a question nobody's
 * action raised (review of O8, 2026-11-17). A refused look throws, and the
 * welcome says it in words with a way on — another place.
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
  /** A path Plainva knows as a vault — in the recent list, or with settings of its own. */
  isKnownVault: (path: string) => Promise<boolean>;
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
export async function findTourFolder(templateName: string, probe: TourFolderProbe, parentOverride?: string): Promise<string | null> {
  const parent = parentOverride ?? (await probe.parent());
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const candidate = await probe.join(parent, tourFolderName(templateName, attempt));
    if (await probe.isKnownVault(candidate)) continue;
    if (!(await probe.exists(candidate))) return candidate;
    if (await probe.isEmptyUnknownFolder(candidate)) return candidate;
  }
  return null;
}

/** Documents, else the home folder — a path only; nothing is opened. */
export async function tourParentFolder(): Promise<string> {
  try {
    return await documentDir();
  } catch {
    return homeDir();
  }
}

/** Where the tour goes when nothing is in the way — for the card, before any click. */
export async function plannedTourFolder(templateName: string): Promise<string> {
  return join(await tourParentFolder(), tourFolderName(templateName, 1));
}

/** The same place, whatever the separators, a trailing one, or the case. */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    let s = p.split("\\").join("/");
    while (s.endsWith("/")) s = s.slice(0, -1);
    return s.toLowerCase();
  };
  return norm(a) === norm(b);
}

/**
 * The Tauri implementation; `recent` is the splash's list of recent vaults,
 * `planFor` what the tour writes into a folder — a folder holding nothing but
 * what a failed tour left there is free for the next (fourth review of O8).
 */
export const tauriTourFolderProbe = (recent: readonly string[], planFor: (path: string) => ScaffoldPlan): TourFolderProbe => ({
  parent: tourParentFolder,
  isKnownVault: async (path) => recent.some((r) => samePath(r, path)) || (await vaultHasAppData(path)),
  join: (parent, name) => join(parent, name),
  exists: (path) => exists(path),
  isEmptyUnknownFolder: (path) => isVaultFolderFreeFor(path, planFor(path)),
});
