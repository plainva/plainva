import { useSyncExternalStore } from "react";
import { embedFileName, fileNameSpellings, IMAGE_JPEG_QUALITIES, IMAGE_MAX_BYTES, IMAGE_PNG_MAX_BYTES, mimeTypeForPath, prefersPng, scaledImageSize, toBase64, type ImageMediaType } from "@plainva/core";
import { findMediaEmbeds } from "../lib/imageTarget";
import { toast } from "../services/toastStore";
import type { AiSession, ImageOutcome } from "./aiSession";
import { megabytes } from "./aiTranscribe";

/**
 * "Explain image" at a picture of the vault (plan KI-Harness P4-5, §10.7).
 * A picture knows where it stands — its path and, on an embed, the note —
 * and nothing else; the shell that runs the AI registers the one explainer
 * that reads the file, prepares it and hands it to the session. The viewers
 * and the editor's picture menu ask this registry, so the door is there
 * exactly while the AI is on, like "Transcribe" at a voice note.
 */

/** Where a picture stands: its vault path, and the note it is embedded in where the door stood on an embed. */
export interface ImagePlace {
  path: string;
  notePath?: string;
}

export type ImageExplainer = (place: ImagePlace) => Promise<void>;

let current: ImageExplainer | null = null;
const listeners = new Set<() => void>();

/** The shell's explainer while the AI is on; `null` takes the door away again. */
export function setImageExplainer(explainer: ImageExplainer | null): void {
  current = explainer;
  for (const listener of listeners) listener();
}

export function imageExplainer(): ImageExplainer | null {
  return current;
}

export function onImageExplainerChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The explainer for a component: null while the AI is off, so the door is not drawn. */
export function useImageExplainer(): ImageExplainer | null {
  return useSyncExternalStore(onImageExplainerChange, imageExplainer, imageExplainer);
}

export interface EmbedderLookup {
  /** The notes whose text contains one of these spellings (the index's own scan); `truncated` when there were more than it returns. */
  containing(needles: readonly string[]): Promise<{ paths: string[]; truncated: boolean }>;
  /** A note's text as it is saved; null when it cannot be read. */
  read(path: string): Promise<string | null>;
}

/**
 * The notes that embed a picture (plan KI-Harness P4-5). A note's rule
 * "never to the cloud" covers what the note shows, and a picture it embeds is
 * part of that — wherever "Explain image" is pressed, also in the viewer,
 * which no longer knows the note. Found in two steps: the notes whose text
 * names the file at all, then the embeds of each, read with the editor's own
 * scanner. Compared by file name, as an embed finds its file: two pictures of
 * one name in different folders count as one here, which can only keep a
 * picture back, never let one go.
 *
 * `null` when the answer cannot be had — more notes name the file than can be
 * read through, or the index is not there: the caller must then not take
 * "no note embeds it" for granted.
 */
export async function notesEmbedding(path: string, lookup: EmbedderLookup): Promise<string[] | null> {
  const name = embedFileName(path);
  if (!name) return [];
  let found: { paths: string[]; truncated: boolean };
  try {
    found = await lookup.containing(fileNameSpellings(path.slice(path.lastIndexOf("/") + 1)));
  } catch {
    return null;
  }
  if (found.truncated) return null;
  const out: string[] = [];
  for (const note of found.paths) {
    const text = await lookup.read(note).catch(() => null);
    if (text === null) continue;
    if (findMediaEmbeds(text).some((embed) => embed.kind === "image" && embedFileName(embed.target) === name)) out.push(note);
  }
  return out;
}

/** "312 KB", "1.4 MB" — the size of what is sent, as the overview names it. */
export function pictureSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : megabytes(bytes);
}

/** A picture ready to go: scaled down and encoded anew, as base64. */
export interface PreparedImage {
  mime: ImageMediaType;
  data: string;
  width: number;
  height: number;
  bytes: number;
}

/** Why a picture cannot go: it does not decode here, or it stays too large however it is encoded. */
export type PrepareFailure = "unreadable" | "too-large";

/**
 * Turns a file's bytes into what is sent. The shells use the web view's own
 * decoder and canvas (`prepareImageInBrowser`); tests hand in their own.
 */
export type ImagePreparer = (bytes: Uint8Array, sourceMime: string) => Promise<PreparedImage | PrepareFailure>;

/** What a drawing surface must be able to do; a canvas of the web view is one. */
interface Surface {
  draw(background: boolean): void;
  encode(mime: ImageMediaType, quality?: number): Promise<Uint8Array | null>;
}

