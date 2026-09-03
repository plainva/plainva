import type { i18n as I18nInstance } from "i18next";
import { Annotation, Compartment, EditorState, Extension, Prec, Transaction } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, type KeyBinding } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { basicSetup } from "@uiw/codemirror-extensions-basic-setup";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages as codeLanguages } from "@codemirror/language-data";
import { LanguageDescription, syntaxHighlighting } from "@codemirror/language";

import { editorTheme, markdownHighlightStyle, markdownTheme } from "./MarkdownTheme";
import {
  markdownDecorationPlugin,
  frontmatterHidePlugin,
  tableField,
  tableLinkHandlers,
} from "./LivePreviewPlugin";
import { imagePreviewPlugin } from "./ImagePreviewPlugin";
import { mathInlinePlugin, mathMermaidBlockField } from "./mathMermaidLive";
import { wikiLinkPlugin, type LinkKind } from "./WikiLinkPlugin";
import { anchorHighlightExtension, commentAnchorHandlers, setAnchorHighlights, suggestionActionHandlers, type AnchorFrameHint, type AnchorHighlight } from "./anchorHighlight";
import { anchorMarkerHidePlugin } from "./anchorMarkerHide";
import { editorCompletion } from "./editorCompletion";
import { documentHeaderExtension, type DocumentHeaderTexts } from "./documentHeader";
import { listKeymap } from "./listKeymap";
import { listIndentPlugin } from "./listIndent";
import { markdownFolding } from "./foldingExtension";
import { searchSetup } from "./searchSetup";
import { blockHandles } from "./blockHandles";
import { minimalDocChange } from "../lib/textDiff";
import { countWords } from "../lib/wordCount";
import { markdownToPlainText } from "../lib/markdownToPlainText";
import { markdownToHtml } from "../lib/markdownToHtml";
import type { EditorTriggerDeps } from "./editorTriggers";
import {
  toggleInlineMark,
  insertMarkdownLink,
  setHeadingLevel,
  toggleTaskLine,
} from "./editorTouchCommands";

/**
 * Selection-based Markdown formatting shortcuts (desktop keyboard). Letters are
 * matched by CodeMirror's keymap; heading digits (Mod+Shift+1..3/0) are handled
 * via event.code in the keydown handler below, since a shifted digit reports as
 * a punctuation key on many keyboard layouts.
 */
const formattingKeymap: KeyBinding[] = [
  { key: "Mod-b", run: (v) => { toggleInlineMark(v, "**"); return true; } },
  { key: "Mod-i", run: (v) => { toggleInlineMark(v, "*"); return true; } },
  { key: "Mod-Shift-s", run: (v) => { toggleInlineMark(v, "~~"); return true; } },
  { key: "Mod-Shift-h", run: (v) => { toggleInlineMark(v, "=="); return true; } },
  { key: "Mod-k", run: (v) => { insertMarkdownLink(v); return true; } },
  { key: "Mod-Enter", run: (v) => { toggleTaskLine(v); return true; } },
];

/** Mod+Shift+<digit> → heading level, keyed by layout-independent event.code. */
const HEADING_BY_CODE: Record<string, number> = { Digit0: 0, Digit1: 1, Digit2: 2, Digit3: 3 };

/**
 * Copy handler for live preview (#1): write BOTH text/plain (markers stripped)
 * and text/html (formatting preserved) for a single non-empty selection, so
 * pasting into a rich-text target keeps the formatting while plain-text targets
 * get the filtered text. Empty/multi selections return false and fall through
 * to CodeMirror's own (plain-text) copy path.
 */
