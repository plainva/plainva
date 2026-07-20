import { useSyncExternalStore } from "react";
import type { EditableTarget } from "@plainva/ui";

/**
 * Tiny store for the app's own right-click menu (webview hardening, 2026-07-07).
 * The native WebView context menu is suppressed everywhere; instead we show a
 * minimal menu (rendered by components/ContextMenuHost): Cut/Copy/Paste over an
 * editable field, or just Copy over a plain text selection. The selection and
 * the target field are captured at right-click time so a later focus change
 * (the menu itself takes focus) cannot lose them before the user acts.
 */
/** A vault image the right-click landed on (copy / save-as). */
export interface ImageContextTarget {
  /** Loads the raw image bytes (vault adapter / the editor's injected readBinary). */
  loadBytes: () => Promise<Uint8Array>;
  /** Suggested file name (basename with extension). */
  filename: string;
  /** Image MIME type. */
  mime: string;
}

export interface ContextMenuState {
  x: number;
  y: number;
  /** Text selected when the menu opened. */
  selection: string;
  /** The editable field under the click, or null for plain text. */
  editable: EditableTarget | null;
  /** Set when the click landed on a vault image — shows Copy / Save image as… */
  image?: ImageContextTarget | null;
}

let state: ContextMenuState | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function openContextMenu(next: ContextMenuState): void {
  state = next;
  emit();
}

export function closeContextMenu(): void {
  if (state === null) return;
  state = null;
  emit();
}

export const contextMenuStore = {
  get: () => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useContextMenu(): ContextMenuState | null {
  return useSyncExternalStore(contextMenuStore.subscribe, contextMenuStore.get);
}
