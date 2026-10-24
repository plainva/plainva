import { ROUTINES_MAX, type Routine } from "@plainva/core";

/**
 * The routines of the open vault on this device (plan KI-Harness P8, ADR
 * 0033): the list as the app's data holds it, the one that runs right now,
 * and the note a run left while the app was open. One implementation for
 * both shells. The run itself is the session's — it is a conversation like
 * any other, with less in it.
 *
 * The list is per vault and per device, beside the vault's other AI data and
 * never in the vault: a routine is a standing permission of this device, and
 * a vault that carried it would hand it to every device that syncs it.
 */
export interface RoutineStore {
  /** The routines as stored; a file that is missing or damaged holds none. */
  load(): Promise<Routine[]>;
  save(routines: readonly Routine[]): Promise<void>;
}

/** The note a run left: said once where a conversation is on screen, and to the system where it may. */
export interface RoutineReady {
  id: string;
  name: string;
  /** The note's path in the vault, and what it is called. */
  note: string;
  title: string;
}

export interface AiRoutinesState {
  /** The list was read for the open vault. */
  loaded: boolean;
  /** Whether this vault keeps routines on this device at all. */
  available: boolean;
  list: Routine[];
  /** The routine that runs right now. */
  running: { id: string; name: string } | null;
  ready: RoutineReady | null;
}

export const EMPTY_ROUTINES_STATE: AiRoutinesState = { loaded: false, available: false, list: [], running: null, ready: null };

export class AiRoutines {
  state: AiRoutinesState = EMPTY_ROUTINES_STATE;
  private store: RoutineStore | null = null;
  /** One change at a time — read, change, write —, so a run that ends and a switch that is flipped both land. */
  private lane: Promise<unknown> = Promise.resolve();

  constructor(private readonly publish: (state: AiRoutinesState) => void) {}

  private set(patch: Partial<AiRoutinesState>): void {
    this.state = { ...this.state, ...patch };
    this.publish(this.state);
  }

  /** Another vault: its own list, read from this device's data. What ran or lay ready belonged to the last one. */
  attach(store: RoutineStore | null): void {
    this.store = store;
    this.set({ ...EMPTY_ROUTINES_STATE, available: store !== null });
    if (store) void this.reload();
  }

  available(): boolean {
    return this.store !== null;
  }

  /** The list as this device holds it now. */
  async reload(): Promise<Routine[]> {
    const store = this.store;
    if (!store) return [];
    const list = await store.load().catch((): Routine[] => []);
    if (this.store !== store) return [];
    this.set({ list, loaded: true });
    return list;
  }

  /** One routine as this device holds it now; null when it is gone. */
  async fresh(id: string): Promise<Routine | null> {
    return (await this.reload()).find((routine) => routine.id === id) ?? null;
  }

  private change(apply: (list: Routine[]) => Routine[] | null): Promise<Routine[] | null> {
    const store = this.store;
    const work = this.lane
      .catch(() => undefined)
      .then(async () => {
        if (!store) return null;
        const next = apply(await store.load());
        if (!next) return null;
        await store.save(next);
        if (this.store === store) this.set({ list: next, loaded: true });
        return next;
      });
    this.lane = work;
    return work;
  }

  /** Adds a routine, or puts it in the place of the one with its id. Null where the list is full or nothing is kept here. */
  put(routine: Routine): Promise<Routine[] | null> {
    return this.change((list) => {
      if (list.some((other) => other.id === routine.id)) return list.map((other) => (other.id === routine.id ? routine : other));
      return list.length >= ROUTINES_MAX ? null : [...list, routine];
    });
  }

  /** Changes one routine as it is stored at that moment; null when it is gone. */
  patch(id: string, change: (routine: Routine) => Routine): Promise<Routine[] | null> {
    return this.change((list) => (list.some((routine) => routine.id === id) ? list.map((routine) => (routine.id === id ? change(routine) : routine)) : null));
  }

  remove(id: string): Promise<Routine[] | null> {
    return this.change((list) => (list.some((routine) => routine.id === id) ? list.filter((routine) => routine.id !== id) : null));
  }

  setRunning(running: AiRoutinesState["running"]): void {
    this.set({ running });
  }

  setReady(ready: RoutineReady | null): void {
    this.set({ ready });
  }
}
