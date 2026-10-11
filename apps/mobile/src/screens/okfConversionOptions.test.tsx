// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The type an OKF run on the phone writes into files without one (finding
 * 2026-10-21).
 *
 * The wizard offered a lowercase `note` of its own instead of the vault's type,
 * so one vault converted on the phone and on the desktop got two types. This
 * drives the real screen with the conversion replaced by a recorder, so what
 * is checked is exactly what a run is handed.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const okf = vi.hoisted(() => ({
  /** Every run, with the options it was handed. */
  runs: [] as unknown[],
}));

vi.mock("../services/okfConversion", () => ({
  pendingOkfRun: async () => null,
  scanVaultOkf: async () => ({
    scanned: 3,
    violations: [{ path: "a.md", kind: "missing-type" }, { path: "b.md", kind: "missing-frontmatter" }],
    convertiblePaths: ["a.md", "b.md"],
    typedPaths: ["c.md"],
  }),
  convertVaultToOkf: async (opts: { options: unknown }) => {
    okf.runs.push(opts.options);
    return { changed: ["a.md", "b.md"], unchanged: 0, skipped: [], samples: [], cancelled: false, backupDir: ".plainva/backups/okf-run" };
  },
  undoOkfConversion: async () => ({ restored: [], failed: [] }),
}));
vi.mock("../services/mobileSettings", () => ({ getMobileSettings: () => ({ defaultNoteType: "Zettel" }) }));
vi.mock("@capacitor/app", () => ({
  App: { addListener: () => Promise.resolve({ remove: async () => {} }) },
}));
vi.mock("../hooks/useLeaveGuard", () => ({ useLeaveGuard: () => {} }));
/** One `t` for every render, as react-i18next hands it out: the screen scans again whenever `t` changes. */
const translation = vi.hoisted(() => ({ t: (k: string) => k, i18n: { language: "en" } }));
vi.mock("react-i18next", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useTranslation: () => translation,
}));

import { OkfConversionScreen } from "./OkfConversionScreen";
import type { MobileVault } from "../services/vaultService";

const VAULT = { vaultId: "v", adapter: {}, files: {}, queryService: null } as unknown as MobileVault;
const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

let container: HTMLDivElement;
let root: Root;

/** The services answer at once; one task later every await of the screen has run. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function open() {
  await act(async () => {
    root.render(<OkfConversionScreen onBack={() => {}} vault={VAULT} />);
  });
  await settle();
}

const typeField = () => container.querySelector<HTMLInputElement>("input:not([type=checkbox])")!;

async function setType(value: string) {
  await act(async () => {
    inputSetter.call(typeField(), value);
    typeField().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function start() {
  const button = container.querySelector<HTMLButtonElement>('[data-testid="okf-start"]');
  expect(button, "the preview offers the run").toBeTruthy();
  await act(async () => button!.click());
  await settle();
}

beforeEach(() => {
  okf.runs.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the type an OKF run on the phone writes", () => {
  it("offers the vault's type for new notes", async () => {
    await open();
    expect(typeField().value).toBe("Zettel");
    await start();
    expect(okf.runs).toEqual([{ defaultType: "Zettel", existingTypeStrategy: "keep" }]);
  });

  it("converts an emptied field with the default type, as the desktop does", async () => {
    // Blank means the default, as in the settings: not the vault's type the
    // field was filled with, and not the phone's old lowercase `note`.
    await open();
    await setType("");
    await start();
    expect(okf.runs).toEqual([{ defaultType: "Note", existingTypeStrategy: "keep" }]);
  });
});
