import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { imageMimeType } from "../services/imageFiles";
import { findImageEmbeds, imageBasename, imageCandidates, type ImageLookup } from "../lib/imageTarget";
import { anchorFramesAt, anchorFramesSignature, decorateAnchorTarget, hasAnchorHighlightChange, type AnchorFrame } from "./anchorHighlight";
import { pickImageRegion } from "./anchorRegion";
import i18n from "../i18n";

/**
 * Inline image previews in live/source mode. Vault images load as BLOB URLs
 * (P5.11) — never via the asset protocol, which required a filesystem-wide
 * `assetProtocol` scope and is now disabled entirely. Targets from note
 * content are validated against the vault root (same rule as the read mode).
 *
 * Where a target may point is one shared rule since the Build-91 feedback
 * round (P3, `lib/imageTarget.ts`): the literal path, beside the note, the
 * attachment folder, and — through the host's index — the basename anywhere
 * in the vault, which is how Obsidian writes and finds its attachments.
 */

type ImageSource =
  | { kind: "direct"; url: string }
  | {
      kind: "vault";
      /** Absolute paths to try in order. */
      candidates: string[];
      /** Last resort: the index, by basename — resolves to an absolute path. */
      resolveByIndex: (() => Promise<string | null>) | null;
      /** Stable identity for the widget and the URL cache. */
      key: string;
    };

/** Shell file access, injected by the app (ADR 0011) — no direct fs plugin here. */
export type ReadBinaryFn = (absolutePath: string) => Promise<Uint8Array>;

/** What the host knows about where embeds of the current note may point. */
export type ImageLookupFn = () => ImageLookup & {
  /** The index lookup by basename (vault-relative result), when the host has one. */
  resolveByName?: (basename: string) => Promise<string | null>;
};

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

/** The first candidate that loads; the index answer last. */
async function loadVaultImage(
  source: Extract<ImageSource, { kind: "vault" }>,
  readBinary: ReadBinaryFn,
): Promise<{ url: string; absolutePath: string } | null> {
  for (const absolutePath of source.candidates) {
    const url = await blobUrlFor(absolutePath, readBinary);
    if (url) return { url, absolutePath };
  }
  if (source.resolveByIndex) {
    const absolutePath = await source.resolveByIndex().catch(() => null);
    if (absolutePath) {
      const url = await blobUrlFor(absolutePath, readBinary);
      if (url) return { url, absolutePath };
    }
  }
  return null;
}

/** Right-click on a vault image → the host opens its own copy/save-as menu. */
export type ImageContextFn = (e: MouseEvent, absolutePath: string) => void;

class ImageWidget extends WidgetType {
  constructor(
    readonly source: ImageSource,
    readonly key: string,
    readonly readBinary: ReadBinaryFn,
    /** The embed's range in the document — what a comment on the picture anchors to. */
    readonly from: number,
    readonly to: number,
    /**
     * Every comment anchored to this picture, not just one.
     *
     * Several markings on one screenshot is the normal case for a region, so the
     * widget draws a set - unlike a table cell or a diagram, which frame exactly
     * one range and keep the singular helper.
     */
    readonly frames: readonly AnchorFrame[],
    /** Obsidian's `|300`: a display width in CSS pixels, or null. */
    readonly width: number | null,
    readonly onImageContext?: ImageContextFn,
  ) { super(); }

  eq(other: ImageWidget) {
    // The frames join the identity: without them CodeMirror reuses the DOM it
    // already built and a frame - or a region moved by an edit - never appears.
    return this.key === other.key && this.width === other.width && anchorFramesSignature(other.frames) === anchorFramesSignature(this.frames);
  }

