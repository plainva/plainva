import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { toast } from "../services/toastStore";
import { getPlatformServices } from "../platform/services";
import { findLinkAtOffset } from "../lib/linkParser";
import i18n from "../i18n";

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

/** Resolves the link under (x, y) and opens it. Returns true when a link was
 * opened (callers preventDefault). Shared by mousedown, touchend and click. */
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
  const last = lastLinkNav.get(view);
  if (last && last.target === link.target && timeStamp - last.at < 900) {
    return true; // duplicate event of the same physical tap — swallow, don't re-open
  }
  if (link.type === "wiki") {
    onOpenPath(link.target, newTab);
  } else if (link.type === "markdown") {
    if (link.target.startsWith("http://") || link.target.startsWith("https://")) {
      getPlatformServices().openExternal(link.target).catch((err) => {
        toast.error(i18n.t("dialogs.openWebLinkErrorMsg", { error: err }));
      });
    } else {
      onOpenPath(link.target, newTab);
    }
  } else if (link.type === "url") {
    getPlatformServices().openExternal(link.target).catch((err) => {
      toast.error(i18n.t("dialogs.openWebLinkErrorMsg", { error: err }));
    });
  } else {
    return false;
  }
  lastLinkNav.set(view, { at: timeStamp, target: link.target });
  return true;
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
        const editableNow = update.state.facet(EditorView.editable);
        const needsRebuild = update.docChanged || update.viewportChanged
          || (update.selectionSet && hideSyntax && editableNow)
          || update.startState.facet(EditorView.editable) !== editableNow;
        if (needsRebuild) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        const selection = view.state.selection;
        // Reveal raw link syntax at the selection only while editable. On mobile
        // the live preview is also read mode (editable off): selecting a link
        // there keeps it rendered instead of popping [[...]] (maintainer).
        const editable = view.state.facet(EditorView.editable);

          // Collect all link matches first
          // We need start, end, and ranges to hide
          const matches: { start: number, end: number, text: string, target: string, hideRanges?: {start: number, end: number}[] }[] = [];

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
            
            matches.push({ start: matchStart, end: matchEnd, text: "wiki", target, hideRanges });
          }
          
          // Match Standard Links: [text](url)
          const mdRegex = /\[(.*?)\]\((.*?)\)/g;
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
            
            matches.push({ start: matchStart, end: matchEnd, text: displayText, target, hideRanges });
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
              matches.push({ start: matchStart, end: matchEnd, text: match[0], target: match[0] });
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
          
          if (hideSyntax && !(isFocused && editable) && m.hideRanges && m.hideRanges.length === 2) {
            // Live Preview: Hide markdown link syntax separately and style the rest
            const hr1 = m.hideRanges[0];
            const hr2 = m.hideRanges[1];

            builder.add(hr1.start, hr1.end, Decoration.replace({}));
            
            // The text between the hidden parts gets the class
            if (hr1.end < hr2.start) {
              builder.add(hr1.end, hr2.start, Decoration.mark({ class: "cm-wiki-link" }));
            }
            
            builder.add(hr2.start, hr2.end, Decoration.replace({}));
          } else {
            // When focused or in source mode, show raw text but apply styling
            const markDec = Decoration.mark({ class: "cm-wiki-link" });
            builder.add(m.start, m.end, markDec);
          }
        }
        
        return builder.finish();
      }
    }, {
      decorations: (v: any) => v.decorations
    }),
    EditorView.baseTheme({
      ".cm-wiki-link": {
        color: "var(--wiki-link-color, var(--accent-color))",
        textDecoration: "underline",
        cursor: "pointer"
      }
    }),
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        if (event.button !== 0) return false; // only left click
        lastPointerEvent.set(view, event.timeStamp);

        let targetNode = event.target as Node | null;
        if (targetNode && targetNode.nodeType === Node.TEXT_NODE) {
          targetNode = targetNode.parentNode;
        }
        
        if (!targetNode || !(targetNode instanceof HTMLElement)) {
          return false;
        }
        
        const target = targetNode as HTMLElement;

        // Use closest to ensure we catch clicks on nested elements or the span itself
        const isClickable = target.closest('.cm-wiki-link') !== null;
        const wantsToNavigate = isClickable || event.ctrlKey || event.metaKey;

        // posAtCoords is much more reliable for mouse events than posAtDOM
        if (wantsToNavigate && openLinkAtCoords(view, event.clientX, event.clientY, event.ctrlKey || event.metaKey, onOpenPath, event.timeStamp)) {
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
        if (view.state.facet(EditorView.editable)) return false;
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
        if (openLinkAtCoords(view, end.clientX, end.clientY, false, onOpenPath, event.timeStamp)) {
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
        if (view.state.facet(EditorView.editable)) return false;
        const seen = lastPointerEvent.get(view);
        if (seen !== undefined && event.timeStamp - seen < 1500) return false; // normal pipeline handled this tap
        if (openLinkAtCoords(view, event.clientX, event.clientY, false, onOpenPath, event.timeStamp)) {
          event.preventDefault();
          return true;
        }
        return false;
      }
    })
  ];
}
