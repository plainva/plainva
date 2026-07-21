import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { initialSelection, planNeedsDialog, selectedPaths, type CascadeSelection, type DeletionPlan } from "@plainva/ui";
import { useVault } from "../contexts/VaultContext";
import { toast } from "@plainva/ui";
import { confirmDeletion, confirmLargeDeletion, isLargeDeletion } from "../services/deleteConfirm";
import {
  buildDesktopDeletionPlan,
  cascadeDeleteStore,
  executeDeletionPlan,
} from "../services/cascadeDelete";
import { getTaskDatabasePath } from "../services/taskDatabase";
import { applyIndexChanges } from "../services/fileActions";
import { notifyFileOps } from "../services/indexMdAutoUpdate";
import { CascadeDeleteModal } from "./CascadeDeleteModal";

/**
 * App-level host of the cascade deletion flow: every delete entry point calls
 * requestCascadeDelete(); this host builds the plan and either runs the
 * EXISTING slim confirmation (nothing cascades — behavior identical to
 * before) or shows the cascade dialog, runs the unchanged large-deletion
 * second prompt, executes, reindexes and reports the deleted paths upward
 * (tab + bookmark cleanup live in App).
 */

function norm(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function CascadeDeleteHost({ onDeleted }: { onDeleted: (paths: string[]) => void }) {
  const { t } = useTranslation();
  const { vaultAdapter, queryService, indexer, syncWorker, vaultPath, triggerFileTreeUpdate } = useVault();
  const request = useSyncExternalStore(cascadeDeleteStore.subscribe, cascadeDeleteStore.getSnapshot);

  const [plan, setPlan] = useState<DeletionPlan | null>(null);
  const [taskDbAffected, setTaskDbAffected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Deps snapshot for the async pipeline (the request can outlive a render);
  // updated in an effect — refs must not change during render (compiler rule).
  const depsRef = useRef({ vaultAdapter, queryService, indexer, syncWorker, vaultPath, triggerFileTreeUpdate, onDeleted, t });
  useEffect(() => {
    depsRef.current = { vaultAdapter, queryService, indexer, syncWorker, vaultPath, triggerFileTreeUpdate, onDeleted, t };
  });

  const vaultFileCount = async (): Promise<number> => {
    const d = depsRef.current;
    if (!d.queryService) return 0;
    try {
      // Same base the tree-side confirmations use for the 20% threshold.
      return (await d.queryService.listNotes()).length;
    } catch {
      return 0;
    }
  };

  const finish = (deleted: boolean) => {
    setPlan(null);
    setBusy(false);
    setProgress(null);
    cascadeDeleteStore.settle(deleted);
  };

  const execute = async (p: DeletionPlan, selection: CascadeSelection) => {
    const d = depsRef.current;
    if (!d.vaultAdapter || !d.queryService) {
      finish(false);
      return;
    }
    setBusy(true);
    const result = await executeDeletionPlan({
      adapter: d.vaultAdapter,
      queryService: d.queryService,
      indexer: d.indexer ?? null,
      syncWorker: d.syncWorker ?? null,
      vaultPath: d.vaultPath ?? null,
      plan: p,
      selection,
      onProgress: (done, total) => setProgress({ done, total }),
    });
    try {
      if (d.indexer) {
        await applyIndexChanges(d.indexer, { removed: result.deleted, added: result.cleanedSources });
      }
      d.onDeleted(result.deleted);
      d.triggerFileTreeUpdate();
      notifyFileOps(result.deleted.map((path) => ({ type: "delete" as const, path })));
    } catch (e) {
      console.error("cascade post-delete refresh failed", e);
    }
    if (result.errors.length > 0) {
      toast.error(d.t("dialogs.bulkErrorsMsg", { count: result.errors.length, names: result.errors.join(", ") }));
    } else if (result.deleted.length > 0) {
      toast.info(d.t("cascade.deletedToast", { count: result.deleted.length }));
    }
    finish(result.deleted.length > 0);
  };

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    (async () => {
      const d = depsRef.current;
      if (!d.vaultAdapter || !d.queryService || request.paths.length === 0) {
        finish(false);
        return;
      }
      try {
        const p = await buildDesktopDeletionPlan(d.vaultAdapter, d.queryService, request.paths);
        if (cancelled) return;

        if (!planNeedsDialog(p)) {
          // Nothing hangs off this delete — the EXISTING slim flow, verbatim.
          const total = await vaultFileCount();
          const ok = await confirmDeletion({
            t: d.t,
            single:
              request.paths.length === 1
                ? { name: request.paths[0].split(/[/\\]/).pop() ?? request.paths[0], isFolder: false }
                : undefined,
            rootCount: request.paths.length,
            fileCount: request.paths.length,
            vaultFileCount: total,
            syncActive: !!d.syncWorker,
          });
          if (!ok || cancelled) {
            finish(false);
            return;
          }
          await execute(p, initialSelection(p));
          return;
        }

        let affected = false;
        if (d.vaultPath && p.affectedBases.length > 0) {
          const configured = await getTaskDatabasePath(d.vaultPath);
          affected = !!configured && p.affectedBases.some((b) => norm(configured) === norm(b));
        }
        if (cancelled) return;
        setTaskDbAffected(affected);
        setPlan(p);
      } catch (e) {
        console.error("cascade plan failed", e);
        toast.error(d.t("dialogs.deleteFailedMsg", { error: e instanceof Error ? e.message : String(e) }));
        finish(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  if (!request || !plan) return null;

  return (
    <CascadeDeleteModal
      plan={plan}
      syncActive={!!syncWorker}
      taskDbAffected={taskDbAffected}
      busy={busy}
      progress={progress}
      onCancel={() => finish(false)}
      onConfirm={(selection) => {
        void (async () => {
          const count = selectedPaths(plan, selection).length;
          const total = await vaultFileCount();
          if (isLargeDeletion(count, total)) {
            const ok = await confirmLargeDeletion(depsRef.current.t, count, total, !!depsRef.current.syncWorker);
            if (!ok) return; // stay in the dialog
          }
          await execute(plan, selection);
        })();
      }}
    />
  );
}
