import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { imageMimeType } from "../services/imageFiles";
import { resolveVaultRelative } from "../adapters/pathGuard";

/**
 * Inline image previews in live/source mode. Vault images load as BLOB URLs
 * (P5.11) — never via the asset protocol, which required a filesystem-wide
 * `assetProtocol` scope and is now disabled entirely. Targets from note
 * content are validated against the vault root (same rule as the read mode).
 */

type ImageSource =
  | { kind: "direct"; url: string }
  | { kind: "vault"; absolutePath: string };

/** Shell file access, injected by the app (ADR 0011) — no direct fs plugin here. */
export type ReadBinaryFn = (absolutePath: string) => Promise<Uint8Array>;

// One object URL per absolute path for the app's lifetime: images repeat
// across rebuilds (every cursor line change), and revoking per-widget would
// flash. Failed loads are retried on the next build.
const blobUrlCache = new Map<string, Promise<string | null>>();

function blobUrlFor(absolutePath: string, readBinary: ReadBinaryFn): Promise<string | null> {
  let pending = blobUrlCache.get(absolutePath);
  if (!pending) {
    pending = readBinary(absolutePath)
      .then((bytes) => URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: imageMimeType(absolutePath) })))
      .catch(() => null);
    blobUrlCache.set(absolutePath, pending);
    void pending.then((url) => {
      if (url === null) blobUrlCache.delete(absolutePath); // allow retry later
    });
  }
  return pending;
}

class ImageWidget extends WidgetType {
  constructor(readonly source: ImageSource, readonly key: string, readonly readBinary: ReadBinaryFn) { super(); }

  eq(other: ImageWidget) {
    return this.key === other.key;
  }

  toDOM() {
    const container = document.createElement("span");
    container.style.marginTop = "0.5rem";
    container.style.marginBottom = "0.5rem";
    container.style.display = "inline-block";
    container.style.maxWidth = "100%";

    const img = document.createElement("img");
    img.style.maxWidth = "100%";
    img.style.maxHeight = "400px";
    img.style.borderRadius = "4px";
    img.style.boxShadow = "var(--shadow-1)";

    if (this.source.kind === "direct") {
      img.src = this.source.url;
    } else {
      void blobUrlFor(this.source.absolutePath, this.readBinary).then((url) => {
        if (url && img.isConnected !== false) img.src = url;
      });
    }

    container.appendChild(img);
    return container;
  }
}

function resolveImageSource(src: string, vaultRoot: string): ImageSource | null {
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
    return { kind: "direct", url: src };
  }
  // Note content is potentially foreign (synced vaults): refuse absolute
  // paths and anything escaping the vault, exactly like the read mode.
  const rel = resolveVaultRelative(src);
  if (!rel) return null;
  const root = vaultRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  return { kind: "vault", absolutePath: `${root}/${rel}` };
}

export function imagePreviewPlugin(vaultRoot: string, hideSyntax: boolean, readBinary: ReadBinaryFn) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      let needsRebuild = update.docChanged || update.viewportChanged;
      if (!needsRebuild && update.selectionSet) {
        const oldRanges = update.startState.selection.ranges;
        const newRanges = update.state.selection.ranges;
        if (oldRanges.length !== newRanges.length) {
          needsRebuild = true;
        } else {
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
      if (needsRebuild) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView) {
      const builder = new RangeSetBuilder<Decoration>();
      const selection = view.state.selection;

      for (const { from, to } of view.visibleRanges) {
        const text = view.state.sliceDoc(from, to);

        // Match both ![Alt text](url) and ![[url]]
        const regex = /!\[.*?\]\((.*?)(?:\s+".*?")?\)|!\[\[(.*?(\.(?:png|jpe?g|gif|svg|webp|bmp|ico)))\]\]/gi;
        let match;

        while ((match = regex.exec(text)) !== null) {
          const url = match[1] || match[2];
          if (url) {
            const source = resolveImageSource(url, vaultRoot);
            if (!source) continue; // absolute/escaping targets never load

            const matchStart = from + match.index;
            const matchEnd = matchStart + match[0].length;

            // Check if cursor overlaps this match
            let isFocused = false;
            for (const range of selection.ranges) {
              if (range.from <= matchEnd && range.to >= matchStart) {
                isFocused = true;
                break;
              }
            }

            const widget = new ImageWidget(source, source.kind === "direct" ? source.url : source.absolutePath, readBinary);
            if (!hideSyntax || isFocused) {
              // Cursor is here or source mode: show text AND image below it
              const dec = Decoration.widget({ widget, side: 1 });
              builder.add(matchEnd, matchEnd, dec);
            } else {
              // Live Preview: Hide text and show only image
              const dec = Decoration.replace({ widget });
              builder.add(matchStart, matchEnd, dec);
            }
          }
        }
      }

      return builder.finish();
    }
  }, {
    decorations: (v: any) => v.decorations
  });
}
