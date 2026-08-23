import { buildWindowQuery, windowStatePrefix, type WindowPreset, type WindowRole } from "./windowContext";
import { getSettingsStore } from "./settingsStore";
import { getWindowBus } from "./windowBus";
import { forgetComposeDraft, stashComposeDraft, type ComposeSnapshot } from "./mail/composeHandoff";
import { isVirtualPath } from "../components/graph/virtualPaths";
import { releaseHolder } from "./vaultRuntimes";

/**
 * Opening, focusing and remembering auxiliary windows (multi-window P0).
 *
 * Owner-side only: the aux capability deliberately withholds
 * `core:webview:allow-create-webview-window`, so a second window cannot spawn a
 * third. Windows are created from the central one, which is also the only place
 * that knows the whole picture — which content is open where, and therefore
 * whether a request should open a window or just focus one.
 *
 * `@tauri-apps/api` is imported inside the functions, never at module level
 * (C20): a top-level call across a package boundary is the shape that shipped a
 * white window twice.
 */

/** What an auxiliary window is, as far as the owner needs to know. */
export interface AuxWindowRecord {
  /** Tauri window label — `aux-<n>` / `compose-<n>`, the bus address too. */
  label: string;
  role: Exclude<WindowRole, "owner">;
  vaultPath: string;
  /** Vault-relative path or a `plainva://` pseudo path; null for a blank window. */
  content: string | null;
  /**
   * EVERYTHING the window has open, not just the active tab (P4).
   *
   * An auxiliary window carries tabs and a split now, so "which window shows
   * this note" can no longer be answered from one field — without this, a note
   * sitting in a window's second tab would be opened a second time and the
   * app-wide "content is open once" rule (E2) would hold only for whatever
   * happened to be in front. Absent on records written before P4, which reads
   * as "just the active one".
   */
  contents?: string[];
  bounds?: { x: number; y: number; width: number; height: number };
  alwaysOnTop?: boolean;
  /** Seeded the initial split; kept so a restore rebuilds the same window. */
  preset?: WindowPreset;
}

/** Where the open windows of a vault are remembered between sessions. */
export const windowsKey = (vaultPath: string) => `plainva-windows-${vaultPath}`;

/** Settings key of "put my windows back where they were" (E5). */
export const RESTORE_WINDOWS_KEY = "restoreWindows";

/**
 * Whether a start reopens the auxiliary windows of the vault (E5).
 *
 * Default ON: a window arrangement is something the user built, and losing it
 * on every start would make the whole feature feel accidental. Off is for
 * people who want a clean single window every morning — and for the case a
 * restored window ever gets in the way, which is why the switch exists at all.
 */
export async function getRestoreWindowsSetting(): Promise<boolean> {
  try {
    const store = await getSettingsStore();
    const v = await store.get<boolean>(RESTORE_WINDOWS_KEY);
    return v !== false;
  } catch {
    return true;
  }
}

export async function setRestoreWindowsSetting(value: boolean): Promise<void> {
  const store = await getSettingsStore();
  await store.set(RESTORE_WINDOWS_KEY, value);
  await store.save();
}

/** Default size of a fresh note window: a comfortable single column. */
const DEFAULT_SIZE = { width: 720, height: 820 };
/** A view is not a column: a month grid or a mail list needs the width. */
const VIEW_SIZE = { width: 1100, height: 780 };
/** A composer wants room for recipients and a body, not for a whole page. */
const COMPOSE_SIZE = { width: 780, height: 700 };
/** A preset opens two views side by side, so it needs both of their widths. */
const PRESET_SIZE = { width: 1320, height: 860 };
/**
 * A full second window carries the sidebars as well (stage C), so it opens at
 * roughly the size the central window has by default -- a narrower one would
 * start with both sidebars collapsed and look broken rather than compact.
 */
const FULL_SIZE = { width: 1280, height: 860 };

/** Views (graph, tasks, calendar, mail) open landscape, notes portrait. */
function defaultSizeFor(content: string | null | undefined) {
  return content && content.startsWith("plainva://") ? VIEW_SIZE : DEFAULT_SIZE;
}

const open = new Map<string, AuxWindowRecord>();
let counter = 0;

