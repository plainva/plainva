import { useCallback, useEffect, useRef, useState } from "react";
import { searchOrderId, type SearchOrder, type SearchPageCursor, type SearchResult, type VaultQueryService } from "@plainva/core";

const EMPTY: SearchResult[] = [];
type SearchService = Pick<VaultQueryService, "searchOccurrencesPage">;
interface State { query: string; order: string; service: SearchService | null | undefined; revision: number; hits: SearchResult[]; next: SearchPageCursor | null; loading: boolean; failed: boolean }

/** One cancellation and paging contract for all three search surfaces. */
/** `order` is part of the request (finding 2026-09-19): a new order starts the list over, exactly like a new query. */
export function useSearchPages(service: SearchService | null | undefined, query: string, revision = 0, limit = 40, order: SearchOrder | null = null) {
  const orderId = searchOrderId(order);
  const orderKey = order?.key ?? "relevance";
  const orderDir = order?.dir ?? "desc";
  const request = useRef<AbortController | null>(null);
  const [state, setState] = useState<State>({ query: "", order: orderId, service, revision, hits: EMPTY, next: null, loading: false, failed: false });
  const load = useCallback((cursor: SearchPageCursor | null) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const initial: State = { query, order: orderId, service, revision, hits: EMPTY, next: null, loading: true, failed: false };
    setState((previous) => cursor ? { ...previous, loading: true, failed: false } : initial);
    if (!service || !query.trim()) { setState({ ...initial, loading: false }); return; }
    void service.searchOccurrencesPage(query, { cursor, limit, signal: controller.signal, order: orderKey === "relevance" ? null : { key: orderKey, dir: orderDir } }).then((page) => {
      if (controller.signal.aborted) return;
      setState((previous) => {
        const combined = cursor ? [...previous.hits, ...page.hits] : page.hits;
        const unique = [...new Map(combined.map((hit) => [`${hit.path}\0${hit.occurrence?.from ?? "file"}`, hit])).values()];
        return { ...initial, hits: unique, next: page.next, loading: false };
      });
    }).catch(() => { if (!controller.signal.aborted) setState((previous) => ({ ...(cursor ? previous : initial), loading: false, failed: true })); });
  }, [service, query, revision, limit, orderId, orderKey, orderDir]);
  useEffect(() => { load(null); return () => request.current?.abort(); }, [load]);
  const current = state.query === query && state.order === orderId && state.service === service && state.revision === revision;
  return {
    hits: current ? state.hits : EMPTY,
    loading: current ? state.loading : Boolean(query.trim()),
    failed: current && state.failed,
    hasMore: current && state.next !== null,
    loadMore: () => { if (current && state.next && !state.loading) load(state.next); },
    retry: () => load(null),
  };
}

const remembered = new Map<string, { query: string; scrollTop: number; visibleCount: number }>();
export function recallSearchSession(vault: string) { return remembered.get(vault); }
export function rememberSearchSession(vault: string, query: string, scrollTop: number, visibleCount = 0) {
  remembered.delete(vault);
  remembered.set(vault, { query, scrollTop, visibleCount });
  if (remembered.size > 16) remembered.delete(remembered.keys().next().value!);
}
