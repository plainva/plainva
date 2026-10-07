import { type HTMLAttributes, type ReactNode, type Ref } from "react";
import { Button } from "./Button";
import { cx } from "./cx";

/**
 * The row of the context column (plan Befunde 2026-10-06, R2):
 *
 *     icon · name · value · edge
 *
 * Properties, the trust group and the database section each had a grid of
 * their own — four in one column — and every value type brought its own left
 * edge on top. This is the one row they all draw now. What it fixes is not a
 * look but four positions: the icon, where the name starts, where EVERY value
 * starts, and where the things a row can do stand.
 *
 * The layout lives in ui.css (`.pv-prow`); below the compact step of the
 * column (`data-side-step` on an ancestor) the name moves above the value.
 * The component is deliberately markup only — no state, no measuring — so the
 * phone and the peek window get the same grammar by rendering it.
 */
export interface PropRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Icon column: a glyph, or the button that opens the type menu. */
  icon?: ReactNode;
  /** Name column. Text wraps; an editable name passes its field. */
  name: ReactNode;
  /** The value. Always starts at the same left edge. */
  children?: ReactNode;
  /**
   * What stands in the edge at rest — lock, select caret, "add". One glyph.
   */
  edge?: ReactNode;
  /**
   * What the row offers on hover and on keyboard focus (comment, delete). They
   * open inside the edge and lay over it; the value never moves.
   */
  actions?: ReactNode;
  /** The actions stay visible at rest (a comment count nobody has to hover for). */
  actionsPinned?: boolean;
  /**
   * The edge glyph stays where it is while the actions show — they open beside
   * it. For a glyph that carries information of its own (the lock names the
   * key in its tooltip), which the actions must not cover.
   */
  keepEdge?: boolean;
  /**
   * `quiet`: the value looks like text and gets a frame on hover and while it
   * is edited. `none`: nothing to edit here (a computed field, a switch).
   */
  frame?: "quiet" | "none";
  /** Value type, for the few rules that depend on it. */
  kind?: string;
}

export function PropRow({ icon, name, children, edge, actions, actionsPinned, keepEdge, frame = "none", kind, className, ...rest }: PropRowProps) {
  return (
    <div className={cx("pv-prow", className)} data-frame={frame} data-kind={kind} {...rest}>
      <span className="pv-prow-icon">{icon}</span>
      <div className="pv-prow-name">{name}</div>
      <div className="pv-prow-value">{children}</div>
      <div className="pv-prow-edge" data-keep={keepEdge ? "true" : undefined}>
        {edge != null && edge !== false && <span className="pv-prow-rest">{edge}</span>}
        {actions != null && actions !== false && (
          <span className="pv-prow-actions" data-pinned={actionsPinned ? "true" : undefined}>{actions}</span>
        )}
      </div>
    </div>
  );
}

/** Divides a section: icon, uppercase label, one trailing chip. */
export function PropGroupHead({ icon, children, trailing, className, ...rest }: Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  icon?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className={cx("pv-prow-group", className)} {...rest}>
      <span className="pv-prow-icon">{icon}</span>
      <span className="pv-prow-group-label">{children}</span>
      {trailing != null && <span className="pv-prow-group-trailing">{trailing}</span>}
    </div>
  );
}

/** Ends a section: something the section can do, as a row rather than a button bar. */
export function PropActionRow({ icon, children, onClick, testId, buttonRef, expanded }: {
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  testId?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  /** Set when the row opens a popover, so assistive technology hears its state. */
  expanded?: boolean;
}) {
  return (
    <Button ref={buttonRef} variant="ghost" size="sm" className="pv-prow-action" icon={icon} onClick={onClick} data-testid={testId} aria-expanded={expanded}>
      {children}
    </Button>
  );
}

/**
 * Names what the rows under it belong to: icon, a name with a muted second
 * part (a database and its view), and one trailing control (the pager).
 */
export function PropLine({ icon, children, trailing, className, ...rest }: Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  icon?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className={cx("pv-prow-line", className)} {...rest}>
      <span className="pv-prow-icon">{icon}</span>
      <div className="pv-prow-line-main">{children}</div>
      {trailing != null && <div className="pv-prow-line-trailing">{trailing}</div>}
    </div>
  );
}
