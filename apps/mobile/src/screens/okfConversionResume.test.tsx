// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Continuing an OKF run on the phone (finding § 3.129 Nr. 1 a and b).
 *
 * The screen continued a paused or interrupted run with whatever its fields
 * held in the render before — the vault's type and "keep", whatever the run
 * began with — and a continue that failed fell back to the preview, whose
 * start opened a second backup folder no undo of the first covers. This drives
 * the real screen with the services replaced by a recorder: a continue asks
 * for the open run (`resume`), never for options of its own, and a failed one
 * leads back to the open run's card.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const JOURNAL = {
  startedAt: "2026-10-30T10:00:00.000Z",
  backupDir: ".plainva/backups/okf-conversion-OPEN",
  total: 3,
  options: { defaultType: "Memo", existingTypeStrategy: "rename" as const },
};

const okf = vi.hoisted(() => ({
  /** Every run, with what it was handed. */
  runs: [] as Record<string, unknown>[],
  /** What the next runs answer, in order; an Error is thrown. */
  answers: [] as unknown[],
  /** The journal `pendingOkfRun` finds. */
  open: null as unknown,
}));

vi.mock("../services/okfConversion", () => ({
  pendingOkfRun: async () => (okf.open ? { journal: okf.open, remaining: 1 } : null),
  scanVaultOkf: async () => ({
    scanned: 3,
    violations: [{ path: "a.md", kind: "missing-type" }],
    convertiblePaths: ["a.md", "b.md", "c.md"],
    typedPaths: ["c.md"],
  }),
  convertVaultToOkf: async (opts: Record<string, unknown>) => {
    const { vault: _vault, scan: _scan, onProgress: _p, isCancelled: _c, ...handed } = opts;
    okf.runs.push(handed);
    const answer = okf.answers.shift();
    if (answer instanceof Error) throw answer;
    return answer;
  },
  undoOkfConversion: async () => ({ restored: [], failed: [], changedSince: [] }),
}));
vi.mock("../services/mobileSettings", () => ({ getMobileSettings: () => ({ defaultNoteType: "Zettel" }) }));
vi.mock("@capacitor/app", () => ({
  App: { addListener: () => Promise.resolve({ remove: async () => {} }) },
}));
vi.mock("../hooks/useLeaveGuard", () => ({ useLeaveGuard: () => {} }));
const translation = vi.hoisted(() => ({ t: (k: string) => k, i18n: { language: "en" } }));
vi.mock("react-i18next", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useTranslation: () => translation,
}));

import { OkfConversionScreen } from "./OkfConversionScreen";
import type { MobileVault } from "../services/vaultService";

const VAULT = { vaultId: "v", adapter: {}, files: {}, queryService: null } as unknown as MobileVault;

let container: HTMLDivElement;
let root: Root;

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

async function click(testId: string) {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  expect(button, `${testId} is offered`).toBeTruthy();
  await act(async () => button!.click());
  await settle();
}

const report = (cancelled: boolean) => ({
  changed: ["a.md"],
  unchanged: 0,
  skipped: [],
  samples: [],
  cancelled,
  backupDir: JOURNAL.backupDir,
  recipe: { kind: "conversion", options: JOURNAL.options },
});

beforeEach(() => {
  okf.runs.length = 0;
  okf.answers.length = 0;
  okf.open = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("continuing an OKF run on the phone", () => {
  it("continues a paused run as that run — not with the fields of the screen", async () => {
    await open();
    okf.answers.push(report(true), report(false));
    await click("okf-start");
    expect(okf.runs[0]).toEqual({ options: { defaultType: "Zettel", existingTypeStrategy: "keep" } });
    okf.open = JOURNAL;

    await click("okf-resume");

    expect(okf.runs[1]).toEqual({ resume: true });
  });

  it("continues an interrupted run found at start as that run", async () => {
    okf.open = JOURNAL;
    await open();
    okf.answers.push(report(false));

    await click("okf-resume");

    expect(okf.runs).toEqual([{ resume: true }]);
  });

  it("leads a failed continue back to the open run, never to a fresh start", async () => {
    await open();
    okf.answers.push(report(true), new Error("the vault went away"));
    await click("okf-start");
    okf.open = JOURNAL;

    await click("okf-resume");

    // The preview's start would open a second backup folder (§ 3.129 Nr. 1 b).
    expect(container.querySelector('[data-testid="okf-start"]')).toBeNull();
    expect(container.querySelector('[data-testid="okf-resume"]')).toBeTruthy();
    expect(container.textContent).toContain("okf.recoveryTitle");
  });
});
