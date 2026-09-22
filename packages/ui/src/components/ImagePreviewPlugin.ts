import { trimEndChars } from "@plainva/core";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { imageMimeType } from "../services/imageFiles";
import { findMediaEmbeds, imageBasename, imageCandidates, type ImageLookup } from "../lib/imageTarget";
import { mountAudioPlayer } from "./audioPlayer";
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

// URLs belong to one editor view. Mobile vaults share relative paths, so a
// process-global path cache could display another vault's image. Cursor rebuilds
// reuse this view cache; closing or reconfiguring the view revokes every URL.
interface ImageCache { urls: Map<string, Promise<string | null>>; closed: boolean }

function blobUrlFor(absolutePath: string, readBinary: ReadBinaryFn, cache: ImageCache): Promise<string | null> {
  if (cache.closed) return Promise.resolve(null);
  let pending = cache.urls.get(absolutePath);
  if (!pending) {
    pending = readBinary(absolutePath)
      .then((bytes) => cache.closed ? null : URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: imageMimeType(absolutePath) })))
      .catch(() => null);
    cache.urls.set(absolutePath, pending);
    void pending.then((url) => {
      if (url === null) cache.urls.delete(absolutePath); // allow retry later
    });
  }
  return pending;
}

/** The first candidate that loads; the index answer last. */
async function loadVaultImage(
  source: Extract<ImageSource, { kind: "vault" }>,
  readBinary: ReadBinaryFn,
  cache: ImageCache,
): Promise<{ url: string; absolutePath: string } | null> {
  for (const absolutePath of source.candidates) {
    const url = await blobUrlFor(absolutePath, readBinary, cache);
    if (url) return { url, absolutePath };
  }
  if (source.resolveByIndex) {
    const absolutePath = await source.resolveByIndex().catch(() => null);
    if (absolutePath) {
      const url = await blobUrlFor(absolutePath, readBinary, cache);
      if (url) return { url, absolutePath };
    }
  }
  return null;
}

/** Right-click on a vault image → the host opens its own copy/save-as menu. */
export type ImageContextFn = (e: MouseEvent, absolutePath: string, fromAction?: boolean) => boolean | void;

class ImageWidget extends WidgetType {
  constructor(
    readonly source: ImageSource,
    readonly key: string,
    readonly readBinary: ReadBinaryFn,
    readonly cache: ImageCache,
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
    readonly onOpenImage?: (absolutePath: string) => void,
    readonly alt = "",
  ) { super(); }

  eq(other: ImageWidget) {
    // The frames join the identity: without them CodeMirror reuses the DOM it
    // already built and a frame - or a region moved by an edit - never appears.
    return this.key === other.key && this.width === other.width && this.alt === other.alt && anchorFramesSignature(other.frames) === anchorFramesSignature(this.frames);
  }

