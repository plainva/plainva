import { useSyncExternalStore } from "react";

/*
 * The doors of the AI at a picture and at a voice note: the shell that runs the AI registers the one function behind
 * each, the viewers and players ask here. They live with the AI's ports so a surface of the start bundle can ask
 * without loading the harness (performance plan L5).
 */

/** Where a picture stands: its vault path, and the note it is embedded in where the door stood on an embed. */
export interface ImagePlace {
  path: string;
  notePath?: string;
}

/** What is asked at a picture: what it shows, or a note of it (plan KI-Harness P7). */
export type ImagePurpose = "explain" | "note";

export type ImageExplainer = (place: ImagePlace, purpose?: ImagePurpose) => Promise<void>;

let explainer: ImageExplainer | null = null;
const explainerListeners = new Set<() => void>();

/** The shell's explainer while the AI is on; `null` takes the door away again. */
export function setImageExplainer(next: ImageExplainer | null): void {
  explainer = next;
  for (const listener of explainerListeners) listener();
}

export function imageExplainer(): ImageExplainer | null {
  return explainer;
}

export function onImageExplainerChange(listener: () => void): () => void {
  explainerListeners.add(listener);
  return () => {
    explainerListeners.delete(listener);
  };
}

/** The explainer for a component: null while the AI is off, so the door is not drawn. */
export function useImageExplainer(): ImageExplainer | null {
  return useSyncExternalStore(onImageExplainerChange, imageExplainer, imageExplainer);
}

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

