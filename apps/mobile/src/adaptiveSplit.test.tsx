// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setPlatformServices } from "@plainva/ui";
import { useAdaptiveSplit } from "./hooks/useAdaptiveSplit";
import { getMobileSettings, updateMobileSettings } from "./services/mobileSettings";
import { setWindowClassForTest } from "./services/windowClass";

/**
 * Folding the navigator away on a tablet (2026-08-23).
 *
 * The two-column layout gave the navigator a permanent 280-380 px, which is
 * right while you are picking a note and wrong while you are writing one. The
 * desktop has been able to collapse its left sidebar since it had one; this is
 * that, for the shape where a second column exists at all.
 *
 * These assert the BEHAVIOUR through the real settings store, not a stand-in:
 * whether the fold SURVIVES is the whole point of putting it in settings, and
 * a mocked store would answer that question for itself. The source-text guard
 * in `mobileLint` is about WHERE the switch lives; this is about what it does.
 */

let container: HTMLDivElement;
let root: Root;
/**
 * The hook's answers, read the way the shell reads them: through a render.
 * The click goes through a real button because that is what the rail is -- a
 * test that called `toggleNav()` directly would skip the one step where a
 * stale closure would show up.
 */
function Probe({ onboarded }: { onboarded: boolean }) {
  const s = useAdaptiveSplit(onboarded);
  return (
    <button
      data-collapsed={String(s.navCollapsed)}
      data-split={String(s.splitPossible)}
      data-testid="probe"
      data-two={String(s.twoColumn)}
      onClick={s.toggleNav}
      type="button"
    />
  );
}

const render = (onboarded = true) => {
  act(() => root.render(<Probe onboarded={onboarded} />));
};

const probe = () => container.querySelector('[data-testid="probe"]') as HTMLElement;
const seenSplit = () => probe().dataset.split === "true";
const seenTwo = () => probe().dataset.two === "true";
const seenCollapsed = () => probe().dataset.collapsed === "true";
const toggle = async () => {
  await act(async () => probe().click());
};

beforeEach(async () => {
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
  await updateMobileSettings({ navSidebarCollapsed: false });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  setWindowClassForTest(400, 800);
  await updateMobileSettings({ navSidebarCollapsed: false });
});

describe("the tablet's second column", () => {
  it("stands beside the working surface on a tablet", () => {
    setWindowClassForTest(1100, 800);
    render();
    expect(seenSplit()).toBe(true);
    expect(seenTwo()).toBe(true);
  });

  it("is not offered where there is no room for it", () => {
    // A phone, and a phone merely turned sideways: wide enough on width alone,
    // but two columns in 400 px of height is the tablet layout on a phone.
    for (const [w, h] of [
      [400, 800],
      [700, 800],
      [900, 400],
    ]) {
      setWindowClassForTest(w, h);
      render();
      expect(seenSplit(), `${w}x${h} should stay single-surface`).toBe(false);
      expect(seenTwo()).toBe(false);
    }
  });

  it("is not offered before there is a vault to navigate", () => {
    setWindowClassForTest(1100, 800);
    render(false);
    expect(seenSplit()).toBe(false);
    expect(seenTwo()).toBe(false);
  });
});

describe("folding it away", () => {
  it("takes the column down and reports the fold", async () => {
    setWindowClassForTest(1100, 800);
    render();
    expect(seenTwo()).toBe(true);

    await toggle();
    expect(seenCollapsed(), "the switch should report the fold").toBe(true);
    expect(seenTwo(), "and the layout should act on it").toBe(false);
    // The room to fold into does not go away with the column — otherwise the
    // switch would remove itself and there would be no way back.
    expect(seenSplit()).toBe(true);

    await toggle();
    expect(seenTwo()).toBe(true);
  });

  it("survives, because a fold is a preference and not a mood", async () => {
    setWindowClassForTest(1100, 800);
    render();
    await toggle();
    expect(getMobileSettings().navSidebarCollapsed).toBe(true);

    // What a restart really does: the shell mounts again and asks the store.
    act(() => root.unmount());
    root = createRoot(container);
    render();
    expect(seenCollapsed()).toBe(true);
    expect(seenTwo()).toBe(false);
  });

  it("follows the setting when something else changes it", async () => {
    setWindowClassForTest(1100, 800);
    render();
    // The settings screen writes the same field; the shell must not hold a
    // second, stale copy of an answer the store already has.
    await act(async () => updateMobileSettings({ navSidebarCollapsed: true }));
    expect(seenCollapsed()).toBe(true);
    expect(seenTwo()).toBe(false);
  });
});
