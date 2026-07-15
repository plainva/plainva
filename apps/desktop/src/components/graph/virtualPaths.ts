/**
 * Virtual tab paths (D1): the vault map lives in the normal tab/pane system
 * under a pseudo path. Anything that treats tab paths as vault FILES (save,
 * icons, reveal, rename, recent lists) must guard with isVirtualPath().
 * Virtual paths never reach the index, so index-driven surfaces (quick
 * switcher, search, tree) can never produce them by themselves.
 */

export const GRAPH_TAB_PATH = "plainva://graph";
export const TASKS_TAB_PATH = "plainva://tasks";

export function isVirtualPath(path: string | null | undefined): boolean {
  return typeof path === "string" && path.startsWith("plainva://");
}
