import { useEffect } from "react";
import { toast, type FileOp } from "@plainva/ui";
import { useTranslation } from "react-i18next";
import type { CommentPathMove } from "@plainva/core";
import { mobileCommentStore } from "../services/mobileComments";
import type { MobileVault } from "../services/vaultService";

/**
 * A renamed or moved note keeps its remarks on the phone (Nachschaerfung, N1).
 *
 * Every rename path of the shell - the note's rename, a folder rename, "move
 * to" - reports itself through `plainva-file-ops` AFTER it succeeded, the same
 * event the desktop's vault context listens to. This is the one place that
 * turns those reports into move markers in the bundle; a failure leaves the
 * rename standing and says so, exactly like a failed link update.
 *
 * Its own hook rather than an effect in `App.tsx`, for the same reason the
 * notifier's deps live in one: a shell capability with a name and a test.
 */
export function useCommentMoves(vault: MobileVault | null): void {
  const { t } = useTranslation();
  useEffect(() => {
    if (!vault) return;
    const onOps = (event: Event) => {
      const ops = (event as CustomEvent<{ ops?: FileOp[] }>).detail?.ops ?? [];
      const moves: CommentPathMove[] = [];
      for (const op of ops) if (op.type === "move") moves.push({ from: op.from, to: op.to, folder: op.isFolder === true });
      if (moves.length === 0) return;
      void mobileCommentStore(vault).recordMoves(moves).catch((error) => {
        console.error("[comments] moves not recorded", error);
        toast.warning(t("workspaceSecurity.commentMoveFailed"));
      });
    };
    window.addEventListener("plainva-file-ops", onOps);
    return () => window.removeEventListener("plainva-file-ops", onOps);
  }, [vault, t]);
}
