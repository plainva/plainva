import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { toast } from "../services/toastStore";
import { openUrl } from "@tauri-apps/plugin-opener";
import { findLinkAtOffset } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

// Removed LinkWidget as we'll use Decoration.mark to allow CSS inheritance

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
        const needsRebuild = update.docChanged || update.viewportChanged || (update.selectionSet && hideSyntax);
        if (needsRebuild) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        const selection = view.state.selection;
        
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
          
          if (hideSyntax && !isFocused && m.hideRanges && m.hideRanges.length === 2) {
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

        if (wantsToNavigate) {
          // posAtCoords is much more reliable for mouse events than posAtDOM
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos !== null) {
            const line = view.state.doc.lineAt(pos);
            const text = line.text;
            const offset = pos - line.from;
            
            const link = findLinkAtOffset(text, offset);
            if (link) {
              if (link.type === 'wiki') {
                onOpenPath(link.target, event.ctrlKey || event.metaKey);
                event.preventDefault();
                return true;
              } else if (link.type === 'markdown') {
                if (link.target.startsWith("http://") || link.target.startsWith("https://")) {
                   openUrl(link.target).catch((err) => {
                     toast.error(i18n.t("dialogs.openWebLinkErrorMsg", { error: err }));
                   });
                } else {
                   onOpenPath(link.target, event.ctrlKey || event.metaKey);
                }
                event.preventDefault();
                return true;
              } else if (link.type === 'url') {
                openUrl(link.target).catch((err) => {
                  toast.error(i18n.t("dialogs.openWebLinkErrorMsg", { error: err }));
                });
                event.preventDefault();
                return true;
              }
            }
          }
        }
        return false;
      }
    })
  ];
}
