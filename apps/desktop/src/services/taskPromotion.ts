/**
 * Checkbox-task promotion (PIM plan, package 1a).
 *
 * Moved to `@plainva/ui` (S23) so the phone promotes through the exact same
 * path — same storage-folder resolution, same stale guard, same line rewrite.
 * Re-exported here so every existing import keeps working.
 */
export {
  taskTextToTitle,
  taskFileStem,
  replaceCheckboxWithLink,
  findColumnKey,
  promoteTask,
  createTaskInDatabase,
} from "@plainva/ui";
export type {
  CheckboxReplaceResult,
  PromoteTaskOptions,
  PromoteTaskResult,
  CreateTaskOptions,
} from "@plainva/ui";
