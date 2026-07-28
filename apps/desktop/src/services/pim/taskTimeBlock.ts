/**
 * "Block time" on a task (issue #34, wave 3).
 *
 * Moved to `@plainva/ui` (S24) so the phone creates the same event, writes the
 * same `plainva.blocks` anchor and treats a failed anchor the same way — as a
 * warning, never a rollback. Re-exported here so every import keeps working.
 */
export { createTaskTimeBlock, readTaskBlocks } from "@plainva/ui";
export type {
  TaskBlockAnchor,
  CreateTaskTimeBlockOptions,
  CreateTaskTimeBlockResult,
} from "@plainva/ui";
