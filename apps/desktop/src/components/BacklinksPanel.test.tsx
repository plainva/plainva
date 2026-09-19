// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";

/**
 * The ORDER of the backlinks (finding 2026-09-19).
 *
 * The list had none: the statement carried no ORDER BY, so the rows came in
 * whatever order the link table held them, and each row was named after its
 * FILE although the index knows the note's title. The shell is mocked (vault
 * context); the grouping, the sorting and the component's own wiring run for
 * real.
 */

// The index answers in ITS order - deliberately not the one any sort produces.
const rows = [
  { source_path: "notes/zebra.md", source_title: "Zebra", source_mtime: 100, target_path: "Hub", link_type: "wikilink", line_number: 2 },
  { source_path: "notes/a-file-name.md", source_title: "Mango", source_mtime: 300, target_path: "Hub", link_type: "wikilink", line_number: 1 },
  { source_path: "notes/alpha.md", source_title: "Alpha", source_mtime: 200, target_path: "Hub", link_type: "wikilink", line_number: 4 },
  { source_path: "notes/alpha.md", source_title: "Alpha", source_mtime: 200, target_path: "Hub", link_type: "wikilink", line_number: 9 },
];

// One stable object: a fresh one per render would change the effect deps on every pass.
const vaultContext = {
  fileTreeVersion: 0,
  queryService: { getBacklinks: async () => rows },
  vaultAdapter: { readTextFile: async () => "" },
};
vi.mock("../contexts/VaultContext", () => ({ useVault: () => vaultContext }));

import { BacklinksPanel } from "./BacklinksPanel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
};
/** The name line of each file row - the element right above the row's path line. */
const titles = () => [...container.querySelectorAll(".pv-backlink-context")].map((path) => path.previousElementSibling?.textContent?.trim());
const clickButton = async (el: Element | null | undefined) => {
  expect(el, "button to click").toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
};
const menuItem = (label: string) => [...document.querySelectorAll(".pv-menu-item")].find((item) => item.textContent?.includes(label));

beforeEach(async () => {
  await i18n.changeLanguage("en");
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("BacklinksPanel — order and names", () => {
  it("names each row by the note's title and orders them A–Z, whatever the index returned", async () => {
    await act(async () => { root.render(<BacklinksPanel activePath="Hub.md" onOpenPath={() => {}} embedded />); });
    await flush();
    expect(titles()).toEqual(["Alpha", "Mango", "Zebra"]);
  });

  it("sorts by the chosen key, flips on the second pick, and remembers the choice on this device", async () => {
    await act(async () => { root.render(<BacklinksPanel activePath="Hub.md" onOpenPath={() => {}} embedded />); });
    await flush();
    const sortButton = () => container.querySelector('[data-testid="backlinks-sort"]');
    expect(sortButton()?.textContent).toContain("Title");

    await clickButton(sortButton());
    await clickButton(menuItem("Number of links"));
    // Alpha links twice; the other two tie and fall back to their paths.
    expect(titles()).toEqual(["Alpha", "Mango", "Zebra"]);
    expect(sortButton()?.textContent).toContain("Number of links");

    await clickButton(sortButton());
    await clickButton(menuItem("Last modified"));
    expect(titles()).toEqual(["Mango", "Alpha", "Zebra"]);
    await clickButton(sortButton());
    await clickButton(menuItem("Last modified"));
    expect(titles()).toEqual(["Zebra", "Alpha", "Mango"]);
    expect(JSON.parse(localStorage.getItem("plainva-backlink-sort")!)).toEqual({ key: "modified", dir: "asc" });

    // A panel mounted later starts from the remembered order.
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => { root.render(<BacklinksPanel activePath="Hub.md" onOpenPath={() => {}} embedded />); });
    await flush();
    expect(titles()).toEqual(["Zebra", "Alpha", "Mango"]);
  });
});
