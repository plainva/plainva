import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { StateField, EditorState, Extension } from "@codemirror/state";
import type { PlainvaDocMeta } from "@plainva/core";
import { plainvaMetaFromBlock } from "../services/docMeta";
import { renderDocIconDOM } from "./DocIcon";

/**
 * Live-mode document header (W3): a block widget above the (hidden) frontmatter
 * that renders the full-width color stripe + document icon, so the header
 * scrolls with the content like in the read view. Clicks are routed back to
 * the Editor (React) which opens the emoji / color picker popovers.
 */

export interface DocumentHeaderTexts {
  addIcon: string;
  addColor: string;
  changeIcon: string;
  changeColor: string;
}

export interface DocumentHeaderCallbacks {
  onPickIcon: (anchor: { x: number; y: number }) => void;
  onPickColor: (anchor: { x: number; y: number }) => void;
}

function anchorBelow(el: HTMLElement): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom + 4 };
}

class DocumentHeaderWidget extends WidgetType {
  constructor(
    readonly meta: PlainvaDocMeta,
    readonly texts: DocumentHeaderTexts,
    readonly cb: DocumentHeaderCallbacks,
    readonly showAddActions: boolean
  ) {
    super();
  }

  eq(other: DocumentHeaderWidget): boolean {
    return (
      other.meta.icon === this.meta.icon &&
      other.meta.iconColor === this.meta.iconColor &&
      other.meta.headerColor === this.meta.headerColor &&
      other.texts.addIcon === this.texts.addIcon &&
      other.texts.addColor === this.texts.addColor
    );
  }

  toDOM(): HTMLElement {
    const root = document.createElement("div");
    root.className = "pv-doc-header pv-doc-header-live";

    if (this.meta.headerColor) {
      const stripe = document.createElement("div");
      stripe.className = "pv-doc-header-stripe";
      stripe.style.background = this.meta.headerColor;
      stripe.title = this.texts.changeColor;
      stripe.addEventListener("click", (e) => {
        e.preventDefault();
        this.cb.onPickColor({ x: e.clientX, y: e.clientY + 4 });
      });
      root.appendChild(stripe);
    }

    const inner = document.createElement("div");
    inner.className = "pv-doc-header-inner";

    if (this.meta.icon) {
      const iconBtn = document.createElement("button");
      iconBtn.className = "pv-doc-header-icon";
      iconBtn.type = "button";
      const iconNode = renderDocIconDOM(this.meta.icon, this.meta.iconColor, 44);
      if (iconNode) iconBtn.appendChild(iconNode);
      else iconBtn.textContent = this.meta.icon;
      iconBtn.title = this.texts.changeIcon;
      iconBtn.setAttribute("aria-label", this.texts.changeIcon);
      iconBtn.addEventListener("click", (e) => {
        e.preventDefault();
        this.cb.onPickIcon(anchorBelow(e.currentTarget as HTMLElement));
      });
      inner.appendChild(iconBtn);
    }

    const actions = document.createElement("div");
    actions.className = "pv-doc-header-actions";
    const addAction = (label: string, onClick: (anchor: { x: number; y: number }) => void) => {
      const btn = document.createElement("button");
      btn.className = "pv-doc-header-action";
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        onClick(anchorBelow(e.currentTarget as HTMLElement));
      });
      actions.appendChild(btn);
    };
    // Mobile hides the add buttons — icon/stripe live in the note's ⋮ menu there.
    if (this.showAddActions && !this.meta.icon) addAction(`＋ ${this.texts.addIcon}`, this.cb.onPickIcon);
    if (this.showAddActions && !this.meta.headerColor) addAction(`＋ ${this.texts.addColor}`, this.cb.onPickColor);
    if (actions.childElementCount > 0) inner.appendChild(actions);

    root.appendChild(inner);
    return root;
  }

  // The widget's buttons handle their own events; the editor must not treat
  // clicks on them as document interactions.
  ignoreEvent(): boolean {
    return true;
  }
}

/** Frontmatter YAML text read straight from the document head (cheap, no full copy). */
function frontmatterTextOf(state: EditorState): string | null {
  if (state.doc.lines < 2 || state.doc.line(1).text !== "---") return null;
  const maxLines = Math.min(state.doc.lines, 300);
  for (let i = 2; i <= maxLines; i++) {
    if (state.doc.line(i).text === "---") {
      if (i === 2) return "";
      return state.sliceDoc(state.doc.line(2).from, state.doc.line(i - 1).to);
    }
  }
  return null;
}

interface HeaderFieldValue {
  deco: DecorationSet;
  fmText: string | null;
}

function buildValue(
  state: EditorState,
  texts: DocumentHeaderTexts,
  cb: DocumentHeaderCallbacks,
  showAddActions: boolean
): HeaderFieldValue {
  const fmText = frontmatterTextOf(state);
  const meta = plainvaMetaFromBlock(fmText);
  const deco = Decoration.set([
    Decoration.widget({
      widget: new DocumentHeaderWidget(meta, texts, cb, showAddActions),
      side: -1,
      block: true,
    }).range(0),
  ]);
  return { deco, fmText };
}

/**
 * Stretches the color stripe to the full scroller width (the content column is
 * centered/max-width'd in narrow mode, so plain CSS cannot escape it — we
 * measure and offset instead; this also keeps split panes correct where
 * viewport-based CSS tricks would not).
 */
const stripeFullBleed = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.schedule();
    }

    update(update: ViewUpdate) {
      if (update.geometryChanged || update.docChanged || update.viewportChanged) this.schedule();
    }

    schedule() {
      this.view.requestMeasure({
        read: (view): { el: HTMLElement; shift: number; width: number } | null => {
          const el = view.contentDOM.querySelector<HTMLElement>(".pv-doc-header-stripe");
          if (!el) return null;
          const scrollerRect = view.scrollDOM.getBoundingClientRect();
          const rect = el.getBoundingClientRect();
          const currentShift = parseFloat(el.style.marginLeft || "0");
          const naturalLeft = rect.left - currentShift;
          return {
            el,
            shift: naturalLeft - scrollerRect.left,
            width: view.scrollDOM.clientWidth,
          };
        },
        write: (measure) => {
          if (!measure) return;
          const marginLeft = `${-measure.shift}px`;
          const width = `${measure.width}px`;
          if (measure.el.style.marginLeft !== marginLeft) measure.el.style.marginLeft = marginLeft;
          if (measure.el.style.width !== width) measure.el.style.width = width;
        },
      });
    }
  }
);

export function documentHeaderExtension(
  enabled: boolean,
  texts: DocumentHeaderTexts,
  cb: DocumentHeaderCallbacks,
  opts?: { showAddActions?: boolean }
): Extension {
  if (!enabled) return [];
  const showAddActions = opts?.showAddActions !== false;
  const field = StateField.define<HeaderFieldValue>({
    create(state) {
      return buildValue(state, texts, cb, showAddActions);
    },
    update(value, tr) {
      if (!tr.docChanged) return value;
      // Rebuild only when the frontmatter block itself changed — body edits on
      // every keystroke must not re-parse YAML or recreate the widget.
      const fmText = frontmatterTextOf(tr.state);
      if (fmText === value.fmText) return value;
      return buildValue(tr.state, texts, cb, showAddActions);
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });
  return [field, stripeFullBleed];
}