/**
 * Allocates the next window label. Separate from opening because a compose
 * window needs its label BEFORE it exists (to stash the draft under it), and
 * because opening yields at its first await: two requests in flight must not
 * compute the same address.
 */
function nextLabel(role: Exclude<WindowRole, "owner">): string {
  // Never hand out a name that is already taken. `counter` starts at 0 in every
  // process, while the per-window layouts in localStorage outlive the process --
  // so a fresh window used to inherit the tabs of a long-closed stranger that
  // happened to carry the same name (maintainer finding 2026-08-23: right-click
  // "Tasks" opened the graph, then the calendar). Restored windows keep their
  // stored label, which puts them into `open` before anything new is named.
  counter += 1;
  while (open.has(`${role}-${counter}`)) counter += 1;
  return `${role}-${counter}`;
}

/** Every auxiliary window currently open, in creation order. */
export function listAuxWindows(): AuxWindowRecord[] {
  return [...open.values()];
}

/** Everything a window holds — its tabs across every pane, active one included. */
function contentsOf(rec: AuxWindowRecord): string[] {
  if (rec.contents && rec.contents.length > 0) return rec.contents;
  return rec.content ? [rec.content] : [];
}

/**
 * May this content be open in more than one place at a time?
 *
 * The four singleton VIEWS may: they render shared state and hold no editing
 * buffer, so a second one cannot lose anything. Everything with a file behind
 * it may not -- see `openOrFocusContent`.
 */
export function isDuplicableView(path: string): boolean {
  return isVirtualPath(path);
}

/** The window showing this content, if any — in ANY of its tabs (P4). */
export function findWindowForContent(vaultPath: string, content: string): AuxWindowRecord | null {
  for (const rec of open.values()) {
    if (rec.vaultPath === vaultPath && contentsOf(rec).includes(content)) return rec;
  }
  return null;
}

/**
 * Drops everything one window left behind (see `openAuxWindow`).
 *
 * Two shapes, because window state comes in two flavours: keys that carry the
 * vault (panes/tabs, the tree's expanded folders) and keys that do not (sidebar
 * geometry, which context sections are open — multi-window C4). Both end in
 * `-<label>`, so both would otherwise be inherited by the next window that gets
 * this name: a fresh window would come up with a stranger's collapsed sidebar
 * and half-open panels, which is the same finding the tabs had, one surface
 * further.
 *
 * The layout key mirrors `layoutKey` in usePaneLayout, which is deliberately
 * not exported: the layout hook owns the shape, this only needs to be able to
 * clear it. A test pins the two together.
 */
export function forgetWindowLayout(vaultPath: string, label: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`plainva-layout-${vaultPath}-${label}`);
    window.localStorage.removeItem(`plainva-expanded-${vaultPath}-${label}`);
    // Prefix sweep rather than a list: window state grows with the shell, and a
    // list is the thing that goes stale silently. See `windowStatePrefix` for
    // why the label leads the key instead of ending it.
    const prefix = windowStatePrefix(label);
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(prefix)) window.localStorage.removeItem(key);
    }
  } catch {
    /* quota/private mode: a stale layout is not worth failing an open for */
  }
}

/** Remembers what is open so the next start can restore it (plan P4/E5). */
export function persistWindows(vaultPath: string): void {
  if (typeof window === "undefined") return;
  // Compose windows are deliberately not remembered: what they hold is unsaved
  // text that lives in memory. Restoring one after a restart would reopen an
  // EMPTY composer — a window that lies about having kept something.
  const mine = listAuxWindows().filter((w) => w.vaultPath === vaultPath && (w.role === "aux" || w.role === "full"));
  try {
    if (mine.length === 0) window.localStorage.removeItem(windowsKey(vaultPath));
    else window.localStorage.setItem(windowsKey(vaultPath), JSON.stringify(mine));
  } catch (e) {
    console.warn("[windowManager] could not persist the window list", e);
  }
}

