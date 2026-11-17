/**
 * A hard limit at the Capacitor bridge (release list F51).
 *
 * Every call's text is parsed on Android's UI thread before a plugin runs; the
 * phone's vault archive was one 118 MB message there, and the app ran out of
 * memory 40 s after every start - a dead process instead of an error anyone
 * could see. No call leaves the page with more than `BRIDGE_LIMIT_CHARS` of
 * text now: the one that tries fails in JavaScript with the plugin method's
 * name, the app goes on. Every plugin method of both platforms goes through
 * `window.Capacitor.toNative`, where this sits. An ANSWER the native side
 * sends is beyond reach here; those are measured on the way in by the
 * diagnostics, and kept small by the plugins themselves (`atomicFile.ts`).
 */

/**
 * About 32 MB of text (a file of about 24 MB as base64). A guard against the
 * dead process, not a replacement for writing in parts: below it everything
 * goes as it did. Measured on the phone that froze (Pixel, Android 17, 256 MB
 * Java heap): the archive went through every day at 38 MB of base64 and ended
 * the app at 118 MB. Calls this app makes in parts stay at 256 KB; what still
 * sends whole files (a picked folder, mail attachments) keeps working up to
 * here, and the bridge meter reports anything from 64 KB.
 */
export const BRIDGE_LIMIT_CHARS = 32 * 1024 * 1024;

/**
 * About the length of a message's text without making it: the strings'
 * lengths and a few characters per other value. Stops counting once over
 * `stopAt`.
 */
export function bridgeMessageSize(value: unknown, stopAt = Infinity): number {
  let size = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0 && size <= stopAt) {
    const item = stack.pop();
    if (typeof item === "string") size += item.length + 2;
    else if (typeof item === "number" || typeof item === "boolean") size += 8;
    else if (item === null || item === undefined) size += 4;
    else if (Array.isArray(item)) {
      size += 2;
      for (const entry of item) stack.push(entry);
    } else if (ArrayBuffer.isView(item)) {
      // Not sent as such, but counted as its base64 would be.
      size += Math.ceil(item.byteLength / 3) * 4;
    } else if (typeof item === "object") {
      size += 2;
      for (const [key, entry] of Object.entries(item as Record<string, unknown>)) {
        size += key.length + 3;
        stack.push(entry);
      }
    }
  }
  return size;
}

/** The error a call over the limit fails with. */
export class BridgeMessageTooLargeError extends Error {
  constructor(readonly call: string, readonly size: number) {
    super(`${call}: a message of about ${size} characters is over the bridge's limit of ${BRIDGE_LIMIT_CHARS}`);
    this.name = "BridgeMessageTooLargeError";
  }
}

interface Stored {
  reject?: (error: unknown) => void;
  callback?: (data: unknown, error?: unknown) => void;
  [key: string]: unknown;
}
type ToNative = (pluginName: string, methodName: string, options: unknown, stored: Stored) => unknown;

let installed = false;

/** Puts the limit in place; outside a native shell there is no bridge and nothing happens. */
export function installBridgeLimit(): void {
  if (installed) return;
  installed = true;
  const cap = (globalThis as { Capacitor?: { toNative?: ToNative } }).Capacitor;
  const toNative = cap?.toNative;
  if (!cap || typeof toNative !== "function") return;
  cap.toNative = (pluginName, methodName, options, stored) => {
    const size = bridgeMessageSize(options, BRIDGE_LIMIT_CHARS);
    if (size > BRIDGE_LIMIT_CHARS) {
      const error = new BridgeMessageTooLargeError(`${pluginName}.${methodName}`, size);
      console.warn(`[bridge] ${error.message}`);
      if (typeof stored?.reject === "function") stored.reject(error);
      else if (typeof stored?.callback === "function") stored.callback(null, error);
      return undefined;
    }
    return toNative.call(cap, pluginName, methodName, options, stored);
  };
}

/** Tests only. */
export function resetBridgeLimitForTests(): void {
  installed = false;
}
