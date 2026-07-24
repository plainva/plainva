import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { toast } from "../services/toastStore";
import { getPlatformServices } from "../platform/services";
import { findLinkAtOffset } from "../lib/linkParser";
import { isWikiTargetResolved } from "../lib/wikiResolver";
import { isEditorInteractive } from "./editorInteractive";
import i18n from "../i18n";

// Resolver set of existing wiki targets (lowercased titles + paths), pushed in
// from the shell whenever the vault index changes. A wiki link whose target is
// NOT in the set renders "unresolved" (muted, dashed) — Obsidian parity
// (maintainer 2026-07-18). null = index not loaded yet → nothing flagged.
export const setWikiResolver = StateEffect.define<Set<string> | null>();
export const wikiResolverField = StateField.define<Set<string> | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setWikiResolver)) return e.value;
    return value;
  },
});

// Removed LinkWidget as we'll use Decoration.mark to allow CSS inheritance

// Distinguishes a genuine tap (open the link) from a scroll or long-press on
// touch devices (Capacitor WebView); keyed by view so editors stay isolated.
const touchTapStart = new WeakMap<EditorView, { x: number; y: number; at: number }>();

// One physical tap/click can surface as mousedown, touchend AND click. The
// pipeline marker records that the primary handlers were reachable at all —
// the click fallback only acts when they were NOT (native WebViews, iOS
// WKWebView in particular, can swallow touch/mouse events on non-editable
// content while still synthesizing a click). lastLinkNav additionally dedupes
// a same-target re-fire within a short window as a belt-and-braces guard.
const lastPointerEvent = new WeakMap<EditorView, number>();
const lastLinkNav = new WeakMap<EditorView, { at: number; target: string }>();

type LinkKind = "wiki" | "markdown" | "url";

/** Opens a resolved (type, target). Wiki + relative markdown links navigate
 * in-app via onOpenPath; http(s) links and bare URLs go to the system browser.
 * lastLinkNav dedupes the same-target re-fire of one physical tap. */
function openParsedLink(
  view: EditorView,
  type: LinkKind,
  target: string,
  newTab: boolean,
  onOpenPath: (linkText: string, newTab: boolean) => void,
  timeStamp: number,
): boolean {
  const last = lastLinkNav.get(view);
  if (last && last.target === target && timeStamp - last.at < 900) {
    return true; // duplicate event of the same physical tap — swallow, don't re-open
  }
  if (type === "wiki") {
    onOpenPath(target, newTab);
  } else if (type === "markdown") {
    if (target.startsWith("http://") || target.startsWith("https://")) {
      getPlatformServices().openExternal(target).catch((err) => {
        toast.error(i18n.t("dialogs.openWebLinkErrorMsg", { error: err }));
      });
    } else {
      onOpenPath(target, newTab);
    }
  } else if (type === "url") {
    getPlatformServices().openExternal(target).catch((err) => {
      toast.error(i18n.t("dialogs.openWebLinkErrorMsg", { error: err }));
    });
  } else {
    return false;
  }
  lastLinkNav.set(view, { at: timeStamp, target });
  return true;
}

/** PRIMARY path: read the link straight off the tapped `.cm-wiki-link`
 * element via its data attributes — NO coordinate round-trip. This is what
 * makes taps reliable on touch WebViews: posAtCoords() + re-parsing the raw
 * line mis-resolved most links (a tap landed just outside the [[…]] offset
 * range), so only the odd link opened while structurally identical ones did
 * not — on BOTH Android and iOS (maintainer, 2026-07-15). The DOM element that
 * was actually hit already carries its target, so there is nothing to mis-map. */
function openLinkFromEl(
  node: EventTarget | null,
  view: EditorView,
  newTab: boolean,
  onOpenPath: (linkText: string, newTab: boolean) => void,
  timeStamp: number,
): boolean {
  const el = node instanceof Node
    ? (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement))
    : null;
  const span = el ? el.closest<HTMLElement>(".cm-wiki-link") : null;
  if (!span) return false;
  const target = span.getAttribute("data-link-target");
  const type = span.getAttribute("data-link-type") as LinkKind | null;
  if (!target || !type) return false;
  return openParsedLink(view, type, target, newTab, onOpenPath, timeStamp);
}

