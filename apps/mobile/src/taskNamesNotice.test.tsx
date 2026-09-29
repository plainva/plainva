// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createHash } from "node:crypto";
import { taskNoteKey, type TaskAnchorRecord } from "@plainva/core";
import { __resetTaskSyncPauseForTest } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * The phone's side of the offer to clean up task-note names with an id (plan
 * Befunde 2026-09-24, E12): the same shared notice as the desktop, wired to the
 * phone's ordinary rename (`vaultOps.renameReport`), its confirmation sheet
 * and its PIM cache.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hashOf = (uid: string) => createHash("sha256").update(taskNoteKey({ provider: "google", identity: "google:me", list: "L1", uid })).digest("hex");
const note = (uid: string, title: string) =>
  ["---", "plainva:", "  pim:", "    kind: task", "    provider: google", "    identity: google:me", "    list: L1", `    uid: ${uid}`, "---", `# ${title}`, ""].join("\n");

const env = vi.hoisted(() => ({
  files: new Map<string, string>(),
  moved: [] as Array<[string, string]>,
  renamed: [] as Array<[string, string]>,
}));

const confirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock("./services/mobileDialogs", () => ({ mConfirm: confirm, mPrompt: vi.fn(), mSelect: vi.fn() }));
vi.mock("./services/pim/pimService", () => ({
  getPimCache: () => ({ moveTaskNotePath: async (from: string, to: string) => void env.moved.push([from, to]) }),
}));
vi.mock("./services/syncService", () => ({ syncSoon: vi.fn() }));
vi.mock("./services/vaultService", () => ({
  vaultOps: {
    read: async (_v: unknown, p: string) => {
      if (!env.files.has(p)) throw new Error(`missing ${p}`);
      return env.files.get(p)!;
    },
    save: async (_v: unknown, p: string, c: string) => void env.files.set(p, c),
    renameReport: async (_v: unknown, from: string, title: string) => {
      const to = `${from.slice(0, from.lastIndexOf("/") + 1)}${title}.md`;
      env.files.set(to, env.files.get(from)!);
      env.files.delete(from);
      env.renamed.push([from, to]);
      return { newPath: to, renamedLinks: 0, changedFiles: 0, linkUpdateFailed: false };
    },
  },
}));

import { TaskNamesNotice } from "./components/TaskNamesNotice";

function anchors(): Map<string, TaskAnchorRecord[]> {
  const out = new Map<string, TaskAnchorRecord[]>();
  for (const [path, content] of env.files) {
    const uid = /uid: (\S+)/.exec(content)?.[1];
    if (uid) out.set(uid, [...(out.get(uid) ?? []), { path, uid, list: "L1", ctime: 1 } as TaskAnchorRecord]);
  }
  return out;
}

const vault = {
  vaultId: "vault-phone",
  queryService: {
    getTaskAnchors: async () => anchors(),
    listNotes: async () => [...env.files.keys()].map((path) => ({ path })),
    getBacklinks: async () => [],
    db: { query: async () => [...env.files.keys()].map((path) => ({ path })) },
  },
  files: { exists: async (p: string) => env.files.has(p) },
  indexer: null,
  reindexPaths: vi.fn(async () => {}),
} as never;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  __resetTaskSyncPauseForTest();
  localStorage.clear();
  env.files.clear();
  env.moved.length = 0;
  env.renamed.length = 0;
  confirm.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("TaskNamesNotice (phone)", () => {
  it("shows the same notice and renames through the phone's rename after the sheet's yes", async () => {
    const from = `Aufgaben/Zahnarzt anrufen — ${hashOf("u1").slice(0, 16)}.md`;
    env.files.set(from, note("u1", "Zahnarzt anrufen"));
    env.files.set("Aufgaben/Zahnarzt anrufen.md", "# Meine eigene Notiz\n");
    await act(async () => {
      root.render(<TaskNamesNotice vault={vault} reloadKey={0} onChanged={() => {}} />);
    });
    await settle();

    const notice = container.querySelector('[data-testid="task-names-notice"]');
    expect(notice?.className).toContain("m-names-notice");
    expect(container.querySelector('[data-testid="task-names-banner"]')?.textContent).toBe("1 task note still carries an id in its name");
    expect(container.textContent).toContain("(here: none)");
    // The person's own "Zahnarzt anrufen.md" is taken: the task becomes "… 2".
    expect(container.querySelector('del[data-testid="task-names-old"]')?.textContent).toBe(from.split("/").pop());
    expect(container.querySelector('[data-testid="task-names-new"]')?.textContent).toBe("Zahnarzt anrufen 2.md");
    expect(container.querySelector('[data-testid="task-names-clean"]')?.textContent).toBe("Clean up names…");

    await act(async () => { (container.querySelector('[data-testid="task-names-clean"]') as HTMLButtonElement).click(); });
    await settle();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(env.moved).toEqual([[from, "Aufgaben/Zahnarzt anrufen 2.md"]]);
    expect(env.renamed).toEqual([[from, "Aufgaben/Zahnarzt anrufen 2.md"]]);
    expect(env.files.get("Aufgaben/Zahnarzt anrufen.md")).toBe("# Meine eigene Notiz\n");
    expect(container.querySelector('[data-testid="task-names-notice"]')).toBeNull();
  });
});
