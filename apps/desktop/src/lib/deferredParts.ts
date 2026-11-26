import { createElement, type ComponentProps, type ComponentType, type ReactElement } from "react";
import { aiComponent, lazyPart, preloadLazyPart, type AiComponentName, type AiModule } from "@plainva/ui";

/*
 * The shell's parts that load on demand (performance plan L5), declared at module level and made where they render:
 * the shared `lazyPart` and `aiComponent` run when a part is first drawn, not while this shell's modules load
 * (the rule of moduleInitBoundary.test.ts). Each returns the same component every time, so a part keeps its state.
 */

const ahead: Array<() => Promise<ComponentType<never>>> = [];

/**
 * A component from a chunk of the app's own bundle, loaded when it is first drawn. `prefetch`: a part the person is
 * likely to open soon, loaded while the app idles after the start (`prefetchDeferredParts`), so its first use does
 * not wait. Never for a part of the AI: the AI loads only when its switch is on.
 */
export function deferredPart<P extends object>(load: () => Promise<ComponentType<P>>, options: { prefetch?: boolean } = {}): ComponentType<P> {
  if (options.prefetch) ahead.push(load as unknown as () => Promise<ComponentType<never>>);
  function DeferredPart(props: P): ReactElement {
    return createElement(lazyPart(load), props);
  }
  return DeferredPart;
}

/** A component of the AI harness: nothing while the harness is not loaded, the component once it is. */
export function deferredAiPart<K extends AiComponentName>(name: K): (props: ComponentProps<AiModule[K]>) => ReactElement {
  function DeferredAiPart(props: ComponentProps<AiModule[K]>): ReactElement {
    return createElement(aiComponent(name) as ComponentType<object>, props as object);
  }
  return DeferredAiPart;
}

type IdleWindow = Window & { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number };
const idle = () => new Promise<void>((resolve) => {
  const request = typeof window !== "undefined" ? (window as IdleWindow).requestIdleCallback : undefined;
  if (request) request(() => resolve(), { timeout: 3000 });
  else setTimeout(resolve, 200);
});

/**
 * Loads the parts marked `prefetch`, one at a time while the app idles after its first picture. Returns a stop for
 * the parts not loaded yet.
 */
let prefetched = false;

export function prefetchDeferredParts(): () => void {
  let stopped = false;
  if (prefetched) return () => undefined;
  prefetched = true;
  void (async () => {
    for (const load of ahead) {
      await idle();
      if (stopped) return;
      await preloadLazyPart(load);
    }
  })();
  return () => {
    stopped = true;
  };
}