/**
 * Picks the encoding (plan P4-5): PNG for what a file's format says has sharp
 * edges, while that stays small; JPEG otherwise, at the first quality that
 * fits. JPEG has no transparency, so it is drawn on white.
 */
export async function encodePicture(surface: Surface, sourceMime: string, size: { width: number; height: number }): Promise<PreparedImage | PrepareFailure> {
  if (prefersPng(sourceMime)) {
    surface.draw(false);
    const png = await surface.encode("image/png");
    if (png && png.length <= IMAGE_PNG_MAX_BYTES) return { mime: "image/png", data: toBase64(png), ...size, bytes: png.length };
  }
  surface.draw(true);
  let encoded = false;
  for (const quality of IMAGE_JPEG_QUALITIES) {
    const jpeg = await surface.encode("image/jpeg", quality);
    if (!jpeg) continue;
    encoded = true;
    if (jpeg.length <= IMAGE_MAX_BYTES) return { mime: "image/jpeg", data: toBase64(jpeg), ...size, bytes: jpeg.length };
  }
  return encoded ? "too-large" : "unreadable";
}

/** A picture without a size of its own (some SVGs) is drawn at this one. */
const SIZELESS = { width: 1024, height: 768 };

/**
 * The web view's own way: decode the file as an `<img>` (which also turns a
 * photo the way its EXIF says), draw it at the size it goes in, and encode
 * the canvas. The file's bytes themselves are never sent — so nothing of its
 * metadata is: no place, no date, no camera.
 */
export const prepareImageInBrowser: ImagePreparer = async (bytes, sourceMime) => {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return "unreadable";
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: sourceMime }));
  try {
    const picture = new Image();
    picture.decoding = "async";
    picture.src = url;
    try {
      await picture.decode();
    } catch {
      return "unreadable";
    }
    const size = scaledImageSize(picture.naturalWidth || SIZELESS.width, picture.naturalHeight || SIZELESS.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return "unreadable";
    const surface: Surface = {
      draw(background) {
        context.clearRect(0, 0, size.width, size.height);
        if (background) {
          // Paper white behind what is sent as JPEG — data of the picture, not a colour of the app.
          context.fillStyle = "white";
          context.fillRect(0, 0, size.width, size.height);
        }
        context.drawImage(picture, 0, 0, size.width, size.height);
      },
      encode: (mime, quality) =>
        new Promise((resolve) => {
          try {
            canvas.toBlob(
              (blob) => {
                if (!blob) resolve(null);
                else void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), () => resolve(null));
              },
              mime,
              quality,
            );
          } catch {
            // A canvas the engine marks tainted (an SVG that embeds foreign content) gives nothing.
            resolve(null);
          }
        }),
    };
    return await encodePicture(surface, sourceMime, size);
  } finally {
    URL.revokeObjectURL(url);
  }
};

export interface ExplainerDeps {
  /** The picture's bytes from the vault. */
  readBinary(path: string): Promise<Uint8Array>;
  /** How the bytes become what is sent; the web view's own way where none is given. */
  prepare?: ImagePreparer;
}

type Translate = (key: string, vars?: Record<string, unknown>) => string;

/** The explainer a shell registers: hands the place to the session, which asks for the picture once it may go. */
export function createImageExplainer(session: Pick<AiSession, "explainImage">, t: Translate, deps: ExplainerDeps): ImageExplainer {
  const prepare = deps.prepare ?? prepareImageInBrowser;
  return async (place) => {
    const outcome = await session.explainImage({
      path: place.path,
      ...(place.notePath ? { notePath: place.notePath } : {}),
      load: async () => {
        const bytes = await deps.readBinary(place.path).catch(() => null);
        return bytes ? prepare(bytes, mimeTypeForPath(place.path)) : "unreadable";
      },
    });
    reportImage(t, outcome);
  };
}

/** One toast per refusal; an answer is in the conversation, and a declined send overview says nothing — the user chose it. */
export function reportImage(t: Translate, outcome: ImageOutcome): void {
  if (outcome.kind !== "refused") return;
  switch (outcome.reason) {
    case "cancelled":
    case "busy":
      return;
    case "no-route":
      toast.error(t("ai.image.refused.no-route", { provider: outcome.provider ?? "" }));
      return;
    case "too-large":
      toast.error(t("ai.image.refused.too-large", { max: megabytes(IMAGE_MAX_BYTES) }));
      return;
    case "failed":
      // The conversation shows why: the notice under the question names the provider's answer.
      if (outcome.conversationId) return;
      toast.error(t("ai.image.refused.failed", { reason: outcome.message ?? "" }));
      return;
    default:
      toast.error(t(`ai.image.refused.${outcome.reason}`));
  }
}
