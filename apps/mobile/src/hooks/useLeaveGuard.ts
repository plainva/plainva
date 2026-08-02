import { useEffect } from "react";
import { armLeaveGuard, disarmLeaveGuard } from "../services/leaveGuard";

/**
 * Declares that this surface currently holds work worth a question.
 *
 * The guard follows `dirty`: an empty form never asks, and saving or sending
 * clears it, so the confirmation only appears when something would actually be
 * lost. Cleanup disarms by id, which matters because React runs a leaving
 * screen's cleanup AFTER the next screen mounted — an unqualified disarm would
 * silently switch off the guard the new screen just armed.
 */
export function useLeaveGuard(id: string, dirty: boolean, message: string): void {
  useEffect(() => {
    if (!dirty) {
      disarmLeaveGuard(id);
      return;
    }
    armLeaveGuard({ id, message });
    return () => disarmLeaveGuard(id);
  }, [id, dirty, message]);
}