/**
 * A window changed which vault it shows (C5, per window since stage D).
 *
 * Only for a real switch: a window that CLOSES its vault keeps its record, so
 * reopening that vault brings the window back (E5). Passing `null` is the other
 * case — the window is gone, and a record left behind reopens it empty on the
 * next start.
 *
 * Until stage D a switch moved every window in the process, because one process
 * held one vault. With several open that is exactly wrong: a second window
 * exists to show something else, and moving it takes away the only reason it is
 * open.
 *
 * A window's record carries the vault it belongs to, and that is what decides
 * which list it is remembered in and which windows a start restores. Both lists
 * are written: the new one gains the window, the old one loses it — otherwise
 * the next start of the old vault reopens a window that has been looking at
 * something else since.
 */
export function noteWindowVault(label: string, vaultPath: string | null): void {
  const rec = open.get(label);
  if (!rec) return;
  const previous = rec.vaultPath;
  if (previous === vaultPath) return;
  if (vaultPath) rec.vaultPath = vaultPath;
  else open.delete(label);
  if (previous) persistWindows(previous);
  if (vaultPath) persistWindows(vaultPath);
}

/** What was open last time. Malformed content is dropped, never thrown. */
export function readPersistedWindows(vaultPath: string): AuxWindowRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(windowsKey(vaultPath));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is AuxWindowRecord =>
        !!r && typeof r === "object" && typeof (r as AuxWindowRecord).label === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Opens an auxiliary window for a piece of content.
 *
 * The label is the address the bus talks to, so it has to be unique for the
 * lifetime of the process — a counter is enough, since only the owner creates
 * windows and a label is never reused while its window lives.
 */
export async function openAuxWindow(params: {
  role: Exclude<WindowRole, "owner">;
  vaultPath: string;
  content?: string | null;
  title?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  size?: { width: number; height: number };
  /** Opens with a prepared split instead of a single piece of content (E4). */
  preset?: WindowPreset;
  /** Restores the pin of a window that had one when it was last closed (E6). */
  alwaysOnTop?: boolean;
  /** Pre-allocated label (see `nextLabel`); otherwise one is taken here. */
  label?: string;
  /** Runs when the window goes away, however it went away. */
  onClosed?: () => void;
}): Promise<AuxWindowRecord> {
  const label = params.label ?? nextLabel(params.role);
  // A window that is opened FRESH starts with what it was opened with. Only a
  // restore (which passes its stored label) brings tabs back, so anything left
  // under this name by an earlier window goes -- the second half of the finding
  // above, for the case where the earlier window was closed by hand.
  if (!params.label) forgetWindowLayout(params.vaultPath, label);
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const record: AuxWindowRecord = {
    label,
    role: params.role,
    vaultPath: params.vaultPath,
    content: params.content ?? null,
    bounds: params.bounds,
    ...(params.preset ? { preset: params.preset } : {}),
    ...(params.alwaysOnTop ? { alwaysOnTop: true } : {}),
  };

  const url = `index.html${buildWindowQuery({
    role: params.role,
    vaultPath: params.vaultPath,
    content: params.content,
    label,
    preset: params.preset,
  })}`;

  const win = new WebviewWindow(label, {
    url,
    title: params.title ?? "Plainva",
    width: params.bounds?.width ?? params.size?.width ?? defaultSizeFor(params.content).width,
    height: params.bounds?.height ?? params.size?.height ?? defaultSizeFor(params.content).height,
    x: params.bounds?.x,
    y: params.bounds?.y,
    alwaysOnTop: params.alwaysOnTop === true,
    // Same frameless chrome as the main window — the aux title bar draws it.
    decorations: false,
  });

  open.set(label, record);
  persistWindows(params.vaultPath);

  // A window can also be closed by the OS (Alt+F4, the system menu), so the
  // registry follows the window rather than the code path that closed it.
  void win.onCloseRequested(() => {
    // Its CURRENT vault, not the one it opened with: since stage D a window can
    // switch, and persisting the old list would leave the record it just lost
    // in place while the list it actually belongs to keeps a stale entry.
    const shown = open.get(label)?.vaultPath ?? params.vaultPath;
    open.delete(label);
    persistWindows(shown);
    // And let go of the runtime: a vault only this window held has no reason to
    // keep indexing, watching and syncing for a window that is gone.
    releaseHolder(label);
    params.onClosed?.();
  });

  return record;
}

