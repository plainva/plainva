import { createElement, useSyncExternalStore, type ComponentProps, type ComponentType, type ReactElement } from "react";

/**
 * The AI harness (`@plainva/ui/ai`) as the app loads it: on demand, never with the start (performance plan L5). A
 * shell asks for it when the AI is on on this device, or when a surface of the AI opens; until then a surface of the
 * start bundle sees `null` and draws nothing of the AI — what it drew while the AI was off.
 *
 * The harness comes from the app's own bundle, never from the network: this is a chunk of the build.
 */
export type AiModule = typeof import("../ai");

let loaded: AiModule | null = null;
let loading: Promise<AiModule> | null = null;
const listeners = new Set<() => void>();

/** Loads the harness once; every later call answers with the same module. A failed load may be asked again. */
export function loadAiModule(): Promise<AiModule> {
  if (loaded) return Promise.resolve(loaded);
  loading ??= import("../ai").then(
    (module) => {
      loaded = module;
      for (const listener of listeners) listener();
      return module;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** The harness when it is loaded, else `null`. */
export function aiModule(): AiModule | null {
  return loaded;
}

export function onAiModuleLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The harness for a component: `null` until it is loaded, then the module; it re-renders once when it arrives. */
export function useAiModule(): AiModule | null {
  return useSyncExternalStore(onAiModuleLoaded, aiModule, aiModule);
}

export type AiComponentName = { [K in keyof AiModule]: AiModule[K] extends ComponentType<never> ? K : never }[keyof AiModule];

/**
 * A component of the harness for a surface of the start bundle: nothing while the harness is not loaded, the
 * component itself once it is. Every component taken this way draws nothing while the AI is off, so before the load
 * the surface looks as it did. One component per name; a shell asks where the part renders (`deferredAiPart`).
 */
const aiParts = new Map<string, unknown>();

export function aiComponent<K extends AiComponentName>(name: K): (props: ComponentProps<AiModule[K]>) => ReactElement | null {
  const known = aiParts.get(name);
  if (known) return known as (props: ComponentProps<AiModule[K]>) => ReactElement | null;
  function AiPart(props: ComponentProps<AiModule[K]>) {
    const module = useAiModule();
    if (!module) return null;
    // The name picks a component of the module (`ComponentName`); its props are the ones this part was given.
    return createElement(module[name] as unknown as ComponentType<object>, props as object);
  }
  AiPart.displayName = `ai(${String(name)})`;
  aiParts.set(name, AiPart);
  return AiPart;
}
