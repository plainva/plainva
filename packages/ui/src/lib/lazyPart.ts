import { createElement, use, useContext, type ComponentType } from "react";
import { AreaBoundary, InsideAreaBoundary } from "../components/ui/AreaBoundary";
import { isPartLoadFailure, loadPart, releaseWhenShown } from "./partLoad";

/**
 * A component loaded on demand (performance plan L5), from a chunk of the app's own bundle. Render it inside
 * `Suspense`. A part that was preloaded (`preloadLazyPart`) draws at once, without a frame of its fallback.
 *
 * A load that fails or does not arrive in time (`loadPart`) never reaches the app-wide boundary that replaces the
 * window (review of B1b, round 1), and never changes a surface that has a boundary of its own (round 2):
 * - below an `AreaBoundary` the failure goes to that boundary, which knows the area's size and way out — a dialog
 *   closes with Escape, a tab offers "close tab", a quiet host only toasts, as on `main`;
 * - with no `AreaBoundary` above (a host beside the shell), the part catches its load failure itself, as a section in
 *   the app's words with its reload. Any other error of a part goes on to the boundary above, as before.
 * A failed load is let go once a boundary has met it: the reload, the dialog opened anew, the next mount load again
 * (a state, not a time).
 */
type Tracked<T> = Promise<T> & { status?: "pending" | "fulfilled" | "rejected"; value?: T; reason?: unknown };

interface Part {
  component: ComponentType<never>;
  start(): Tracked<ComponentType<never>>;
  /** Lets a failed load go, so the next render loads again; a load under way or done is kept. */
  forgetFailure(): void;
}

const parts = new WeakMap<object, Part>();

function partOf<P extends object>(load: () => Promise<ComponentType<P>>): Part {
  const known = parts.get(load);
  if (known) return known;
  let loading: Tracked<ComponentType<P>> | null = null;
  const start = (): Tracked<ComponentType<P>> => {
    if (!loading) {
      // Bounded and in the app's words (`loadPart`): a load that hangs or fails reaches a boundary as a
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
          // Kept until a boundary has shown it (`releaseWhenShown`): React renders the part again at once and must
          // meet the same failure, not start a load in a loop.
          promise.status = "rejected";
          promise.reason = error;
          releaseWhenShown(error, () => {
            if (loading === promise) loading = null;
          });
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
    const inside = useContext(InsideAreaBoundary);
    const loaded = createElement(LoadedPart as ComponentType<P>, props);
    // Below a boundary its failure is that boundary's to draw; beside the shell the part draws it itself.
    if (inside) return loaded;
    return createElement(AreaBoundary, { area: "part:onDemand", size: "section", only: isPartLoadFailure, children: loaded });
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
export function lazyPart<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  return partOf(load).component as unknown as ComponentType<P>;
}

/** Loads a part ahead of its first use; a failure is let go at once, and the part loads again when it mounts. */
export function preloadLazyPart<P extends object>(load: () => Promise<ComponentType<P>>): Promise<void> {
  const part = partOf(load);
  return part.start().then(
    () => undefined,
    () => part.forgetFailure(),
  );
}
