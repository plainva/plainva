// The runner and the draft builder moved to @plainva/ui (C33, 2026-09-04) so
// the phone blocks through the same code; re-exported here so every existing
// import path keeps working.
export {
  runCalendarBlocks,
  isAuthorizationFailure,
  blockFailureReason,
  blockFailureStatus,
} from "@plainva/ui";
export type { CalendarBlockFailure, CalendarBlockOutcome, RunCalendarBlocksInput } from "@plainva/ui";
