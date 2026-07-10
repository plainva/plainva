import type { IVaultAdapter } from "@plainva/core";

/**
 * Per-vault graph state in `.plainva/graph.json` (decision E4, precised):
 * `.plainva` is excluded from sync everywhere, so pins and dismissed
 * suggestions are DEVICE-LOCAL like vault.db — the deterministic base layout
 * keeps the map recognizable across devices even without them.
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

const FILE_PATH = ".plainva/graph.json";
const WRITE_DEBOUNCE_MS = 800;

function emptyState(): GraphStateFile {
  return { version: 1, pins: {}, dismissedSuggestions: [] };
}

export function suggestionKey(reason: string, source: string, target: string): string {
  return `${reason}\u0000${source}\u0000${target}`;
}

export class GraphStateStore {
  private state: GraphStateFile = emptyState();
  private loaded = false;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly adapter: IVaultAdapter) {}

  /** Loads once; a corrupt or missing file resets to the empty state. */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await this.adapter.readTextFile(FILE_PATH);
      const parsed = JSON.parse(raw) as Partial<GraphStateFile> | null;
      if (parsed && typeof parsed === "object" && parsed.version === 1) {
        this.state = {
          version: 1,
          pins: typeof parsed.pins === "object" && parsed.pins !== null ? (parsed.pins as GraphStateFile["pins"]) : {},
          pinModes:
            typeof parsed.pinModes === "object" && parsed.pinModes !== null
              ? (Object.fromEntries(
                  Object.entries(parsed.pinModes).filter(([, v]) => typeof v === "boolean")
                ) as GraphStateFile["pinModes"])
              : undefined,
          dismissedSuggestions: Array.isArray(parsed.dismissedSuggestions)
            ? parsed.dismissedSuggestions.filter((s): s is string => typeof s === "string")
            : [],
          mapMode: typeof parsed.mapMode === "string" ? parsed.mapMode : undefined,
        };
      }
    } catch {
      this.state = emptyState();
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
      void this.adapter.writeTextFile(FILE_PATH, JSON.stringify(this.state, null, 2)).catch(() => {
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
      await this.adapter.writeTextFile(FILE_PATH, JSON.stringify(this.state, null, 2));
    } catch {
      /* see persistSoon */
    }
  }

  getPins(context: string): Record<string, GraphPin> {
    return this.state.pins[context] ?? {};
  }

  setPin(context: string, nodeId: string, pin: GraphPin | null): void {
    const bucket = this.state.pins[context] ?? {};
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
      if (!this.state.pinModes) this.state.pinModes = {};
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
