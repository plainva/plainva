import { useEffect } from "react";
import { useVaultLabels, vaultFolderLabel } from "./vaultNames";

/**
 * What the OS title bar and the taskbar entry say (stage D).
 *
 * With one vault open, a window is named after what it SHOWS — the note, the
 * view, or plainly the app. With two, that is no longer enough to tell the
 * entries apart: two windows called "Tasks — Plainva" in the taskbar belong to
 * two different vaults, and nothing on the button says which. So the vault
 * joins the name, but only then — appending it always would put a folder name
 * in front of every user who never opens a second vault.
 *
 * The same rule as the tray line (`trayNext.ts`), and for the same reason: the
 * disambiguator appears when there is something to disambiguate.
 */
export function composeWindowTitle(opts: {
  /** What this window shows: a note, a view name, or null for the workplace. */
  subject?: string | null;
  vaultPath?: string | null;
  /**
   * What the vault is called in Plainva (`vaultNames.ts`): its own name where
   * it has one, else its folder's. Without it the folder's name stands.
   */
  vaultName?: string | null;
  /** How many vaults the process has open right now. */
  vaultCount: number;
}): string {
  const vault = opts.vaultPath ? (opts.vaultName?.trim() || vaultFolderLabel(opts.vaultPath)) : null;
  const subject = opts.subject?.trim() || null;
  const lead = subject ?? vault ?? "Plainva";
  // The vault is already the lead when there is no subject: repeating it would
  // read "Notes — Notes — Plainva".
  const withVault = opts.vaultCount >= 2 && vault && subject ? `${lead} — ${vault}` : lead;
  return withVault === "Plainva" ? "Plainva" : `${withVault} — Plainva`;
}

/**
 * Names the OS window. Silent where there is none (browser, tests), and silent
 * for `null` — a compose window keeps the subject the owner gave it.
 */
export function useOsWindowTitle(title: string | null): void {
  useEffect(() => {
    if (title === null) return;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setTitle(title);
      } catch {
        /* browser/test: no OS window to name */
      }
    })();
  }, [title]);
}

/**
 * Names the OS window after `composeWindowTitle`, with the vault under the
 * name it has in Plainva (Sammelplan § 3.171 Nr. 4). The title read the
 * folder's name, so a vault renamed in the settings kept its old name in the
 * title bar and the taskbar. It follows a rename at once, in this window and -
 * through the settings broadcast (`appearanceSync.ts`) - in every other one.
 * `null` leaves the title alone, as `useOsWindowTitle` does.
 */
export function useWindowTitle(opts: Omit<Parameters<typeof composeWindowTitle>[0], "vaultName"> | null): void {
  const vaultPath = opts?.vaultPath ?? null;
  const labelOf = useVaultLabels([vaultPath]);
  useOsWindowTitle(opts ? composeWindowTitle({ ...opts, vaultName: vaultPath ? labelOf(vaultPath) : null }) : null);
}