/**
 * Opens a full second window: the whole shell, in client mode (stage C).
 *
 * Deliberately not deduplicated by content — a full window is a WORKPLACE, not
 * a piece of content, and having two of them open on two monitors is the point
 * of the stage. What stays deduplicated is what they show: the routing in
 * `openOrFocusContent` treats a full window like any other.
 */
export async function openFullWindow(params: {
  vaultPath: string;
  title?: string;
}): Promise<AuxWindowRecord> {
  return openAuxWindow({
    role: "full",
    vaultPath: params.vaultPath,
    title: params.title,
    size: FULL_SIZE,
  });
}

/**
 * Pops the message composer out into its own window (P3).
 *
 * Deliberately NOT deduplicated: writing two mails at once is ordinary, and the
 * rule "content is open once" is about content in the vault — an unsent draft
 * is not that. The snapshot is stashed before the window exists because the new
 * window asks for it as its first act; base64 attachments have no business in a
 * URL.
 */
export async function openComposeWindow(params: {
  vaultPath: string;
  snapshot: ComposeSnapshot;
  title?: string;
}): Promise<AuxWindowRecord> {
  const label = nextLabel("compose");
  stashComposeDraft(label, params.snapshot);
  try {
    return await openAuxWindow({
      label,
      role: "compose",
      vaultPath: params.vaultPath,
      title: params.title,
      size: COMPOSE_SIZE,
      onClosed: () => forgetComposeDraft(label),
    });
  } catch (e) {
    // The window never came up: do not leave the draft lying in the map.
    forgetComposeDraft(label);
    throw e;
  }
}

/**
 * Opens a window with a prepared split — today: mail beside the calendar (E4).
 *
 * The window is an ordinary auxiliary window; the preset only decides what its
 * two panes start with. Deduplicated on its first pane like any other content,
 * so asking twice brings the existing communications window forward instead of
 * building a second one.
 */
export async function openPresetWindow(params: {
  vaultPath: string;
  preset: WindowPreset;
  title?: string;
}): Promise<AuxWindowRecord> {
  return openAuxWindow({
    role: "aux",
    vaultPath: params.vaultPath,
    content: PRESET_CONTENT[params.preset][0],
    preset: params.preset,
    title: params.title,
    size: PRESET_SIZE,
  });
}

/** What each preset puts into its panes, left/top first. */
export const PRESET_CONTENT: Record<WindowPreset, [string, string]> = {
  "mail-calendar": ["plainva://mail", "plainva://calendar"],
};

/**
 * Is this window's title bar reachable with the monitors that exist now (E5)?
 *
 * A saved position outlives the screen it was saved on: unplug the second
 * monitor, restart, and a restored window sits at x=2400 where nothing can
 * click it. The test is deliberately about the DRAG REGION, not about area —
 * a window that is 90% off-screen is fine as long as enough of its title bar
 * is grabbable to pull it back.
 */
export function isReachable(
  bounds: { x: number; y: number; width: number; height: number },
  monitors: readonly { position: { x: number; y: number }; size: { width: number; height: number } }[],
): boolean {
  if (monitors.length === 0) return true; // no answer is not a reason to move a window
  const TITLE_H = 40;
  const NEEDED = 120;
  for (const m of monitors) {
    const left = Math.max(bounds.x, m.position.x);
    const right = Math.min(bounds.x + bounds.width, m.position.x + m.size.width);
    const top = Math.max(bounds.y, m.position.y);
    const bottom = Math.min(bounds.y + TITLE_H, m.position.y + m.size.height);
    if (right - left >= NEEDED && bottom - top > 0) return true;
  }
  return false;
}

/**
 * Reopens the windows a vault had open when it was last closed (E5).
 *
 * Compose windows are not in the list by construction (`persistWindows`), so
 * nothing here can resurrect an empty composer. A window whose saved position
 * no longer lands on a monitor keeps its SIZE and loses its position — the OS
 * then places it, which is better than restoring it out of reach.
 */
