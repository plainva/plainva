import { useEffect } from "react";
import { contentPathRefusal, type IVaultAdapter, type VaultQueryService } from "@plainva/core";
import { copyNoteLink, deliverNoteLink, openNoteLink, requestAnchorJump, resolveOpenAction, setNoteLinkHandler, useStableHandler, type NoteLinkShell } from "@plainva/ui";
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

/**
 * The central window comes forward — out of the tray, too — when a link
 * opens a note or asks about one; never for a link it drops (F2 review). The
 * Rust side no longer does this on arrival.
 */
async function bringForward(): Promise<void> {
  try {
    // The same means the second launch of the app uses (the single-instance
    // callback in src-tauri/src/lib.rs): the Rust side unminimizes, shows and
    // focuses the central window in one call.
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("note_link_bring_forward");
  } catch {
    // The browser of the E2E suite: there is no window to bring.
  }
}

/** In an auxiliary, compose or capture window: a clicked note link opens in the central window. */
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
  queryService: Pick<VaultQueryService, "resolveNotePath" | "fileRecords"> | null | undefined;
  vaultAdapter?: Pick<IVaultAdapter, "exists"> | null;
  openNote: (path: string) => void;
}

/**
 * How the shown vault opens a note link — the desktop side of `openNoteLink`.
 * Its own function so a test can run the whole way with the desktop's rules
 * (the index, never the disk; the window comes forward only to show or ask).
 */
export function desktopNoteLinkShell(deps: {
  vaultPath: string;
  recentVaults: readonly string[];
  queryService: Pick<VaultQueryService, "resolveNotePath" | "fileRecords">;
  /** The disk, asked only for a path the index does not hold yet and whose name has no unusual shape. */
  vaultAdapter?: Pick<IVaultAdapter, "exists"> | null;
  openVault: (path: string) => Promise<boolean>;
  openNote: (path: string) => void;
  confirm?: typeof appConfirm;
  bringForward?: () => Promise<void>;
}): NoteLinkShell<string> {
  const { vaultPath, recentVaults, queryService } = deps;
  const confirm = deps.confirm ?? appConfirm;
  const forward = deps.bringForward ?? bringForward;
  return {
    shownVault: { key: vaultPath, name: vaultLabel(vaultPath) },
    knownVaults: async () => [...new Set([vaultPath, ...recentVaults])].map((path) => ({ key: path, name: vaultLabel(path) })),
    confirmSwitch: async (name) => {
      await forward();
      return confirm({
        title: i18n.t("noteLink.switchTitle"),
        message: i18n.t("noteLink.switchMessage", { name }),
        kind: "info",
        confirmLabel: i18n.t("noteLink.switchConfirm"),
      });
    },
    confirmOpenHere: async (vault, note, ambiguous) => {
      await forward();
      return confirm({
        title: i18n.t("noteLink.openHereTitle"),
        message: i18n.t(ambiguous ? "noteLink.openHereAmbiguousMessage" : "noteLink.openHereMessage", { vault, note }),
        kind: "info",
        confirmLabel: i18n.t("noteLink.openHereConfirm"),
      });
    },
    switchVault: (path) => deps.openVault(path).catch(() => false),
    // The index first: it holds real, visible spellings only. A note it has not
    // taken in yet (a first scan, a note just synced) is asked of the disk —
    // never for an internal folder or a name of an unusual shape (F2 review).
    exists: async (path) => {
      if ((await queryService.fileRecords([path])).has(path)) return true;
      return !!deps.vaultAdapter && contentPathRefusal(path) === null && (await deps.vaultAdapter.exists(path).catch(() => false));
    },
    resolveName: (name) => queryService.resolveNotePath(name),
    openNote: (path, anchor) => {
      void forward();
      deps.openNote(path);
      // Parked under the path: the pane that shows the note takes it once its text is in.
      if (anchor) requestAnchorJump(path, anchor);
    },
  };
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
    if (!vaultPath || !queryService) return;
    const shell = desktopNoteLinkShell({ vaultPath, recentVaults, queryService, vaultAdapter, openVault, openNote });
    return setNoteLinkHandler((url, switched) => void openNoteLink<string>(url, shell, switched));
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
