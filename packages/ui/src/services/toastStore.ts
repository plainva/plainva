import { useSyncExternalStore } from "react";
import { logDiagnostic } from "./diagnosticsLog";

/**
 * Non-blocking notifications (plan Designsprache 2026-07-05, P3/E2).
 * Info/error notices that used to be native blocking dialogs (Tauri
 * message/ask) become toasts; only real DECISIONS stay dialogs
 * (services/appDialogs.ts). Rendered by components/ui/ToastHost.
 */
export type ToastKind = "info" | "success" | "warning" | "error";

/** Optional call-to-action rendered as a button in the toast (e.g. install an
 *  update). Clicking runs `run` and dismisses the toast. */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
  /** Stays until dismissed explicitly (e.g. a running install) — no auto-dismiss. */
  persistent?: boolean;
}

const AUTO_DISMISS_MS: Record<ToastKind, number> = {
  info: 5000,
  success: 5000,
  warning: 7000,
  error: 8000,
};

let items: ToastItem[] = [];
let nextId = 1;
const timers = new Map<number, number>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function remove(id: number) {
  const t = timers.get(id);
  if (t !== undefined) window.clearTimeout(t);
  timers.delete(id);
  const before = items.length;
  items = items.filter((i) => i.id !== id);
  if (items.length !== before) emit();
}

function push(kind: ToastKind, message: string, action?: ToastAction, persistent?: boolean): number {
  const id = nextId++;
  items = [...items, { id, kind, message, action, persistent }];
  // Persistent toasts (e.g. a running install) stay until dismissed explicitly;
  // actionable toasts linger longer so the user can reach the button.
  if (!persistent) {
    timers.set(id, window.setTimeout(() => remove(id), action ? 12000 : AUTO_DISMISS_MS[kind]));
  }
  // Error/warning toasts double as the diagnostics trail (P4.2) — the export
  // shows what the user actually saw, without any note content.
  if (kind === "error" || kind === "warning") logDiagnostic(`toast.${kind}`, message);
  emit();
  return id;
}

export const toast = {
  info: (message: string, action?: ToastAction) => push("info", message, action),
  success: (message: string, action?: ToastAction) => push("success", message, action),
  warning: (message: string, action?: ToastAction) => push("warning", message, action),
  error: (message: string, action?: ToastAction) => push("error", message, action),
  /** A persistent toast (no auto-dismiss) for an ongoing operation — the caller
   *  dismisses it when done (e.g. an update download that ends in a relaunch). */
  progress: (message: string) => push("info", message, undefined, true),
  dismiss: remove,
  /** Hover pause: stop the auto-dismiss timer … */
  pause(id: number) {
    const t = timers.get(id);
    if (t !== undefined) {
      window.clearTimeout(t);
      timers.delete(id);
    }
  },
  /** … and restart a short grace period on leave. */
  resume(id: number) {
    const item = items.find((i) => i.id === id);
    if (!item || item.persistent || timers.has(id)) return;
    timers.set(id, window.setTimeout(() => remove(id), 2000));
  },
  /** Test helper. */
  clearAll() {
    for (const t of timers.values()) window.clearTimeout(t);
    timers.clear();
    if (items.length) {
      items = [];
      emit();
    }
  },
};

export const toastStore = {
  get: () => items,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(toastStore.subscribe, toastStore.get);
}
