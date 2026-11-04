import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import type { i18n as I18nInstance } from "i18next";
import type { TasksQueryHost } from "@plainva/ui";
import { VaultContext } from "../contexts/VaultContext";
import { TasksQueryView } from "./tasks/TasksQueryView";

/**
 * The desktop's ```tasks blocks in the live editor (plan Tasks-Abfragen, T4):
 * each block a React root with the vault context, drawing `TasksQueryView`.
 *
 * A root mounted inside CodeMirror does not see the editor's React tree, so it
 * would keep the vault context it was mounted with — and with it the index
 * state, and a block would never follow a change. The host therefore holds
 * every root it mounted and draws them again whenever the editor hands it new
 * props (`update`), which the editor does on every change of its context.
 */
export interface TasksQueryHostProps {
  i18n: I18nInstance;
  vaultContext: unknown;
  /** The note the editor holds. */
  notePath: string;
  onOpenPath?: (path: string, newTab: boolean) => void;
}

export interface DesktopTasksQueryHost extends TasksQueryHost {
  update(props: TasksQueryHostProps): void;
}

export function createTasksQueryHost(): DesktopTasksQueryHost {
  let props: TasksQueryHostProps | null = null;
  const mounted = new Set<() => void>();
  return {
    update(next) {
      props = next;
      for (const draw of mounted) draw();
    },
    render(container, context) {
      const root = createRoot(container);
      const draw = () => {
        if (!props) return;
        root.render(
          <I18nextProvider i18n={props.i18n}>
            <VaultContext.Provider value={props.vaultContext as never}>
              <TasksQueryView
                source={context.source}
                notePath={props.notePath}
                onOpenPath={props.onOpenPath}
                onEditQuery={context.editQuery}
                changeNote={context.changeNote}
              />
            </VaultContext.Provider>
          </I18nextProvider>,
        );
      };
      mounted.add(draw);
      draw();
      return () => {
        mounted.delete(draw);
        // Not inside CodeMirror's update: React must not unmount during a render.
        queueMicrotask(() => root.unmount());
      };
    },
  };
}
