import { GFM_TASK_LINE, setChecklistTaskDone, setHtmlCheckboxChecked, type ChecklistMutationOptions, type ChecklistMutationResult } from "@plainva/core";

/**
 * The reader, editor, cards and task overview share the same Markdown mutation.
 * Fenced code — a fence inside a quote or a callout included — is the one rule
 * of `createFenceTracker` (core `markdownFence.ts`); there is no pattern for it
 * to copy (finding 2026-10-25).
 */
export const TASK_LINE_RE = GFM_TASK_LINE;
export type TaskToggleResult = ChecklistMutationResult;

export function toggleTaskAtIndex(content: string, index: number, checked: boolean, options?: ChecklistMutationOptions): TaskToggleResult {
  return setChecklistTaskDone(content, index, checked, options);
}

/** A checkbox written as HTML — the only way to put one in a table cell. */
export { setHtmlCheckboxChecked };
