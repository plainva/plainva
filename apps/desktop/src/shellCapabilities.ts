/**
 * What the app shell needs from the window it runs in (multi-window stage C).
 *
 * The shell — sidebars, ribbon, tabs, editor, status bar — is the same in every
 * window. What differs is what a window is ALLOWED to do: the central window
 * owns the indexer, the sync worker, the schedulers and every write path, and a
 * client window has none of them (see `services/clientVault.ts`, whose header
 * carries that list and whose test pins it).
 *
 * This is deliberately an object of functions rather than a `mode` flag. A flag
 * would become `if (owner)` at thirty call sites, each of them free to forget;
 * an object forces every surface to NAME the thing it depends on, and a
 * capability that is `undefined` is a compile-time fact rather than a runtime
 * surprise. Where a client cannot do something itself, the capability is still
 * present — it brings the central window forward instead (plan § 5.3: an
 * greyed-out command explains nothing).
 */
export interface ShellCapabilities {
  /** Opens the settings, optionally on a given sync provider / vault area. */
  openSettings: (opts?: { provider?: string; area?: string }) => void;
  /** Opens the sync error dialog (vault switcher warning, status bar). */
  openSyncError: () => void;
  /** Import wizard — a run that writes across the whole vault. */
  openImport: () => void;
  /**
   * Reports every path this window has open, so the app-wide "content is open
   * once" rule can be answered (plan E2). The owner mirrors it into the window
   * registry; a client sends it over the bus.
   *
   * `active` rides along because it answers a second question with the same
   * data: the active tab names the window and decides what a restart puts back,
   * while the full list decides dedup. They change together, so they travel
   * together.
   */
  reportOpenContents?: (contents: readonly string[], active: string | null) => void;
  /**
   * Asks where content should be drawn (multi-window C1). Absent in the owner:
   * it holds the window registry and answers the question itself.
   *
   * Present in a client, it is handed straight to `usePaneLayout`, so every door
   * into a pane routes without any surface knowing about it — the alternative
   * was a rule that has to be remembered at each of the twenty openers, and the
   * one that gets forgotten is the one that opens a second editor on a file
   * somebody is typing in.
   */
  routeOpen?: (path: string, openHere: () => void, opts?: { newWindow?: boolean }) => boolean;
  /** Leaves the current vault. Absent in a client: a client follows the owner (E7). */
  closeVault?: () => void;
  /** Opens another known vault. Absent in a client for the same reason (E7). */
  openVault?: (path: string) => void;
  /** The vaults offered in the switcher; empty in a client (E7). */
  recentVaults?: readonly string[];
}
