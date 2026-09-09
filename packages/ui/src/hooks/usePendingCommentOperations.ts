import { useCallback, useEffect, useState } from "react";
import type { CommentOperation, CommentOperationService } from "@plainva/core";

export function usePendingCommentOperations(service: CommentOperationService | null, contextKey: string | null, path: string | null) {
  const [state, setState] = useState<{ service: CommentOperationService | null; path: string | null; operations: CommentOperation[]; failed: boolean }>({ service: null, path: null, operations: [], failed: false });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!service || !contextKey || !path) return;
    let active = true;
    let generation = 0;
    const read = async () => {
      const current = ++generation;
      try {
        const operations = await service.pending(path);
        if (active && generation === current) setState({ service, path, operations, failed: false });
      } catch {
        if (active && generation === current) setState((old) => ({ service, path,
          operations: old.service === service && old.path === path ? old.operations : [], failed: true }));
      }
    };
    const changed = (event: Event) => {
      const d = (event as CustomEvent<{ vaultPath?: string; vaultId?: string }>).detail;
      if ((d.vaultPath ?? d.vaultId) === contextKey) void read();
    };
    void read();
    window.addEventListener("plainva-comment-operation-changed", changed);
    return () => { active = false; window.removeEventListener("plainva-comment-operation-changed", changed); };
  }, [service, contextKey, path, tick]);
  return { operations: state.service === service && state.path === path ? state.operations : [],
    failed: state.service === service && state.path === path && state.failed, refresh };
}
