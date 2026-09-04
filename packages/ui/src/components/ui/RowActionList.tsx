import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { RowActionSpec, RowActionT } from "../../lib/rowActions";

/**
 * Renders one of the shared row-action lists (`lib/rowActions.ts`) through a
 * caller-supplied row renderer.
 *
 * Why a component and not a plain call: the handlers a list carries usually
 * read refs when they run (a sequence counter, the open message), and the
 * React Compiler refuses to see such a function handed to an opaque call
 * during render — the call might invoke it. Behind a component boundary the
 * handlers arrive as props, which is what handlers are for; the build happens
 * here, where the compiler can see it is only a map.
 */
export function RowActionList({
  build,
  children,
}: {
  /** Builds the list for this surface — usually `(t) => mailRowActions(t, caps)`. */
  build: (t: RowActionT) => RowActionSpec[];
  /** Renders one entry; receives the whole list so a renderer can place separators. */
  children: (action: RowActionSpec, index: number, all: RowActionSpec[]) => ReactNode;
}) {
  const { t } = useTranslation();
  const list = build(t as RowActionT);
  return <>{list.map((a, i) => children(a, i, list))}</>;
}
