import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";

/**
 * "The user is genuinely editing" — contenteditable AND not read-only.
 *
 * The touch read mode (mobile, see EditorSessionConfig.touchInput) keeps
 * contenteditable ON so the WebView paints a native, extendable text selection,
 * but sets EditorState.readOnly + inputmode="none". Editing affordances — block
 * grips, raw-markdown reveal at the caret/selection, cursor-placing taps — must
 * gate on THIS, not on EditorView.editable alone, so read mode stays calm and
 * rendered while still selectable, and link taps navigate instead of placing a
 * caret. Off-touch (desktop) readOnly never coexists with editable, so this
 * equals the editable facet and desktop behaviour is unchanged.
 */
export const isEditorInteractive = (s: EditorState): boolean =>
  s.facet(EditorView.editable) && !s.readOnly;