export async function restoreAuxWindows(vaultPath: string): Promise<AuxWindowRecord[]> {
  const saved = readPersistedWindows(vaultPath).filter((w) => w.role === "aux" || w.role === "full");
  if (saved.length === 0) return [];

  let monitors: { position: { x: number; y: number }; size: { width: number; height: number } }[] = [];
  try {
    const { availableMonitors } = await import("@tauri-apps/api/window");
    monitors = await availableMonitors();
  } catch {
    /* no backend (browser/test): restore without the reachability check */
  }

  const opened: AuxWindowRecord[] = [];
  for (const rec of saved) {
    const bounds = rec.bounds && isReachable(rec.bounds, monitors) ? rec.bounds : undefined;
    try {
      opened.push(
        await openAuxWindow({
          // A full window comes back full: the role is part of what was open,
          // not a property of the restore.
          role: rec.role === "full" ? "full" : "aux",
          vaultPath,
          // The layout of a window hangs on its label, so a restored window has
          // to come back under the SAME one -- otherwise its tabs stay behind
          // and land on whichever window is named that next time.
          label: rec.label,
          content: rec.content,
          preset: rec.preset,
          alwaysOnTop: rec.alwaysOnTop === true,
          bounds,
          size: rec.bounds ? { width: rec.bounds.width, height: rec.bounds.height } : undefined,
          title: rec.content?.split(/[/\\]/).pop(),
        }),
      );
    } catch (e) {
      // One window that will not come up must not cost the others.
      console.warn("[windowManager] could not restore a window", rec.label, e);
    }
  }
  return opened;
}

/** Brings an existing window forward (dedup / focus routing). */
export async function focusAuxWindow(label: string): Promise<boolean> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  // Asking the backend for a window can THROW, not just answer null (a closing
  // window, a backend that has no window list). Either way the answer for the
  // caller is the same — "not there" — and routing must not explode over it:
  // an exception here would bubble through openOrFocusContent into the ribbon.
  const win = await WebviewWindow.getByLabel(label).catch(() => null);
  if (!win) {
    // The window is gone but the registry did not hear about it — drop it, so
    // the next dedup lookup opens a fresh one instead of routing into nothing.
    open.delete(label);
    return false;
  }
  await win.unminimize().catch(() => {});
  await win.show().catch(() => {});
  await win.setFocus().catch(() => {});
  return true;
}

/** Closes one auxiliary window. */
export async function closeAuxWindow(label: string): Promise<void> {
  const record = open.get(label);
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const win = await WebviewWindow.getByLabel(label);
  open.delete(label);
  if (record) persistWindows(record.vaultPath);
  await win?.close().catch(() => {});
}

/**
 * Closes every auxiliary window of a vault — used when the owner switches
 * vaults (v1 keeps all windows on one vault) and before the app quits.
 */
export async function closeAllAuxWindows(): Promise<void> {
  for (const label of [...open.keys()]) {
    await closeAuxWindow(label);
  }
}

/**
 * What the CENTRAL window currently has open in its tabs.
 *
 * The owner is the only place that can answer "is this content already open
 * somewhere" for the whole app, and half the answer lives in React state
 * (`usePaneLayout`). App keeps this mirror in sync; nothing else writes it.
 */
let ownerContents: ReadonlySet<string> = new Set();

/** Called by App whenever the pane layout changes. */
export function setOwnerOpenContents(paths: readonly string[]): void {
  ownerContents = new Set(paths);
}

/** Does the central window have this content open in a tab? */
export function ownerHasContent(path: string): boolean {
  return ownerContents.has(path);
}

/** Where a piece of content ended up when it was asked for. */
export type OpenContentResult =
  | { where: "focused"; label: string }
  | { where: "owner" }
  | { where: "caller" };

/**
 * The one routing decision for "show me this content", app-wide (P1).
 *
 * Content is open ONCE (plan E2): opening something that another window
 * already shows must bring that window forward, never draw a second copy. The
 * owner is the only participant that can decide this, so both the owner's own
 * UI and every auxiliary window's request go through here.
 *
 * `newWindow` is the popout: it MOVES the content into a fresh window. The
 * caller (App) closes its tab afterwards — leaving it open would put the same
 * note in two places, which is exactly what dedup exists to prevent.
 */
