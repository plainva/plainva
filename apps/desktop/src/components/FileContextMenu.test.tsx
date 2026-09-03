// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { GRAPH_TAB_PATH } from "./graph/virtualPaths";
import { FileContextMenu } from "./FileContextMenu";

/**
 * The menu is shared between the file tree and the two pinned lists (plan P4),
 * and the whole arrangement rests on one rule: a missing callback is a missing
 * entry. These tests pin that rule, because it is what keeps the lists from
 * offering tree-only actions — and the tree from growing list-only ones.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(el: ReactElement) {
  act(() => root.render(el));
}

/** Menu entries render into a portal, so read them off the document. */
function entries(): string[] {
  return [...document.querySelectorAll('[role="menuitem"]')].map((b) => (b.textContent ?? "").trim());
}

describe("FileContextMenu", () => {
  it("shows only the actions it was handed", () => {
    // The pinned-list shape: files, no folder arm, no creating things.
    render(
      <FileContextMenu
        x={10}
        y={10}
        path="Notes/Alpha.md"
        isFolder={false}
        onClose={() => {}}
        onOpenNewTab={() => {}}
        onCopyPath={() => {}}
        onRemoveFromList={() => {}}
      />,
    );
    const items = entries();
    expect(items).toContain("Open in New Tab");
    expect(items).toContain("Copy Path");
    expect(items).toContain("Remove from list");
    // No callback was handed over for these, so they must not appear.
    expect(items).not.toContain("Rename");
    expect(items).not.toContain("Duplicate");
    expect(items).not.toContain("Delete");
    expect(items).not.toContain("Open in split (right)");
  });

  it("carries the tree's full file menu when every callback is handed over", () => {
    render(
      <FileContextMenu
        x={0}
        y={0}
        path="Notes/Alpha.md"
        isFolder={false}
        onClose={() => {}}
        onOpenNewTab={() => {}}
        onOpenInSplit={() => {}}
        onRename={() => {}}
        onDuplicate={() => {}}
        onMove={() => {}}
        isBookmarked={() => false}
        onToggleBookmark={() => {}}
        onVersionHistory={() => {}}
        onCopyPath={() => {}}
        onDelete={() => {}}
      />,
    );
    const items = entries();
    for (const label of ["Open in New Tab", "Rename", "Duplicate", "Move to…", "Copy Path", "Delete"]) {
      expect(items).toContain(label);
    }
    // "Remove from list" is the lists' entry — the tree never asked for it.
    expect(items).not.toContain("Remove from list");
  });

  it("offers a virtual row only open and forget", () => {
    // The vault map can sit in "Recently opened", but renaming or deleting it
    // is meaningless — it is a view, not a file.
    render(
      <FileContextMenu
        x={0}
        y={0}
        path={GRAPH_TAB_PATH}
        isFolder={false}
        onClose={() => {}}
        onOpenNewTab={() => {}}
        onRename={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        onCopyPath={() => {}}
        onRemoveFromList={() => {}}
      />,
    );
    expect(entries()).toEqual(["Open in New Tab", "Remove from list"]);
  });

  it("switches to the bulk variant for a multi-selection", () => {
    render(
      <FileContextMenu
        x={0}
        y={0}
        path="Notes/Alpha.md"
        isFolder={false}
        selectionCount={3}
        onClose={() => {}}
        onRename={() => {}}
        onBulkDuplicate={() => {}}
        onClearSelection={() => {}}
        onBulkDelete={() => {}}
      />,
    );
    const items = entries();
    expect(items).toContain("Duplicate");
    expect(items).toContain("Delete");
    // Single-target actions are gone while three rows are selected.
    expect(items).not.toContain("Rename");
    expect(document.body.textContent).toContain("3");
  });

  it("renames through the callback with the clicked path", () => {
    const renamed: string[] = [];
    render(
      <FileContextMenu
        x={0}
        y={0}
        path="Notes/Beta.md"
        isFolder={false}
        onClose={() => {}}
        onRename={(p) => renamed.push(p)}
      />,
    );
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.trim() === "Rename");
    act(() => { (item as HTMLButtonElement).click(); });
    expect(renamed).toEqual(["Notes/Beta.md"]);
  });
});
