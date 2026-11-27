import { createElement, use, type ComponentType } from "react";
import { loadPart } from "./partLoad";

/**
 * A component loaded on demand (performance plan L5), from a chunk of the app's own bundle. Unlike a bare `lazy`,
 * a load that failed is not kept: the next mount — the area's "Try again", the dialog opened anew — loads again.
 * Render it inside `Suspense` and an `AreaBoundary`: the boundary shows the failure where the part stood, never a
 * white surface. A part that was preloaded (`preloadLazyPart`) draws at once, without a frame of its fallback.
 */
type Tracked<T> = Promise<T> & { status?: "pending" | "fulfilled" | "rejected"; value?: T; reason?: unknown };

interface Part {
  component: ComponentType<never>;
  start(): Tracked<ComponentType<never>>;
}

const parts = new WeakMap<object, Part>();
/** How long a failed load stands before the next mount may try again. */
export const FAILED_LOAD_HELD_MS = 500;

function partOf<P extends object>(load: () => Promise<ComponentType<P>>): Part {
  const known = parts.get(load);
  if (known) return known;
  let loading: Tracked<ComponentType<P>> | null = null;
  const start = (): Tracked<ComponentType<P>> => {
    if (!loading) {
      // Bounded and in the app's words (`loadPart`): a load that hangs or fails reaches the boundary as a
      // `PartLoadError`, never as a fallback that waits for ever (package B1b).
      const promise: Tracked<ComponentType<P>> = loadPart(load);
      // The status React reads in `use`: a part loaded before is drawn without suspending.
      promise.status = "pending";
      promise.then(
        (component) => {
          promise.status = "fulfilled";
          promise.value = component;
        },
        (error: unknown) => {
          promise.status = "rejected";
          promise.reason = error;
          // Kept for a moment: React renders the part again at once, and the same failure goes to the boundary,
          // instead of loading again in a loop. The next mount after that — "Try again", the dialog opened anew —
          // loads again.
          setTimeout(() => {
            if (loading === promise) loading = null;
          }, FAILED_LOAD_HELD_MS);
        },
      );
      loading = promise;
    }
    return loading;
  };
  function LazyPart(props: P) {
    return createElement(use(start() as Promise<ComponentType<P>>), props);
  }
  const part: Part = { component: LazyPart as unknown as ComponentType<never>, start: start as unknown as Part["start"] };
  parts.set(load, part);
  return part;
}

/**
 * One component per loader: asked again with the same `load`, it is the same component, so a surface that asks
 * where it renders keeps its state. A shell calls it where a part renders (`deferredPart` of each shell), never at
 * module load: the rule of work across package boundaries at load time (moduleInitBoundary.test.ts) holds.
 */
export function lazyPart<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  return partOf(load).component as unknown as ComponentType<P>;
}

/** Loads a part ahead of its first use; a failure is left to the part itself, which loads again when it mounts. */
export function preloadLazyPart<P extends object>(load: () => Promise<ComponentType<P>>): Promise<void> {
  return partOf(load).start().then(
    () => undefined,
    () => undefined,
  );
}