  toDOM(view: EditorView) {
    const container = document.createElement("span");
    container.className = "pv-image-embed";

    const img = document.createElement("img");
    img.style.maxWidth = "100%";
    img.style.maxHeight = "400px";
    img.style.borderRadius = "4px";
    img.style.boxShadow = "var(--shadow-1)";
    if (this.width) img.style.width = `${this.width}px`;

    if (this.source.kind === "direct") {
      img.src = this.source.url;
    } else {
      const source = this.source;
      void loadVaultImage(source, this.readBinary).then((loaded) => {
        if (!loaded || img.isConnected === false) return;
        img.src = loaded.url;
        if (this.onImageContext) {
          const onCtx = this.onImageContext;
          img.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            onCtx(e, loaded.absolutePath);
          };
        }
      });
    }

    container.appendChild(img);
    // Regions are positioned in percent against this box, and the class is what
    // makes the box equal the picture: an inline-block around an inline image
    // inherits the baseline gap, and those stray pixels would skew every
    // fraction downwards.
    container.classList.add("cm-anchor-region-host");
    // A comment on the WHOLE picture still frames the whole picture; one with a
    // rectangle draws its own overlay instead, so it must not do both.
    const whole = this.frames.find((f) => !f.rect) ?? null;
    const regions = this.frames.filter((f) => f.rect);
    decorateAnchorTarget({
      view,
      host: container,
      // The frame goes around the picture, not the inline-block that carries
      // the vertical margins — otherwise it would float above and below it.
      target: img,
      range: { from: this.from, to: this.to },
      display: { kind: "image" },
      frame: whole,
      regions,
      // Only a picture from the vault (plan Stufe E, section 4). At a foreign URL
      // Plainva can guarantee neither the size the fractions were measured
      // against nor that the picture is still the same one.
      pickRegion: this.source.kind === "vault"
        ? () => pickImageRegion({ host: container, box: img }, { hint: i18n.t("comments.commentRegionHint") })
        : undefined,
      bubbleLabel: i18n.t("comments.commentOnImage"),
    });
    return container;
  }
}

function resolveImageSource(src: string, vaultRoot: string, lookup: ImageLookupFn | undefined): ImageSource | null {
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
    return { kind: "direct", url: src };
  }
  const root = vaultRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const absolute = (rel: string) => `${root}/${rel}`;
  const known = lookup?.();
  // Note content is potentially foreign (synced vaults): every candidate
  // passes the vault guard — absolute paths and escapes never load.
  const candidates = imageCandidates(src, known ?? { notePath: "" }).map(absolute);
  if (candidates.length === 0) return null;
  const basename = known?.resolveByName ? imageBasename(src) : null;
  const resolveByName = known?.resolveByName;
  const resolveByIndex =
    basename && resolveByName
      ? async () => {
          const rel = await resolveByName(basename);
          return rel ? absolute(rel) : null;
        }
      : null;
  return { kind: "vault", candidates, resolveByIndex, key: `${known?.notePath ?? ""}::${src}` };
}

export function imagePreviewPlugin(
  vaultRoot: string,
  hideSyntax: boolean,
  readBinary: ReadBinaryFn,
  onImageContext?: ImageContextFn,
  lookup?: ImageLookupFn,
) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      let needsRebuild = update.docChanged || update.viewportChanged
        // A comment appearing or being selected changes the frame, and the
        // frame lives inside the widget's DOM.
        || update.transactions.some(hasAnchorHighlightChange);
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

        for (const embed of findImageEmbeds(text)) {
          const source = resolveImageSource(embed.target, vaultRoot, lookup);
          if (!source) continue; // absolute/escaping targets never load

          const matchStart = from + embed.start;
          const matchEnd = from + embed.end;

          // Check if cursor overlaps this match
          let isFocused = false;
          for (const range of selection.ranges) {
            if (range.from <= matchEnd && range.to >= matchStart) {
              isFocused = true;
              break;
            }
          }

          const widget = new ImageWidget(
            source,
            source.kind === "direct" ? source.url : source.key,
            readBinary,
            matchStart,
            matchEnd,
            anchorFramesAt(view.state, matchStart, matchEnd),
            embed.width,
            onImageContext,
          );
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

      return builder.finish();
    }
  }, {
    decorations: (v: any) => v.decorations
  });
}