/** FALLBACK path: resolve the link under (x, y) by document offset. Kept for
 * the rare tap that lands just beside the glyph and for ctrl/cmd+click that
 * means to hit a link under the pointer. */
function openLinkAtCoords(
  view: EditorView,
  x: number,
  y: number,
  newTab: boolean,
  onOpenPath: (linkText: string, newTab: boolean) => void,
  timeStamp: number,
): boolean {
  const pos = view.posAtCoords({ x, y });
  if (pos === null) return false;
  const line = view.state.doc.lineAt(pos);
  const link = findLinkAtOffset(line.text, pos - line.from);
  if (!link) return false;
  return openParsedLink(view, link.type, link.target, newTab, onOpenPath, timeStamp);
}

export function wikiLinkPlugin(onOpenPath: (linkText: string, newTab: boolean) => void, hideSyntax: boolean) {
  return [
    ViewPlugin.fromClass(class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        // Rebuild on EVERY selection change (not just line changes): the
        // caret-in-link reveal below compares the selection against each link
        // range, so arrow-key movement WITHIN a line must re-evaluate it —
        // with the old line-level check, links never unfolded under the
        // keyboard caret (maintainer report 2026-07-06). Scans only the
        // visible ranges; same convention as the markdown decoration plugin.
        const interactiveNow = isEditorInteractive(update.state);
        // Also rebuild when the resolver set arrives/changes so unresolved links
        // (re)style after the index loads or a target note gets created.
        const resolverChanged = update.startState.field(wikiResolverField, false) !== update.state.field(wikiResolverField, false);
        const needsRebuild = update.docChanged || update.viewportChanged || resolverChanged
          || (update.selectionSet && hideSyntax && interactiveNow)
          || isEditorInteractive(update.startState) !== interactiveNow;
        if (needsRebuild) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        const selection = view.state.selection;
        // Reveal raw link syntax at the selection only while editing. On mobile
        // the live preview is also read mode (editable but read-only): selecting
        // a link there keeps it rendered instead of popping [[...]] (maintainer).
        const editable = isEditorInteractive(view.state);
        // Resolver set (existing targets); a wiki link missing from it renders
        // "unresolved" (Obsidian parity). null until the index has loaded.
        const resolver = view.state.field(wikiResolverField, false) ?? null;

          // Collect all link matches first
          // We need start, end, and ranges to hide
          const matches: { start: number, end: number, type: LinkKind, target: string, hideRanges?: {start: number, end: number}[] }[] = [];

        for (const { from, to } of view.visibleRanges) {
          const text = view.state.sliceDoc(from, to);
          
          // Match WikiLinks: [[target|alias]] or [[target]]
          const wikiRegex = /\[\[(.*?)\]\]/g;
          let match;
          while ((match = wikiRegex.exec(text)) !== null) {
            const matchStart = from + match.index;
            if (matchStart > 0 && view.state.sliceDoc(matchStart - 1, matchStart) === "!") {
              continue; // Skip image links ![[...]]
            }
            const matchEnd = matchStart + match[0].length;
            const content = match[1];
            const hideRanges: {start: number, end: number}[] = [];
            let rawTarget = content;
            
            if (content.includes("|")) {
              const parts = content.split("|");
              rawTarget = parts[0];
              // text is parts[1]
              // We hide `[[target|` and `]]`
              const prefixLen = 2 + rawTarget.length + 1; // "[[" + target + "|"
              hideRanges.push({ start: matchStart, end: matchStart + prefixLen });
              hideRanges.push({ start: matchEnd - 2, end: matchEnd });
            } else {
              // We hide `[[` and `]]`
              hideRanges.push({ start: matchStart, end: matchStart + 2 });
              hideRanges.push({ start: matchEnd - 2, end: matchEnd });
            }
            const target = rawTarget.split("#")[0];
            
            matches.push({ start: matchStart, end: matchEnd, type: "wiki", target, hideRanges });
          }
          
          // Match Standard Links: [text](url). The link TEXT must not contain a
          // `]` (a real Markdown link's text can't) — otherwise the match spans
          // across a preceding `[...]` such as a footnote `[^1]` into the real
          // link, styling everything in between as one link (issue #11).
          const mdRegex = /\[([^\]\n]*?)\]\(([^)\n]*?)\)/g;
          while ((match = mdRegex.exec(text)) !== null) {
            const matchStart = from + match.index;
            if (matchStart > 0 && view.state.sliceDoc(matchStart - 1, matchStart) === "!") {
              continue; // Skip image links ![...](...)
            }
            const matchEnd = matchStart + match[0].length;
            const displayText = match[1];
            const target = match[2];
            
            const hideRanges = [];
            hideRanges.push({ start: matchStart, end: matchStart + 1 }); // hide `[`
            const suffixStart = matchStart + 1 + displayText.length;
            hideRanges.push({ start: suffixStart, end: matchEnd }); // hide `](url)`
            
            matches.push({ start: matchStart, end: matchEnd, type: "markdown", target, hideRanges });
          }

          // Match raw URLs: https://...
          const urlRegex = /(https?:\/\/[^\s)]+)/g;
          while ((match = urlRegex.exec(text)) !== null) {
            const matchStart = from + match.index;
            const matchEnd = matchStart + match[0].length;
            
            let overlaps = false;
            for (const m of matches) {
              if (matchStart < m.end && matchEnd > m.start) {
                overlaps = true;
                break;
              }
            }
            
            if (!overlaps) {
              matches.push({ start: matchStart, end: matchEnd, type: "url", target: match[0] });
            }
          }
        }
        
        // Sort matches by start position because RangeSetBuilder requires strictly increasing order
        matches.sort((a, b) => a.start - b.start);
        
        // Prevent overlapping matches which crash RangeSetBuilder
        const validMatches = [];
        let lastEnd = -1;
        for (const m of matches) {
          if (m.start >= lastEnd) {
            validMatches.push(m);
            lastEnd = m.end;
          }
        }
        
        for (const m of validMatches) {
          // Check if cursor overlaps this match
          let isFocused = false;
          for (const range of selection.ranges) {
            if (range.from <= m.end && range.to >= m.start) {
              isFocused = true;
              break;
            }
          }

          // Unresolved = a wiki link whose target note does not exist yet
          // (only wiki links carry the "not created yet" meaning).
          const unresolved = m.type === "wiki" && !isWikiTargetResolved(m.target, resolver);
          const linkClass = unresolved ? "cm-wiki-link cm-wiki-link--unresolved" : "cm-wiki-link";
          const linkAttrs: Record<string, string> = { "data-link-target": m.target, "data-link-type": m.type };
          if (unresolved) linkAttrs.title = i18n.t("editor.unresolvedLinkTip", "Note doesn't exist yet — click to create");

          if (hideSyntax && !(isFocused && editable) && m.hideRanges && m.hideRanges.length === 2) {
            // Live Preview: Hide markdown link syntax separately and style the rest
            const hr1 = m.hideRanges[0];
            const hr2 = m.hideRanges[1];

            builder.add(hr1.start, hr1.end, Decoration.replace({}));

            // The text between the hidden parts gets the class
            if (hr1.end < hr2.start) {
              builder.add(hr1.end, hr2.start, Decoration.mark({
                class: linkClass,
                attributes: linkAttrs,
              }));
            }

            builder.add(hr2.start, hr2.end, Decoration.replace({}));
          } else {
            // When focused or in source mode, show raw text but apply styling
            const markDec = Decoration.mark({
              class: linkClass,
              attributes: linkAttrs,
            });
            builder.add(m.start, m.end, markDec);
          }
        }
        
        return builder.finish();
      }
    }, {
      decorations: (v: any) => v.decorations
    }),
    wikiResolverField,
    EditorView.baseTheme({
      ".cm-wiki-link": {
        color: "var(--wiki-link-color, var(--accent-color))",
        textDecoration: "underline",
        cursor: "pointer"
      },
      // lezer-markdown tags the inner `[target]` of `[[wiki]]` (and `[text](url)`)
      // as a Link, so the highlighter paints its own SOLID underline on the token
      // nested inside this mark. It stacked with this mark's underline — invisible
      // on a resolved link (two solid lines merge) but on an UNRESOLVED link it
      // showed a solid line beneath the dashed one. This mark owns the link
      // underline; drop the nested token's so exactly one line renders. Scoped to
      // `.cm-wiki-link`, so the compose editor (no wiki plugin) keeps its links
      // underlined.
      ".cm-wiki-link *": {
        textDecoration: "none",
      },
      // Unresolved (note doesn't exist yet): muted + dashed underline, still
      // clickable — clicking creates the note (Obsidian parity). Kept visually
      // identical to the reading view's `underline dashed` (maintainer: the
      // live-preview link must look the same as in reading mode).
      ".cm-wiki-link--unresolved": {
        color: "var(--wiki-link-unresolved-color, var(--text-muted))",
        textDecorationStyle: "dashed",
      },
    }),
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        if (event.button !== 0) return false; // only left click
        lastPointerEvent.set(view, event.timeStamp);
        const newTab = event.ctrlKey || event.metaKey;
        // Primary: the target lives on the tapped .cm-wiki-link element itself.
        if (openLinkFromEl(event.target, view, newTab, onOpenPath, event.timeStamp)) {
          event.preventDefault();
          return true;
        }
        // Ctrl/Cmd+click may mean a link under the pointer even off the glyph.
        if (newTab && openLinkAtCoords(view, event.clientX, event.clientY, true, onOpenPath, event.timeStamp)) {
          event.preventDefault();
          return true;
        }
        return false;
      },
      // Touch devices don't fire a reliable mousedown on tap (worse in the
      // read-only view, where the content isn't focusable). Treat a genuine tap
      // as a link open; preventDefault() suppresses the synthetic mouse events
      // so desktop (mouse) still goes through mousedown with no double-fire.
      touchstart: (event, view) => {
        const t = event.touches[0];
        if (t) touchTapStart.set(view, { x: t.clientX, y: t.clientY, at: event.timeStamp });
        return false;
      },
      touchend: (event, view) => {
        // Edit mode: a tap places the cursor; only the read-only view navigates.
        if (isEditorInteractive(view.state)) return false;
        const start = touchTapStart.get(view);
        touchTapStart.delete(view);
        const end = event.changedTouches[0];
        if (!start || !end) return false;
        const moved = Math.hypot(end.clientX - start.x, end.clientY - start.y);
        if (moved > 10 || event.timeStamp - start.at > 700) return false; // scroll / long-press, not a tap
        // Only a GENUINE tap marks the pipeline reachable (so the click fallback
        // stands down). A scroll must NOT arm it — otherwise a later swallowed tap
        // on a link would find the fallback wrongly disabled (maintainer: links
        // not responding). Hence the stamp sits AFTER the scroll/long-press check.
        lastPointerEvent.set(view, event.timeStamp);
        // Read the target off the hit element first (reliable on every WebView);
        // fall back to the coordinate lookup only if the tap missed the span.
        if (openLinkFromEl(event.target, view, false, onOpenPath, event.timeStamp)
          || openLinkAtCoords(view, end.clientX, end.clientY, false, onOpenPath, event.timeStamp)) {
          event.preventDefault();
          return true;
        }
        return false;
      },
      // Native WebViews (iOS WKWebView in particular) run their own gesture
      // recognizers ahead of the page: a tap on non-editable content may never
      // reach the touch/mouse handlers above, but it DOES synthesize a click
      // on elements styled cursor:pointer. This fallback only acts when the
      // primary handlers were unreachable for this tap (no recent pointer
      // event); lastLinkNav guards the same-target re-fire on top of that.
      click: (event, view) => {
        if (isEditorInteractive(view.state)) return false;
        const seen = lastPointerEvent.get(view);
        if (seen !== undefined && event.timeStamp - seen < 1500) return false; // normal pipeline handled this tap
        if (openLinkFromEl(event.target, view, false, onOpenPath, event.timeStamp)
          || openLinkAtCoords(view, event.clientX, event.clientY, false, onOpenPath, event.timeStamp)) {
          event.preventDefault();
          return true;
        }
        return false;
      }
    })
  ];
}
