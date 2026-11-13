// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "i18next";
import {
  beginIndexBuild,
  createIndexAutoUpdater,
  indexBuildState,
  indexNotWholeText,
  markIndexWhole,
  owedPinboardSweepsIn,
  resetIndexBuildsForTests,
  takeFullScan,
  useIndexWholeEpoch,
} from "@plainva/ui";
import { IndexBuildNotice } from "@plainva/ui";
import { wholeIndexReader } from "@plainva/core";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
beforeEach(async () => { resetIndexBuildsForTests(); await i18n.changeLanguage("en"); });
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});
const mount = (node: React.ReactElement) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
};

describe("what a full scan that left something out says (fourth review of 11.11.)", () => {
  it("whole only where the core says so; otherwise the strip and every refusal name what was left out and what to do", () => {
    beginIndexBuild("/v");
    takeFullScan("/v", { whole: false, skipped: [{ path: "Shared", reason: "unreadable" }, { path: "loop", reason: "cycle" }] });
    const state = indexBuildState("/v");
    expect(state.kind).toBe("failed");
    expect(state.kind === "failed" ? state.leftOut : null).toEqual(["Shared"]);
    expect(indexNotWholeText(state as never)).toContain("“Shared” could not be read");
    mount(<IndexBuildNotice vaultId="/v" onReadAgain={() => {}} />);
    expect(host!.querySelector('[data-testid="index-build-notice"]')!.textContent).toContain("“Shared” could not be read");
    expect(host!.querySelector('[data-testid="index-read-again"]')).not.toBeNull();
    // A scan that leaves nothing out makes it whole.
    act(() => takeFullScan("/v", { whole: true, skipped: [] }));
    expect(indexBuildState("/v").kind).toBe("whole");
  });

  it("names the first and counts the rest", () => {
    beginIndexBuild("/v");
    takeFullScan("/v", { whole: false, skipped: ["A", "B", "C"].map((path) => ({ path, reason: "unreadable" })) });
    expect(indexNotWholeText(indexBuildState("/v") as never)).toContain("“A” and 2 more");
  });
});

describe("a surface reads again the moment the index becomes whole (fourth review of 11.11.)", () => {
  it("counts each change to whole, and nothing else", () => {
    const seen: number[] = [];
    function Probe() {
      seen.push(useIndexWholeEpoch("/v"));
      return null;
    }
    beginIndexBuild("/v");
    mount(<Probe />);
    expect(seen[seen.length - 1]).toBe(0);
    act(() => markIndexWhole("/v"));
    expect(seen[seen.length - 1]).toBe(1);
    act(() => beginIndexBuild("/v"));
    act(() => markIndexWhole("/v"));
    expect(seen[seen.length - 1]).toBe(2);
  });
});

describe("a pinboard sweep a close cut short is owed and run at the next whole index (fourth review of 11.11.)", () => {
  it("runs the owed sweep once the index is whole, and forgets it then", async () => {
    const storage = new Map<string, string>();
    const store = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) };
    const owedSweeps = owedPinboardSweepsIn("/v", store);
    owedSweeps.save([{ from: "a.md", to: "b/a.md" }]);
    const files = new Map<string, string>([["Board.base", ["views:", "  - type: table", "    name: Board", "    plainva:", "      render: pinboard", "      pinboardOrder:", '        - "a.md"', ""].join("\n")]]);
    let becameWhole: () => void = () => {};
    const whole = new Promise<void>((resolve) => { becameWhole = resolve; });
    const written: string[] = [];
    const updater = createIndexAutoUpdater({
      adapter: {
        readTextFile: async (p: string) => { const t = files.get(p); if (t === undefined) throw new Error("not found"); return t; },
        writeTextFile: async (p: string, t: string) => void files.set(p, t),
      } as never,
      queryService: wholeIndexReader({ listBaseFilePaths: async () => ["Board.base"], untilWholeIndex: () => whole }) as never,
      vaultName: () => "V",
      subfoldersHeading: () => "Folders",
      owed: { load: () => [], save: () => {} },
      owedSweeps,
      onWritten: (p) => void written.push(p),
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(files.get("Board.base")).toContain('"a.md"');
      becameWhole();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(files.get("Board.base")).toContain("b/a.md");
      expect(written).toEqual(["Board.base"]);
      expect(owedSweeps.load()).toEqual([]);
    } finally {
      updater.dispose();
    }
  });
});