function writeRichClipboard(event: ClipboardEvent, view: EditorView): boolean {
  const ranges = view.state.selection.ranges;
  if (ranges.length !== 1 || ranges[0].empty || !event.clipboardData) return false;
  const md = view.state.sliceDoc(ranges[0].from, ranges[0].to);
  event.clipboardData.setData("text/plain", markdownToPlainText(md));
  event.clipboardData.setData("text/html", markdownToHtml(md));
  event.preventDefault();
  return true;
}

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
/**
 * Context handed to the app shell's embed extension (notes/bases rendered
 * inside the editor). Built by the session; the shell's embed plugin
 * (desktop: NoteEmbedPlugin) consumes it — the session itself never
 * imports app modules (ADR 0011).
 */
export interface EmbedHostContext {
  i18n: I18nInstance;
  readonly vaultContext: unknown;
  readonly hostPath: string | undefined;
  onOpenPath: (path: string, newTab: boolean) => void;
}

export interface EditorSessionDeps {
  queryService: ReturnType<EditorTriggerDeps["getQueryService"]>;
  /** Context snapshot for embedded notes/bases — read lazily at widget build time. */
  vaultContext: unknown;
  /** Path of the note being edited — the host for any base embedded in it. */
  hostPath?: string;
  /** Reads a binary file for inline image previews (shell file access). */
  readBinaryFile: (absolutePath: string) => Promise<Uint8Array>;
  /** Right-click on an inline image → host opens its copy / save-as menu. */
  onImageContext?: (e: MouseEvent, absolutePath: string) => void;
  /** Builds the app-shell extension rendering ![[...]] note/base embeds. */
  buildNoteEmbedExtension: (context: EmbedHostContext, isLive: boolean) => Extension;
  onOpenPath?: (path: string, newTab: boolean) => void;
  /**
   * Opens a clicked in-app link. `kind` distinguishes a wiki target (a NAME the
   * index resolves; a miss may create the note) from a relative markdown target
   * (a PATH relative to the host note; a miss is a missing file) — issue #61.
   */
  openWikiTarget: (linkText: string, newTab: boolean, kind?: LinkKind) => void;
  openExternalUrl: (url: string) => void;
  handlePaste: (event: ClipboardEvent, view: EditorView) => boolean;
  /** OS file drop onto the editor (P3.2): images embed, other files link. */
  handleDrop: (event: DragEvent, view: EditorView) => boolean;
  /** A real (non-external) document edit happened. */
  onDocChanged: (view: EditorView) => void;
  onSelectionToolbar: (state: { x: number; y: number; above: boolean } | null) => void;
  /** Click inside a highlighted range → host selects that comment card. */
  onAnchorActivate?: (commentId: string) => void;
  /**
   * A widget offers "comment on this" only while the host says commenting is on
   * - a plain note outside a workspace shows no bubble at all.
   */
  commentAnchorsEnabled?: () => boolean;
  /**
   * The reader asked to comment on a picture, a diagram or a table cell (E1).
   * A widget click carries no text selection, so the host has to remember the
   * target until the comment is actually written.
   */
  onCommentAnchorRequest?: (req: { from: number; to: number; display: AnchorFrameHint }) => void;
  /**
   * Accept or decline a suggestion from the pill on its inline rendering (K5).
   * Leave either out and the pill shows no button for it: a Commenter may
   * decline but not accept; the phone's sheet carries both instead.
   */
  onSuggestionApply?: (commentId: string) => void;
  onSuggestionDecline?: (commentId: string) => void;
  /** Selection word/char counts for the status bar (P3.9); null = no selection. */
  onSelectionStats: (stats: { chars: number; words: number } | null) => void;
  /**
   * The main selection, or null when it is empty. Fires on every selection
   * change - the HOST decides what is worth a re-render (D2 shows the quote a
   * new comment would attach to, and only re-renders when that quote changes).
   */
  onSelectionRange?: (range: { from: number; to: number } | null) => void;
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
  /** Show the ＋-add buttons in the document header (desktop). Mobile hides
   * them — icon/stripe are edited from the note's ⋮ menu. Default true. */
  headerAddActions?: boolean;
  deps: { readonly current: EditorSessionDeps };
  /**
   * Start read-only (mobile read-first mode). Drives CodeMirror's own facets,
   * never the raw contenteditable attribute (CM rewrites that on the next
   * update and the keyboard comes back — mobile finding, 2026-07-11).
   *
   * Read mode flips `EditorView.editable`, on touch as well. It briefly kept
   * contenteditable ON there so the WebView would paint a native selection —
   * but the thing that had hidden the native selection was `drawSelection`,
   * which the touch profile already switches off. The leftover editable region
   * had a price: Android treats a contenteditable as an input field, so its
   * autofill service claimed the selection toolbar and offered "Autofill"
   * where Copy belongs — selectable text you could not copy (device report,
   * 2026-07-26). Non-editable text selects natively and copies normally.
   */
  editable?: boolean;
  /**
   * Open this as a PLAIN TEXT file rather than a note (C15, S14): the path,
   * whose extension picks the grammar. Set by the shell when
   * `resolveOpenAction` says "text" — a `.py` gets highlighting, find & replace
   * and undo, and none of the note machinery that would misread or rewrite it.
   */
  plainTextFile?: string;
  /**
   * Touch-device input profile (mobile shell, 2026-07-16). Two effects:
   * (1) drawSelection stays OFF, so the WebView renders its NATIVE selection
   *     with the platform handles. CM's drawn selection hides the native one
   *     (`::selection { background: transparent !important }`) and ships its
   *     own handles only on iOS — on Android that left read-mode selections
   *     invisible and un-expandable ("only one word selectable") and edit-mode
   *     selection glitchy. (Multi-cursor rendering is lost; irrelevant on touch.)
   * (2) the contentDOM re-enables the virtual keyboard's smartness
   *     (autocapitalize / autocorrect / writing suggestions) that CM6
   *     hard-disables by default — auto-capitalization after a sentence and
   *     GBoard suggestions did nothing in the app. Spellcheck stays off by
   *     decision (no squiggles under Markdown syntax). Desktop leaves this
   *     unset and keeps CM's defaults.
   */
  touchInput?: boolean;
}

