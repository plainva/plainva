// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { InfoTip, RowList, Row, setPlatformServices } from "@plainva/ui";
import { PlatformSheet } from "./PlatformSheet";
import { closeTopSheet, openSheetCount } from "../services/sheetStack";

/**
 * The phone's sheet for the info button of a setting (settings plan
 * 2026-10-29, § 3): registered as the platform's `Sheet`, so the shared
 * InfoTip opens a sheet here — the same sheet as "What is OKF?", with a grip
 * and a place on the sheet stack, so the back button closes it first.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  setPlatformServices({
    loadSettings: async () => ({}) as never,
    credentials: {} as never,
    openExternal: async () => {},
    Sheet: PlatformSheet,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the info button on the phone", () => {
  it("opens the shell's sheet at the end of the document, out of the row it was pressed in", () => {
    const go: string[] = [];
    act(() => root.render(<RowList><Row title="Rebuild index" onClick={() => go.push("row")} info={{ text: "The search index is Plainva's record.", guide: "Search.md" }} /></RowList>));
    const button = container.querySelector<HTMLButtonElement>("button.pv-infotip")!;
    act(() => button.click());
    const sheet = document.querySelector<HTMLElement>('[data-testid="grouprow-info-sheet"]')!;
    expect(sheet).not.toBeNull();
    // Placed outside the row: it would otherwise inherit the row's single, cut-off line.
    expect(container.contains(sheet)).toBe(false);
    expect(sheet.classList.contains("m-sheet")).toBe(true);
    expect(sheet.querySelector(".m-sheet-grip")).not.toBeNull();
    expect(sheet.querySelector(".m-sheet-title")?.textContent).toBe("Rebuild index");
    expect(sheet.textContent).toContain("The search index is Plainva's record.");
    expect(sheet.textContent).toContain("Read more in the handbook");
    expect(go).toEqual([]);
    // The back button closes the sheet, not the screen.
    expect(openSheetCount()).toBe(1);
    act(() => { closeTopSheet(); });
    expect(document.querySelector('[data-testid="grouprow-info-sheet"]')).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("a press on the backdrop closes it", () => {
    act(() => root.render(<InfoTip label="Search index" info="Text." />));
    act(() => container.querySelector<HTMLButtonElement>("button.pv-infotip")!.click());
    const backdrop = document.querySelector<HTMLElement>(".m-sheet-backdrop")!;
    act(() => backdrop.click());
    expect(document.querySelector(".m-sheet-backdrop")).toBeNull();
    expect(openSheetCount()).toBe(0);
  });
});