  toDOM(view: EditorView) {
    const container = document.createElement("span");
    container.className = "pv-image-embed";

    const frame = document.createElement("span");
    frame.className = "cm-anchor-region-host pv-image-frame";
    const img = document.createElement("img");
    img.alt = this.alt;
    img.style.maxWidth = "100%";
    img.style.maxHeight = "400px";
    img.style.borderRadius = "4px";
    img.style.boxShadow = "var(--shadow-1)";
    if (this.width) img.style.width = `${this.width}px`;

    if (this.source.kind === "direct") {
      img.src = this.source.url;
    } else {
      const source = this.source;
      void loadVaultImage(source, this.readBinary, this.cache).then((loaded) => {
        if (!loaded || img.isConnected === false) return;
        img.src = loaded.url;
        if (this.onOpenImage) {
          const open = document.createElement("button");
          open.type = "button"; open.className = "pv-image-open pv-btn pv-btn--ghost pv-btn--sm";
          open.textContent = i18n.t("contextMenu.openImage");
          open.onclick = (event) => { event.preventDefault(); event.stopPropagation(); this.onOpenImage?.(loaded.absolutePath); };
          open.oncontextmenu = (event) => {
            if (this.onImageContext?.(event, loaded.absolutePath, true) !== false) { event.preventDefault(); event.stopPropagation(); }
          };
          container.appendChild(open);
        }
        if (this.onImageContext) {
          const onCtx = this.onImageContext;
          img.oncontextmenu = (e) => {
            if (onCtx(e, loaded.absolutePath, false) !== false) {
              e.preventDefault(); e.stopPropagation();
            }
          };
        }
      });
    }

    frame.appendChild(img); container.appendChild(frame);
    // Regions are positioned in percent against this box, and the class is what
    // makes the box equal the picture: an inline-block around an inline image
    // inherits the baseline gap, and those stray pixels would skew every
    // fraction downwards.

    // A comment on the WHOLE picture still frames the whole picture; one with a
    // rectangle draws its own overlay instead, so it must not do both.
    const whole = this.frames.find((f) => !f.rect) ?? null;
    const regions = this.frames.filter((f) => f.rect);
    decorateAnchorTarget({
      view,
      host: frame,
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
        ? () => pickImageRegion({ host: frame, box: img }, { hint: i18n.t("comments.commentRegionHint") })
        : undefined,
      bubbleLabel: i18n.t("comments.commentOnImage"),
    });
    return container;
  }
}

/**
 * A sound embed in the editor (plan Journal-Erweiterungen, X3). The same file
 * machinery as the picture - candidates, vault guard, blob URL, view cache -
 * and the shared player for the controls.
 *
 * No anchor regions: a comment can be anchored to a rectangle on a picture,
 * and a sound has no rectangle. A comment on the LINE still works, because
 * that one anchors to the text, not to this widget.
 */
class AudioWidget extends WidgetType {
  constructor(
    readonly source: ImageSource,
    readonly key: string,
    readonly readBinary: ReadBinaryFn,
    readonly cache: ImageCache,
    readonly label: string,
  ) { super(); }

  eq(other: AudioWidget) {
    return this.key === other.key && this.label === other.label;
  }

  toDOM() {
    const container = document.createElement("span");
    container.className = "pv-image-embed";
    const player = mountAudioPlayer(container, { label: this.label });
    if (this.source.kind === "direct") {
      player.setUrl(this.source.url);
    } else {
      void loadVaultImage(this.source, this.readBinary, this.cache).then((loaded) => {
        if (!container.isConnected) return;
        player.setUrl(loaded ? loaded.url : null);
      });
    }
    return container;
  }
}

function resolveImageSource(src: string, vaultRoot: string, lookup: ImageLookupFn | undefined): ImageSource | null {
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
    return { kind: "direct", url: src };
  }
  const root = trimEndChars(vaultRoot.replace(/\\/g, "/"), "/");
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
  onOpenImage?: (absolutePath: string) => void,
) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    readonly imageCache: ImageCache = { urls: new Map(), closed: false };

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    destroy() {
      this.imageCache.closed = true;
      for (const pending of this.imageCache.urls.values()) void pending.then((url) => { if (url) URL.revokeObjectURL(url); });
      this.imageCache.urls.clear();
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

        for (const embed of findMediaEmbeds(text)) {
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

          if (embed.kind === "audio") {
            const sound = new AudioWidget(source, source.kind === "direct" ? source.url : source.key, readBinary, this.imageCache, embed.alt || embed.target.split("/").pop() || embed.target);
            builder.add(
              hideSyntax && !isFocused ? matchStart : matchEnd,
              matchEnd,
              hideSyntax && !isFocused ? Decoration.replace({ widget: sound }) : Decoration.widget({ widget: sound, side: 1 }),
            );
            continue;
          }

          const widget = new ImageWidget(
            source,
            source.kind === "direct" ? source.url : source.key,
            readBinary,
            this.imageCache,
            matchStart,
            matchEnd,
            anchorFramesAt(view.state, matchStart, matchEnd),
            embed.width,
            onImageContext,
            onOpenImage,
            embed.alt || embed.target,
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
