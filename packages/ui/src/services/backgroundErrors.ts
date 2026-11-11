/**
 * Failures of work nobody watches (stability plan R4, finding S5).
 *
 * A write, a clean-up or an index step that runs behind the screen used to end
 * in `.catch(() => {})`: the failure was gone, and so was every trace of why a
 * search missed a note or a sync never carried a deletion. Each such place now
 * decides for itself — and where the answer is "nobody needs to see it", the
 * failure still goes into the diagnostics export (About & diagnostics), which
 * is what a bug report carries.
 *
 * What a line says: the area (a machine name such as `index:rename`), the
 * error's kind and the first line of its message, cut at 160 characters —
 * the shape `AreaBoundary` writes for a failed area. Never a stack, never the
 * text of a note. The export's header warns that messages may carry
 * vault-relative paths; nothing here adds one.
 *
 * Three rules hold because these run INSIDE a failure path:
 *  - reporting never throws, whatever the error is (a getter that throws, a
 *    revoked proxy, an object without a prototype) and whatever the buffer does;
 *  - it never reports itself: a failure while reporting is dropped, not reported;
 *  - it does not flood: the same report again counts on its first line.
 *
 * Where a swallowed failure would leave the person believing that something
 * was saved, deleted or sent that was not, a line in the export is not enough:
 * `reportVisible` says it on screen too, with what failed.
 */
import { logDiagnosticCounted } from "./diagnosticsLog";
import { toast } from "./toastStore";

/** The first line of a failure, as a developer reads it: `Kind: message`, at most 160 characters of message. */
export function describeBackgroundError(error: unknown): string {
  let kind = typeof error;
  let raw = "";
  try {
    if (error instanceof Error) {
      kind = (error.name || "Error") as typeof kind;
      raw = String(error.message ?? "");
    } else if (typeof error === "string") {
      raw = error;
    } else if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
      // Plugin rejections cross the bridge as plain objects with a message.
      kind = "object";
      raw = (error as { message: string }).message;
    }
  } catch {
    // An error whose name or message throws on reading: its kind is all there is.
    raw = "";
  }
  const first = raw.split("\n", 1)[0]!.trim();
  const message = first.length > 160 ? `${first.slice(0, 160)}…` : first;
  return `${kind}${message ? `: ${message}` : ""}`;
}

let reporting = false;

/**
 * Writes a failure nobody watches into the diagnostics: `area` is a machine
 * name (`index:rename`, `sync:state`), never a file name or a title.
 */
export function reportBackground(area: string, error: unknown): void {
  // A failure while a failure is written is not written again (no recursion).
  if (reporting) return;
  reporting = true;
  try {
    logDiagnosticCounted(area, describeBackgroundError(error));
    if (import.meta.env?.DEV) console.warn(`[${area}]`, error);
  } catch {
    // Reporting is the last thing a failure path does; it must not become a second failure.
  } finally {
    reporting = false;
  }
}

/** `promise.catch(reportingTo("index:rename"))`: the handler form of `reportBackground`. */
export function reportingTo(area: string): (error: unknown) => void {
  return (error) => reportBackground(area, error);
}

/**
 * A failure the person has to know of: what they did did not take effect.
 * Written into the diagnostics like any background failure, and said on
 * screen with `message` — a text that names what failed (and, as the shells'
 * other failure notices do, why: build it with `errorText(error)`).
 */
export function reportVisible(area: string, error: unknown, message: string): void {
  reportBackground(area, error);
  try {
    toast.error(message);
  } catch {
    // The notice could not be put up; the diagnostics line above stands.
  }
}
