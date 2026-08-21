// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setPlatformServices } from "@plainva/ui";
import { OverviewsScreen } from "./screens/OverviewsScreen";

/**
 * The OKF overviews list on the phone (P6).
 *
 * Pins the two decisions this screen exists for:
 *
 *  - it sorts by where something is MISSING, not alphabetically — an
 *    alphabetical list of mostly-fine folders buries the handful that need
 *    attention, which is the whole reason for a tidy-up pass;
 *  - a folder whose index.md is the user's own is LISTED and left alone: no
 *    write action next to it, because overwriting a hand-written note in
 *    passing is the one failure this feature must not have.
 */

const MARKER = "<!-- plainva:index generated -->";

const files: Record<string, string> = {};

const written: string[] = [];
vi.mock("./services/indexOverviews", () => ({
  writeOverview: vi.fn(async (_v: unknown, folder: string) => {
    written.push(folder);
    return { path: folder ? `${folder}/index.md` : "index.md", entries: 1, overwrote: false };
  }),
}));

vi.mock("./services/mobileDialogs", () => ({ mConfirm: vi.fn(async () => true) }));

const adapter = {
  readTextFile: async (path: string) => {
    const hit = files[path];
    if (hit === undefined) throw new Error(`ENOENT ${path}`);
    return hit;
  },
};

/** Three folders, one of each state, deliberately alphabetically unhelpful. */
const queryService = {
  db: { query: async () => [] },
  listAllNotes: async () => [],
} as never;

vi.mock("@plainva/ui", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    collectFolderIndexInfos: vi.fn(async () => [
      { folder: "Alpha", fileCount: 3, hasIndex: true, indexIsConcept: false, candidates: [] },
      { folder: "Beta", fileCount: 2, hasIndex: true, indexIsConcept: false, candidates: [] },
      { folder: "Gamma", fileCount: 4, hasIndex: false, indexIsConcept: false, candidates: [] },
    ]),
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  };
});

const vault = { files: adapter, queryService, indexer: null } as never;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  for (const k of Object.keys(files)) delete files[k];
  written.length = 0;
  // Alpha is ours, Beta is the user's own, Gamma has none at all.
  files["Alpha/index.md"] = `# Alpha\n\n${MARKER}\n`;
  files["Beta/index.md"] = "# Beta\n\nHand written.\n";
  setPlatformServices({
    loadSettings: async () => ({
      get: async () => undefined,
      set: async () => {},
      delete: async () => {},
      keys: async () => [],
      save: async () => {},
    }),
    credentials: { readSecret: async () => null, writeSecret: async () => {}, removeSecret: async () => {} },
    openExternal: async () => {},
  } as never);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = async () => {
  await act(async () => {
    root.render(<OverviewsScreen onBack={() => {}} vault={vault} />);
  });
  await act(async () => {});
  await act(async () => {});
};

const rowOrder = () =>
  [...container.querySelectorAll('[data-testid^="overview-row-"]')].map((el) =>
    el.getAttribute("data-testid")!.replace("overview-row-", ""),
  );

describe("OverviewsScreen", () => {
  it("puts the folder without an overview first", async () => {
    await render();
    expect(rowOrder()).toEqual(["Gamma", "Beta", "Alpha"]);
  });

  it("offers no write action next to the user's own overview", async () => {
    await render();
    const beta = container.querySelector('[data-testid="overview-row-Beta"]')!;
    expect(beta.querySelector("button")).toBeNull();
    // …while the two Plainva knows about do carry one.
    expect(container.querySelector('[data-testid="overview-row-Alpha"]')!.querySelector("button")).not.toBeNull();
    expect(container.querySelector('[data-testid="overview-row-Gamma"]')!.querySelector("button")).not.toBeNull();
  });

  it("writes only the folder whose action was tapped", async () => {
    await render();
    await act(async () => {
      container
        .querySelector('[data-testid="overview-row-Gamma"]')!
        .querySelector("button")!
        .click();
    });
    await act(async () => {});
    expect(written).toEqual(["Gamma"]);
  });

  it("generates in every folder that has none when the bulk row is tapped", async () => {
    await render();
    await act(async () => {
      (container.querySelector('[data-testid="overviews-all-missing"]') as HTMLElement).click();
    });
    await act(async () => {});
    // Only Gamma is missing one — Beta belongs to the user and is not touched.
    expect(written).toEqual(["Gamma"]);
  });
});
