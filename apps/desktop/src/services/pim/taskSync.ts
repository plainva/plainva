/**
 * Task <-> note reconciler (PIM stage 3).
 *
 * Moved to `@plainva/ui` so the phone runs the exact same reconcile — same
 * three-way merge by uid, same anchor adoption, same data-safety rules. What
 * stays shell-side is only WHICH `.base` this vault designated
 * (`getTaskDatabasePath`), and that arrives as a value (`taskDbPath`).
 * Re-exported here so every existing import keeps working.
 */
export { runTaskSync, readNoteFields, applyFieldsToNote } from "@plainva/ui";
export type { TaskSyncAdapter, TaskSyncOptions, TaskSyncResult } from "@plainva/ui";
