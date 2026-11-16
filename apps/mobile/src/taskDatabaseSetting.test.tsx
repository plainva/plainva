// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

/**
 * The phone's half of the review of issue 172: the Tasks tab and the account
 * page follow the standard task database when the settings change, and
 * "Create new database…" never makes a second one over a database set
 * meanwhile. Settings and dialog are mocked; the hook and the helper run.
 */
const settings = { taskDatabase: "" };
const updates: Array<Record<string, unknown>> = [];
vi.mock("./services/mobileSettings", () => ({
  getMobileSettings: () => settings,
  updateMobileSettings: async (patch: Record<string, unknown>) => {
    updates.push(patch);
    Object.assign(settings, patch);
    window.dispatchEvent(new CustomEvent("m-settings-changed"));
  },
}));
let onPrompt: () => void = () => {};
const prompt = vi.fn(async () => {
  onPrompt();
  return { cancelled: false, value: "Tasks" };
});
vi.mock("./services/mobileDialogs", () => ({ mPrompt: () => prompt() }));
const created: string[] = [];
vi.mock("@plainva/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plainva/ui")>()),
  createTaskDatabase: async (_adapter: unknown, name: string) => {
    created.push(name);
    return `${name}.base`;
  },
}));

const { useTaskDatabaseSetting } = await import("./hooks/useTaskDatabaseSetting");
const { createStandardTaskDatabase } = await import("./services/taskDatabaseCreate");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const vault = { files: {}, reindexPaths: async () => {} } as never;
const t = ((key: string) => key) as never;

beforeEach(() => {
  settings.taskDatabase = "";
  updates.length = 0;
  created.length = 0;
  prompt.mockClear();
  onPrompt = () => {};
});

describe("the standard task database on the phone (review of issue 172)", () => {
  it("the views follow a database picked in the settings", async () => {
    const seen: string[] = [];
    function Probe() {
      seen.push(useTaskDatabaseSetting());
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    expect(seen[seen.length - 1]).toBe("");
    settings.taskDatabase = "Picked.base";
    await act(async () => {
      window.dispatchEvent(new CustomEvent("m-settings-changed"));
    });
    expect(seen[seen.length - 1]).toBe("Picked.base");
    act(() => root.unmount());
  });

  it("creates and sets one when none is set", async () => {
    expect(await createStandardTaskDatabase(vault, t)).toBe("Tasks.base");
    expect(updates).toEqual([{ taskDatabase: "Tasks.base" }]);
  });

  it("does nothing when one is set already, or got set while the name was asked", async () => {
    settings.taskDatabase = "Picked.base";
    expect(await createStandardTaskDatabase(vault, t)).toBe("Picked.base");
    expect(prompt).not.toHaveBeenCalled();
    settings.taskDatabase = "";
    onPrompt = () => {
      settings.taskDatabase = "Picked.base";
    };
    expect(await createStandardTaskDatabase(vault, t)).toBe("Picked.base");
    expect(created).toEqual([]);
    expect(updates).toEqual([]);
  });
});
