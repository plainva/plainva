import type { IVaultAdapter } from "@plainva/core";
import { ownDeviceFilePath, readDeviceOwnText } from "../lib/deviceOwnFiles";

/**
 * Per-vault graph state of ONE device (decision E4, precised): `.plainva` is
 * excluded from sync everywhere, so pins and dismissed suggestions are
 * DEVICE-LOCAL like vault.db — the deterministic base layout keeps the map
 * recognizable across devices even without them.
 *
 * The file is the device's own, `.plainva/graph.<device>.json` (decision E7,
 * Sammelplan § 3.127 Nr. 3): in a vault folder a file service carries, the one
 * `graph.json` of older versions was shared by every device, and the last one
 * to save had it — the other device's pins were gone. All of it is per device:
 * pins are positions on THIS device's map (screens differ), the pin mode and
 * the overlay mode are how this device shows the map, and a dismissed
 * suggestion was never more than that — over Plainva's own sync no other
 * device ever saw it. A device without its own file starts from the shared
 * one, which stays where it is for older versions (`deviceOwnFiles.ts`).
 *
 * Contexts key the pin sets: "vault" for the vault map, "base:<path>#<view>"
 * for saved base graph views.
 */

export interface GraphPin {
  x: number;
  y: number;
}

interface GraphStateFile {
  version: 1;
  /**
   * Layout generation the "vault" pin context was captured in. 2 = recursive
   * container packing (A4). Pins from the old FLAT vault-map layout live in a
   * coordinate space that is meaningless under the container layout (they
   * inflate the enclosing circles and scatter the top level), so load() drops
   * that one context ONCE when the stamp is older. Base/context pins are
   * untouched — their layouts did not change.
   */
  vaultLayout?: number;
  pins: Record<string, Record<string, GraphPin>>;
  /**
   * Per-context pin mode. Absent/true = ON (dragging a node remembers its
   * position, the historical behavior); false = OFF (drags are ephemeral).
   * Only explicit OFF is stored, so the default stays ON for every context.
   */
  pinModes?: Record<string, boolean>;
  dismissedSuggestions: string[];
  /** Last active vault-map overlay mode ("normal" | "heatmap" | "replay"). */
  mapMode?: string;
}

const WRITE_DEBOUNCE_MS = 800;
/** Bump when the vault-map layout changes coordinate semantics. */
const VAULT_LAYOUT_GENERATION = 2;
const VAULT_PIN_CONTEXT = "vault";

/** JSON dictionaries must not inherit setters or mutable prototype objects. */
function dictionary<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPins(value: unknown): GraphStateFile["pins"] {
  const contexts = dictionary<Record<string, GraphPin>>();
  if (!isRecord(value)) return contexts;
  for (const [context, rawBucket] of Object.entries(value)) {
    if (!isRecord(rawBucket)) continue;
    const bucket = dictionary<GraphPin>();
    for (const [nodeId, pin] of Object.entries(rawBucket)) {
      if (isRecord(pin) && typeof pin.x === "number" && Number.isFinite(pin.x) && typeof pin.y === "number" && Number.isFinite(pin.y)) {
        bucket[nodeId] = { x: pin.x, y: pin.y };
      }
    }
    if (Object.keys(bucket).length) contexts[context] = bucket;
  }
  return contexts;
}

function readPinModes(value: unknown): Record<string, boolean> | undefined {
  if (!isRecord(value)) return undefined;
  const modes = dictionary<boolean>();
  for (const [context, mode] of Object.entries(value)) if (typeof mode === "boolean") modes[context] = mode;
  return modes;
}

function emptyState(): GraphStateFile {
  return { version: 1, vaultLayout: VAULT_LAYOUT_GENERATION, pins: Object.create(null), dismissedSuggestions: [] };
}

export function suggestionKey(reason: string, source: string, target: string): string {
  return `${reason}\u0000${source}\u0000${target}`;
}

export class GraphStateStore {
  private state: GraphStateFile = emptyState();
  /**
   * The one load, shared by every caller. A second view that asked while the
   * first read was still under way used to get an immediate "loaded" over the
   * EMPTY state: it showed no pins, and its first change (the overlay mode a
   * map sets as it opens) wrote that empty state over the file — and, since
   * E7, created this device's own file before the shared one was ever read.
   */
  private loading: Promise<void> | null = null;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  /** This device's own file, resolved once (the device id is asked for asynchronously). */
  private ownPath: Promise<string> | null = null;

  constructor(private readonly adapter: IVaultAdapter) {}

  private filePath(): Promise<string> {
    if (!this.ownPath) this.ownPath = ownDeviceFilePath("graph");
    return this.ownPath;
  }

