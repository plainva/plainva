// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PinboardDraftSweep } from "@plainva/ui";
import type { MobileVault } from "./services/vaultService";

/**
 * What an app that was closed or killed during a pinboard entry left behind is
 * finished when a vault opens (plan Befunde 2026-09-24, E15) — on the phone at
 * the start and after a vault switch. The rule itself is pinned in the desktop
 * package (`services/pinboardDraftLedger.test.ts`) and the phone's file paths
 * in `services/baseOpsCapture.test.ts`; this pins the start-up call site.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sweep = vi.fn(async (..._args: unknown[]): Promise<PinboardDraftSweep> => ({ removed: [], kept: [], forgotten: [], open: [] }));
vi.mock("./services/baseOps", () => ({ sweepMobilePinboardDrafts: (...args: unknown[]) => sweep(...args) }));

import { usePinboardDraftSweep } from "./services/usePinboardDraftSweep";

function Probe({ vault }: { vault: MobileVault | null }) {
  usePinboardDraftSweep(vault);
  return null;
}

describe("finishing a crash's pinboard drafts at the vault's open (phone)", () => {
  afterEach(() => sweep.mockClear());

  it("sweeps each vault the app opens — at the start and after a switch — once", async () => {
    const root = createRoot(document.createElement("div"));
    const first = { vaultId: "a" } as MobileVault;
    const second = { vaultId: "b" } as MobileVault;
    await act(async () => root.render(<Probe vault={null} />));
    expect(sweep).not.toHaveBeenCalled();
    await act(async () => root.render(<Probe vault={first} />));
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(sweep).toHaveBeenLastCalledWith(first);
    await act(async () => root.render(<Probe vault={first} />));
    expect(sweep).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Probe vault={second} />));
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(sweep).toHaveBeenLastCalledWith(second);
    await act(async () => root.unmount());
  });

  it("the app shell runs it for the vault it holds", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "App.tsx"), "utf8");
    expect(source).toMatch(/\n\s*usePinboardDraftSweep\(vault\);/);
  });
});
