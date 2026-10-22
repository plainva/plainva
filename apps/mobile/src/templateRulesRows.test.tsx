// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// One translation object for the file: a new `t` per render makes a screen
// whose load depends on it run again and again.
const translation = vi.hoisted(() => ({ value: null as null | { t: (key: string) => string; i18n: { language: string } } }));
vi.mock("react-i18next", async () => {
  const data = (await import("../../../packages/ui/src/locales/en.json")).default;
  const lookup = (key: string): unknown => key.split(".").reduce<unknown>((obj, k) => (obj as Record<string, unknown>)?.[k], data);
  translation.value = { t: (key: string) => { const v = lookup(key); return typeof v === "string" ? v : key; }, i18n: { language: "en" } };
  return { initReactI18next: { type: "3rdParty", init() {} }, useTranslation: () => translation.value };
});

import { TemplateRules } from "./components/TemplateRules";

/**
 * The rows that add a template rule on the phone (Sammelplan § 3.97, Nr. 5).
 *
 * Their label carries its own plus ("＋ Folder template" in every language),
 * because the desktop shows it on a button without an icon. The phone's row put
 * a Plus icon in front of that label as well, so it read "+ ＋ Folder template".
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the rows that add a template rule", () => {
  it("show one plus each — the one in their label", async () => {
    const settings = { folderTemplates: [], typeTemplates: [], templateFolder: "Templates" } as never;
    await act(async () => {
      root.render(<TemplateRules settings={settings} onChange={() => {}} vault={{} as never} />);
    });
    const rows = [...container.querySelectorAll<HTMLElement>(".pv-grouprow")].filter((row) => /template/i.test(row.textContent ?? ""));
    expect(rows.map((row) => row.textContent?.trim())).toEqual(["＋ Folder template", "＋ Type template"]);
    for (const row of rows) {
      expect(row.querySelector(".pv-grouprow-icon"), `${row.textContent}: an icon beside a label that has its plus`).toBeNull();
      expect(row.querySelector("svg")).toBeNull();
    }
  });
});
