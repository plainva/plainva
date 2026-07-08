import { useSyncExternalStore } from "react";

/**
 * In-app dialog service (plan Designsprache 2026-07-05, P3/§6). Replaces the
 * native blocking dialogs (window.confirm + Tauri ask/message/confirm) with
 * Plainva-styled, theme-aware dialogs. Promise API so the 35 former call
 * sites stay one-liners; rendered by components/ui/DialogHost (mounted once
 * in main.tsx). Only the OS folder/file pickers (plugin-dialog open()) stay
 * native. Queue semantics: requests show one at a time, in order.
 */
export type DialogKind = "info" | "warning" | "danger";

interface BaseRequest {
  id: number;
  title: string;
  message: string;
  kind: DialogKind;
  confirmLabel?: string;
  cancelLabel?: string;
}
export interface ConfirmRequest extends BaseRequest {
  type: "confirm";
  resolve: (ok: boolean) => void;
}
export interface MessageRequest extends BaseRequest {
  type: "message";
  resolve: () => void;
}
export interface PromptRequest extends BaseRequest {
  type: "prompt";
  initial?: string;
  placeholder?: string;
  resolve: (value: string | null) => void;
}
export type DialogRequest = ConfirmRequest | MessageRequest | PromptRequest;

let queue: DialogRequest[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function enqueue(req: DialogRequest) {
  queue = [...queue, req];
  emit();
}

/** Called by DialogHost when the visible dialog is answered. */
export function settleDialog(id: number, value: boolean | string | null) {
  const req = queue.find((r) => r.id === id);
  if (!req) return;
  queue = queue.filter((r) => r.id !== id);
  emit();
  if (req.type === "confirm") req.resolve(value === true);
  else if (req.type === "prompt") req.resolve(typeof value === "string" ? value : null);
  else req.resolve();
}

export interface ConfirmOptions {
  title: string;
  message: string;
  kind?: DialogKind;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function appConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    enqueue({ type: "confirm", id: nextId++, kind: "warning", ...opts, resolve });
  });
}

export function appMessage(opts: { title: string; message: string; kind?: DialogKind }): Promise<void> {
  return new Promise((resolve) => {
    enqueue({ type: "message", id: nextId++, kind: "info", ...opts, resolve });
  });
}

export interface PromptOptions {
  title: string;
  message?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function appPrompt(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    enqueue({
      type: "prompt",
      id: nextId++,
      kind: "info",
      message: opts.message ?? "",
      ...opts,
      resolve,
    });
  });
}

export const dialogStore = {
  /** The dialog currently shown (head of the queue). */
  get: (): DialogRequest | null => queue[0] ?? null,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Test helper. */
  clearAll() {
    for (const r of queue) {
      if (r.type === "confirm") r.resolve(false);
      else if (r.type === "prompt") r.resolve(null);
      else r.resolve();
    }
    queue = [];
    emit();
  },
};

export function useActiveDialog(): DialogRequest | null {
  return useSyncExternalStore(dialogStore.subscribe, dialogStore.get);
}
