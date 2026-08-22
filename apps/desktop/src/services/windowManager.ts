import { buildWindowQuery, type WindowRole } from "./windowContext";
import { forgetComposeDraft, stashComposeDraft, type ComposeSnapshot } from "./mail/composeHandoff";

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
  bounds?: { x: number; y: number; width: number; height: number };
  alwaysOnTop?: boolean;
}

/** Where the open windows of a vault are remembered between sessions. */
export const windowsKey = (vaultPath: string) => `plainva-windows-${vaultPath}`;

/** Default size of a fresh note window: a comfortable single column. */
const DEFAULT_SIZE = { width: 720, height: 820 };
/** A view is not a column: a month grid or a mail list needs the width. */
const VIEW_SIZE = { width: 1100, height: 780 };
/** A composer wants room for recipients and a body, not for a whole page. */
const COMPOSE_SIZE = { width: 780, height: 700 };

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
  counter += 1;
  return `${role}-${counter}`;
}

/** Every auxiliary window currently open, in creation order. */
export function listAuxWindows(): AuxWindowRecord[] {
  return [...open.values()];
}

/** The window showing this content, if any. */
export function findWindowForContent(vaultPath: string, content: string): AuxWindowRecord | null {
  for (const rec of open.values()) {
    if (rec.vaultPath === vaultPath && rec.content === content) return rec;
  }
  return null;
}

/** Remembers what is open so the next start can restore it (plan P4/E5). */
export function persistWindows(vaultPath: string): void {
  if (typeof window === "undefined") return;
  // Compose windows are deliberately not remembered: what they hold is unsaved
  // text that lives in memory. Restoring one after a restart would reopen an
  // EMPTY composer — a window that lies about having kept something.
  const mine = listAuxWindows().filter((w) => w.vaultPath === vaultPath && w.role === "aux");
  try {
    if (mine.length === 0) window.localStorage.removeItem(windowsKey(vaultPath));
    else window.localStorage.setItem(windowsKey(vaultPath), JSON.stringify(mine));
  } catch (e) {
    console.warn("[windowManager] could not persist the window list", e);
  }
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
  /** Pre-allocated label (see `nextLabel`); otherwise one is taken here. */
  label?: string;
  /** Runs when the window goes away, however it went away. */
  onClosed?: () => void;
}): Promise<AuxWindowRecord> {
  const label = params.label ?? nextLabel(params.role);
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const record: AuxWindowRecord = {
    label,
    role: params.role,
    vaultPath: params.vaultPath,
    content: params.content ?? null,
    bounds: params.bounds,
  };

  const url = `index.html${buildWindowQuery({
    role: params.role,
    vaultPath: params.vaultPath,
    content: params.content,
    label,
  })}`;

  const win = new WebviewWindow(label, {
    url,
    title: params.title ?? "Plainva",
    width: params.bounds?.width ?? params.size?.width ?? defaultSizeFor(params.content).width,
    height: params.bounds?.height ?? params.size?.height ?? defaultSizeFor(params.content).height,
    x: params.bounds?.x,
    y: params.bounds?.y,
    // Same frameless chrome as the main window — the aux title bar draws it.
    decorations: false,
  });

  open.set(label, record);
  persistWindows(params.vaultPath);

  // A window can also be closed by the OS (Alt+F4, the system menu), so the
  // registry follows the window rather than the code path that closed it.
  void win.onCloseRequested(() => {
    open.delete(label);
    persistWindows(params.vaultPath);
    params.onClosed?.();
  });

  return record;
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
  const existing = findWindowForContent(opts.vaultPath, opts.path);
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

/** Test seam: forget the in-memory registry (never called by the app). */
export function resetWindowRegistryForTest(): void {
  open.clear();
  ownerContents = new Set();
  counter = 0;
}
