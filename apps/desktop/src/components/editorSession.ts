import type { i18n as I18nInstance } from "i18next";
import { Annotation, Compartment, EditorState, Extension, Prec, Transaction } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { basicSetup } from "@uiw/codemirror-extensions-basic-setup";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages as codeLanguages } from "@codemirror/language-data";

import { markdownTheme } from "./MarkdownTheme";
import {
  markdownDecorationPlugin,
  frontmatterHidePlugin,
  tableField,
  tableLinkHandlers,
} from "./LivePreviewPlugin";
import { imagePreviewPlugin } from "./ImagePreviewPlugin";
import { mathInlinePlugin, mathMermaidBlockField } from "./mathMermaidLive";
import { wikiLinkPlugin } from "./WikiLinkPlugin";
import { noteEmbedPlugin } from "./NoteEmbedPlugin";
import { editorCompletion } from "./editorCompletion";
import { documentHeaderExtension, type DocumentHeaderTexts } from "./documentHeader";
import { listKeymap } from "./listKeymap";
import { listIndentPlugin } from "./listIndent";
import { markdownFolding } from "./foldingExtension";
import { searchSetup } from "./searchSetup";
import { blockHandles } from "./blockHandles";
import { minimalDocChange } from "@plainva/ui";
import { countWords } from "@plainva/ui";
import { markdownToPlainText } from "@plainva/ui";
import type { EditorTriggerDeps } from "./editorTriggers";

/**
 * Editor session (Gesamtplan Editor-Stabilitaet 2026-07-05, P1/E1).
 *
 * Builds the CodeMirror state/view for one open markdown file exactly ONCE and
 * keeps every extension instance stable for the session's lifetime. The
 * previous @uiw/react-codemirror host re-dispatched StateEffect.reconfigure
 * with brand-new extension instances on every React render; a fresh
 * `markdown()` language instance resets CodeMirror's parse state, which only
 * re-parses the first 3000 characters synchronously — beyond that every
 * tree-based decoration (table widgets, list indents, live formatting)
 * collapsed and visibly rebuilt 100–500 ms later.
 *
 * Two rules keep the session immune to React:
 * - Mutable host values/callbacks flow in through `deps.current`, a ref the
 *   host refreshes on every render. Extensions capture the REF, never values.
 * - The live/source switch swaps one Compartment; the language field (and with
 *   it the parsed syntax tree) survives the switch.
 */

export type EditorSessionMode = "live" | "source";

/** Mutable host bindings; the host refreshes `current` on every React render. */
export interface EditorSessionDeps {
  queryService: ReturnType<EditorTriggerDeps["getQueryService"]>;
  /** Context snapshot for embedded notes/bases — read lazily at widget build time. */
  vaultContext: unknown;
  /** Path of the note being edited — the host for any base embedded in it. */
  hostPath?: string;
  onOpenPath?: (path: string, newTab: boolean) => void;
  openWikiTarget: (linkText: string, newTab: boolean) => void;
  openExternalUrl: (url: string) => void;
  handlePaste: (event: ClipboardEvent, view: EditorView) => boolean;
  /** OS file drop onto the editor (P3.2): images embed, other files link. */
  handleDrop: (event: DragEvent, view: EditorView) => boolean;
  /** A real (non-external) document edit happened. */
  onDocChanged: (view: EditorView) => void;
  onSelectionToolbar: (state: { x: number; y: number; above: boolean } | null) => void;
  /** Selection word/char counts for the status bar (P3.9); null = no selection. */
  onSelectionStats: (stats: { chars: number; words: number } | null) => void;
  onPickIcon: (anchor: { x: number; y: number }) => void;
  onPickColor: (anchor: { x: number; y: number }) => void;
}

export interface EditorSessionConfig {
  parent: HTMLElement;
  doc: string;
  mode: EditorSessionMode;
  vaultPath: string;
  i18n: I18nInstance;
  /** Fixed per session; a language switch rebuilds the session (host effect). */
  headerTexts: DocumentHeaderTexts;
  deps: { readonly current: EditorSessionDeps };
}

/** Marks transactions that adopt externally produced text (watcher/sync/merge). */
export const ExternalChange = Annotation.define<boolean>();

export interface EditorSession {
  readonly view: EditorView;
  /** Swap only the mode-dependent extensions; the syntax tree survives. */
  setMode(mode: EditorSessionMode): void;
  /**
   * Adopt external text as a minimal range change; identical text is a no-op.
   * Never enters the undo history (E4) and never marks the editor dirty.
   * Returns true when a change was dispatched.
   */
  applyExternalText(text: string): boolean;
  destroy(): void;
}

