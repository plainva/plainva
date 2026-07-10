/**
 * Pure back/forward history for the floating peek window (P2). A small stack
 * with a cursor: navigating to a new note truncates any forward entries and
 * pushes; back/forward move the cursor; re-navigating to the current entry is a
 * no-op. Extracted so the transitions are unit-testable without rendering the
 * portal/editor.
 */
export interface PeekHistory {
  stack: string[];
  i: number;
}

export const peekInit = (path: string): PeekHistory => ({ stack: [path], i: 0 });

export const peekCurrent = (h: PeekHistory): string => h.stack[h.i];

export const canPeekBack = (h: PeekHistory): boolean => h.i > 0;

export const canPeekForward = (h: PeekHistory): boolean => h.i < h.stack.length - 1;

export const peekBack = (h: PeekHistory): PeekHistory => (h.i > 0 ? { stack: h.stack, i: h.i - 1 } : h);

export const peekForward = (h: PeekHistory): PeekHistory =>
  h.i < h.stack.length - 1 ? { stack: h.stack, i: h.i + 1 } : h;

export const peekPush = (h: PeekHistory, path: string): PeekHistory => {
  if (h.stack[h.i] === path) return h;
  const stack = h.stack.slice(0, h.i + 1);
  stack.push(path);
  return { stack, i: stack.length - 1 };
};