/** Marks transactions that adopt externally produced text (watcher/sync/merge). */
export const ExternalChange = Annotation.define<boolean>();

export interface EditorSession {
  readonly view: EditorView;
  /** Swap only the mode-dependent extensions; the syntax tree survives. */
  setMode(mode: EditorSessionMode): void;
  /**
   * Toggle user editability (facet + readOnly state) without rebuilding the
   * session; decorations and the syntax tree survive. Read-only still allows
   * programmatic `applyExternalText`.
   */
  setEditable(on: boolean): void;
  /**
   * Show where the comments of this note sit. Ranges are RESOLVED offsets, not
   * stored ones: the host recomputes them whenever the text or the comment list
   * changes. A StateField carries them, so they map through edits and survive a
   * mode swap — the tint neither drifts while typing nor flickers on live↔source.
   */
  setAnchorHighlights(highlights: readonly AnchorHighlight[]): void;
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
  const editableComp = new Compartment();
  // A grammar arrives after the session may already be gone (file switched,
  // pane closed): dispatching into a destroyed view throws.
  let destroyed = false;
  // One rule on both profiles: read mode is NOT editable. See the `editable`
  // doc above for why the touch profile no longer makes an exception.
  const editableExtensions = (on: boolean): Extension => [
    EditorView.editable.of(on),
    EditorState.readOnly.of(!on),
  ];

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
      // Comment anchor markers vanish in live preview (K1); source shows them.
      anchorMarkerHidePlugin(isLive),
      // Document header (W3): stripe + icon widget above the hidden frontmatter.
      documentHeaderExtension(
        isLive,
        cfg.headerTexts,
        {
          onPickIcon: (anchor) => deps.current.onPickIcon(anchor),
          onPickColor: (anchor) => deps.current.onPickColor(anchor),
        },
        { showAddActions: cfg.headerAddActions !== false }
      ),
      tableField(isLive),
      // Visual list indentation (live + source), mirroring the read view (#2).
      // Live mode hides the leading whitespace of list lines (T1: a tab's width
      // and the hanging indent chase each other); source mode shows it raw.
      listIndentPlugin({ hideLeadingWhitespace: isLive }),
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
      imagePreviewPlugin(cfg.vaultPath, isLive, (path) => deps.current.readBinaryFile(path), (e, abs) => deps.current.onImageContext?.(e, abs)),
      deps.current.buildNoteEmbedExtension(embedContextProps, isLive),
      wikiLinkPlugin((target, newTab, kind) => deps.current.openWikiTarget(target, newTab, kind), isLive),
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
            // Rich copy (#1): also put text/html on the clipboard so pasting
            // into Word/Docs keeps formatting; the filter above still handles
            // plain-text targets and the empty/multi-selection fall-through.
            EditorView.domEventHandlers({
              copy: (event, view) => writeRichClipboard(event, view),
              cut: (event, view) => {
                if (!writeRichClipboard(event, view)) return false;
                const r = view.state.selection.ranges[0];
                view.dispatch({ changes: { from: r.from, to: r.to, insert: "" }, userEvent: "delete.cut" });
                return true;
              },
            }),
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
    const main = v.state.selection.main;
    deps.current.onSelectionRange?.(main.empty ? null : { from: main.from, to: main.to });
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