export function createEditorSession(cfg: EditorSessionConfig): EditorSession {
  const deps = cfg.deps;
  const modeComp = new Compartment();

  // Stable container for the embed widgets. `vaultContext` is a getter so a
  // widget built later sees the CURRENT services (the old host handed the
  // plugin a context snapshot from extension-creation time instead).
  const embedContextProps = {
    i18n: cfg.i18n,
    get vaultContext() {
      return deps.current.vaultContext;
    },
    get hostPath() {
      return deps.current.hostPath;
    },
    onOpenPath: (path: string, newTab: boolean) => deps.current.onOpenPath?.(path, newTab),
  };

  // Everything that depends on the view mode / live style lives in ONE
  // compartment, in the same relative order the flat extension list used.
  const modeExtensions = (mode: EditorSessionMode): Extension => {
    const isLive = mode === "live";
    return [
      // Source mode keeps line numbers for raw editing (#6); live hides all gutters.
      isLive ? [] : [lineNumbers(), highlightActiveLineGutter()],
      frontmatterHidePlugin(isLive),
      // Document header (W3): stripe + icon widget above the hidden frontmatter.
      documentHeaderExtension(isLive, cfg.headerTexts, {
        onPickIcon: (anchor) => deps.current.onPickIcon(anchor),
        onPickColor: (anchor) => deps.current.onPickColor(anchor),
      }),
      tableField(isLive),
      // Math + mermaid render in place in LIVE mode only (P3.4 + Nachfass);
      // source mode stays raw markdown. Caret inside = raw, like every widget.
      isLive
        ? [
            mathInlinePlugin(),
            mathMermaidBlockField({
              loading: cfg.i18n.t("reader.mermaidLoading"),
              error: cfg.i18n.t("reader.mermaidError"),
            }),
          ]
        : [],
      markdownDecorationPlugin(isLive),
      imagePreviewPlugin(cfg.vaultPath, isLive),
      noteEmbedPlugin(embedContextProps, isLive),
      wikiLinkPlugin((target, newTab) => deps.current.openWikiTarget(target, newTab), isLive),
      // Copy-as-plain-text (WP1): in live preview the markers are hidden on
      // screen, so copying the raw doc slice pastes Markdown noise. Strip it on
      // the way to the clipboard (covers Ctrl+C, Cut and drag). Source mode
      // keeps this filter absent, so it copies raw by design. `data-pv-live-
      // preview` lets the right-click Copy (services/contextMenuStore ->
      // lib/editableField) mirror this without editor-view access.
      isLive
        ? [
            EditorView.clipboardOutputFilter.of((text) => markdownToPlainText(text)),
            EditorView.contentAttributes.of({ "data-pv-live-preview": "true" }),
          ]
        : [],
    ];
  };

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && !update.transactions.some((tr) => tr.annotation(ExternalChange))) {
      deps.current.onDocChanged(update.view);
    }
    // Floating formatting toolbar over a non-empty selection (#5) — same
    // conditions as the previous inline listener in Editor.tsx.
    if (!(update.selectionSet || update.docChanged || update.focusChanged)) return;
    const v = update.view;
    // Selection-aware word/char counts (P3.9). Multi-cursor ranges sum up;
    // the common empty selection is a cheap null.
    {
      let chars = 0;
      let words = 0;
      for (const r of v.state.selection.ranges) {
        if (r.empty) continue;
        chars += r.to - r.from;
        words += countWords(v.state.sliceDoc(r.from, r.to));
      }
      deps.current.onSelectionStats(chars > 0 ? { chars, words } : null);
    }
    const range = v.state.selection.main;
    if (range.empty || !v.hasFocus) {
      deps.current.onSelectionToolbar(null);
      return;
    }
    const coords = v.coordsAtPos(range.from);
    if (!coords) {
      deps.current.onSelectionToolbar(null);
      return;
    }
    const above = coords.top > 56;
    deps.current.onSelectionToolbar({ x: coords.left, y: above ? coords.top - 8 : coords.bottom + 8, above });
  });

  const extensions: Extension = [
    EditorView.contentAttributes.of({ "aria-label": "Markdown Editor" }),
    // Same base setup (and package) the @uiw host used; the three gutter
    // switches moved into the mode compartment below.
    basicSetup({ lineNumbers: false, foldGutter: false, highlightActiveLineGutter: false }),
    keymap.of([indentWithTab]),
    // The old host's container theme: the scroller fills the pane height.
    EditorView.theme({ "&": { height: "100%" }, "& .cm-scroller": { height: "100% !important" } }),
    updateListener,
    // Syntax-highlight fenced code blocks (#10/#3): codeLanguages lazy-loads
    // the matching grammar for ```lang fences.
    markdown({ base: markdownLanguage, codeLanguages }),
    EditorView.lineWrapping,
    // Visual list indentation (live + source), mirroring the read view (#2).
    listIndentPlugin(),
    // Markdown list auto-continuation (#10): Enter/Tab/Shift-Tab.
    Prec.high(keymap.of(listKeymap)),
    // Smart paste (#10): clipboard image -> embed; URL over selection -> link.
    // OS file drops (P3.2): images embed, other files copy in + link. Text
    // drags carry no files and fall through to CodeMirror's own handling.
    EditorView.domEventHandlers({
      paste: (event, view) => deps.current.handlePaste(event, view),
      drop: (event, view) => deps.current.handleDrop(event, view),
    }),
    // Foldable headings & callouts (#10).
    markdownFolding(),
    // Find & replace (#10): Ctrl/Cmd-F opens the localized search panel.
    searchSetup(),
    // Block handles (#7): grip per block; click opens the menu, drag reorders.
    blockHandles(),
    markdownTheme(),
    editorCompletion({ getQueryService: () => deps.current.queryService }),
    // Rendered table cells share the note-link semantics of the wiki link plugin.
    tableLinkHandlers.of({
      onOpenNote: (target, newTab) => deps.current.openWikiTarget(target, newTab),
      onOpenUrl: (url) => deps.current.openExternalUrl(url),
    }),
    modeComp.of(modeExtensions(cfg.mode)),
  ];

  const view = new EditorView({
    state: EditorState.create({ doc: cfg.doc, extensions }),
    parent: cfg.parent,
  });

  let currentMode = cfg.mode;

  return {
    view,
    setMode(mode) {
      if (mode === currentMode) return;
      currentMode = mode;
      view.dispatch({ effects: modeComp.reconfigure(modeExtensions(mode)) });
    },
    applyExternalText(text) {
      const change = minimalDocChange(view.state.doc.toString(), text);
      if (!change) return false;
      view.dispatch({
        changes: change,
        annotations: [ExternalChange.of(true), Transaction.addToHistory.of(false)],
        scrollIntoView: false,
      });
      return true;
    },
    destroy() {
      view.destroy();
    },
  };
}