  private async write(): Promise<void> {
    // Never before what is on disk is in: a write while the load is still
    // reading would put a state on disk that does not hold the file's pins.
    if (this.loading) await this.loading;
    await this.adapter.writeTextFile(await this.filePath(), JSON.stringify(this.state, null, 2));
  }

  /** Loads once — every caller waits for the same read; a corrupt or missing file resets to the empty state. */
  load(): Promise<void> {
    if (!this.loading) this.loading = this.read();
    return this.loading;
  }

  private async read(): Promise<void> {
    try {
      const raw = (await readDeviceOwnText(this.adapter, "graph", await this.filePath())).text;
      const parsed = JSON.parse(raw) as Partial<GraphStateFile> | null;
      if (parsed && typeof parsed === "object" && parsed.version === 1) {
        this.state = {
          version: 1,
          vaultLayout: typeof parsed.vaultLayout === "number" ? parsed.vaultLayout : undefined,
          pins: readPins(parsed.pins),
          pinModes: readPinModes(parsed.pinModes),
          dismissedSuggestions: Array.isArray(parsed.dismissedSuggestions)
            ? parsed.dismissedSuggestions.filter((s): s is string => typeof s === "string")
            : [],
          mapMode: typeof parsed.mapMode === "string" ? parsed.mapMode : undefined,
        };
      }
    } catch {
      this.state = emptyState();
    }
    // One-time migration: vault-map pins captured under an older layout
    // generation are dropped (their coordinates are meaningless in the
    // recursive-packing layout and blow the container circles up). Only
    // persisted when something was actually discarded.
    if (this.state.vaultLayout !== VAULT_LAYOUT_GENERATION) {
      const hadVaultPins = !!this.state.pins[VAULT_PIN_CONTEXT];
      delete this.state.pins[VAULT_PIN_CONTEXT];
      this.state.vaultLayout = VAULT_LAYOUT_GENERATION;
      if (hadVaultPins) this.persistSoon();
    }
    this.emit();
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  private persistSoon(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      void this.write().catch(() => {
        /* state is a cache — a failed write must never break the view */
      });
    }, WRITE_DEBOUNCE_MS);
  }

  /** Flushes a pending write immediately (view unmount). */
  async flush(): Promise<void> {
    if (!this.writeTimer) return;
    clearTimeout(this.writeTimer);
    this.writeTimer = null;
    try {
      await this.write();
    } catch {
      /* see persistSoon */
    }
  }

  getPins(context: string): Record<string, GraphPin> {
    return this.state.pins[context] ?? dictionary<GraphPin>();
  }

  setPin(context: string, nodeId: string, pin: GraphPin | null): void {
    const bucket = this.state.pins[context] ?? dictionary<GraphPin>();
    if (pin && (!Number.isFinite(pin.x * 100) || !Number.isFinite(pin.y * 100))) return;
    if (pin) bucket[nodeId] = { x: Math.round(pin.x * 100) / 100, y: Math.round(pin.y * 100) / 100 };
    else delete bucket[nodeId];
    if (Object.keys(bucket).length > 0) this.state.pins[context] = bucket;
    else delete this.state.pins[context];
    this.persistSoon();
    this.emit();
  }

  clearPins(context: string): void {
    delete this.state.pins[context];
    this.persistSoon();
    this.emit();
  }

  /** Pin mode for a context. Default ON: drags are remembered. */
  getPinMode(context: string): boolean {
    return this.state.pinModes?.[context] ?? true;
  }

  /** OFF is stored explicitly; turning back ON drops the entry so the file
   *  keeps only real deviations from the default. */
  setPinMode(context: string, on: boolean): void {
    if (on) {
      if (this.state.pinModes) {
        delete this.state.pinModes[context];
        if (Object.keys(this.state.pinModes).length === 0) delete this.state.pinModes;
      }
    } else {
      if (!this.state.pinModes) this.state.pinModes = dictionary<boolean>();
      this.state.pinModes[context] = false;
    }
    this.persistSoon();
    this.emit();
  }

  isDismissed(key: string): boolean {
    return this.state.dismissedSuggestions.includes(key);
  }

  dismissSuggestion(key: string): void {
    if (this.state.dismissedSuggestions.includes(key)) return;
    this.state.dismissedSuggestions.push(key);
    this.persistSoon();
    this.emit();
  }

  getMapMode(): string | undefined {
    return this.state.mapMode;
  }

  setMapMode(mode: string): void {
    if (this.state.mapMode === mode) return;
    this.state.mapMode = mode;
    this.persistSoon();
    this.emit();
  }
}

const stores = new WeakMap<IVaultAdapter, GraphStateStore>();

/** One store per vault adapter (i.e. per open vault). */
export function getGraphState(adapter: IVaultAdapter): GraphStateStore {
  let store = stores.get(adapter);
  if (!store) {
    store = new GraphStateStore(adapter);
    stores.set(adapter, store);
  }
  return store;
}
