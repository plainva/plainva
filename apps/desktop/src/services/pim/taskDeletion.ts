/**
 * Confirmed task deletion with an undo window (E4b/E4c).
 *
 * Moved to `@plainva/ui` alongside the reconciler that carries the order out.
 * Re-exported here so every existing import keeps working.
 *
 * The one thing that CANNOT move is the "we are going away" event: the desktop
 * has `beforeunload`, the phone has `appStateChange`. Wiring it here keeps the
 * shared module free of a listener that would be right on one shell and
 * silently dead on the other — see `cancelInFlightTaskDeletion`.
 */
import { cancelInFlightTaskDeletion } from "@plainva/ui";

export {
  initTaskDeletion,
  collectTaskAnchors,
  requestTaskDeletion,
  taskDeletionsInFlight,
  pendingTaskDeletions,
  resolveTaskDeletion,
  cancelInFlightTaskDeletion,
  __resetTaskDeletionsForTest,
  UNDO_SEND_MS,
} from "@plainva/ui";
export type { TaskDeletionOrder, TaskDeletionDeps } from "@plainva/ui";

if (typeof window !== "undefined") {
  // Cancel, not flush: the safe end of an interrupted deletion is that the task
  // still exists. Mail flushes on the same event for the opposite reason.
  window.addEventListener("beforeunload", () => {
    cancelInFlightTaskDeletion();
  });
}
