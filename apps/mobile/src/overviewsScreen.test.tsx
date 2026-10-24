// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setPlatformServices, toast, type AdoptionResult } from "@plainva/ui";
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
 *
 * And the one it had left to the desktop (finding 2026-10-11): adopting a
 * note as a folder's overview asks with the choice the desktop's dialog
 * offers — prepare it for OKF on the way —, preset as it is there.
 */

// The texts are their keys here: what is asked and what is said can be told apart by name.
vi.mock("react-i18next", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

const MARKER = "<!-- plainva:index generated -->";

const files: Record<string, string> = {};

const written: string[] = [];
vi.mock("./services/indexOverviews", () => ({
  writeOverview: vi.fn(async (_v: unknown, folder: string) => {
    written.push(folder);
    return { path: folder ? `${folder}/index.md` : "index.md", entries: 1, overwrote: false };
  }),
}));

/** What the question about an adoption was asked with, and what it is answered. */
const asked: unknown[] = [];
let answer = { confirmed: true, checked: true };
vi.mock("./services/mobileDialogs", () => ({
  mConfirmOption: vi.fn(async (request: unknown) => {
    asked.push(request);
    return answer;
  }),
}));

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

const THREE_FOLDERS = [
  { folder: "Alpha", fileCount: 3, hasIndex: true, indexIsConcept: false, candidates: [] },
  { folder: "Beta", fileCount: 2, hasIndex: true, indexIsConcept: false, candidates: [] },
  { folder: "Gamma", fileCount: 4, hasIndex: false, indexIsConcept: false, candidates: [] },
];
/** A folder without an overview that holds a note which could be one. */
const DELTA = { folder: "Delta", fileCount: 2, hasIndex: false, indexIsConcept: false, candidates: [{ path: "Delta/MOC.md", score: 90, reason: "name-pattern" }] };
let folders: unknown[] = THREE_FOLDERS;

/** What an adoption was called with, and what it reports. */
const adoptions: unknown[] = [];
const ADOPTED: AdoptionResult = { indexPath: "Delta/index.md", renamedLinks: 0, changedFiles: 0, linkUpdateFailed: false };
let adoption: AdoptionResult = ADOPTED;

vi.mock("@plainva/ui", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    collectFolderIndexInfos: vi.fn(async () => folders),
    adoptFileAsIndex: vi.fn(async (request: unknown) => {
      adoptions.push(request);
      return adoption;
    }),
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  };
});

const vault = { files: adapter, queryService, indexer: null } as never;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  for (const k of Object.keys(files)) delete files[k];
  written.length = 0;
  folders = THREE_FOLDERS;
  asked.length = 0;
  adoptions.length = 0;
  answer = { confirmed: true, checked: true };
  adoption = ADOPTED;
  for (const notice of [toast.success, toast.warning, toast.error]) vi.mocked(notice).mockClear();
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

describe("adopting a note as a folder's overview", () => {
  const row = () => container.querySelector('[data-testid="overview-row-Delta"]') as HTMLElement;
  const tap = async (target: HTMLElement) => {
    await act(async () => {
      target.click();
    });
    await act(async () => {});
    await act(async () => {});
  };
  beforeEach(() => {
    folders = [...THREE_FOLDERS, DELTA];
  });

  it("asks with the preparation as its choice, preset, and adopts the way it was answered", async () => {
    adoption = { ...ADOPTED, renamedLinks: 3, changedFiles: 2, preparation: { converted: 4, embeds: 1, unresolved: 0, inLabels: 2 } };
    await render();
    await tap(row());

    // The desktop's dialog offers this choice beside its list, ticked; the phone asked nothing.
    expect(asked).toEqual([{ title: "indexMd.actionAdopt", message: "indexMd.renameHint", checkbox: { label: "indexMd.prepareOption", initial: true } }]);
    expect(adoptions).toEqual([expect.objectContaining({ candidatePath: "Delta/MOC.md", folder: "Delta", prepare: true })]);
    // What was done is said in the words of the desktop's result line — what a preparation left behind included.
    expect(vi.mocked(toast.success).mock.calls).toEqual([["indexMd.resultAdopted (indexMd.resultLinks; indexMd.resultPrepLeftovers; indexMd.resultPrepInLabels)"]]);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("adopts the note as it is where the option was taken off", async () => {
    answer = { confirmed: true, checked: false };
    await render();
    await tap(row());

    expect(adoptions).toEqual([expect.objectContaining({ candidatePath: "Delta/MOC.md", prepare: false })]);
    expect(vi.mocked(toast.success).mock.calls).toEqual([["indexMd.resultAdopted"]]);
  });

  it("adopts nothing where the question was cancelled", async () => {
    answer = { confirmed: false, checked: true };
    await render();
    await tap(row());

    expect(asked).toHaveLength(1);
    expect(adoptions).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("says so where a link to the note could not be followed, as after any rename", async () => {
    adoption = { ...ADOPTED, linkUpdateFailed: true };
    await render();
    await tap(row());

    expect(vi.mocked(toast.warning).mock.calls).toEqual([["dialogs.renameLinksFailed"]]);
    expect(vi.mocked(toast.success).mock.calls).toEqual([["indexMd.resultAdopted"]]);
  });

  it("does not ask when the row's own action is tapped: that one writes a listing", async () => {
    // The row leads somewhere AND carries a button. As a button itself it held
    // a button inside a button — the tap on "Create overview" was the row's too.
    await render();
    await tap(row().querySelector("button")!);

    expect(written).toEqual(["Delta"]);
    expect(asked).toEqual([]);
    expect(adoptions).toEqual([]);
  });
});
