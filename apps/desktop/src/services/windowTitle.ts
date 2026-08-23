import { useEffect } from "react";

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
  /** How many vaults the process has open right now. */
  vaultCount: number;
}): string {
  const vault = opts.vaultPath ? vaultName(opts.vaultPath) : null;
  const subject = opts.subject?.trim() || null;
  const lead = subject ?? vault ?? "Plainva";
  // The vault is already the lead when there is no subject: repeating it would
  // read "Notes — Notes — Plainva".
  const withVault = opts.vaultCount >= 2 && vault && subject ? `${lead} — ${vault}` : lead;
  return withVault === "Plainva" ? "Plainva" : `${withVault} — Plainva`;
}

function vaultName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
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
