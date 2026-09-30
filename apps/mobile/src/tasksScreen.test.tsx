// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { requestNew, takePendingNew, toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * "New task" reaching the phone's tasks screen from elsewhere (plan Befunde
 * 2026-09-24, E28 — found by the task suite in `e2e-prod/tasks.spec.ts`).
 *
 * The ＋ menu on another tab, the palette, the Android launcher shortcut and
 * the journal's "Create a task instead" all park the request and open the
 * tasks tab — which MOUNTS the screen with the request already waiting. The
 * screen used to learn its task database in an effect, so on the first render
 * it had none, took the request and dropped it: the tab opened, the capture
 * sheet did not. What the request carried (the journal's typed text) was lost
 * with it.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TASK_BASE = "filters:\n  and:\n    - file.folder == \"Aufgaben\"\nproperties:\n  note.status:\n    plainva:\n      input: select\n      options:\n        - Offen\n        - Erledigt\n";

const env = vi.hoisted(() => ({ taskDatabase: "Aufgaben.base" }));

vi.mock("./services/mobileSettings", () => ({
  getMobileSettings: () => ({ taskDatabase: env.taskDatabase, templateFolder: "Templates", defaultNoteType: "Note" }),
}));
vi.mock("./services/pim/pimService", () => ({
  getPimCache: () => null,
  pimForegroundSync: vi.fn(),
  pimSyncNow: vi.fn(),
  pimTargetForCalendarKey: vi.fn(async () => null),
  writablePimCalendarOptions: vi.fn(async () => []),
}));
vi.mock("./services/pim/taskToProvider", () => ({
  providerListLabel: vi.fn(async () => null),
  sendTaskToProviderList: vi.fn(async () => "sent"),
}));
vi.mock("./services/syncService", () => ({ syncSoon: vi.fn() }));
vi.mock("./services/mobileDialogs", () => ({ mConfirm: vi.fn(async () => false), mSelect: vi.fn(async () => null) }));
vi.mock("./services/taskCompletionAction", () => ({ setTaskDone: vi.fn(async () => ({ changed: false })) }));
vi.mock("./lib/usePullToRefresh", () => ({ usePullToRefresh: () => null }));
vi.mock("./services/vaultService", () => ({
  vaultOps: {
    read: async (_vault: unknown, path: string) => {
      if (path === "Aufgaben.base") return TASK_BASE;
      throw new Error(`ENOENT ${path}`);
    },
    save: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    renameReport: vi.fn(),
  },
}));

import { TasksScreen } from "./screens/TasksScreen";

const vault = {
  vaultId: "vault-phone",
  queryService: {
    listTasks: async () => [],
    queryDatabaseFiles: async () => [],
    getTaskAnchors: async () => new Map(),
    listNotes: async () => [],
    getBacklinks: async () => [],
    listBases: async () => [],
  },
  files: { exists: async () => false },
  indexer: null,
  reindexPaths: async () => {},
} as never;

let host: HTMLDivElement;
let root: Root;
const sheet = () => host.querySelector<HTMLElement>('[data-testid="task-capture-sheet"]');
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

async function mount() {
  await act(async () => {
    root.render(<TasksScreen vault={vault} bump={0} onOpenNote={vi.fn()} />);
  });
  await settle();
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  env.taskDatabase = "Aufgaben.base";
  takePendingNew("task");
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  toast.clearAll();
});

describe("TasksScreen and a New task from elsewhere", () => {
  it("opens the capture sheet for a request that was parked before the screen mounted", async () => {
    requestNew("task");
    await mount();
    expect(sheet()).not.toBeNull();
    expect(takePendingNew("task")).toBe(false);
  });

  it("keeps the text the request brought along — the journal's handover", async () => {
    requestNew("task", "Order the spare part tomorrow");
    await mount();
    expect(sheet()?.querySelector<HTMLInputElement>('[data-testid="task-capture-input"]')?.value).toBe("Order the spare part tomorrow");
  });

  it("opens it for a request made while the screen is open, too", async () => {
    await mount();
    expect(sheet()).toBeNull();
    await act(async () => requestNew("task"));
    await settle();
    expect(sheet()).not.toBeNull();
  });

  it("takes the request and opens nothing when the vault has no task database", async () => {
    env.taskDatabase = "";
    requestNew("task");
    await mount();
    expect(sheet()).toBeNull();
    expect(takePendingNew("task")).toBe(false);
  });
});
