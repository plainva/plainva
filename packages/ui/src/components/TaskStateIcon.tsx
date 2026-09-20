import { CheckSquare, Square, SquareMinus, SquareSlash } from "lucide-react";
import type { TaskBoxState } from "@plainva/core";

/**
 * The box of a task as a glyph (plan Aufgaben-Oberfläche, E12): open, in
 * progress (`[/]`), done, cancelled (`[-]`). Four SHAPES, so the state never
 * rests on colour alone — every task row in both shells draws this one.
 */
const GLYPH = { open: Square, progress: SquareSlash, done: CheckSquare, cancelled: SquareMinus } as const;

export function TaskStateIcon({ state, size, className }: { state: TaskBoxState; size: number; className?: string }) {
  const Glyph = GLYPH[state];
  return <Glyph size={size} className={className} data-task-state={state} />;
}
