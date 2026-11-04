import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * The system's assistant, as far as JavaScript can reach it (AI harness P4.7).
 *
 * Siri and Shortcuts reach Plainva through App Intents, which run natively —
 * also while the app is closed, when nothing of this bundle runs. So this
 * bridge carries two things and decides neither: the DIRECTORY of titles the
 * system may know goes out, and the ORDERS an intent left come in. What is in
 * the directory and what becomes of an order is `intentService.ts`'s; the
 * bytes live in the native `IntentStore`, in the App Group.
 *
 * iOS only. Android has no public counterpart yet (parity catalog
 * `ai-system-intents`), and in a browser tab every call is a no-op — except
 * while a test runner installed a fixture, the way the share target does it.
 */
interface IntentBridgeNative {
  writeDirectory(options: { json: string }): Promise<void>;
  clearDirectory(): Promise<void>;
  readOrders(): Promise<{ orders: unknown[] }>;
  clearOrders(options: { ids: number[] }): Promise<void>;
  /** "orders": an intent left an order while the app was running. Kept natively until somebody listens. */
  addListener?(event: "orders", listener: () => void): Promise<{ remove(): Promise<void> }> | { remove(): Promise<void> };
}

const nativeBridge = registerPlugin<IntentBridgeNative>("IntentBridge");

const FIXTURE_KEY = "__plainvaFixtureIntents";
const METHODS = ["writeDirectory", "clearDirectory", "readOrders", "clearOrders"] as const;

/** The bridge of a production-bundle test run: installed on `globalThis` before the bundle loads, never on a device. */
function fixtureBridge(): IntentBridgeNative | null {
  if (Capacitor.isNativePlatform()) return null;
  const candidate = (globalThis as Record<string, unknown>)[FIXTURE_KEY];
  if (!candidate || typeof candidate !== "object") return null;
  const port = candidate as Record<string, unknown>;
  return METHODS.every((method) => typeof port[method] === "function") ? (candidate as IntentBridgeNative) : null;
}

const bridge = (): IntentBridgeNative | null => fixtureBridge() ?? (Capacitor.getPlatform() === "ios" ? nativeBridge : null);

/** An iPhone or iPad has App Intents; Android and a browser tab have none. */
export function systemIntentsAvailable(): boolean {
  return bridge() !== null;
}

/** The titles the system may know, until the app next writes them. */
export async function writeIntentDirectory(json: string): Promise<boolean> {
  try {
    const port = bridge();
    if (!port) return false;
    await port.writeDirectory({ json });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wipes them. Unlike a stale widget, a directory that could not be wiped is
 * not cosmetic — the caller is told, and tries again at the next moment.
 */
export async function clearIntentDirectory(): Promise<boolean> {
  try {
    const port = bridge();
    if (!port) return true;
    await port.clearDirectory();
    return true;
  } catch {
    return false;
  }
}

/** What the intents left since the app last looked — as the native queue hands it over, unread. */
export async function readIntentOrdersRaw(): Promise<unknown[]> {
  try {
    const port = bridge();
    if (!port) return [];
    const { orders } = await port.readOrders();
    return Array.isArray(orders) ? orders : [];
  } catch {
    return [];
  }
}

/**
 * Tells the app that an intent left an order while it was running — "open
 * this note" is about now, and the return to the front may already be over
 * when the order is recorded. A no-op where the platform says nothing.
 */
export function onIntentOrders(listener: () => void): void {
  try {
    void bridge()?.addListener?.("orders", listener);
  } catch {
    /* the return to the front still reads the queue */
  }
}

/** Drops the orders the app has dealt with — by id, never wholesale: one that arrived in between survives. */
export async function clearIntentOrders(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await bridge()?.clearOrders({ ids: [...ids] });
  } catch {
    /* they are read again next time; writing a journal entry twice is what the planned entry prevents */
  }
}
