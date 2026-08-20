import { useSyncExternalStore } from "react";
import type { TemplateRequest } from "@plainva/ui";

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
/** What a prompt hands back when it carries a checkbox (C18). */
export interface PromptResult {
  value: string;
  checked: boolean;
}
export interface PromptRequest extends BaseRequest {
  type: "prompt";
  initial?: string;
  placeholder?: string;
  /**
   * An optional single yes/no alongside the text field. Added rather than
   * folded into the return type of appPrompt: that resolves to `string | null`
   * and has around twenty call sites, so widening it would touch every one of
   * them to serve the one place that asks a second question.
   */
  checkbox?: { label: string; initial: boolean };
  resolve: (value: PromptResult | null) => void;
}
/**
 * Every question of ONE template, asked in one dialog (plan Vorlagen-Engine,
 * P3). Templater asks one modal per placeholder; a template with three
 * questions is then three dialogs deep before the note even exists. Here the
 * engine collects the questions first and this asks them together — and a
 * cancel aborts the whole thing, so no half-filled note is ever written.
 */
export interface AnswersRequest extends BaseRequest {
  type: "answers";
  fields: TemplateRequest[];
  resolve: (values: Record<string, string> | null) => void;
}
export type DialogRequest = ConfirmRequest | MessageRequest | PromptRequest | AnswersRequest;

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
export function settleDialog(
  id: number,
  value: boolean | string | null | Record<string, string> | PromptResult
) {
  const req = queue.find((r) => r.id === id);
  if (!req) return;
  queue = queue.filter((r) => r.id !== id);
  emit();
  if (req.type === "confirm") req.resolve(value === true);
  else if (req.type === "prompt") {
    // A bare string keeps working: the host sends one when the prompt has no
    // checkbox, and a cancel still arrives as null.
    if (typeof value === "string") req.resolve({ value, checked: false });
    else if (value && typeof value === "object" && "value" in value) req.resolve(value as PromptResult);
    else req.resolve(null);
  }
  // A PromptResult is an object too, so the answers branch must exclude it
  // explicitly — otherwise a checkbox prompt could land here as a field map.
  else if (req.type === "answers")
    req.resolve(value && typeof value === "object" && !("value" in value) ? (value as Record<string, string>) : null);
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
  return appPromptChecked(opts).then((res) => (res ? res.value : null));
}

/**
 * A prompt with one extra yes/no, for the case where the text alone does not
 * carry the whole decision — creating a task that a database also names a
 * provider list for (C18). The switch starts on, because picking a list is
 * already the decision; it is there so a single task can stay in the vault.
 *
 * Same rule and same default as the phone, which has had this since S17. It
 * was the WAY of asking that differed, not the behaviour.
 */
export function appPromptChecked(
  opts: PromptOptions & { checkbox?: { label: string; initial?: boolean } }
): Promise<PromptResult | null> {
  return new Promise((resolve) => {
    enqueue({
      type: "prompt",
      id: nextId++,
      kind: "info",
      message: opts.message ?? "",
      ...opts,
      checkbox: opts.checkbox ? { label: opts.checkbox.label, initial: opts.checkbox.initial ?? true } : undefined,
      resolve,
    });
  });
}

/**
 * Asks every question of a template at once. Resolves with the answers, or
 * with `null` when the user cancels — callers MUST treat null as "abort the
 * whole operation", never as "use empty answers": a note created from a
 * half-answered template is worse than no note.
 */
export function appTemplateAnswers(opts: {
  title: string;
  message?: string;
  fields: TemplateRequest[];
}): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    enqueue({
      type: "answers",
      id: nextId++,
      kind: "info",
      title: opts.title,
      message: opts.message ?? "",
      fields: opts.fields,
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
      else if (r.type === "answers") r.resolve(null);
      else r.resolve();
    }
    queue = [];
    emit();
  },
};

export function useActiveDialog(): DialogRequest | null {
  return useSyncExternalStore(dialogStore.subscribe, dialogStore.get);
}
