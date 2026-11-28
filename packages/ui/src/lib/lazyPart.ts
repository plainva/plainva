import { createElement, use, type ComponentType } from "react";
import { AreaBoundary, type AreaBoundarySize } from "../components/ui/AreaBoundary";
import { isPartLoadFailure, loadPart } from "./partLoad";

/**
 * A component loaded on demand (performance plan L5), from a chunk of the app's own bundle. Render it inside
 * `Suspense`. A part that was preloaded (`preloadLazyPart`) draws at once, without a frame of its fallback.
 *
 * A part brings its own boundary for its load (review of B1b, round 1): a load that fails or does not arrive in time
 * (`loadPart`) is shown where the part stands, in the app's words, with its reload — it never reaches a boundary
 * further up, least of all the app-wide one that replaces the whole window. Any other error of the part goes on to
 * the boundary above, as before. A failed load is let go once its boundary has shown it: the reload, the dialog
 * opened anew, the next mount load again (a state, not a time).
 */
type Tracked<T> = Promise<T> & { status?: "pending" | "fulfilled" | "rejected"; value?: T; reason?: unknown };

interface Part {
  component: ComponentType<never>;
  start(): Tracked<ComponentType<never>>;
  /** Lets a failed load go, so the next render loads again; a load under way or done is kept. */
  forgetFailure(): void;
}

export interface LazyPartOptions {
  /** How the part's load failure is drawn where it stands (`AreaBoundary` sizes); a dialog draws as a dialog. */
  size?: AreaBoundarySize;
}

const parts = new WeakMap<object, Part>();

function partOf<P extends object>(load: () => Promise<ComponentType<P>>, options: LazyPartOptions = {}): Part {
  const known = parts.get(load);
  if (known) return known;
  let loading: Tracked<ComponentType<P>> | null = null;
  const start = (): Tracked<ComponentType<P>> => {
    if (!loading) {
      // Bounded and in the app's words (`loadPart`): a load that hangs or fails reaches the part's boundary as a
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
          // Kept until the boundary has shown it (`forgetFailure`): React renders the part again at once and must
          // meet the same failure, not start a load in a loop.
          promise.status = "rejected";
          promise.reason = error;
        },
      );
      loading = promise;
    }
    return loading;
  };
  const forgetFailure = () => {
    if (loading?.status === "rejected") loading = null;
  };
  function LoadedPart(props: P) {
    return createElement(use(start() as Promise<ComponentType<P>>), props);
  }
  function LazyPart(props: P) {
    return createElement(AreaBoundary, {
      area: "part:onDemand",
      size: options.size ?? "section",
      only: isPartLoadFailure,
      onCaught: forgetFailure,
      children: createElement(LoadedPart as ComponentType<P>, props),
    });
  }
  const part: Part = { component: LazyPart as unknown as ComponentType<never>, start: start as unknown as Part["start"], forgetFailure };
  parts.set(load, part);
  return part;
}

/**
 * One component per loader: asked again with the same `load`, it is the same component, so a surface that asks
 * where it renders keeps its state. A shell calls it where a part renders (`deferredPart` of each shell), never at
 * module load: the rule of work across package boundaries at load time (moduleInitBoundary.test.ts) holds.
 */
export function lazyPart<P extends object>(load: () => Promise<ComponentType<P>>, options?: LazyPartOptions): ComponentType<P> {
  return partOf(load, options).component as unknown as ComponentType<P>;
}

/** Loads a part ahead of its first use; a failure is let go at once, and the part loads again when it mounts. */
export function preloadLazyPart<P extends object>(load: () => Promise<ComponentType<P>>): Promise<void> {
  const part = partOf(load);
  return part.start().then(
    () => undefined,
    () => part.forgetFailure(),
  );
}
