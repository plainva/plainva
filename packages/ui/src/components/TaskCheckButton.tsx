import type { TaskBoxState } from "@plainva/core";
import { ICON } from "../lib/iconSizes";
import { IconButton } from "./ui/IconButton";
import { cx } from "./ui/cx";
import { TaskStateIcon } from "./TaskStateIcon";

/**
 * The box of a task row as a control (plan Befunde 2026-10-06, W1) — every task
 * list in both shells draws this one: the planner, the database section and
 * the checkboxes grouped by note.
 *
 * Two sizes are decided here and nowhere else. The TARGET is the icon button's
 * (`--control-md` with a pointer, at least `--touch-sm` under a finger); the
 * desktop's "All" list had a bare glyph with no padding, so its target was the
 * 15 px of the glyph. The GLYPH is `--taskbox-size` (18 px, 24 px on touch): it
 * was 15 px in the phone's planner, the same as an inline icon, which is what a
 * tester reported as too small to tick.
 */
export interface TaskCheckButtonProps {
  state: TaskBoxState;
  /** Accessible name and tooltip: what the box says or what a press will do — the list's own wording. */
  label: string;
  onToggle: () => void;
  disabled?: boolean;
  testId?: string;
}

export function TaskCheckButton({ state, label, onToggle, disabled, testId }: TaskCheckButtonProps) {
  return (
    <IconButton
      label={label}
      className={cx("pv-iconbtn--taskbox", state === "done" && "is-done")}
      disabled={disabled}
      onClick={onToggle}
      data-testid={testId}
      data-state={state}
    >
      <TaskStateIcon state={state} size={ICON.head} />
    </IconButton>
  );
}
