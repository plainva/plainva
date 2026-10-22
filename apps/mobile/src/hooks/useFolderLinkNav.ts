import { useEffect } from "react";

import { pushEntry, type NavState } from "../navigation";
import { OPEN_FOLDER_EVENT } from "../services/openLink";

/**
 * A link to a folder that holds no index.md shows the folder itself
 * (`services/openLink`, ADR 0027 addendum 2026-10-12): the opener raises
 * OPEN_FOLDER_EVENT with the vault it was asked in, and the folder screen is
 * pushed for the vault the app shows — the event of a vault the user has left
 * meanwhile is dropped.
 *
 * In its own module rather than in App.tsx because App.tsx is under a shrinking
 * line budget: feature blocks belong in their own files.
 */
export function useFolderLinkNav(
  setNav: (fn: (state: NavState) => NavState) => void,
  shownVault: { readonly current: string | null },
): void {
  useEffect(() => {
    const onOpenFolder = (event: Event) => {
      const { path, vaultId } = (event as CustomEvent<{ path: string; vaultId: string }>).detail;
      if (shownVault.current === vaultId) setNav((s) => pushEntry(s, { kind: "folder", path }));
    };
    window.addEventListener(OPEN_FOLDER_EVENT, onOpenFolder);
    return () => window.removeEventListener(OPEN_FOLDER_EVENT, onOpenFolder);
  }, [setNav, shownVault]);
}
