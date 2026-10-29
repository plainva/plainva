/** Which way a navigation step went (F5): it decides how the working column slides. */
export type NavMotion = "push" | "pop" | "none";

/** Deeper is a push, shallower a pop, a tab switch (same depth) neither. */
export function navMotion(previousDepth: number, depth: number): NavMotion {
  return depth > previousDepth ? "push" : depth < previousDepth ? "pop" : "none";
}
