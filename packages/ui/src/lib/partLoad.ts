/**
 * Loading a part of the app's own bundle on demand (package B1b, the rest of L5): one place that bounds how long a
 * load may take and says, in the app's words, that it failed.
 *
 * Before, a load that failed reached the person as the browser's own sentence ("Failed to fetch dynamically imported
 * module …"), untranslated, and a load that hung — a WebView that never answered — had no end: the surface waited in
 * its fallback for ever, and a send that waited for the word diff did nothing, the second time too.
 *
 * Every part drawn through `lazyPart` loads through `loadPart`, and so does any load a step waits for (the suggestion
 * mode's word diff). A load that has not settled after `PART_LOAD_TIMEOUT_MS` fails as a `PartLoadError`, and so
 * does one that failed; `errorText` and the `AreaBoundary` show both with the app's own text, and the next mount or
 * step loads again. Nothing is written while a load is outstanding: a step that needs the part waits for it, or fails
 * before it writes (Performance_Notes.md, "What is written never depends on whether a chunk has loaded").
 */

/**
 * How long one load of a part may take. The parts are files of the app's own bundle on the device's disk: a load
 * takes tens of milliseconds there (Performance_Notes.md, "First use of a part loaded on demand"). 20 s is far beyond
 * a slow device and still an end the person sees.
 */
export const PART_LOAD_TIMEOUT_MS = 20_000;

/** A part of the app's bundle that could not be loaded: it failed, or it did not arrive in time. */
export class PartLoadError extends Error {
  readonly reason: "failed" | "timeout";
  constructor(reason: "failed" | "timeout", cause?: unknown) {
    super(reason === "timeout" ? `part load timed out after ${PART_LOAD_TIMEOUT_MS} ms` : `part load failed: ${causeText(cause)}`, { cause });
    this.name = "PartLoadError";
    this.reason = reason;
  }
}

function causeText(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return typeof cause === "string" ? cause : String(cause);
}

/**
 * The browsers' own sentences for a module that could not be fetched (Chromium/WebView2, WebKit, Firefox): a load
 * that did not go through `loadPart` is still recognised where its failure is shown.
 */
const BROWSER_LOAD_FAILURES = [
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
  "error loading dynamically imported module",
  "Unable to preload CSS",
];

/** Whether `error` is a part of the bundle that could not be loaded — ours, or the browser's own message for it. */
export function isPartLoadFailure(error: unknown): boolean {
  if (error instanceof PartLoadError) return true;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return BROWSER_LOAD_FAILURES.some((sentence) => message.includes(sentence));
}

/**
 * Runs `load` (an `import()` of the app's own bundle) with an end: resolves with what it loaded, or rejects with a
 * `PartLoadError` when it failed or took longer than `timeoutMs`. A load that arrives after its end is dropped; the
 * next call loads again (the browser keeps a module it fetched, so that one is quick).
 */
export function loadPart<T>(load: () => Promise<T>, options: { timeoutMs?: number } = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? PART_LOAD_TIMEOUT_MS;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new PartLoadError("timeout"));
    }, timeoutMs);
    let started: Promise<T>;
    try {
      started = load();
    } catch (error) {
      started = Promise.reject(error);
    }
    started.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error instanceof PartLoadError ? error : new PartLoadError("failed", error));
      },
    );
  });
}
