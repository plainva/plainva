import { GFM_TASK_FENCE, GFM_TASK_LINE, setChecklistTaskDone, setHtmlCheckboxChecked, type ChecklistMutationOptions, type ChecklistMutationResult } from "@plainva/core";

/** The reader, editor, cards and task overview share the same Markdown mutation. */
export const TASK_LINE_RE = GFM_TASK_LINE;
export const FENCE_RE = GFM_TASK_FENCE;
export type TaskToggleResult = ChecklistMutationResult;

export function toggleTaskAtIndex(content: string, index: number, checked: boolean, options?: ChecklistMutationOptions): TaskToggleResult {
  return setChecklistTaskDone(content, index, checked, options);
}

/** A checkbox written as HTML — the only way to put one in a table cell. */
export { setHtmlCheckboxChecked };
