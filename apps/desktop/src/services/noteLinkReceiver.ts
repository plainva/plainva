import { useEffect } from "react";
import type { IVaultAdapter, VaultQueryService } from "@plainva/core";
import { copyNoteLink, deliverNoteLink, openNoteLink, requestAnchorJump, resolveOpenAction, setNoteLinkHandler, useStableHandler } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { appConfirm } from "./appDialogs";
import { isOwnerWindow } from "./windowContext";
import { vaultLabel } from "./vaultNames";

/**
 * Note links on the desktop (F2, ADR 0037).
 *
 * In: the Rust side keeps what the system handed over — a launch argument on
 * Windows and Linux, the second launch the single-instance plugin turns into
 * a callback of THIS process, macOS's `Opened` event — and tells the central
 * window, which takes the addresses (`note_links_take`) into the shared
 * inbox. A link clicked in the app reaches the inbox through the guard of
 * `openExternal`; one clicked in an auxiliary window is forwarded to the
 * central window, which knows the vaults and the tabs.
 *
 * Out: `useDesktopNoteLinks` (AppShell) registers how the shown vault opens a
 * note; a link that arrived before a vault was open waits until then.
 */

const ARRIVED_EVENT = "plainva-note-link";

async function takeArrived(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const urls = await invoke<string[]>("note_links_take");
    for (const url of urls) deliverNoteLink(url);
  } catch {
    // The browser of the E2E suite: no Rust side, nothing arrives this way.
  }
}

let listening = false;

/** The central window's ear for links from the system; once per window. */
export function listenForSystemNoteLinks(): void {
  if (listening || !isOwnerWindow()) return;
  listening = true;
  void (async () => {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      await listen(ARRIVED_EVENT, () => void takeArrived());
    } catch {
      /* no Rust side */
    }
    // What the launch carried arrived before anyone listened.
    await takeArrived();
  })();
}

/** In an auxiliary window: a clicked note link opens in the central window. */
export function forwardNoteLinksToCentralWindow(): () => void {
  return setNoteLinkHandler((url) => {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("note_link_forward", { url }))
      .catch(() => undefined);
  });
}

/** "Copy link" names the vault as the person sees it (its own name or its folder's), never its place on disk. */
export function desktopVaultLinkName(vaultPath: string | null | undefined): string | null {
  return vaultPath ? vaultLabel(vaultPath) : null;
}

export interface DesktopNoteLinkDeps {
  vaultPath: string | null;
  recentVaults: readonly string[];
  openVault: (path: string) => Promise<boolean>;
  queryService: Pick<VaultQueryService, "resolveNotePath"> | null | undefined;
  vaultAdapter: Pick<IVaultAdapter, "exists"> | null | undefined;
  openNote: (path: string) => void;
}

/** Registers the shown vault's way of opening a note link while it is shown. */
export function useDesktopNoteLinks(deps: DesktopNoteLinkDeps): void {
  const openNote = useStableHandler(deps.openNote);
  const openVault = useStableHandler(deps.openVault);
  const { vaultPath, recentVaults, queryService, vaultAdapter } = deps;
  useEffect(() => {
    listenForSystemNoteLinks();
  }, []);
  useEffect(() => {
    if (!vaultPath || !queryService || !vaultAdapter) return;
    return setNoteLinkHandler((url, switched) => {
      void openNoteLink<string>(
        url,
        {
          shownVault: { key: vaultPath, name: vaultLabel(vaultPath) },
          knownVaults: async () => [...new Set([vaultPath, ...recentVaults])].map((path) => ({ key: path, name: vaultLabel(path) })),
          confirmSwitch: (name) =>
            appConfirm({
              title: i18n.t("noteLink.switchTitle"),
              message: i18n.t("noteLink.switchMessage", { name }),
              kind: "info",
              confirmLabel: i18n.t("noteLink.switchConfirm"),
            }),
          switchVault: (path) => openVault(path).catch(() => false),
          exists: (path) => vaultAdapter.exists(path),
          resolveName: (name) => queryService.resolveNotePath(name),
          openNote: (path, anchor) => {
            openNote(path);
            // Parked under the path: the pane that shows the note takes it once its text is in.
            if (anchor) requestAnchorJump(path, anchor);
          },
        },
        switched,
      );
    });
  }, [vaultPath, recentVaults, queryService, vaultAdapter, openNote, openVault]);
}

/** "Copy link" of a note, a database or another file Plainva shows itself — the file's address, its place in it optional. */
export function copyDesktopNoteLink(vaultPath: string | null | undefined, path: string, anchor?: { heading?: string; block?: string }): void {
  void copyNoteLink(desktopVaultLinkName(vaultPath), path, anchor);
}

/** Whether a file has an address of its own: what Plainva opens itself, never a file handed to the system. */
export function hasNoteLink(path: string): boolean {
  return !path.startsWith("plainva://") && resolveOpenAction(path) !== "external";
}
