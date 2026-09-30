import React, { useLayoutEffect, useRef, type HTMLAttributes } from "react";
import { Bold, Italic, Strikethrough, Code, Highlighter, Link } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EditorView } from "@codemirror/view";
import { ICON } from "../lib/iconSizes";
import { toggleInlineMark } from "./editorTouchCommands";
import { placeFloatingPanel, visibleFloatingBounds, type FloatingAnchor } from "./ui/floatingPlacement";

export type FormatAction = "bold" | "italic" | "strike" | "code" | "highlight" | "link";

export interface SelectionToolbarPosition {
  x: number;
  y: number;
  /** Render above the selection (true) or below it (near the top edge). */
  above: boolean;
  /** Reads the current coordinates without a React update on every scroll. */
  getAnchor?: () => FloatingAnchor | null;
}
interface Props extends SelectionToolbarPosition {
  onAction: (action: FormatAction) => void;
  /** Further buttons after the format actions (the desktop's AI door, plan KI-Harness P1.5). */
  extra?: React.ReactNode;
}

/** Both shells measure the real toolbar instead of assuming that its labels
 * fit to the right of a selected word. The visual viewport also accounts for
 * the phone's keyboard, zoom and changing orientation. */
export function SelectionToolbarSurface({ x, y, above, getAnchor, compactLabels = false, className = "", children, ...props }: SelectionToolbarPosition & {
  compactLabels?: boolean;
} & Omit<HTMLAttributes<HTMLDivElement>, "style">) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const viewport = window.visualViewport;
    const measure = () => {
      const anchor = getAnchor ? getAnchor() : { left: x, top: y, bottom: y };
      if (!anchor) { el.style.visibility = "hidden"; return; }
      const styles = getComputedStyle(el);
      const inset = (edge: string) => parseFloat(styles.getPropertyValue(`--selection-safe-${edge}`)) || 0;
      const bounds = visibleFloatingBounds(window, { left: inset("left"), right: inset("right"), top: inset("top"), bottom: inset("bottom") });
      const available = Math.max(0, bounds.right - bounds.left);
      el.style.maxWidth = `${available}px`;
      el.style.maxHeight = `${Math.max(0, bounds.bottom - bounds.top)}px`;
      if (compactLabels) {
        // Measure the labelled state each time, so compacting cannot create a
        // wide/narrow feedback loop through ResizeObserver.
        el.removeAttribute("data-compact");
        const childrenWidth = Array.from(el.children).reduce((sum, child) => sum + (child as HTMLElement).offsetWidth, 0);
        const gap = parseFloat(styles.columnGap) || 0;
        const padding = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0) + 2;
        el.toggleAttribute("data-compact", childrenWidth + gap * Math.max(0, el.children.length - 1) + padding > available);
      }
      const { left, top } = placeFloatingPanel(anchor, { width: el.offsetWidth, height: el.offsetHeight }, bounds, above, getAnchor ? 8 : 0);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.visibility = "visible";
    };
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(el);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
    };
  }, [x, y, above, getAnchor, compactLabels]);
  return <div {...props} ref={ref} className={`pv-popover--fixed pv-seltoolbar ${className}`}>{children}</div>;
}

/**
 * Floating formatting toolbar over a non-empty selection (#5), shared since
 * S18 so the phone gets the same six actions rather than a second set.
 *
 * `onMouseDown`/`onPointerDown` preventDefault is essential: it keeps the
 * editor's selection and focus while a button is pressed, so the formatting
 * applies to the range the user actually marked. On touch that matters more,
 * not less — a tap that drops the selection would format nothing.
 */
export const SelectionToolbar: React.FC<Props> = ({ x, y, above, getAnchor, onAction, extra }) => {
  const { t } = useTranslation();
  const items: { a: FormatAction; icon: React.ReactNode; label: string }[] = [
    { a: "bold", icon: <Bold size={ICON.ui} />, label: t("editor.fmtBold", { defaultValue: "Fett" }) },
    { a: "italic", icon: <Italic size={ICON.ui} />, label: t("editor.fmtItalic", { defaultValue: "Kursiv" }) },
    { a: "strike", icon: <Strikethrough size={ICON.ui} />, label: t("editor.fmtStrike", { defaultValue: "Durchgestrichen" }) },
    { a: "code", icon: <Code size={ICON.ui} />, label: t("editor.fmtCode", { defaultValue: "Inline-Code" }) },
    { a: "highlight", icon: <Highlighter size={ICON.ui} />, label: t("editor.fmtHighlight", { defaultValue: "Markierung" }) },
    { a: "link", icon: <Link size={ICON.ui} />, label: t("editor.fmtLink", { defaultValue: "Link" }) },
  ];

  return (
    <SelectionToolbarSurface
      role="toolbar"
      aria-label={t("editor.fmtToolbar", { defaultValue: "Formatierung" })}
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => e.preventDefault()}
      x={x}
      y={y}
      above={above}
      getAnchor={getAnchor}
    >
      {items.map((it) => (
        <button
          key={it.a}
          type="button"
          data-tip={it.label}
          aria-label={it.label}
          onClick={() => onAction(it.a)}
          className="pv-iconbtn"
        >
          {it.icon}
        </button>
      ))}
      {extra}
    </SelectionToolbarSurface>
  );
};

/**
 * Applies a toolbar action to the current selection (shared since S18).
 *
 * The six actions are the same on both shells, so the logic is too — including
 * the one case that is not a simple marker: a link cannot span lines, and the
 * caller is told rather than left with a broken one.
 */
export function applySelectionFormat(
  view: EditorView,
  action: FormatAction,
  onMultilineLink: () => void,
): void {
  const sel = view.state.selection.main;
  if (sel.empty) return;
  const text = view.state.sliceDoc(sel.from, sel.to);
  if (action === "link") {
    if (/\r?\n/.test(text)) {
      onMultilineLink();
      view.focus();
      return;
    }
    const insert = `[${text}](url)`;
    const urlAt = sel.from + 1 + text.length + 2; // the "url" placeholder
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: urlAt, head: urlAt + 3 },
      userEvent: "input",
    });
    view.focus();
    return;
  }
  const marker =
    action === "bold" ? "**"
    : action === "italic" ? "*"
    : action === "strike" ? "~~"
    : action === "code" ? "`"
    : "==";
  toggleInlineMark(view, marker);
}
