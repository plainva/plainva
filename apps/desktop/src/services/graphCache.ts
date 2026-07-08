import type { GraphService, VaultGraph } from "@plainva/core";

/**
 * Version-keyed cache for the fully resolved vault graph (P2.6). The context
 * sidebar reloads on every file switch AND every index bump; without a cache
 * each of those re-reads and re-resolves every link row of the vault. One
 * graph per (service, option set) stays valid for as long as the index
 * version (fileTreeVersion) is unchanged — plain file switches become hits.
 */
const cache = new WeakMap<GraphService, Map<string, { version: number; promise: Promise<VaultGraph> }>>();

export function loadGraphCached(
  service: GraphService,
  version: number,
  opts: { includeAttachments?: boolean } = {}
): Promise<VaultGraph> {
  const key = opts.includeAttachments ? "att" : "plain";
  let byKey = cache.get(service);
  if (!byKey) {
    byKey = new Map();
    cache.set(service, byKey);
  }
  const hit = byKey.get(key);
  if (hit && hit.version === version) return hit.promise;

  const promise = service.loadGraph(opts);
  byKey.set(key, { version, promise });
  // A failed load must not stick around as a poisoned entry.
  promise.catch(() => {
    if (byKey.get(key)?.promise === promise) byKey.delete(key);
  });
  return promise;
}
