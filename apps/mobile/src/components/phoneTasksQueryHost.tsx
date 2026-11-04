import { createRoot } from "react-dom/client";
import type { TasksQueryHost } from "@plainva/ui";
import type { MobileVault } from "../services/vaultService";
import { PhoneTasksQuery } from "./PhoneTasksQuery";

/**
 * The phone's ```tasks blocks in the editor (plan Tasks-Abfragen, T6): each a
 * React root drawing `PhoneTasksQuery`. Like the desktop's host it holds every
 * root it mounted and draws them again when the editor hands it new props —
 * the mode (reading or writing) decides what "Edit query" does.
 */
export interface PhoneTasksQueryHostProps {
  vault: MobileVault;
  notePath: string;
  editable: boolean;
  onOpenNote: (path: string) => void;
  /** Switches to writing with the caret at `range` (the screen's "Edit"); absent where the note cannot be written. */
  onEditAt?: (range: { from: number; to: number }) => void;
}

export interface PhoneTasksQueryHost extends TasksQueryHost {
  update(props: PhoneTasksQueryHostProps): void;
}

export function createPhoneTasksQueryHost(): PhoneTasksQueryHost {
  let props: PhoneTasksQueryHostProps | null = null;
  const mounted = new Set<() => void>();
  return {
    update(next) {
      props = next;
      for (const draw of mounted) draw();
    },
    render(container, context) {
      const root = createRoot(container);
      const draw = () => {
        const p = props;
        if (!p) return;
        // Writing: the caret goes into the query. Reading: first to writing,
        // with the caret at the same place (the reader has no caret).
        const editQuery = p.editable
          ? context.editQuery
          : p.onEditAt
            ? (line: number | null) => {
                // The screen's "Edit" keeps the selection the editor holds:
                // put the caret there first, then switch to writing.
                const at = context.positionOf(line);
                context.view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
                p.onEditAt?.({ from: at, to: at });
              }
            : null;
        root.render(
          <PhoneTasksQuery
            vault={p.vault}
            source={context.source}
            notePath={p.notePath}
            onOpenNote={p.onOpenNote}
            onEditQuery={editQuery ?? undefined}
            changeNote={context.changeNote}
          />,
        );
      };
      mounted.add(draw);
      draw();
      return () => {
        mounted.delete(draw);
        queueMicrotask(() => root.unmount());
      };
    },
  };
}
