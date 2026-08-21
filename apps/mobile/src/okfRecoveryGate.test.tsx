// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OkfRecoveryGate } from "./components/OkfRecoveryGate";

/**
 * "A conversion was interrupted" — asked once, and never a trap (P8).
 *
 * The behaviour is what matters here, not the markup: the gate has to SPEAK
 * when a journal is lying around (a silent one leaves a half-converted vault
 * nobody knows about), it has to let the sheet be dismissed (a phone one
 * cannot get out of is worse than the state being warned about), and it must
 * not ask again after being answered — a question that returns after you
 * answered it teaches people to dismiss it unread.
 */

const pending = vi.fn();
vi.mock("./services/okfConversion", () => ({ pendingOkfRun: (...a: unknown[]) => pending(...a) }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  pending.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** A fresh object each time — a vault reload hands out a new one, and that is
 *  exactly the case the "ask once" guard exists for. */
const vault = () => ({ vaultId: "/vault" }) as never;
const gate = () => container.querySelector('[data-testid="okf-recovery-gate"]');

const render = async (onOpen = () => {}) => {
  await act(async () => {
    root.render(<OkfRecoveryGate onOpen={onOpen} vault={vault()} />);
  });
  await act(async () => {});
};

const openRun = { journal: { startedAt: "2026-08-21T10:00:00.000Z", backupDir: "b", total: 3, options: {} }, remaining: 2 };

describe("the interrupted-conversion gate", () => {
  it("says nothing when no run is open", async () => {
    pending.mockResolvedValue(null);
    await render();
    expect(gate()).toBeNull();
  });

  it("speaks when a journal is lying around, and counts what is left", async () => {
    pending.mockResolvedValue(openRun);
    await render();
    expect(gate()).not.toBeNull();
    expect(container.textContent).toContain("2");
  });

  it("says nothing when the vault has no index yet, beyond the fact itself", async () => {
    // remaining -1 means the scan could not run at start-up. The run is still
    // worth reporting; the number is not invented.
    pending.mockResolvedValue({ ...openRun, remaining: -1 });
    await render();
    expect(gate()).not.toBeNull();
    expect(container.querySelector(".m-hint")).toBeNull();
  });

  it("lets go, and does not ask twice for the same vault", async () => {
    pending.mockResolvedValue(openRun);
    await render();
    const buttons = [...container.querySelectorAll("button")];
    const later = buttons[buttons.length - 1];
    await act(async () => later.click());
    expect(gate()).toBeNull();

    // A vault reload is not a new app start: it hands out a fresh object with
    // the same id, and a dep array alone would ask again. Asking again here is
    // what trains people to tap the question away without reading it.
    await act(async () => {
      root.render(<OkfRecoveryGate onOpen={() => {}} vault={vault()} />);
    });
    await act(async () => {});
    expect(gate()).toBeNull();
    expect(pending).toHaveBeenCalledTimes(1);
  });

  it("hands over to the wizard rather than acting on its own", async () => {
    // The gate never converts and never rolls back: both are decisions with
    // consequences, and they belong on the screen that shows the numbers.
    pending.mockResolvedValue(openRun);
    const onOpen = vi.fn();
    await render(onOpen);
    await act(async () => (container.querySelector('[data-testid="okf-gate-open"]') as HTMLElement).click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(gate()).toBeNull();
  });
});
