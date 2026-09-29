// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { IconButton, SearchField } from "@plainva/ui";
import { AppBar } from "./components/AppBar";

vi.mock("react-i18next", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useTranslation: () => ({ t: (k: string) => k }),
}));

const SRC = join(process.cwd(), "src");
const LOCALES = join(process.cwd(), "..", "..", "packages", "ui", "src", "locales");
const LANGS = ["de", "en", "es", "fr", "it", "ja", "nl", "pl", "pt-BR", "zh-CN"];

/**
 * The phone's search field takes its row (finding 2026-09-24, E19).
 *
 * The app bar gave its flexible share of the row only to a HEADING: a control
 * handed in through `titleAs` was rendered instead of the holder rather than
 * inside it, so it stayed as wide as its own content. The search page showed it
 * the day a sort button joined the bar — the field ended at about 60 % of the
 * width. The geometry itself is measured in the production bundle
 * (`e2e-prod/search-occurrences.spec.ts`); this pins the structure that makes
 * it true for every control that will ever sit in that slot.
 */
describe("app bar: a control in the title slot", () => {
  it("sits in the same flexible holder as a heading", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <AppBar
          onBack={() => {}}
          title="Search"
          titleAs={<SearchField clearLabel="Clear" onValueChange={() => {}} value="" />}
          actions={<IconButton label="Sort">S</IconButton>}
        />,
      );
    });
    try {
      const row = host.querySelector(".m-appbar-row")!;
      const holder = row.querySelector(":scope > .m-appbar-ttl");
      expect(holder, "the title slot must always be the flexible holder").not.toBeNull();
      expect(holder!.querySelector(".pv-searchfield")).not.toBeNull();
      // Back, holder, actions — nothing of the field is a direct child of the row.
      expect([...row.children].map((c) => c.className.split(" ")[0])).toEqual(["pv-iconbtn", "m-appbar-ttl", "m-headactions"]);
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
    }
  });

  it("gives the holder the row's free space", () => {
    const css = readFileSync(join(SRC, "mobile.css"), "utf8");
    const at = css.indexOf(".m-appbar-ttl {");
    const block = css.slice(at, css.indexOf("}", at));
    expect(block).toMatch(/flex:\s*1;/);
    expect(block).toMatch(/min-width:\s*0;/);
  });
});

describe("the search placeholder names searching first (E19)", () => {
  it.each(LANGS)("%s", (lang) => {
    const json = JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), "utf8"));
    const hint: string = json.search.hint;
    // It used to read "> tippen für Befehle": the field's main job was missing
    // from its own label.
    expect(hint.startsWith(json.sidebar.search), `${lang}: "${hint}" must open with "${json.sidebar.search}"`).toBe(true);
    expect(hint).toContain(">");
  });
});
