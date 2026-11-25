/**
 * The areas of a language that load beside its core (performance plan L5, `i18n.ts`).
 *
 * Each language's file is cut into areas at build time. The loads of one language are kept while they run and once
 * they landed; a load that failed is tried again — at once a few times, then on the next ask (a language switched
 * to, the window coming back online) — never kept as a failure until the app restarts. While an area is on its way
 * its keys read as nothing for that moment; once its tries gave up they read as their default text, or as the key.
 */
export type AreaLoaders = Record<string, ((code: string) => Promise<Record<string, unknown>>) | undefined>;

export interface AreaLoading {
  /** Loads every area of a language not loaded yet; resolves when all landed, rejects when one could not be loaded. */
  load(code: string): Promise<void>;
  /** Whether an area of the language is on its way. */
  pending(code: string, area: string): boolean;
  /** Languages with an area that could not be loaded, to be tried again. */
  failed(): string[];
}

export function createAreaLoading(options: {
  loaders: AreaLoaders;
  add: (code: string, messages: Record<string, unknown>) => void;
  /** The waits between the tries of one load; the default: at once, after 250 ms, after 1 s. */
  retryDelays?: readonly number[];
  wait?: (ms: number) => Promise<void>;
}): AreaLoading {
  const delays = options.retryDelays ?? [250, 1000];
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const loaded = new Map<string, Set<string>>();
  const onTheWay = new Map<string, Set<string>>();
  const running = new Map<string, Promise<void>>();
  const failedCodes = new Set<string>();

  async function loadArea(code: string, area: string): Promise<void> {
    const loader = options.loaders[area];
    if (!loader) return;
    for (let attempt = 0; ; attempt++) {
      try {
        options.add(code, await loader(code));
        return;
      } catch (error) {
        if (attempt >= delays.length) throw error;
        await wait(delays[attempt]!);
      }
    }
  }

  return {
    load(code) {
      const ongoing = running.get(code);
      if (ongoing) return ongoing;
      const done = loaded.get(code) ?? new Set<string>();
      loaded.set(code, done);
      const todo = Object.keys(options.loaders).filter((area) => !done.has(area));
      if (todo.length === 0) return Promise.resolve();
      const way = new Set(todo);
      onTheWay.set(code, way);
      const run = Promise.allSettled(
        todo.map((area) =>
          loadArea(code, area)
            .then(() => {
              done.add(area);
            })
            .finally(() => way.delete(area)),
        ),
      ).then((results) => {
        running.delete(code);
        const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
        if (failure) {
          failedCodes.add(code);
          throw failure.reason;
        }
        failedCodes.delete(code);
      });
      running.set(code, run);
      return run;
    },
    pending(code, area) {
      return onTheWay.get(code)?.has(area) ?? false;
    },
    failed() {
      return [...failedCodes];
    },
  };
}
