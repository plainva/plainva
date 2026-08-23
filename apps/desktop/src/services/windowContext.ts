/**
 * Which window is this, and what was it opened with (multi-window P0).
 *
 * Every window loads the same bundle; the URL query decides what it becomes.
 * The central window ("owner") has no query at all — that is deliberate, so an
 * ordinary launch is byte-identical to what it was before multi-window
 * existed. Client windows carry `?win=aux|compose|full` plus the vault they
 * belong to and the content they opened with.
 *
 * The parse is a pure function on the query string so the aux shell can be
 * driven from a test without a real second window; only `currentWindowParams`
 * touches `location`.
 */

/**
 * `full` (stage C) is a second window with the whole shell — sidebars, ribbon,
 * status bar. It is a CLIENT like the other two: it reads the vault locally and
 * delegates every write to the owner. Only the owner keeps the background
 * services, so "full" describes what the window DRAWS, never what it runs.
 */
export type WindowRole = "owner" | "aux" | "compose" | "full";

/** Every role that is not the owner — i.e. every window running in client mode. */
const CLIENT_ROLES: readonly WindowRole[] = ["aux", "compose", "full"];

/**
 * A window that opens with a prepared split instead of a single piece of
 * content (multi-window P4, plan E4).
 *
 * Deliberately NOT a window type of its own: a preset only seeds the layout of
 * an ordinary auxiliary window, so everything after the first second — closing
 * a pane, adding a tab, dragging the divider — is the behaviour every window
 * already has, and the combination stays the user's to change.
 */
export type WindowPreset = "mail-calendar";

const PRESETS: readonly WindowPreset[] = ["mail-calendar"];

export interface WindowParams {
  role: WindowRole;
  /** Absolute path of the vault this window belongs to (aux/compose only). */
  vaultPath: string | null;
  /**
   * What the window opened with: a vault-relative file path, or one of the
   * `plainva://` pseudo paths for the virtual views (graph, tasks, …).
   */
  content: string | null;
  /** Stable label of the window, mirrored from the query for the bus. */
  label: string | null;
  /** Seeds the initial split when the window has no stored layout yet (P4). */
  preset: WindowPreset | null;
}

const OWNER: WindowParams = { role: "owner", vaultPath: null, content: null, label: null, preset: null };

/** Reads the window role out of a query string. Unknown values fall back to owner. */
export function parseWindowParams(search: string): WindowParams {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const win = q.get("win");
  // An unknown or missing value is the owner: an ordinary launch has no query.
  if (!CLIENT_ROLES.includes(win as WindowRole)) return OWNER;
  const preset = q.get("preset");
  return {
    role: win as WindowRole,
    vaultPath: q.get("vault"),
    content: q.get("content"),
    label: q.get("label"),
    preset: PRESETS.includes(preset as WindowPreset) ? (preset as WindowPreset) : null,
  };
}

/**
 * Where a piece of WINDOW state is stored (multi-window C4).
 *
 * Sidebar widths, what is collapsed, which sections are open: state that
 * describes the window rather than the vault. Every window keeps its own — a
 * second window exists in order to show something else, and a shared "active
 * tab" would be actively annoying — while the central window keeps the
 * unscoped key it has always had, so existing settings survive the update.
 *
 * The scope is read here rather than passed in on purpose. It is the window's
 * own identity, constant for the life of the process, and a parameter is a
 * thing a call site can forget: the one that forgets writes into the central
 * window's key from a second window. Same rule as `layoutKey` in
 * `hooks/usePaneLayout.ts`, in one place instead of two conventions.
 *
 * Not for per-VAULT state: those keys carry the vault path and have to be
 * listed in `vaultForget.collectPerVaultLocalStorageKeys`.
 */
export function windowStateKey(base: string): string {
  const label = currentWindowParams().label;
  return label ? `${windowStatePrefix(label)}${base}` : base;
}

/**
 * Prefix of everything `windowStateKey` writes for one window.
 *
 * A PREFIX rather than the `-<label>` suffix the layout keys use, and that is
 * the whole point: `windowManager` clears a window's leftovers when a fresh
 * window takes its name, and a suffix sweep cannot tell
 * `plainva-expanded-D:/notes/full-1` (another vault's tree) from a key that
 * belongs to the window called `full-1`. With the prefix the sweep is exact and
 * needs no list of key names to stay current.
 */
export function windowStatePrefix(label: string): string {
  return `plainva-w-${label}-`;
}

/** Builds the query an auxiliary window is opened with. */
export function buildWindowQuery(params: {
  role: Exclude<WindowRole, "owner">;
  vaultPath: string;
  content?: string | null;
  label: string;
  preset?: WindowPreset | null;
}): string {
  const q = new URLSearchParams();
  q.set("win", params.role);
  q.set("vault", params.vaultPath);
  q.set("label", params.label);
  if (params.content) q.set("content", params.content);
  if (params.preset) q.set("preset", params.preset);
  return `?${q.toString()}`;
}

let cached: WindowParams | null = null;

/**
 * Params of the window this code runs in. Cached: the query never changes for
 * the lifetime of a window, and `main.tsx` asks before the first paint.
 */
export function currentWindowParams(): WindowParams {
  if (cached) return cached;
  cached = typeof window === "undefined" ? OWNER : parseWindowParams(window.location.search);
  return cached;
}

/** True in the one window that owns the background services and every write. */
export function isOwnerWindow(): boolean {
  return currentWindowParams().role === "owner";
}

/**
 * Test seam: forget the cached parse, or stand in for a window (never called by
 * the app). The argument exists because the alternative is a jsdom `location`
 * per test — for code whose whole job is to read one query string once.
 */
export function resetWindowParamsForTest(search?: string): void {
  cached = search === undefined ? null : parseWindowParams(search);
}
