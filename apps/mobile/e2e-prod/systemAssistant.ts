import type { BrowserContext } from "@playwright/test";

/**
 * The system's assistant for the production bundle (AI harness P4.7).
 *
 * Siri and Shortcuts reach the app through its `IntentBridge` plugin, and a
 * browser has neither. The app therefore looks for a bridge under
 * `__plainvaFixtureIntents` — only when no native platform answers
 * (`platform/intentBridge.ts`), the same seam the share inbox uses. This
 * module is that bridge, kept in the test process so it outlives reloads, and
 * it keeps the native store's contract: the directory is one file that is
 * written whole or wiped, an order gets an id and leaves the queue only when
 * the app names that id.
 */

const KEY = "__plainvaFixtureIntents";

export interface AskFixture {
  kind: "open" | "search" | "journal" | "task";
  text: string;
  /** open: the key of the row that was chosen, read from the directory. */
  key?: string;
  /** When it was said, ms since the epoch. */
  at: number;
}

export interface DirectoryFixture {
  version: number;
  writtenAt: number;
  vault: string;
  notes: { k: string; t: string; f?: string }[];
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export async function installSystemAssistant(context: BrowserContext) {
  let directory: string | null = null;
  let wipes = 0;
  let nextId = 1;
  let orders: Array<{ id: number; kind: string; text: string; at: number; key?: string }> = [];

  await context.exposeFunction(`${KEY}__write`, ({ json }: { json: string }) => {
    directory = json;
  });
  await context.exposeFunction(`${KEY}__clear`, () => {
    directory = null;
    wipes += 1;
  });
  await context.exposeFunction(`${KEY}__orders`, () => ({ orders: orders.map(clone) }));
  await context.exposeFunction(`${KEY}__done`, ({ ids }: { ids: number[] }) => {
    orders = orders.filter((order) => !ids.includes(order.id));
  });
  await context.addInitScript((key) => {
    const g = globalThis as unknown as Record<string, unknown>;
    const call = (name: string) => (args?: unknown) => (g[`${key}__${name}`] as (value?: unknown) => Promise<unknown>)(args);
    g[key] = { writeDirectory: call("write"), clearDirectory: call("clear"), readOrders: call("orders"), clearOrders: call("done") };
  }, KEY);

  return {
    /** What the system can read right now: the file as the app wrote it, or null where there is none. */
    raw: () => directory,
    directory: (): DirectoryFixture | null => (directory === null ? null : (JSON.parse(directory) as DirectoryFixture)),
    /** The titles in it, in its order. */
    titles: (): string[] => (directory === null ? [] : (JSON.parse(directory) as DirectoryFixture).notes.map((note) => note.t)),
    wipes: () => wipes,
    /** Somebody asked the system for something while the app was closed; the app finds it when it next looks. */
    ask(order: AskFixture): number {
      const id = nextId++;
      orders.push({ id, kind: order.kind, text: order.text, at: order.at, ...(order.key ? { key: order.key } : {}) });
      return id;
    },
    /** What still waits to be redeemed. */
    waiting: () => orders.map(clone),
  };
}
