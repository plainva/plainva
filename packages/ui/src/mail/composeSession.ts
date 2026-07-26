import { EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder, type KeyBinding } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { markdownDecorationPlugin } from "../components/LivePreviewPlugin";
import { markdownTheme } from "../components/MarkdownTheme";
import { applyComposeCommand, detectSlash, type ComposeCommandId } from "./composeMarkdown";

/**
 * The compose editor's engine, shared by both shells (G3b).
 *
 * It owns everything about writing a message that must not differ between
 * desktop and phone: which CodeMirror extensions run, how a toolbar or slash
 * command is applied, and how an externally supplied draft (a reply prefill) is
 * adopted. What it deliberately does NOT own is chrome — the desktop draws an
 * inline toolbar with a caret-anchored menu, the phone docks its toolbar above
 * the keyboard — so each shell renders its own around this session.
 *
 * The extension set is intentionally minimal and ISOLATED: markdown decorations
 * and theme only. The note editor's completion/embed/table/wiki/header plugins
 * fire global window events that the open note also listens to; none of them
 * exist here, so a mail or event dialog can never write into an open note.
 */

export interface ComposeSessionOptions {
  parent: HTMLElement;
  doc: string;
  placeholder?: string;
  /**
   * Phone profile: CodeMirror hard-codes autocapitalize/autocorrect/
   * writingsuggestions to "off", which turns a virtual keyboard dumb. Same
   * override the mobile note editor carries.
   */
  touch?: boolean;
  /** Extra key bindings at highest precedence (menu navigation, shortcuts). */
  extraKeys?: readonly KeyBinding[];
  onChange: (value: string) => void;
  /** Called whenever the caret moves or the text changes; null = no `/` active. */
  onSlashChange?: (hit: { from: number; query: string } | null) => void;
  onFocusChange?: (focused: boolean) => void;
}

export interface ComposeSession {
  readonly view: EditorView;
  /** Apply a toolbar command to the current selection. */
  run(id: ComposeCommandId): void;
  /** Apply a command picked from the `/` menu and swallow the typed trigger. */
  runSlash(id: ComposeCommandId, from: number): void;
  /** Adopt an externally supplied draft; typing never reaches this. */
  applyExternalText(value: string): void;
  /** Current value, as the caller last saw it through `onChange`. */
  currentValue(): string;
  destroy(): void;
}

export function createComposeSession(opts: ComposeSessionOptions): ComposeSession {
  let last = opts.doc;

  const extensions: Extension[] = [
    ...(opts.extraKeys && opts.extraKeys.length > 0 ? [Prec.highest(keymap.of([...opts.extraKeys]))] : []),
    markdown(),
    markdownDecorationPlugin(true),
    markdownTheme(),
    EditorView.lineWrapping,
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    cmPlaceholder(opts.placeholder ?? ""),
    ...(opts.touch
      ? [EditorView.contentAttributes.of({ autocapitalize: "sentences", autocorrect: "on", writingsuggestions: "true" })]
      : []),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        last = u.state.doc.toString();
        opts.onChange(last);
      }
      if ((u.docChanged || u.selectionSet) && opts.onSlashChange) {
        opts.onSlashChange(detectSlash(u.state.doc.toString(), u.state.selection.main.head));
      }
      if (u.focusChanged && opts.onFocusChange) opts.onFocusChange(u.view.hasFocus);
    }),
  ];

  const view = new EditorView({
    state: EditorState.create({ doc: opts.doc, extensions }),
    parent: opts.parent,
  });

  /** Replace the whole document with the result of a pure text operation. */
  const replaceAll = (value: string, selStart: number, selEnd: number) => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: selStart, head: selEnd },
    });
    view.focus();
  };

  return {
    view,
    run(id) {
      const doc = view.state.doc.toString();
      const { from, to } = view.state.selection.main;
      const edit = applyComposeCommand(id, doc, from, to);
      replaceAll(edit.value, edit.selStart, edit.selEnd);
    },
    runSlash(id, from) {
      const doc = view.state.doc.toString();
      const caret = view.state.selection.main.head;
      // Drop the "/query" the user typed before applying the command.
      const stripped = doc.slice(0, from) + doc.slice(caret);
      const edit = applyComposeCommand(id, stripped, from, from);
      replaceAll(edit.value, edit.selStart, edit.selEnd);
    },
    applyExternalText(value) {
      if (value === last) return;
      const cur = view.state.doc.toString();
      if (value !== cur) view.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
      last = value;
    },
    currentValue() {
      return last;
    },
    destroy() {
      view.destroy();
    },
  };
}
