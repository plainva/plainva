/**
 * In-app dialogs (R3.3, decision E4): M3 bottom sheets replace the native
 * Capacitor Dialog prompts/confirms and the OS <select> dropdowns on every
 * UI surface — promise API after the desktop appDialogs pattern, rendered
 * by MobileDialogHost (mounted once in main.tsx). Only the sync service's
 * mass-delete guard intentionally stays on the native dialog.
 */

export interface MobileSelectOption {
  value: string;
  label: string;
  /** Optional secondary line under the label (place/mode choices, 2026-07-13). */
  desc?: string;
}

interface BaseRequest {
  id: number;
  title: string;
  message?: string;
}

export type MobileDialog =
  | (BaseRequest & {
      kind: "prompt";
      initial?: string;
      placeholder?: string;
      resolve: (r: { value: string; cancelled: boolean }) => void;
    })
  | (BaseRequest & {
      kind: "confirm";
      danger?: boolean;
      confirmLabel?: string;
      resolve: (ok: boolean) => void;
    })
  | (BaseRequest & {
      kind: "select";
      options: MobileSelectOption[];
      value?: string;
      resolve: (v: string | null) => void;
    })
  | (BaseRequest & {
      kind: "cascade";
      plan: import("@plainva/ui").DeletionPlan;
      resolve: (sel: import("@plainva/ui").CascadeSelection | null) => void;
    });

let queue: MobileDialog[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

export function subscribeMobileDialogs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The host renders the OLDEST pending dialog (FIFO, one sheet at a time). */
export function currentMobileDialog(): MobileDialog | null {
  return queue[0] ?? null;
}

/** Called by the host after resolving a dialog's promise. */
export function dismissMobileDialog(dialog: MobileDialog): void {
  queue = queue.filter((d) => d !== dialog);
  emit();
}

export function mPrompt(opts: {
  title: string;
  message?: string;
  initial?: string;
  placeholder?: string;
}): Promise<{ value: string; cancelled: boolean }> {
  return new Promise((resolve) => {
    queue = [...queue, { kind: "prompt", id: nextId++, ...opts, resolve }];
    emit();
  });
}

export function mConfirm(opts: {
  title: string;
  message?: string;
  danger?: boolean;
  confirmLabel?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { kind: "confirm", id: nextId++, ...opts, resolve }];
    emit();
  });
}

export function mSelect(opts: {
  title: string;
  message?: string;
  options: MobileSelectOption[];
  value?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    queue = [...queue, { kind: "select", id: nextId++, ...opts, resolve }];
    emit();
  });
}

/** Cascade-deletion sheet (plan Kaskadenloeschung, mobile v1): group checkboxes
 * + counters, no per-element opt-out — shared/multi-membership exclusions from
 * the plan still apply. Resolves the chosen selection, or null on cancel. */
export function mCascade(opts: {
  title: string;
  plan: import("@plainva/ui").DeletionPlan;
}): Promise<import("@plainva/ui").CascadeSelection | null> {
  return new Promise((resolve) => {
    queue = [...queue, { kind: "cascade", id: nextId++, ...opts, resolve }];
    emit();
  });
}
