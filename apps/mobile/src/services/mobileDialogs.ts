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
  /** Destructive: rendered in the error pair and separated from the harmless
   * entries (S21). Without it a "delete" reads exactly like a "colour". */
  danger?: boolean;
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
      secure?: boolean;
      /**
       * An optional second decision on the same sheet (S17). Used where a
       * prompt would otherwise need a follow-up dialog for a yes/no that
       * belongs to the same act — the phone has the room for it; the desktop
       * prompt resolves to a plain string and cannot carry one.
       */
      checkbox?: { label: string; initial: boolean };
      resolve: (r: { value: string; cancelled: boolean; checked: boolean }) => void;
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
      /** Placeholder of a filter field above the list; absent = no field. */
      search?: string;
      resolve: (v: string | null) => void;
    })
  | (BaseRequest & {
      kind: "answers";
      fields: import("@plainva/ui").TemplateRequest[];
      resolve: (answers: Record<string, string> | null) => void;
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
  secure?: boolean;
  checkbox?: { label: string; initial: boolean };
}): Promise<{ value: string; cancelled: boolean; checked: boolean }> {
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

/**
 * One choice from a list.
 *
 * `search` turns the list into a searchable one (N9.6): a picker over a
 * handful of options is a list, a picker over every node of a vault is a
 * haystack. The flag is explicit rather than a length threshold, so a caller
 * decides once instead of the sheet changing shape as a vault grows.
 */
export function mSelect(opts: {
  title: string;
  message?: string;
  options: MobileSelectOption[];
  value?: string;
  search?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    queue = [...queue, { kind: "select", id: nextId++, ...opts, resolve }];
    emit();
  });
}

/**
 * Every question a template asks, in ONE sheet (plan Vorlagen-Engine, P6).
 *
 * The phone used to ask sequentially — one prompt per placeholder, each
 * cancellable on its own, and cancelling the third one left the first two
 * answered with no way back. One sheet means one decision: fill it in, or
 * cancel and nothing is created. Same contract as the desktop dialog.
 */
export function mTemplateAnswers(opts: {
  title: string;
  message?: string;
  fields: import("@plainva/ui").TemplateRequest[];
}): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    queue = [...queue, { kind: "answers", id: nextId++, ...opts, resolve }];
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
