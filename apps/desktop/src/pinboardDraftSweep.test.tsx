// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IVaultAdapter } from "@plainva/core";
import type { PinboardDraftSweep } from "@plainva/ui";

/**
 * What an app that was closed or killed during a pinboard entry left behind is
 * finished when a vault opens (plan Befunde 2026-09-24, E15) — on the desktop
 * in the main window, which holds the adapter chain and the index. The rule
 * itself is pinned in `services/pinboardDraftLedger.test.ts`; this pins the
 * start-up call site.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nothing = (): PinboardDraftSweep => ({ removed: [], kept: [], forgotten: [], open: [] });
const sweep = vi.fn(async (..._args: unknown[]) => nothing());
vi.mock("./services/pinboardDrafts", () => ({ sweepDesktopPinboardDrafts: (...args: unknown[]) => sweep(...args) }));

import { usePinboardDraftSweep } from "./services/usePinboardDraftSweep";

type Props = Parameters<typeof usePinboardDraftSweep>[0];
function Probe(props: Props) {
  usePinboardDraftSweep(props);
  return null;
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

describe("finishing a crash's pinboard drafts at the vault's open (desktop)", () => {
  afterEach(() => sweep.mockClear());

  it("sweeps once per opened vault, in the main window, once the vault is ready", async () => {
    const root = createRoot(document.createElement("div"));
    const adapter = {} as IVaultAdapter;
    const onRemoved = vi.fn();
    const at = (p: Partial<Props>) => <Probe owner ready vaultPath="/Vault" adapter={adapter} indexer={null} onRemoved={onRemoved} {...p} />;

    await act(async () => root.render(at({ ready: false })));
    expect(sweep).not.toHaveBeenCalled();
    await act(async () => root.render(at({})));
    await settle();
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(sweep).toHaveBeenCalledWith("/Vault", adapter, null);

    // The same vault again — a re-render, a rebuilt adapter chain — is done.
    await act(async () => root.render(at({ adapter: {} as IVaultAdapter })));
    await settle();
    expect(sweep).toHaveBeenCalledTimes(1);

    // Another vault is swept, and the views hear which files went.
    sweep.mockResolvedValueOnce({ ...nothing(), removed: ["Zettel/2026-09-23 18.00.00.md"] });
    await act(async () => root.render(at({ vaultPath: "/Other" })));
    await settle();
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(onRemoved).toHaveBeenCalledWith(["Zettel/2026-09-23 18.00.00.md"]);
    await act(async () => root.unmount());
  });

  it("a secondary window never sweeps: it delegates every file to the main one", async () => {
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe owner={false} ready vaultPath="/Vault" adapter={{} as IVaultAdapter} indexer={null} />));
    await settle();
    expect(sweep).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("VaultContext runs it for every opened vault, from the main window's state", () => {
    const source = readFileSync(join(__dirname, "contexts", "VaultContext.tsx"), "utf8");
    expect(source).toMatch(
      /usePinboardDraftSweep\(\{\s*owner: !isClient,\s*ready: !state\.isLoading,\s*vaultPath: state\.vaultPath,\s*adapter: state\.vaultAdapter,\s*indexer: state\.indexer,/,
    );
  });
});
