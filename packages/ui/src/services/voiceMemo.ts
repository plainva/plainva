/**
 * Recording a voice memo (plan Journal-Erweiterungen, X4).
 *
 * `MediaRecorder` in the WebView, one service for both shells: the phone asks
 * the operating system for the microphone through the same `getUserMedia` the
 * desktop uses, so there is one state machine rather than two that disagree
 * about what "stopped" means.
 *
 * What the shells DO differ in is the container the platform hands back — iOS
 * records into MP4, Chromium into WebM — so the extension follows the type the
 * recorder actually used rather than a constant. Both play both, and so does
 * Obsidian; there is no conversion anywhere.
 *
 * The permission is asked for on the first tap, never at startup: a note app
 * that wants the microphone the moment it opens is a note app people uninstall.
 */

/** What a recording is doing right now. */
export type VoiceMemoState = "idle" | "starting" | "recording" | "paused" | "stopping";

export interface VoiceMemoResult {
  bytes: Uint8Array;
  /** The type the recorder produced, e.g. `audio/mp4` or `audio/webm`. */
  mime: string;
  /** Matching extension, without the dot. */
  extension: string;
  /** How long it ran, in seconds. */
  seconds: number;
}

export type VoiceMemoFailure =
  /** The person said no, or the system did. */
  | "denied"
  /** No microphone, or the platform has no recorder. */
  | "unavailable"
  /** It started and then broke — a device unplugged mid-take. */
  | "failed";

export class VoiceMemoError extends Error {
  constructor(readonly reason: VoiceMemoFailure, cause?: unknown) {
    super(`voice memo ${reason}`);
    this.cause = cause;
  }
}

export interface VoiceMemoRecorder {
  readonly state: VoiceMemoState;
  /** Seconds elapsed, as the meter reads it. */
  readonly seconds: number;
  pause(): void;
  resume(): void;
  /** Ends the take and answers with the bytes. */
  stop(): Promise<VoiceMemoResult>;
  /** Ends it and throws the bytes away; nothing is written. */
  discard(): void;
}

export interface VoiceMemoPorts {
  /** Injected for the tests; the real one is `navigator.mediaDevices`. */
  getStream?: () => Promise<MediaStream>;
  /** Injected for the tests; the real one is `window.MediaRecorder`. */
  createRecorder?: (stream: MediaStream, mime: string) => MediaRecorder;
  /** Injected for the tests; the real one is `MediaRecorder.isTypeSupported`. */
  isTypeSupported?: (mime: string) => boolean;
}

/**
 * In order of preference. Opus in a WebM container is what Chromium and modern
 * Firefox give; `audio/mp4` is what iOS gives and the only one Safari has. The
 * bare entries are the fallbacks for a WebView that reports no codec detail.
 */
const CANDIDATE_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

/** The extension for a recorder's type; `webm` when it says nothing useful. */
export function extensionForRecording(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  return EXTENSIONS[base] ?? "webm";
}

/** The first type this platform can actually record, or null when none can. */
export function pickRecordingType(isSupported: (mime: string) => boolean): string | null {
  for (const type of CANDIDATE_TYPES) {
    try {
      if (isSupported(type)) return type;
    } catch {
      /* a WebView that throws on the question cannot record that type */
    }
  }
  return null;
}

/**
 * The name a recording is written under — the date and the minute, so a day of
 * memos sorts by itself in the attachment folder and reads as a list of
 * moments rather than of hashes. A second take in the same minute gets its
 * suffix from the attachment path rule, like every other attachment.
 */
export function voiceMemoFileName(now: Date, label: string, extension: string): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}${two(now.getMinutes())}`;
  return `${label} ${stamp}.${extension}`;
}

/**
 * Starts a take. Throws a {@link VoiceMemoError} rather than a raw DOM error,
 * so a caller can say "you said no" and "this device cannot" differently —
 * they need different sentences and only one of them is worth offering again.
 */
export async function startVoiceMemo(ports: VoiceMemoPorts = {}): Promise<VoiceMemoRecorder> {
  const isTypeSupported = ports.isTypeSupported
    ?? ((mime: string) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime));
  const mime = pickRecordingType(isTypeSupported);
  if (!mime) throw new VoiceMemoError("unavailable");

  const getStream = ports.getStream
    ?? (() => {
      const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
      if (!media?.getUserMedia) return Promise.reject(new VoiceMemoError("unavailable"));
      return media.getUserMedia({ audio: true });
    });

  let stream: MediaStream;
  try {
    stream = await getStream();
  } catch (error) {
    if (error instanceof VoiceMemoError) throw error;
    // NotAllowedError is a refusal; NotFoundError is a device that is not there.
    const name = (error as { name?: string } | null)?.name ?? "";
    throw new VoiceMemoError(name === "NotFoundError" || name === "NotSupportedError" ? "unavailable" : "denied", error);
  }

  const stopStream = () => { for (const track of stream.getTracks()) track.stop(); };

  let recorder: MediaRecorder;
  try {
    recorder = (ports.createRecorder ?? ((s, type) => new MediaRecorder(s, { mimeType: type })))(stream, mime);
  } catch (error) {
    stopStream();
    throw new VoiceMemoError("unavailable", error);
  }

  const chunks: BlobPart[] = [];
  let state: VoiceMemoState = "recording";
  let startedAt = Date.now();
  let banked = 0;
  let settle: ((result: VoiceMemoResult) => void) | null = null;
  let reject: ((error: unknown) => void) | null = null;
  let thrownAway = false;

  const elapsed = () => banked + (state === "recording" ? (Date.now() - startedAt) / 1000 : 0);

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  recorder.onerror = (event) => {
    state = "idle";
    stopStream();
    reject?.(new VoiceMemoError("failed", event));
  };
  recorder.onstop = () => {
    const seconds = elapsed();
    state = "idle";
    stopStream();
    if (thrownAway || !settle) return;
    const done = settle;
    settle = null;
    void new Blob(chunks, { type: mime }).arrayBuffer().then((buffer) => {
      done({ bytes: new Uint8Array(buffer), mime, extension: extensionForRecording(mime), seconds });
    }).catch((error) => reject?.(new VoiceMemoError("failed", error)));
  };

  try {
    recorder.start();
  } catch (error) {
    stopStream();
    throw new VoiceMemoError("failed", error);
  }

  return {
    get state() { return state; },
    get seconds() { return elapsed(); },
    pause() {
      if (state !== "recording") return;
      banked = elapsed();
      state = "paused";
      recorder.pause();
    },
    resume() {
      if (state !== "paused") return;
      startedAt = Date.now();
      state = "recording";
      recorder.resume();
    },
    stop() {
      if (state === "idle") return Promise.reject(new VoiceMemoError("failed"));
      banked = elapsed();
      state = "stopping";
      return new Promise<VoiceMemoResult>((resolveWith, rejectWith) => {
        settle = resolveWith;
        reject = rejectWith;
        recorder.stop();
      });
    },
    discard() {
      thrownAway = true;
      if (state !== "idle") {
        state = "stopping";
        try { recorder.stop(); } catch { stopStream(); }
      }
      chunks.length = 0;
    },
  };
}
