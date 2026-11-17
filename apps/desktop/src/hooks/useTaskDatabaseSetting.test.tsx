// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

/**
 * The tasks view and the account page read the standard task database again
 * when the settings save (review of issue 172): picking a database there
 * while the view is open ends the "create one" hint without waiting for the
 * next sync cycle.
 */
let stored: string | null = null;
vi.mock("../services/taskDatabase", () => ({ getTaskDatabasePath: async () => stored }));
const { useTaskDatabaseSetting } = await import("./useTaskDatabaseSetting");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useTaskDatabaseSetting", () => {
  it("is unknown until read, then follows a save of the settings", async () => {
    const seen: Array<string | null | undefined> = [];
    function Probe() {
      seen.push(useTaskDatabaseSetting("/vault"));
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Probe />));
    expect(seen[0]).toBeUndefined();
    expect(seen[seen.length - 1]).toBeNull();
    stored = "Picked.base";
    await act(async () => {
      window.dispatchEvent(new CustomEvent("plainva-features-saved"));
    });
    expect(seen[seen.length - 1]).toBe("Picked.base");
    act(() => root.unmount());
  });
});
