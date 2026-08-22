/**
 * Which window is this, and what was it opened with (multi-window P0).
 *
 * Every window loads the same bundle; the URL query decides what it becomes.
 * The central window ("owner") has no query at all — that is deliberate, so an
 * ordinary launch is byte-identical to what it was before multi-window
 * existed. Auxiliary windows carry `?win=aux|compose` plus the vault they
 * belong to and the content they opened with.
 *
 * The parse is a pure function on the query string so the aux shell can be
 * driven from a test without a real second window; only `currentWindowParams`
 * touches `location`.
 */

export type WindowRole = "owner" | "aux" | "compose";

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
}

const OWNER: WindowParams = { role: "owner", vaultPath: null, content: null, label: null };

/** Reads the window role out of a query string. Unknown values fall back to owner. */
export function parseWindowParams(search: string): WindowParams {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const win = q.get("win");
  if (win !== "aux" && win !== "compose") return OWNER;
  return {
    role: win,
    vaultPath: q.get("vault"),
    content: q.get("content"),
    label: q.get("label"),
  };
}

/** Builds the query an auxiliary window is opened with. */
export function buildWindowQuery(params: {
  role: Exclude<WindowRole, "owner">;
  vaultPath: string;
  content?: string | null;
  label: string;
}): string {
  const q = new URLSearchParams();
  q.set("win", params.role);
  q.set("vault", params.vaultPath);
  q.set("label", params.label);
  if (params.content) q.set("content", params.content);
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

/** Test seam: forget the cached parse (never called by the app). */
export function resetWindowParamsForTest(): void {
  cached = null;
}
