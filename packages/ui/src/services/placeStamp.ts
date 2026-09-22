/**
 * A place stamp for a journal entry (plan Journal-Erweiterungen, X7/E6).
 *
 * Opt-in per DEVICE, off by default, and only ever on a deliberate press: no
 * silent trail, no history, no map, and no online service to turn coordinates
 * into a street name. Without a network there are the coordinates, which is
 * what a note can honestly carry.
 *
 * What lands in the entry is one line of plain Markdown — `📍 52.5200, 13.4050`
 * — that anyone can read, edit into a real name, or delete. Nothing about the
 * position is stored anywhere else.
 *
 * The position itself comes from the shell: a WKWebView answers
 * `navigator.geolocation` with nothing at all, so the phone asks the native
 * plugin while the desktop asks the WebView. One interface, two suppliers.
 */

export interface PlacePosition {
  latitude: number;
  longitude: number;
}

export type PlaceFailure =
  /** The person said no, or the system did. */
  | "denied"
  /** No receiver, no permission dialog, or a WebView that cannot ask. */
  | "unavailable"
  /** It was asked and gave up — indoors, no fix. */
  | "failed";

export class PlaceError extends Error {
  constructor(readonly reason: PlaceFailure, cause?: unknown) {
    super(`place ${reason}`);
    this.cause = cause;
  }
}

/** What the shell supplies; `null` where the platform has no receiver at all. */
export type PlaceProvider = (() => Promise<PlacePosition>) | null;

let provider: PlaceProvider = null;

/**
 * Set once per shell at startup. A shell that sets nothing offers no button —
 * and the parity catalogue says which one that is and why.
 */
export function setPlaceProvider(next: PlaceProvider): void {
  provider = next;
}

/** True where this device could answer at all; the button is absent otherwise. */
export function canStampPlace(): boolean {
  return provider !== null;
}

const SWITCH_KEY = "plainva-place-stamp";

/**
 * May this device offer the button? A DEVICE choice, off by default, and never
 * part of the settings profile: one's phone and one's desk are different
 * places to be asked about one's position.
 */
export function placeStampEnabled(): boolean {
  try {
    return localStorage.getItem(SWITCH_KEY) === "on";
  } catch {
    return false;
  }
}

export function setPlaceStampEnabled(on: boolean): void {
  try {
    localStorage.setItem(SWITCH_KEY, on ? "on" : "off");
  } catch {
    /* a blocked store means the switch stays off, which is the safe answer */
  }
}

/**
 * Four decimals — about eleven metres. Enough to say which building, not
 * enough to say which room, and short enough to read in a line of prose.
 */
export function formatPlace(position: PlacePosition): string {
  const four = (n: number) => (Math.round(n * 10_000) / 10_000).toFixed(4);
  return `📍 ${four(position.latitude)}, ${four(position.longitude)}`;
}

/**
 * Asks for the position once. Throws a {@link PlaceError} rather than a raw
 * platform error, so a caller can say "you said no" and "this device cannot"
 * differently — they need different sentences and only one is worth offering
 * again.
 */
export async function stampPlace(): Promise<string> {
  if (!provider) throw new PlaceError("unavailable");
  try {
    return formatPlace(await provider());
  } catch (error) {
    if (error instanceof PlaceError) throw error;
    // A GeolocationPositionError carries a numeric code: 1 refused, 2 no fix,
    // 3 timed out. The Capacitor plugin rejects with a message instead.
    const code = (error as { code?: number } | null)?.code;
    const message = String((error as { message?: string } | null)?.message ?? "").toLowerCase();
    if (code === 1 || message.includes("denied") || message.includes("permission")) throw new PlaceError("denied", error);
    throw new PlaceError("failed", error);
  }
}
