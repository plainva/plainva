// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";

/**
 * The name field of the file tree submits on Enter AND when it loses focus
 * (issue 170). A template that asks for fields opens its dialog while the
 * first "create" is still running; the dialog takes the focus, the field
 * blurs, and the same create ran a second time — a second dialog, and a
 * second write over the note the first one had just made. The rename field
 * has the same pair of triggers.
 *
 * The shell is mocked (context, template builder, index follow-up); the tree's
 * own submit handlers and their wiring to the form and the field run for real.
 */

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const builds: Deferred<{ content: string; caret: null; templatePath: string } | null>[] = [];
const buildNewNote = vi.fn(() => {
  const d = deferred<{ content: string; caret: null; templatePath: string } | null>();
  builds.push(d);
  return d.promise;
});
vi.mock("../services/newNoteTemplate", () => ({
  buildNewNoteFromTemplate: () => buildNewNote(),
}));

const renames: Deferred<{ ok: false; reason: "unchanged" }>[] = [];
const renameToName = vi.fn(() => {
  const d = deferred<{ ok: false; reason: "unchanged" }>();
  renames.push(d);
  return d.promise;
});
vi.mock("../services/fileActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/fileActions")>()),
  applyIndexChanges: async () => {},
  reindexAfterRename: async () => {},
  renameToName: () => renameToName(),
}));
vi.mock("../services/moveFlush", () => ({ flushUnsavedBeforeMove: async () => {} }));

const disk = new Map<string, string>([["a.md", "# a\n"]]);
const writes: string[] = [];
const vaultContext = {
  queryService: {
    db: {
      query: async (sql: string) =>
        sql.startsWith("SELECT path, title, mode FROM files")
          ? [...disk.keys()].filter((p) => p.endsWith(".md")).map((p) => ({ path: p, title: p.replace(/\.md$/, ""), mode: "md" }))
          : [],
    },
    getDocumentIcons: async () => [],
    listBaseFilePaths: async () => [],
  },
  isLoading: false,
  fileTreeVersion: 0,
  treeStructureVersion: 0,
  syncWorker: null,
  vaultAdapter: {
    listDir: async () => [...disk.keys()].map((p) => ({ path: p, name: p, isDirectory: false, isFile: true })),
    exists: async (p: string) => disk.has(p),
    writeTextFile: async (p: string, c: string) => { writes.push(p); disk.set(p, c); },
    readTextFile: async (p: string) => disk.get(p) ?? "",
    createDir: async () => {},
  },
  vaultPath: "/vault",
  indexer: {},
  triggerFileTreeUpdate: () => {},
  refreshVault: async () => {},
  refreshFolder: async () => {},
};
vi.mock("../contexts/VaultContext", () => ({ useVault: () => vaultContext }));

import { FileTree } from "./FileTree";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  builds.length = 0;
  renames.length = 0;
  writes.length = 0;
  buildNewNote.mockClear();
  renameToName.mockClear();
  disk.clear();
  disk.set("a.md", "# a\n");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<FileTree onSelect={() => {}} activePath={null} />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** What the template dialog does to the field: it takes the focus. */
function blur(input: HTMLInputElement): void {
  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  input.dispatchEvent(new FocusEvent("blur"));
}

function submit(input: HTMLInputElement): void {
  input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("the file tree's name fields run their action once (issue 170)", () => {
  it("Enter, then the template dialog taking the focus: one dialog, one write", async () => {
    await act(async () => {
      window.dispatchEvent(new CustomEvent("plainva-new-item", { detail: { kind: "file" } }));
    });
    const input = container.querySelector<HTMLInputElement>("form input")!;
    expect(input).not.toBeNull();
    await act(async () => typeInto(input, "Meeting"));

    await act(async () => submit(input));
    await act(async () => blur(input));
    expect(buildNewNote).toHaveBeenCalledTimes(1);

    await act(async () => builds[0].resolve({ content: "# Meeting\n", caret: null, templatePath: "T.md" }));
    // Whatever the second dialog would have answered, there is none to answer.
    for (const late of builds.slice(1)) await act(async () => late.resolve({ content: "# again\n", caret: null, templatePath: "T.md" }));
    expect(writes).toEqual(["Meeting.md"]);
    expect(disk.get("Meeting.md")).toBe("# Meeting\n");
  });

  it("a field left with an error can be submitted again once the first run is over", async () => {
    disk.set("Taken.md", "x");
    await act(async () => {
      window.dispatchEvent(new CustomEvent("plainva-new-item", { detail: { kind: "file" } }));
    });
    const input = container.querySelector<HTMLInputElement>("form input")!;
    await act(async () => typeInto(input, "Taken"));
    await act(async () => submit(input));
    expect(container.querySelector(".pv-inline-error")).not.toBeNull();
    await act(async () => typeInto(input, "Free"));
    await act(async () => submit(input));
    expect(buildNewNote).toHaveBeenCalledTimes(1);
  });

  it("rename: Enter, then focus loss while the rename runs, renames once", async () => {
    const row = await vi.waitFor(() => {
      const el = container.querySelector<HTMLElement>('[data-tree-path="a.md"]');
      if (!el) throw new Error("row not rendered");
      return el;
    });
    await act(async () => {
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    });
    const renameItem = [...document.querySelectorAll<HTMLElement>("button, [role=menuitem]")].find((b) => b.textContent?.trim() === "Rename");
    expect(renameItem).toBeDefined();
    await act(async () => renameItem!.click());
    const input = container.querySelector<HTMLInputElement>("form input");
    expect(input).not.toBeNull();
    await act(async () => typeInto(input!, "b"));
    await act(async () => submit(input!));
    await act(async () => blur(input!));
    expect(renameToName).toHaveBeenCalledTimes(1);
    for (const r of renames) await act(async () => r.resolve({ ok: false, reason: "unchanged" }));
  });
});
