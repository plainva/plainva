/**
 * Editable-field helpers for the app's own right-click menu (webview hardening).
 * When the native WebView menu is suppressed, the Cut/Copy/Paste items in
 * components/ContextMenuHost operate through these helpers.
 *
 *  - `<input>`/`<textarea>`: mutate the value through the native value setter and
 *    dispatch an `input` event, so React-controlled fields update their state.
 *  - contenteditable (the CodeMirror editor): use execCommand insertText/delete,
 *    which fire the beforeinput/input events CodeMirror already handles.
 */

import { markdownToPlainText } from "./markdownToPlainText";

export type EditableKind = "input" | "textarea" | "contenteditable";

export interface EditableTarget {
  kind: EditableKind;
  el: HTMLElement;
  /** Selection at capture time (input/textarea only; null for contenteditable). */
  selStart: number | null;
  selEnd: number | null;
}

// Text-like input types that support selection + paste. Deliberately excludes
// checkbox/radio/button/range/number/color etc.
const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "tel", "password", ""]);

export function isTextInput(el: HTMLInputElement): boolean {
  return TEXT_INPUT_TYPES.has((el.type || "text").toLowerCase());
}

/** Resolve the editable field under a right-click target, or null. */
export function findEditable(target: EventTarget | null): EditableTarget | null {
  const el: HTMLElement | null =
    target instanceof HTMLElement ? target : target instanceof Node ? target.parentElement : null;
  if (!el) return null;

  if (el instanceof HTMLInputElement && isTextInput(el) && !el.readOnly && !el.disabled) {
    return { kind: "input", el, selStart: el.selectionStart, selEnd: el.selectionEnd };
  }
  if (el instanceof HTMLTextAreaElement && !el.readOnly && !el.disabled) {
    return { kind: "textarea", el, selStart: el.selectionStart, selEnd: el.selectionEnd };
  }
  // Nearest contenteditable host (covers the CodeMirror editor). A read-only
  // editor carries contenteditable="false", which this selector excludes.
  const ceHost = el.closest<HTMLElement>('[contenteditable=""], [contenteditable="true"]');
  if (ceHost) {
    return { kind: "contenteditable", el: ceHost, selStart: null, selEnd: null };
  }
  return null;
}

/** The currently selected text, reading the field for input/textarea (whose
 *  selection is separate from the document Selection). */
export function selectedText(editable: EditableTarget | null): string {
  if (editable && (editable.kind === "input" || editable.kind === "textarea")) {
    const el = editable.el as HTMLInputElement | HTMLTextAreaElement;
    return el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
  }
  const sel = window.getSelection();
  const raw = sel && !sel.isCollapsed ? sel.toString() : "";
  // In the live-preview editor, right-click Copy should match Ctrl+C, which
  // strips Markdown via clipboardOutputFilter. The CodeMirror contentDOM carries
  // data-pv-live-preview only in live mode; source mode and plain fields copy raw.
  if (raw && editable?.kind === "contenteditable" && editable.el.getAttribute("data-pv-live-preview") === "true") {
    return markdownToPlainText(raw);
  }
  return raw;
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function focusAndRestore(t: EditableTarget): void {
  t.el.focus();
  if ((t.kind === "input" || t.kind === "textarea") && t.selStart != null && t.selEnd != null) {
    // setSelectionRange throws on input types that do not support selection.
    try {
      (t.el as HTMLInputElement | HTMLTextAreaElement).setSelectionRange(t.selStart, t.selEnd);
    } catch {
      /* ignore */
    }
  }
}

/** Insert text at the (restored) selection, replacing it. */
export function insertIntoEditable(t: EditableTarget, text: string): void {
  focusAndRestore(t);
  if (t.kind === "contenteditable") {
    document.execCommand("insertText", false, text);
    return;
  }
  const el = t.el as HTMLInputElement | HTMLTextAreaElement;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  setNativeValue(el, el.value.slice(0, start) + text + el.value.slice(end));
  const caret = start + text.length;
  try {
    el.setSelectionRange(caret, caret);
  } catch {
    /* ignore */
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Remove the (restored) selection from the field. */
export function deleteEditableSelection(t: EditableTarget): void {
  focusAndRestore(t);
  if (t.kind === "contenteditable") {
    document.execCommand("delete");
    return;
  }
  const el = t.el as HTMLInputElement | HTMLTextAreaElement;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  if (start === end) return;
  setNativeValue(el, el.value.slice(0, start) + el.value.slice(end));
  try {
    el.setSelectionRange(start, start);
  } catch {
    /* ignore */
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