  /**
   * Plain-text profile (C15, S14).
   *
   * A `.py` is not a note and must not be treated as one: no live preview, no
   * frontmatter header, no wiki links, no slash menu, no block handles, no
   * table widget. What it does get is what a text file needs — highlighting,
   * find & replace, undo — and nothing that would rewrite it or offer an
   * action its file type cannot carry.
   *
   * The grammar is the SAME chain the fenced code blocks in a note use; only
   * the question changes, from the fence word to the file name. Loading is
   * async and best-effort: an unknown extension simply stays plain, exactly
   * like `highlightCodeToTokens` returning null for an unknown fence.
   */
  const plainFile = cfg.plainTextFile;
  const languageComp = new Compartment();
  if (plainFile) {
    const description = LanguageDescription.matchFilename(codeLanguages, plainFile.split("/").pop() ?? plainFile);
    if (description) {
      void description
        .load()
        .then((support) => { if (!destroyed) view.dispatch({ effects: languageComp.reconfigure(support) }); })
        .catch(() => { /* no grammar, no colours — the text is still readable */ });
    }
  }

  const extensions: Extension = plainFile ? [
    EditorView.contentAttributes.of({ "aria-label": "Text Editor" }),
    basicSetup({ foldGutter: false, highlightActiveLineGutter: false }),
    keymap.of([indentWithTab]),
    EditorView.theme({ "&": { height: "100%" }, "& .cm-scroller": { height: "100% !important" } }),
    updateListener,
    languageComp.of([]),
    EditorView.lineWrapping,
    // Find & replace stays: it is the one note affordance that is really a
    // TEXT affordance, and a config file is exactly where one searches.
    searchSetup(),
    editorTheme,
    // The same two-layer highlighting a fenced code block inside a note gets:
    // basicSetup ships `defaultHighlightStyle` as the fallback, and the app's
    // own style overrides the tags it cares about (keyword -> accent, comment
    // -> muted) so the colours follow the theme instead of CodeMirror's fixed
    // palette. Read view, fenced code and a whole text file then look alike —
    // three callers, one style, no fourth palette to keep in step.
    Prec.highest(syntaxHighlighting(markdownHighlightStyle)),
    editableComp.of(editableExtensions(cfg.editable !== false)),
  ] : [
    EditorView.contentAttributes.of({ "aria-label": "Markdown Editor" }),
    // Touch profile (see EditorSessionConfig.touchInput): later facet values
    // override CM6's hard-coded autocorrect/autocapitalize/writingsuggestions
    // ="off" defaults on the contentDOM.
    cfg.touchInput
      ? EditorView.contentAttributes.of({
          autocapitalize: "sentences",
          autocorrect: "on",
          writingsuggestions: "true",
        })
      : [],
    // Same base setup (and package) the @uiw host used; the three gutter
    // switches moved into the mode compartment below. The touch profile drops
    // drawSelection so the platform draws (and can extend) the selection.
    basicSetup({
      lineNumbers: false,
      foldGutter: false,
      highlightActiveLineGutter: false,
      ...(cfg.touchInput ? { drawSelection: false } : {}),
    }),
    keymap.of([indentWithTab]),
    // The old host's container theme: the scroller fills the pane height.
    EditorView.theme({ "&": { height: "100%" }, "& .cm-scroller": { height: "100% !important" } }),
    updateListener,
    // Syntax-highlight fenced code blocks (#10/#3): codeLanguages lazy-loads
    // the matching grammar for ```lang fences.
    markdown({ base: markdownLanguage, codeLanguages }),
    EditorView.lineWrapping,
    // Markdown list auto-continuation (#10): Enter/Tab/Shift-Tab.
    Prec.high(keymap.of(listKeymap)),
    // Selection formatting shortcuts (bold/italic/strike/highlight/link/task).
    keymap.of(formattingKeymap),
    // Smart paste (#10): clipboard image -> embed; URL over selection -> link.
    // OS file drops (P3.2): images embed, other files copy in + link. Text
    // drags carry no files and fall through to CodeMirror's own handling.
    EditorView.domEventHandlers({
      paste: (event, view) => deps.current.handlePaste(event, view),
      drop: (event, view) => deps.current.handleDrop(event, view),
      keydown: (event, view) => {
        // Heading level via layout-independent event.code: Mod+Shift+1..3 set,
        // Mod+Shift+0 clears. Letters are handled by formattingKeymap above.
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey) {
          const level = HEADING_BY_CODE[event.code];
          if (level !== undefined) {
            setHeadingLevel(view, level);
            event.preventDefault();
            return true;
          }
        }
        return false;
      },
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
    // How a widget reaches the shell: the same facet route the rendered table
    // cells already take for note links.
    commentAnchorHandlers.of({
      enabled: () => deps.current.commentAnchorsEnabled?.() === true,
      request: (req) => deps.current.onCommentAnchorRequest?.(req),
    }),
    suggestionActionHandlers.of({
      canApply: () => typeof deps.current.onSuggestionApply === "function",
      canDecline: () => typeof deps.current.onSuggestionDecline === "function",
      apply: (commentId) => deps.current.onSuggestionApply?.(commentId),
      decline: (commentId) => deps.current.onSuggestionDecline?.(commentId),
      activate: (commentId) => deps.current.onAnchorActivate?.(commentId),
    }),
    anchorHighlightExtension((commentId) => deps.current.onAnchorActivate?.(commentId)),
    editableComp.of(editableExtensions(cfg.editable !== false)),
    modeComp.of(modeExtensions(cfg.mode)),
  ];

  const view = new EditorView({
    state: EditorState.create({ doc: cfg.doc, extensions }),
    parent: cfg.parent,
  });

  let currentMode = cfg.mode;
  let currentEditable = cfg.editable !== false;

  return {
    view,
    setMode(mode) {
      if (mode === currentMode) return;
      currentMode = mode;
      view.dispatch({ effects: modeComp.reconfigure(modeExtensions(mode)) });
    },
    setEditable(on) {
      if (on === currentEditable) return;
      currentEditable = on;
      view.dispatch({ effects: editableComp.reconfigure(editableExtensions(on)) });
    },
    setAnchorHighlights(highlights) {
      view.dispatch({ effects: setAnchorHighlights.of(highlights) });
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
      destroyed = true;
      view.destroy();
    },
  };
}
