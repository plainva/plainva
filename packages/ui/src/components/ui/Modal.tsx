import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { IconButton } from "./IconButton";
import { cx } from "./cx";

/** Open-modal stack: Escape only ever closes the TOPMOST modal, so nested
 * modals (Settings → Shortcuts, appConfirm over anything) unwind one by one. */
const modalStack: symbol[] = [];

/**
 * Whether a modal is open right now. A surface outside this stack that takes
 * Escape for itself can ask this first, so that the key still goes to the
 * dialog on top — the floating composer does, for the question about itself.
 */
export function isModalOpen(): boolean {
  return modalStack.length > 0;
}

export type ModalSize = "sm" | "md" | "lg" | "xl";

export interface ModalProps {
  onClose: () => void;
  title: string;
  /** Optional leading header icon (sweep 2026-07-19) — lets wizard-style and
   * easter-egg dialogs keep their identity without hand-rolled headers. */
  icon?: ReactNode;
  /**
   * One quiet line of context after the title, before the X — where the
   * thing being made will land ("lands in Zettel/"). Not a second heading.
   */
  headerNote?: ReactNode;
  size?: ModalSize;
  children: ReactNode;
  /** Right-aligned action row; omit for plain content dialogs. */
  footer?: ReactNode;
  /** Click on the dimmed backdrop closes (default true). */
  closeOnOverlay?: boolean;
  /** Hide the X button (e.g. blocking progress dialogs). */
  hideClose?: boolean;
  /** Focused after mount instead of the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  bodyClassName?: string;
  /** Extra class on the backdrop (e.g. pv-overlay--dialog for the appDialog layer). */
  overlayClassName?: string;
  /** Overrides the accessible name (defaults to title). */
  ariaLabel?: string;
  /** data-testid on the dialog panel (e2e). */
  testId?: string;
}

/**
 * THE modal (plan Designsprache P2): one overlay, one panel (radius xl,
 * --shadow-3, --z-modal), one header with title + X, optional footer.
 * Focus-trapped; Escape and (configurable) overlay click close. Mount it
 * conditionally — `{open && <Modal …>}` — like the dialogs it replaces.
 * Themes restyle via .pv-overlay/.pv-modal/.pv-modal-heading (LCARS elbow).
 */
export function Modal({
  onClose,
  title,
  icon,
  headerNote,
  size = "sm",
  children,
  footer,
  closeOnOverlay = true,
  hideClose = false,
  initialFocusRef,
  className,
  bodyClassName,
  overlayClassName,
  ariaLabel,
  testId,
}: ModalProps) {
  const { t } = useTranslation();
  // Focus the PANEL, not the first control: the first focusable is the X
  // close button, which otherwise opened every dialog with the button lit
  // in its hover/focus look (maintainer report 2026-07-06).
  const trapRef = useFocusTrap(true, "container");
  const stackIdRef = useRef<symbol | null>(null);
  if (stackIdRef.current === null) stackIdRef.current = Symbol("pv-modal");

  useEffect(() => {
    const id = stackIdRef.current!;
    modalStack.push(id);
    return () => {
      const i = modalStack.indexOf(id);
      if (i >= 0) modalStack.splice(i, 1);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (modalStack[modalStack.length - 1] !== stackIdRef.current) return;
      // A menu lies in front of every dialog and closes on Escape itself. Both
      // listen on the document, so which of them hears the key first is the
      // order they were attached in — and a menu opened by something inside
      // the dialog that keeps its own state is attached after the dialog: the
      // dialog closed, menu and all. The key is the menu's.
      if (document.querySelector('.pv-menu[role="menu"]')) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    initialFocusRef?.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={cx("pv-overlay", overlayClassName)}
      onMouseDown={(e) => {
        if (closeOnOverlay && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        data-testid={testId}
        tabIndex={-1}
        className={cx("pv-modal", `pv-modal--${size}`, className)}
      >
        <div className="pv-modal-header">
          {icon ? <span className="pv-modal-hicon">{icon}</span> : null}
          <h2 className="pv-modal-heading">{title}</h2>
          {headerNote ? <span className="pv-modal-note">{headerNote}</span> : null}
          {!hideClose && (
            <IconButton label={t("common.close", { defaultValue: "Schließen" })} onClick={onClose}>
              <X size={15} />
            </IconButton>
          )}
        </div>
        <div className={cx("pv-modal-body", bodyClassName)}>{children}</div>
        {footer ? <div className="pv-modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
