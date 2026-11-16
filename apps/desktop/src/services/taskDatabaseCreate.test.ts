// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Create new database…" from a hint (review of issue 172): a database set
 * meanwhile wins. The hint could stay on screen after a database had been
 * picked in the settings; a click then made a second database and wrote it
 * over the setting just chosen. The settings store and the dialog are
 * mocked; the creation helper and the setting it reads run for real.
 */
const store = new Map<string, unknown>();
vi.mock("./settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async (key: string) => store.get(key),
    set: async (key: string, value: unknown) => void store.set(key, value),
    save: async () => {},
  }),
}));
let onPrompt: () => void = () => {};
const prompt = vi.fn(async () => {
  onPrompt();
  return "Tasks";
});
vi.mock("./appDialogs", () => ({ appPrompt: () => prompt() }));
const created: string[] = [];
vi.mock("./taskDatabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./taskDatabase")>()),
  createTaskDatabase: async (_adapter: unknown, name: string) => {
    created.push(name);
    return `${name}.base`;
  },
}));
vi.mock("./fileActions", () => ({ applyIndexChanges: async () => ({ leftBehind: [] }) }));

const { createStandardTaskDatabase } = await import("./taskDatabaseCreate");
const { taskDatabaseKey } = await import("../contexts/VaultContext");

const deps = () => ({
  vaultAdapter: {} as never,
  vaultPath: "/vault",
  indexer: null,
  triggerFileTreeUpdate: () => {},
  t: ((key: string) => key) as never,
});

beforeEach(() => {
  store.clear();
  created.length = 0;
  prompt.mockClear();
  onPrompt = () => {};
});

describe("creating the standard task database from a hint", () => {
  it("creates and sets one when none is set", async () => {
    expect(await createStandardTaskDatabase(deps())).toBe("Tasks.base");
    expect(created).toEqual(["Tasks"]);
    expect(store.get(taskDatabaseKey("/vault"))).toBe("Tasks.base");
  });

  it("does nothing when one is set already: no dialog, no second database", async () => {
    store.set(taskDatabaseKey("/vault"), "Picked.base");
    expect(await createStandardTaskDatabase(deps())).toBe("Picked.base");
    expect(prompt).not.toHaveBeenCalled();
    expect(created).toEqual([]);
    expect(store.get(taskDatabaseKey("/vault"))).toBe("Picked.base");
  });

  it("does not write over a database picked while the name was asked", async () => {
    onPrompt = () => store.set(taskDatabaseKey("/vault"), "Picked.base");
    expect(await createStandardTaskDatabase(deps())).toBe("Picked.base");
    expect(created).toEqual([]);
    expect(store.get(taskDatabaseKey("/vault"))).toBe("Picked.base");
  });
});