export async function openOrFocusContent(opts: {
  vaultPath: string;
  path: string;
  newWindow?: boolean;
  /** Label of the window that asked, so it is not told to focus itself. */
  from?: string;
  title?: string;
}): Promise<OpenContentResult> {
  // A VIEW may exist more than once (maintainer decision 2026-08-23). Notes and
  // databases stay unique app-wide -- two editors on one file is the very race
  // the rule was written for -- but the graph, tasks, calendar and mail are
  // read surfaces over shared state. Insisting they be unique meant the
  // communications window could not show a calendar that was open in a tab, and
  // that the ribbon could only ever pull the existing window forward.
  const existing = isDuplicableView(opts.path) ? null : findWindowForContent(opts.vaultPath, opts.path);
  if (existing) {
    if (existing.label === opts.from) return { where: "caller" };
    const ok = await focusAuxWindow(existing.label);
    if (ok) return { where: "focused", label: existing.label };
    // The window died without telling us; fall through and open a fresh one.
  }

  if (opts.newWindow) {
    const rec = await openAuxWindow({
      role: "aux",
      vaultPath: opts.vaultPath,
      content: opts.path,
      title: opts.title,
    });
    return { where: "focused", label: rec.label };
  }

  if (ownerHasContent(opts.path)) return { where: "owner" };
  return { where: "caller" };
}

/**
 * Shows content in whichever window has that vault open (stage D).
 *
 * A reminder fires in the runtime, and the runtime has no window — with two
 * vaults open the one it belongs to may well be a window the central one is
 * not showing. Clicking the notification then has to land where that vault
 * IS, not where the central window happens to be looking, because opening it
 * centrally would silently switch the vault out from under the other window.
 *
 * A held vault always has a window: that is what holding means. So the only
 * two answers are "the central window, locally" and "that window, brought
 * forward" — there is no third case to invent a fallback for.
 */
export async function showContentInVaultWindow(opts: {
  vaultPath: string;
  path: string;
  /** True when the central window is the one showing this vault. */
  ownerShows: boolean;
}): Promise<boolean> {
  if (opts.ownerShows) {
    window.dispatchEvent(new CustomEvent("plainva-window-show-content", { detail: { path: opts.path } }));
    return true;
  }
  const target =
    findWindowForContent(opts.vaultPath, opts.path) ??
    listAuxWindows().find((w) => w.vaultPath === opts.vaultPath && (w.role === "aux" || w.role === "full")) ??
    null;
  if (!target) return false;
  const focused = await focusAuxWindow(target.label);
  if (!focused) return false;
  const bus = await getWindowBus();
  await bus.broadcast("set-content", { label: target.label, path: opts.path }, opts.vaultPath);
  return true;
}

/** Remembers where a window is, so a later start can put it back (P4/E5). */
export function noteWindowBounds(
  label: string,
  bounds: { x: number; y: number; width: number; height: number },
): void {
  const rec = open.get(label);
  if (!rec) return;
  rec.bounds = bounds;
  persistWindows(rec.vaultPath);
}

/** Which content an auxiliary window shows now (it navigated on its own). */
export function noteWindowContent(label: string, content: string | null): void {
  const rec = open.get(label);
  if (!rec || rec.content === content) return;
  rec.content = content;
  persistWindows(rec.vaultPath);
}

/**
 * Everything an auxiliary window has open, reported by the window itself (P4).
 *
 * The active tab decides the title and what a restart restores; the full list
 * decides dedup. Both are written together because they change together — a
 * tab switch moves the active one, closing a tab shortens the list.
 */
export function noteWindowContents(label: string, active: string | null, contents: string[]): void {
  const rec = open.get(label);
  if (!rec) return;
  const same =
    rec.content === active &&
    (rec.contents ?? []).length === contents.length &&
    (rec.contents ?? []).every((c, i) => c === contents[i]);
  if (same) return;
  rec.content = active;
  rec.contents = contents;
  persistWindows(rec.vaultPath);
}

/** Remembers the always-on-top pin so the next start puts it back (E6). */
export function noteWindowAlwaysOnTop(label: string, value: boolean): void {
  const rec = open.get(label);
  if (!rec || rec.alwaysOnTop === value) return;
  rec.alwaysOnTop = value;
  persistWindows(rec.vaultPath);
}

/** Test seam: forget the in-memory registry (never called by the app). */
export function resetWindowRegistryForTest(): void {
  open.clear();
  ownerContents = new Set();
  counter = 0;
}
