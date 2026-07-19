// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { GRAPH_TAB_PATH, TASKS_TAB_PATH } from "./graph/virtualPaths";

// The hooks query the index via VaultContext; the strip's rendering contract
// is what we pin here, so both return empty maps (a virtual path never has an
// index entry anyway — exactly the production case).
vi.mock("../hooks/useDocumentIcons", () => ({ useDocumentIcons: () => new Map() }));
vi.mock("../hooks/useDocumentTitles", () => ({ useDocumentTitles: () => new Map() }));

import { RecentsSection } from "./RecentsSection";

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

function render(el: ReactElement) {
  act(() => root.render(el));
}

function rowFor(path: string): HTMLButtonElement | null {
  return container.querySelector(`button[data-tip="${path}"]`);
}

describe("RecentsSection", () => {
  it("renders virtual views with their localized name instead of the raw pseudo-path basename", () => {
    render(
      <RecentsSection
        recentPaths={[TASKS_TAB_PATH, GRAPH_TAB_PATH, "Notes/Hello.md"]}
        activePath={null}
        onOpen={() => {}}
      />
    );
    expect(rowFor(TASKS_TAB_PATH)?.textContent).toBe(i18n.t("tasks.title"));
    expect(rowFor(GRAPH_TAB_PATH)?.textContent).toBe(i18n.t("rightPanel.graph"));
    // The bug rendered the lowercase basenames — pin their absence.
    expect(rowFor(TASKS_TAB_PATH)?.textContent).not.toBe("tasks");
    expect(rowFor(GRAPH_TAB_PATH)?.textContent).not.toBe("graph");
    // Real notes keep the tree-style display name (extension stripped).
    expect(rowFor("Notes/Hello.md")?.textContent).toBe("Hello");
  });

  it("renders the dedicated view icons (ribbon parity), not the generic file icon", () => {
    render(
      <RecentsSection
        recentPaths={[TASKS_TAB_PATH, GRAPH_TAB_PATH, "Notes/Hello.md"]}
        activePath={null}
        onOpen={() => {}}
      />
    );
    expect(rowFor(TASKS_TAB_PATH)?.querySelector("svg.lucide-list-checks")).toBeTruthy();
    expect(rowFor(GRAPH_TAB_PATH)?.querySelector("svg.lucide-waypoints")).toBeTruthy();
    expect(rowFor("Notes/Hello.md")?.querySelector("svg.lucide-file-text")).toBeTruthy();
  });

  it("opens the clicked entry via its path", () => {
    const onOpen = vi.fn();
    render(<RecentsSection recentPaths={[TASKS_TAB_PATH]} activePath={null} onOpen={onOpen} />);
    act(() => rowFor(TASKS_TAB_PATH)!.click());
    expect(onOpen).toHaveBeenCalledWith(TASKS_TAB_PATH);
  });
});
