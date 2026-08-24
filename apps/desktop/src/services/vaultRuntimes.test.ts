import { describe, it, expect, beforeEach } from "vitest";
import {
  acquireVault,
  releaseVault,
  releaseHolder,
  setHolderVault,
  heldVaults,
  holdersOf,
  isHeld,
  subscribeVaultRuntimes,
  resetVaultRuntimes,
} from "./vaultRuntimes";

describe("vault runtime registry (stage D)", () => {
  beforeEach(() => resetVaultRuntimes());

  it("holds a vault while at least one window shows it", () => {
    acquireVault("/A", "main");
    acquireVault("/A", "full-1");
    expect(heldVaults()).toEqual(["/A"]);

    releaseVault("/A", "main");
    // Still shown by the second window — tearing the runtime down here would
    // stop the sync worker under a window that is looking at it.
    expect(isHeld("/A")).toBe(true);

    releaseVault("/A", "full-1");
    expect(heldVaults()).toEqual([]);
  });

  it("keeps the order vaults were opened in", () => {
    acquireVault("/A", "main");
    acquireVault("/B", "full-1");
    acquireVault("/C", "full-2");
    expect(heldVaults()).toEqual(["/A", "/B", "/C"]);

    releaseVault("/B", "full-1");
    acquireVault("/B", "full-3");
    // Re-acquired vaults go to the end rather than reclaiming their old slot;
    // what matters is that the order is stable between renders, not which slot.
    expect(heldVaults()).toEqual(["/A", "/C", "/B"]);
  });

  it("counts a window once, however often it reports the same vault", () => {
    acquireVault("/A", "main");
    acquireVault("/A", "main");
    acquireVault("/A", "main");
    releaseVault("/A", "main");
    // A refcount that outlives the truth never reaches zero, and the vault would
    // stay open for the rest of the session.
    expect(heldVaults()).toEqual([]);
  });

  it("lets go of everything a closed window held", () => {
    acquireVault("/A", "main");
    acquireVault("/A", "full-1");
    acquireVault("/B", "full-1");

    releaseHolder("full-1");
    expect(heldVaults()).toEqual(["/A"]);
    expect(holdersOf("/A")).toEqual(["main"]);
  });

  it("moves a window from one vault to another in one step", () => {
    acquireVault("/A", "main");
    acquireVault("/A", "full-1");

    setHolderVault("/B", "full-1");
    expect(heldVaults()).toEqual(["/A", "/B"]);
    expect(holdersOf("/A")).toEqual(["main"]);
    expect(holdersOf("/B")).toEqual(["full-1"]);

    // The central window follows: /A has nobody left and goes away.
    setHolderVault("/B", "main");
    expect(heldVaults()).toEqual(["/B"]);
  });

  it("lets a window show no vault at all", () => {
    acquireVault("/A", "main");
    setHolderVault(null, "main");
    expect(heldVaults()).toEqual([]);
  });

  it("notifies only when the set of held vaults changes", () => {
    let calls = 0;
    const stop = subscribeVaultRuntimes(() => {
      calls += 1;
    });

    acquireVault("/A", "main");
    expect(calls).toBe(1);

    // Second window on the SAME vault: nothing to re-render, the vault was
    // already held.
    acquireVault("/A", "full-1");
    expect(calls).toBe(1);

    releaseVault("/A", "full-1");
    expect(calls).toBe(1);

    releaseVault("/A", "main");
    expect(calls).toBe(2);

    stop();
    acquireVault("/B", "main");
    expect(calls).toBe(2);
  });

  it("survives a listener that throws", () => {
    let reached = false;
    subscribeVaultRuntimes(() => {
      throw new Error("boom");
    });
    subscribeVaultRuntimes(() => {
      reached = true;
    });
    acquireVault("/A", "main");
    expect(reached).toBe(true);
    expect(heldVaults()).toEqual(["/A"]);
  });

  it("ignores a release from a window that never held the vault", () => {
    acquireVault("/A", "main");
    releaseVault("/A", "full-9");
    expect(heldVaults()).toEqual(["/A"]);
  });
});
