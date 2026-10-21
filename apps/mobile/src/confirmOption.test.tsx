// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MobileDialogHost } from "./components/MobileDialogHost";
import { currentMobileDialog, dismissMobileDialog, mConfirm, mConfirmOption } from "./services/mobileDialogs";

vi.mock("react-i18next", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

/**
 * A confirmation that carries one more decision (finding 2026-10-11).
 *
 * Adopting a note as a folder's overview offers, on the desktop, to prepare
 * the note on the way: a checkbox beside the list, ticked. The phone's
 * question had no place for a choice, so it asked none and adopted every note
 * as it was. The sheet shows the option now, in the state it is preset to,
 * and hands back the state it was confirmed in.
 */

const LABEL = "Prepare adopted files for OKF (remove frontmatter, convert this file's wikilinks to markdown links)";

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<MobileDialogHost />);
  });
  return {
    host,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}
const byTestId = <T extends HTMLElement>(host: HTMLElement, id: string) => host.querySelector<T>(`[data-testid="${id}"]`);
const click = (target: HTMLElement) => act(async () => { target.click(); });

afterEach(() => {
  // A sheet a failed test left open would be the first the next one sees.
  for (let open = currentMobileDialog(); open; open = currentMobileDialog()) dismissMobileDialog(open);
});

describe("the option on a confirmation sheet", () => {
  it("is shown with its whole sentence, preset, and answered in the state it was confirmed in", async () => {
    const { host, cleanup } = await mount();
    try {
      let asked!: Promise<{ confirmed: boolean; checked: boolean }>;
      await act(async () => {
        asked = mConfirmOption({ title: "Adopt: MOC.md", message: "Links are updated.", checkbox: { label: LABEL, initial: true } });
      });
      const option = byTestId<HTMLInputElement>(host, "confirm-option")!;
      expect(option.type).toBe("checkbox");
      expect(option.checked).toBe(true);
      // The sentence is the checkbox's own label: tapping it anywhere answers, and nothing of it is cut.
      expect(option.closest("label")!.textContent).toBe(LABEL);
      expect(host.textContent).toContain("Adopt: MOC.md");

      await click(option);
      expect(byTestId<HTMLInputElement>(host, "confirm-option")!.checked).toBe(false);
      await click(byTestId(host, "confirm-act")!);
      await expect(asked).resolves.toEqual({ confirmed: true, checked: false });
    } finally {
      await cleanup();
    }
  });

  it("answers the state it was shown in where nothing was touched", async () => {
    const { host, cleanup } = await mount();
    try {
      let asked!: Promise<{ confirmed: boolean; checked: boolean }>;
      await act(async () => {
        asked = mConfirmOption({ title: "Adopt: MOC.md", checkbox: { label: LABEL, initial: true } });
      });
      await click(byTestId(host, "confirm-act")!);
      await expect(asked).resolves.toEqual({ confirmed: true, checked: true });
    } finally {
      await cleanup();
    }
  });

  it("is not confirmed by cancelling, whatever was ticked meanwhile", async () => {
    const { host, cleanup } = await mount();
    try {
      let asked!: Promise<{ confirmed: boolean; checked: boolean }>;
      await act(async () => {
        asked = mConfirmOption({ title: "Adopt: MOC.md", checkbox: { label: LABEL, initial: true } });
      });
      await click(byTestId(host, "confirm-option")!);
      await click(byTestId(host, "confirm-safe")!);
      await expect(asked).resolves.toMatchObject({ confirmed: false });
      expect(currentMobileDialog()).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it("is on no sheet that did not ask for one", async () => {
    const { host, cleanup } = await mount();
    try {
      let asked!: Promise<boolean>;
      await act(async () => {
        asked = mConfirm({ title: "Sure?" });
      });
      expect(byTestId(host, "confirm-option")).toBeNull();
      await click(byTestId(host, "confirm-act")!);
      await expect(asked).resolves.toBe(true);
    } finally {
      await cleanup();
    }
  });
});
