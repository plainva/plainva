import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { getPlatformServices } from "../platform/services";
import { safeHref } from "../lib/safeUrl";
import { toast } from "../services/toastStore";
import i18n from "../i18n";

/**
 * Links in the mail composer (issue #34, wave 4).
 *
 * The composer runs a deliberately MINIMAL extension set: the note editor's
 * slash/embed/table plugins broadcast window events that an open note listens
 * for, so wiring the whole editor in here would make writing a mail act on the
 * note behind it. The consequence was that `[text](url)` stayed visibly raw
 * while composing — the highlighter tinted parts of it, but the brackets and the
 * URL were still there and nothing was clickable.
 *
 * This is the narrow replacement: hide the markdown syntax, style the text, open
 * it externally on click. Deliberately WITHOUT vault resolution — a `[[wiki
 * link]]` has no meaning in an email, so it is not decorated here at all.
 *
 * Nothing is lost when this is off: `mailOut` converts the body to HTML on send,
 * so the recipient always received a real link. This is about what the WRITER
 * sees.
 */

/** Only schemes that are inert on click; `safeHref` rejects javascript:/data:. */
function externalTarget(raw: string): string | undefined {
  const href = safeHref(raw);
  if (!href) return undefined;
  return /^(https?:|mailto:)/i.test(href) ? href : undefined;
}

interface LinkMatch {
  start: number;
  end: number;
  target: string;
  /** `[` and `](url)` — absent for a bare URL, which has no syntax to hide. */
  hide?: [{ start: number; end: number }, { start: number; end: number }];
}

function collect(view: EditorView): LinkMatch[] {
  const matches: LinkMatch[] = [];
  // Spans that are NOT links but must not be re-matched as bare URLs either —
  // an image embed's URL is the case that matters: skipping the `![…](url)`
  // match alone would leave its URL free for the bare-URL pass to decorate.
  const occupied: { start: number; end: number }[] = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);

    // `[text](url)` — the text may not contain `]`, or the match would span a
    // preceding `[...]` (a footnote marker, say) into the real link and style
    // everything between as one link. Same trap as issue #11 in the note editor.
    const md = /\[([^\]\n]*?)\]\(([^)\n]*?)\)/g;
    let m: RegExpExecArray | null;
    while ((m = md.exec(text)) !== null) {
      const start = from + m.index;
      const end = start + m[0].length;
      if (start > 0 && view.state.sliceDoc(start - 1, start) === "!") {
        occupied.push({ start, end });
        continue; // image embed
      }
      const target = externalTarget(m[2] ?? "");
      if (!target) {
        // An unsupported scheme stays plain text — and stays occupied, so the
        // bare-URL pass cannot decorate a fragment of it.
        occupied.push({ start, end });
        continue;
      }
      const textEnd = start + 1 + (m[1] ?? "").length;
      matches.push({
        start,
        end,
        target,
        hide: [
          { start, end: start + 1 },
          { start: textEnd, end },
        ],
      });
    }

    // Bare URLs, as long as they do not sit inside a link already matched above.
    const bare = /(https?:\/\/[^\s)]+)/g;
    while ((m = bare.exec(text)) !== null) {
      const start = from + m.index;
      const end = start + m[0].length;
      if (matches.some((x) => start < x.end && end > x.start)) continue;
      if (occupied.some((x) => start < x.end && end > x.start)) continue;
      const target = externalTarget(m[0]);
      if (target) matches.push({ start, end, target });
    }
  }
  matches.sort((a, b) => a.start - b.start);

  // RangeSetBuilder needs strictly increasing, non-overlapping ranges.
  const out: LinkMatch[] = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      out.push(m);
      lastEnd = m.end;
    }
  }
  return out;
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const selection = view.state.selection;
  for (const m of collect(view)) {
    // Caret inside: show the raw text so it stays editable — same rule the note
    // editor uses for every inline mark.
    const focused = selection.ranges.some((r) => r.from <= m.end && r.to >= m.start);
    const attrs = { class: "cm-mail-link", attributes: { "data-mail-link": m.target } };
    if (m.hide && !focused) {
      builder.add(m.hide[0].start, m.hide[0].end, Decoration.replace({}));
      if (m.hide[0].end < m.hide[1].start) {
        builder.add(m.hide[0].end, m.hide[1].start, Decoration.mark(attrs));
      }
      builder.add(m.hide[1].start, m.hide[1].end, Decoration.replace({}));
    } else {
      builder.add(m.start, m.end, Decoration.mark(attrs));
    }
  }
  return builder.finish();
}

/** Markdown links and bare URLs in the compose body: rendered, and clickable. */
export function composeLinkPlugin() {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = build(view);
        }
        update(u: ViewUpdate) {
          // Selection too: the caret entering a link reveals its syntax.
          if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = build(u.view);
        }
      },
      { decorations: (v) => v.decorations }
    ),
    EditorView.baseTheme({
      ".cm-mail-link": {
        color: "var(--wiki-link-color, var(--accent-color))",
        textDecoration: "underline",
        cursor: "pointer",
      },
      // The highlighter paints its own underline on the nested link token; this
      // mark owns the line, so exactly one renders.
      ".cm-mail-link *": { textDecoration: "none" },
    }),
    EditorView.domEventHandlers({
      mousedown: (event) => {
        if (event.button !== 0) return false;
        const el = event.target instanceof Element ? event.target.closest<HTMLElement>(".cm-mail-link") : null;
        const target = el?.getAttribute("data-mail-link");
        if (!target) return false;
        event.preventDefault();
        getPlatformServices()
          .openExternal(target)
          .catch((err: unknown) => {
            toast.error(i18n.t("dialogs.openWebLinkErrorMsg", { error: err }));
          });
        return true;
      },
    }),
  ];
}
