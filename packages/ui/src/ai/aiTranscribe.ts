import { TRANSCRIPTION_MAX_BYTES } from "@plainva/core";
import { imageBasename, imageCandidates } from "../lib/imageTarget";
import { toast } from "../services/toastStore";
import type { AiSession, TranscriptionOutcome } from "./aiSession";
import { aiFailureText } from "./aiSettingsModel";

/**
 * "Transcribe" at every voice note (plan KI-Harness P1.5, §10.7, E28). A
 * sound embed knows where it stands — the note and the target as written —
 * and nothing else; the shell that runs the AI registers the one transcriber
 * that finds the file, reads it and hands it to the session. The players ask
 * this registry, so the door is there exactly while the AI is on, on every
 * surface a voice note can stand on.
 */

/** Where a sound stands: the note it is embedded in, and the embed's target as the note has it. */
export interface AudioPlace {
  notePath: string;
  target: string;
}

export type AudioTranscriber = (place: AudioPlace) => Promise<void>;

let current: AudioTranscriber | null = null;
const listeners = new Set<() => void>();

/** The shell's transcriber while the AI is on; `null` takes the door away again. */
export function setAudioTranscriber(transcriber: AudioTranscriber | null): void {
  current = transcriber;
  for (const listener of listeners) listener();
}

export function audioTranscriber(): AudioTranscriber | null {
  return current;
}

export function onAudioTranscriberChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const MIME_BY_EXTENSION: Record<string, string> = {
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  webm: "audio/webm",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  aac: "audio/aac",
  flac: "audio/flac",
};

/** A recording's media type by its extension — what the recorder and the providers agree on. */
export function audioMime(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot >= 0 && MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()]) || "application/octet-stream";
}

/** "1.4 MB" — the one size a refusal names. */
export function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The recording's vault path, found the way the player finds it: beside the
 * note by the target as written, else by its name through the index.
 */
export async function resolveAudioPath(
  place: AudioPlace,
  exists: (path: string) => Promise<boolean>,
  byName?: (basename: string, near: string) => Promise<string | null>,
): Promise<string | null> {
  for (const candidate of imageCandidates(place.target, { notePath: place.notePath })) {
    if (await exists(candidate).catch(() => false)) return candidate;
  }
  const basename = imageBasename(place.target);
  return basename && byName ? byName(basename, place.notePath).catch(() => null) : null;
}

export interface TranscriberDeps {
  /** The recording's vault path, found the way the player finds it; null when it is gone. */
  resolve(place: AudioPlace): Promise<string | null>;
  readBinary(path: string): Promise<Uint8Array>;
}

type Translate = (key: string, vars?: Record<string, unknown>) => string;

/** The transcriber a shell registers: finds and reads the file, runs it, and says what came of it. */
export function createAudioTranscriber(session: Pick<AiSession, "transcribe">, t: Translate, deps: TranscriberDeps): AudioTranscriber {
  return async (place) => {
    const outcome = await transcribePlace(session, deps, place);
    reportTranscription(t, outcome);
  };
}

async function transcribePlace(session: Pick<AiSession, "transcribe">, deps: TranscriberDeps, place: AudioPlace): Promise<TranscriptionOutcome> {
  const path = await deps.resolve(place).catch(() => null);
  const bytes = path ? await deps.readBinary(path).catch(() => null) : null;
  if (!path || !bytes) return { kind: "refused", reason: "missing" };
  const name = path.slice(path.lastIndexOf("/") + 1);
  return session.transcribe({ notePath: place.notePath, target: place.target, audio: { path, name, mime: audioMime(name), bytes } });
}

/** One toast per outcome; a declined send overview says nothing — the user chose it. */
export function reportTranscription(t: Translate, outcome: TranscriptionOutcome): void {
  if (outcome.kind === "proposed") {
    toast.success(t("ai.transcribe.proposed"));
    return;
  }
  switch (outcome.reason) {
    case "cancelled":
    case "busy":
      // Declined in the overview, or this recording is already on its way: nothing to add.
      return;
    case "no-route":
      toast.error(t("ai.transcribe.refused.no-route", { provider: outcome.provider ?? "" }));
      return;
    case "too-large":
      toast.error(t("ai.transcribe.refused.too-large", { size: megabytes(outcome.size ?? 0), max: megabytes(TRANSCRIPTION_MAX_BYTES) }));
      return;
    case "failed": {
      const reason = outcome.failure ? aiFailureText(t, outcome.failure, outcome.provider ?? "", outcome.model ?? "") : (outcome.message ?? "");
      toast.error(t("ai.transcribe.refused.failed", { reason }));
      return;
    }
    default:
      toast.error(t(`ai.transcribe.refused.${outcome.reason}`));
  }
}
