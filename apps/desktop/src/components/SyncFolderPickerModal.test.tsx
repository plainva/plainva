// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import "@plainva/ui/i18n";
import { SyncFolderPickerModal } from "./SyncFolderPickerModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(el: ReactElement) {
  await act(async () => root.render(el));
}

function rowByText(text: string): HTMLElement {
  // Folder rows are <li>; the go-up row is a <div>. Prefer the INNERMOST
  // match — a single-folder list makes the container's textContent identical
  // to its only row, and clicking the container would go nowhere.
  const lis = [...container.querySelectorAll("li")] as HTMLElement[];
  let hit = lis.find((r) => r.textContent?.trim() === text);
  if (!hit) {
    const divs = [...container.querySelectorAll("div")].filter((r) => r.textContent?.trim() === text) as HTMLElement[];
    hit = divs[divs.length - 1];
  }
  expect(hit, `row "${text}" not found`).toBeTruthy();
  return hit!;
}

function useButton(): HTMLButtonElement {
  const btn = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Use this folder"));
  expect(btn, "use-folder button not found").toBeTruthy();
  return btn as HTMLButtonElement;
}

describe("SyncFolderPickerModal", () => {
  it("navigates level by level and returns the slash-joined path", async () => {
    const listFolders = vi.fn(async (path: string) => {
      if (path === "") return ["Alpha", "Beta"];
      if (path === "Alpha") return ["Sub"];
      if (path === "Alpha/Sub") return [];
      throw new Error(`unexpected ${path}`);
    });
    const onSelect = vi.fn();
    await render(
      <SyncFolderPickerModal listFolders={listFolders} rootLabel="Dropbox" onSelect={onSelect} onCancel={() => {}} />
    );

    // Root: both folders listed, the root itself is NOT selectable (allowRoot off).
    expect(container.textContent).toContain("Alpha");
    expect(container.textContent).toContain("Beta");
    expect(useButton().disabled).toBe(true);

    await act(async () => rowByText("Alpha").click());
    expect(listFolders).toHaveBeenLastCalledWith("Alpha");
    expect(container.textContent).toContain("Dropbox / Alpha");
    expect(useButton().disabled).toBe(false);

    await act(async () => rowByText("Sub").click());
    await act(async () => useButton().click());
    expect(onSelect).toHaveBeenCalledWith("Alpha/Sub");
  });

  it("offers a go-up row below root and allows picking the root with allowRoot", async () => {
    const listFolders = vi.fn(async (path: string) => (path === "" ? ["Vault"] : []));
    const onSelect = vi.fn();
    await render(
      <SyncFolderPickerModal listFolders={listFolders} rootLabel="bucket" allowRoot onSelect={onSelect} onCancel={() => {}} />
    );

    // Root is a valid pick for S3 (empty prefix).
    expect(useButton().disabled).toBe(false);

    await act(async () => rowByText("Vault").click());
    expect(container.textContent).toContain(".. (Go up)");
    await act(async () => rowByText(".. (Go up)").click());
    expect(listFolders).toHaveBeenLastCalledWith("");

    await act(async () => useButton().click());
    expect(onSelect).toHaveBeenCalledWith("");
  });

  it("navigating into a Drive folder and picking it returns the nested path", async () => {
    const listFolders = vi.fn(async (path: string) => (path === "" ? ["Apps"] : path === "Apps" ? ["Plainva"] : []));
    const onSelect = vi.fn();
    await render(
      <SyncFolderPickerModal listFolders={listFolders} rootLabel="Google Drive" onSelect={onSelect} onCancel={() => {}} />
    );

    expect(useButton().disabled).toBe(true);
    await act(async () => rowByText("Apps").click());
    await act(async () => rowByText("Plainva").click());
    expect(container.textContent).toContain("Google Drive / Apps/Plainva");

    await act(async () => useButton().click());
    expect(onSelect).toHaveBeenCalledWith("Apps/Plainva");
  });

  it("shows listing errors and keeps the pick disabled", async () => {
    const listFolders = vi.fn(async () => {
      throw new Error("S3 list failed: 403");
    });
    await render(
      <SyncFolderPickerModal listFolders={listFolders} rootLabel="bucket" allowRoot onSelect={() => {}} onCancel={() => {}} />
    );
    expect(container.textContent).toContain("S3 list failed: 403");
    expect(useButton().disabled).toBe(true);
  });

  // --- "New folder" row (2026-07-13) -------------------------------------

  const newFolderInput = () =>
    container.querySelector('input[placeholder="New folder"]') as HTMLInputElement | null;

  const typeNewName = async (value: string) => {
    const input = newFolderInput()!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  const createButton = (): HTMLButtonElement => {
    const btn = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Create");
    expect(btn, "create button not found").toBeTruthy();
    return btn as HTMLButtonElement;
  };

  it("shows the new-folder row only when createFolder is provided", async () => {
    const listFolders = vi.fn(async () => []);
    await render(
      <SyncFolderPickerModal listFolders={listFolders} rootLabel="Dropbox" allowRoot onSelect={() => {}} onCancel={() => {}} />
    );
    expect(newFolderInput()).toBeNull();

    await render(
      <SyncFolderPickerModal
        listFolders={listFolders}
        rootLabel="Dropbox"
        allowRoot
        createFolder={async () => {}}
        onSelect={() => {}}
        onCancel={() => {}}
      />
    );
    expect(newFolderInput()).not.toBeNull();
  });

  it("creates a folder at the current level and descends into it as the selection", async () => {
    const listFolders = vi.fn(async (path: string) => {
      if (path === "") return ["Alpha"];
      if (path === "Alpha") return [];
      if (path === "Alpha/Mein Wissen") return [];
      throw new Error(`unexpected ${path}`);
    });
    const createFolder = vi.fn(async () => {});
    const onSelect = vi.fn();
    await render(
      <SyncFolderPickerModal
        listFolders={listFolders}
        rootLabel="Nextcloud"
        createFolder={createFolder}
        onSelect={onSelect}
        onCancel={() => {}}
      />
    );

    await act(async () => rowByText("Alpha").click());
    await typeNewName("Mein Wissen");
    await act(async () => createButton().click());

    expect(createFolder).toHaveBeenCalledWith("Alpha/Mein Wissen");
    expect(listFolders).toHaveBeenLastCalledWith("Alpha/Mein Wissen");
    expect(container.textContent).toContain("Nextcloud / Alpha/Mein Wissen");

    await act(async () => useButton().click());
    expect(onSelect).toHaveBeenCalledWith("Alpha/Mein Wissen");
  });

  it("rejects a name that already exists at this level without calling createFolder", async () => {
    const listFolders = vi.fn(async () => ["Alpha"]);
    const createFolder = vi.fn(async () => {});
    await render(
      <SyncFolderPickerModal
        listFolders={listFolders}
        rootLabel="Nextcloud"
        allowRoot
        createFolder={createFolder}
        onSelect={() => {}}
        onCancel={() => {}}
      />
    );

    await typeNewName("alpha");
    await act(async () => createButton().click());

    expect(createFolder).not.toHaveBeenCalled();
    expect(container.textContent).toContain("A folder with this name already exists.");
  });
});
