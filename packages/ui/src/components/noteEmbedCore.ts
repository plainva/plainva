import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

/**
 * Shell-neutral core of the `![[...]]` note-embed live plugin (M3E package H):
 * the CodeMirror mechanics of the desktop NoteEmbedPlugin — line scanning,
 * caret-aware syntax reveal, widget lifecycle — with the actual preview
 * injected as a renderer. The desktop keeps its React-rooted plugin (a later
 * refactor can converge on this core); mobile mounts a lightweight preview.
 */

export interface NoteEmbedRenderer {
  /** Mounts the embed preview into the container; returns a cleanup. */
  render(container: HTMLElement, target: string): () => void;
}

class CoreEmbedWidget extends WidgetType {
  private cleanup: (() => void) | null = null;

  constructor(
    readonly target: string,
    readonly renderer: NoteEmbedRenderer,
  ) {
    super();
  }

  eq(other: CoreEmbedWidget) {
    return this.target === other.target;
  }

  toDOM() {
    const container = document.createElement("div");
    container.className = "cm-note-embed";
    this.cleanup = this.renderer.render(container, this.target);
    return container;
  }

  destroy() {
    this.cleanup?.();
    this.cleanup = null;
  }
}

const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i;
const EMBED_RE = /!\[\[(.*?)\]\]/g;

export function buildNoteEmbedCoreExtension(
  renderer: NoteEmbedRenderer,
  hideSyntax: boolean,
): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        // Rebuild on doc/viewport changes and when the caret crosses lines
        // (the selected line reveals its raw syntax, desktop semantics).
        let needsRebuild = update.docChanged || update.viewportChanged;
        if (!needsRebuild && update.selectionSet) {
          const oldRanges = update.startState.selection.ranges;
          const newRanges = update.state.selection.ranges;
          if (oldRanges.length !== newRanges.length) needsRebuild = true;
          else {
            for (let i = 0; i < newRanges.length; i++) {
              const oldLine = update.startState.doc.lineAt(oldRanges[i].head).number;
              const newLine = update.state.doc.lineAt(newRanges[i].head).number;
              if (oldLine !== newLine) {
                needsRebuild = true;
                break;
              }
            }
          }
        }
        if (needsRebuild) this.decorations = this.buildDecorations(update.view);
      }

      buildDecorations(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        const selectionLines = new Set<number>();
        for (const range of view.state.selection.ranges) {
          selectionLines.add(view.state.doc.lineAt(range.head).number);
        }
        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos < to) {
            const line = view.state.doc.lineAt(pos);
            const isLineSelected = selectionLines.has(line.number);
            EMBED_RE.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = EMBED_RE.exec(line.text)) !== null) {
              const target = match[1];
              if (IMAGE_RE.test(target)) continue; // images have their own plugin
              const matchFrom = line.from + match.index;
              const matchTo = matchFrom + match[0].length;
              if (hideSyntax && !isLineSelected) {
                builder.add(
                  matchFrom,
                  matchTo,
                  Decoration.replace({ widget: new CoreEmbedWidget(target, renderer) }),
                );
              } else {
                builder.add(
                  matchTo,
                  matchTo,
                  Decoration.widget({ widget: new CoreEmbedWidget(target, renderer), side: 1 }),
                );
              }
            }
            pos = line.to + 1;
          }
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}
