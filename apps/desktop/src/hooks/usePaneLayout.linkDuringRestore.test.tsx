// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { usePaneLayout } from "./usePaneLayout";
import { resetStartForTests } from "../services/startView";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A `plainva://open` link that arrives while the window still restores its
 * stored tabs (review of issue 173, desktop half). The note-link handler hangs
 * on the index, not on the layout; the restore checks every stored tab's file
 * asynchronously and then set its layout without a condition — the link's tab
 * was gone. What was opened meanwhile now stays, on top of the restored tabs.
 */
const V = "C:/Vaults/Link";

afterEach(() => localStorage.clear());

describe("a note link during the restore of the tabs", () => {
  it("keeps the tab the link opened, beside the restored ones", async () => {
    resetStartForTests();
    localStorage.setItem(`plainva-layout-${V}`, JSON.stringify({
      panes: [{ tabs: [{ history: ["stored.md"], historyIndex: 0 }], activeIndex: 0 }],
      direction: "vertical",
      activePaneIndex: 0,
      splitRatio: 0.5,
    }));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let pane!: ReturnType<typeof usePaneLayout>;
    function Probe() {
      const p = usePaneLayout({ vaultPath: V, validatePath: async () => { await gate; return true; } });
      useEffect(() => { pane = p; });
      return null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<Probe />));
    expect(pane.layoutReady).toBe(false);
    // The link arrives now: the index is there, the tabs are still being checked.
    await act(async () => pane.openInFocusedPane("from-link.md", false));
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 0)); });
    const paths = pane.layout.panes.flatMap((p) => p.tabs.map((t) => t.history[t.historyIndex]));
    expect(paths).toContain("from-link.md");
    expect(paths).toContain("stored.md");
    expect(pane.activePath).toBe("from-link.md");
    act(() => root.unmount());
  });
});
