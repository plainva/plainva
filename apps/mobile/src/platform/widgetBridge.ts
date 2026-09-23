import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * The home-screen widgets, as far as JavaScript can reach them
 * (plan Widgets, W2).
 *
 * Nothing of Plainva runs while the app is closed, so a widget works nothing
 * out: it draws a snapshot the app wrote while it was last open, and a tick
 * made on a widget is only an ORDER the app redeems on its next start. Those
 * are the two directions this bridge carries, and it carries nothing else —
 * the deciding happens in `widgetService.ts`, the bytes live in the native
 * `WidgetStore`.
 *
 * In the web bundle every call is a no-op: there is no home screen to write
 * to, and a browser tab must not fail over a widget that cannot exist.
 */
export interface NativeWidgetAction {
  /** Assigned by the native queue; what `clearPendingActions` names. */
  id: number;
  /** Which row of the snapshot named below. */
  index: number;
  /** The snapshot this index belongs to — an index means a row within ONE snapshot. */
  snapshotAt: number;
  /** When the tap happened, ms since the epoch. */
  at: number;
}

interface WidgetBridgeNative {
  writeSnapshot(options: { json: string }): Promise<void>;
  clearSnapshot(): Promise<void>;
  readSnapshot(): Promise<{ json: string | null }>;
  readPendingActions(): Promise<{ actions: NativeWidgetAction[] }>;
  clearPendingActions(options: { ids: number[] }): Promise<void>;
  reloadWidgets(): Promise<void>;
}

const WidgetBridge = registerPlugin<WidgetBridgeNative>("WidgetBridge");

/** Android and iOS have widgets; a browser tab has none. */
export function widgetsAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

/** What the widgets draw until the app next runs. */
export async function writeWidgetSnapshot(json: string): Promise<void> {
  if (!widgetsAvailable()) return;
  try {
    await WidgetBridge.writeSnapshot({ json });
  } catch {
    // A widget that keeps yesterday's picture costs a stale home screen.
    // Letting the failure through would cost the caller — a foreground sync,
    // a ticked checkbox — and none of those is about widgets.
  }
}

/**
 * What is on disk right now.
 *
 * The app reads its own snapshot back after a cold start: a tap on a widget
 * can be the thing that STARTED the process, and then there is nothing in
 * memory to resolve the tapped index against.
 */
export async function readWidgetSnapshot(): Promise<string | null> {
  if (!widgetsAvailable()) return null;
  try {
    return (await WidgetBridge.readSnapshot()).json ?? null;
  } catch {
    return null;
  }
}

/** Wipes it: the vault was locked, changed or removed (W6). */
export async function clearWidgetSnapshot(): Promise<void> {
  if (!widgetsAvailable()) return;
  try {
    await WidgetBridge.clearSnapshot();
  } catch {
    /* see above */
  }
}

/** The ticks made on the home screen since the app last looked. */
export async function readWidgetActions(): Promise<NativeWidgetAction[]> {
  if (!widgetsAvailable()) return [];
  try {
    return (await WidgetBridge.readPendingActions()).actions ?? [];
  } catch {
    return [];
  }
}

/**
 * Drops the orders the app has redeemed — by id, never wholesale: a tap that
 * lands between the read and this call has to survive it.
 */
export async function clearWidgetActions(ids: readonly number[]): Promise<void> {
  if (!widgetsAvailable() || ids.length === 0) return;
  try {
    await WidgetBridge.clearPendingActions({ ids: [...ids] });
  } catch {
    // An order that could not be cleared is applied twice at worst, and
    // ticking an already-ticked task off is a no-op.
  }
}

/** Asks every widget to redraw from what is on disk. */
export async function reloadWidgets(): Promise<void> {
  if (!widgetsAvailable()) return;
  try {
    await WidgetBridge.reloadWidgets();
  } catch {
    /* a redraw that does not happen costs a stale widget, never a crash */
  }
}
