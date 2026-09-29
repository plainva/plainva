// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createHash } from "node:crypto";
import { taskNoteKey, type TaskAnchorRecord } from "@plainva/core";
import { __resetTaskSyncPauseForTest, taskNamesHiddenKey } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * The desktop's offer to clean up task-note names with an id (plan Befunde
 * 2026-09-24, E12, mockup § 4), rendered through its real wiring: the notice
 * lists old -> new, "Clean up names…" asks first and then renames through the
 * desktop's ordinary rename (link retargeting included), the reconciler's
 * stored path follows, open tabs follow, and "Hide" puts the notice away.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hashOf = (uid: string) => createHash("sha256").update(taskNoteKey({ provider: "google", identity: "google:me", list: "L1", uid })).digest("hex");
const note = (uid: string, title: string) =>
  ["---", "plainva:", "  pim:", "    kind: task", "    provider: google", "    identity: google:me", "    list: L1", `    uid: ${uid}`, "---", `# ${title}`, ""].join("\n");
const legacy = (title: string, uid: string) => `Aufgaben/${title} — ${hashOf(uid).slice(0, 16)}.md`;

const env = vi.hoisted(() => ({
  files: new Map<string, string>(),
  moved: [] as Array<[string, string]>,
}));

function anchors(): Map<string, TaskAnchorRecord[]> {
  const out = new Map<string, TaskAnchorRecord[]>();
  for (const [path, content] of env.files) {
    const uid = /uid: (\S+)/.exec(content)?.[1];
    if (uid) out.set(uid, [...(out.get(uid) ?? []), { path, uid, list: "L1", ctime: 1 } as TaskAnchorRecord]);
  }
  return out;
}

const queryService = {
  getTaskAnchors: async () => anchors(),
  listNotes: async () => [...env.files.keys()].map((path) => ({ path })),
  getBacklinks: async (path: string) =>
    [...env.files].filter(([, c]) => c.includes(`[[${path.split("/").pop()!.replace(/\.md$/, "")}]]`)).map(([source]) => ({
      source_path: source,
      target_path: path.split("/").pop()!.replace(/\.md$/, ""),
      property_key: null,
    })),
  db: { query: async () => [...env.files.keys()].map((path) => ({ path })) },
};
const vaultAdapter = {
  exists: async (p: string) => env.files.has(p),
  readTextFile: async (p: string) => {
    if (!env.files.has(p)) throw new Error(`missing ${p}`);
    return env.files.get(p)!;
  },
  writeTextFile: async (p: string, c: string) => void env.files.set(p, c),
  renameItem: async (from: string, to: string) => {
    env.files.set(to, env.files.get(from)!);
    env.files.delete(from);
  },
  listDir: async () => [],
  readBinaryFile: async () => new Uint8Array(),
  writeBinaryFile: async () => {},
};
vi.mock("../../contexts/VaultContext", () => ({
  useVault: () => ({
    vaultPath: "C:/vaults/wiki",
    vaultAdapter,
    queryService,
    indexer: null,
    pimRuntime: { cache: { moveTaskNotePath: async (from: string, to: string) => void env.moved.push([from, to]) } },
  }),
}));
const confirm = vi.hoisted(() => vi.fn(async (_opts: { title: string; message: string; confirmLabel?: string }) => true));
vi.mock("../../services/appDialogs", () => ({ appConfirm: confirm }));
vi.mock("../../services/saveFlush", () => ({ requestSaveFlush: vi.fn(async () => {}) }));
vi.mock("../../services/bookmarks", () => ({ retargetDesktopBookmarks: vi.fn(async () => {}) }));

import { TaskNamesNotice } from "./TaskNamesNotice";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  __resetTaskSyncPauseForTest();
  localStorage.clear();
  env.files.clear();
  env.moved.length = 0;
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

async function render(onRenamed = vi.fn()) {
  await act(async () => {
    root.render(<TaskNamesNotice reloadKey={0} onRenamed={onRenamed} onChanged={() => {}} />);
  });
  await settle();
  return onRenamed;
}

describe("TaskNamesNotice (desktop)", () => {
  it("lists old -> new, asks, renames through the ordinary rename and lets links, stored path and tabs follow", async () => {
    const a = legacy("Einkaufen", "u1");
    const b = legacy("Einkaufen", "u2");
    env.files.set(a, note("u1", "Einkaufen"));
    env.files.set(b, note("u2", "Einkaufen"));
    env.files.set("Projekt.md", `Siehe [[${a.split("/").pop()!.replace(/\.md$/, "")}]]\n`);
    const onRenamed = await render();

    expect(container.querySelector('[data-testid="task-names-banner"]')?.textContent).toBe("2 task notes still carry an id in their names");
    expect(container.textContent).toContain("(here: 1)");
    // Mockup § 4: each row reads "old → new", the old name struck through.
    const rows = [...container.querySelectorAll('[data-testid="task-names-row"]')];
    expect(rows.map((r) => r.querySelector('[data-testid="task-names-new"]')?.textContent)).toEqual(["Einkaufen.md", "Einkaufen 2.md"]);
    expect(rows.map((r) => r.querySelector('del[data-testid="task-names-old"]')?.textContent)).toEqual([a.split("/").pop(), b.split("/").pop()]);

    await act(async () => { (container.querySelector('[data-testid="task-names-clean"]') as HTMLButtonElement).click(); });
    await settle();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]![0]).toMatchObject({ title: "Clean up names?" });
    expect([...env.files.keys()].sort()).toEqual(["Aufgaben/Einkaufen 2.md", "Aufgaben/Einkaufen.md", "Projekt.md"]);
    expect(env.files.get("Projekt.md")).toBe("Siehe [[Einkaufen]]\n");
    expect(env.moved).toEqual([[a, "Aufgaben/Einkaufen.md"], [b, "Aufgaben/Einkaufen 2.md"]]);
    expect(onRenamed).toHaveBeenCalledWith(a, "Aufgaben/Einkaufen.md");
    // Nothing left to offer.
    expect(container.querySelector('[data-testid="task-names-notice"]')).toBeNull();
  });

  it("renames nothing when the question is declined, and 'Hide' puts the notice away", async () => {
    const a = legacy("Zahnarzt anrufen", "u1");
    env.files.set(a, note("u1", "Zahnarzt anrufen"));
    confirm.mockResolvedValueOnce(false);
    await render();
    await act(async () => { (container.querySelector('[data-testid="task-names-clean"]') as HTMLButtonElement).click(); });
    await settle();
    expect(env.files.has(a)).toBe(true);
    expect(env.moved).toEqual([]);

    await act(async () => { (container.querySelector('[data-testid="task-names-hide"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('[data-testid="task-names-notice"]')).toBeNull();
    expect(localStorage.getItem(taskNamesHiddenKey("C:/vaults/wiki"))).toBeTruthy();
  });

  it("offers nothing for a name that only LOOKS like one Plainva gave", async () => {
    env.files.set("Aufgaben/Plan — 0123456789abcdef.md", "# Plan\n");
    env.files.set(`Aufgaben/Fremd — ${hashOf("u1").slice(0, 16)}.md`, note("u9", "Fremd"));
    await render();
    expect(container.querySelector('[data-testid="task-names-notice"]')).toBeNull();
  });
});
