import type { IVaultAdapter, VaultQueryService } from "@plainva/core";
import { buildNoteDatabaseContext, EMPTY_NOTE_DATABASE_CONTEXT, type NoteDatabaseContext } from "@plainva/ui";
import { buildDesktopPlanDeps } from "./cascadeDelete";

/**
 * Version-keyed cache for the note's database context (plan P4), mirroring
 * `graphCache`: building it parses every `.base` and runs a membership query
 * per database, so opening a note must not pay that twice, and switching back
 * and forth between two notes must not pay it at all.
 *
 * Keyed by (note path, index version) — an index bump is exactly when
 * membership can have changed.
 */
const cache = new Map<string, { version: number; promise: Promise<NoteDatabaseContext> }>();
/** Bounded so a long session over a big vault cannot grow without limit. */
const MAX_ENTRIES = 64;

export function loadNoteDatabaseContextCached(
  adapter: IVaultAdapter,
  queryService: VaultQueryService,
  notePath: string,
  version: number
): Promise<NoteDatabaseContext> {
  if (!notePath) return Promise.resolve(EMPTY_NOTE_DATABASE_CONTEXT);
  const hit = cache.get(notePath);
  if (hit && hit.version === version) return hit.promise;

  const promise = buildNoteDatabaseContext(buildDesktopPlanDeps(adapter, queryService), notePath).catch((e) => {
    // Context is decoration: a failure must never break opening the note.
    console.warn("[noteDatabaseContext] building the context failed", e);
    return EMPTY_NOTE_DATABASE_CONTEXT;
  });
  cache.set(notePath, { version, promise });
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return promise;
}

/** Test hook / vault switch. */
export function clearNoteDatabaseContextCache(): void {
  cache.clear();
}
