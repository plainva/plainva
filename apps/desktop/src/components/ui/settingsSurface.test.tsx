// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  SETTINGS_AREAS,
  settingsAreas,
  settingsArea,
  firstSettingsArea,
  SettingsPageHead,
  SettingCard,
  SettingRow,
  SettingCardNote,
} from "@plainva/ui";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function render(el: ReactElement) {
  act(() => root.render(el));
}

describe("settingsCatalog (shared area catalog, redesign P1)", () => {
  it("carries five app areas and seven vault areas with unique ids", () => {
    expect(settingsAreas("app").map((a) => a.id)).toEqual(["appearance", "editor", "behavior", "updates", "about"]);
    expect(settingsAreas("vault").map((a) => a.id)).toEqual(["cloudAccounts", "sync", "security", "pim", "mail", "content", "backup", "maintenance"]);
    const ids = SETTINGS_AREAS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every area has a label key, a page-description key and an icon", () => {
    for (const a of SETTINGS_AREAS) {
      expect(a.labelKey).toMatch(/^settings\./);
      expect(a.descKey).toMatch(/^settings\.pageDesc/);
      expect(a.icon).toBeTruthy();
    }
  });

  it("looks up areas by id and yields the world's first area as landing page", () => {
    expect(settingsArea("backup")?.world).toBe("vault");
    expect(settingsArea("nope")).toBeUndefined();
    expect(firstSettingsArea("app").id).toBe("appearance");
    expect(firstSettingsArea("vault").id).toBe("cloudAccounts");
  });
});

describe("settings surface primitives (quiet cards, redesign P1)", () => {
  it("SettingsPageHead renders the title as a heading plus the description", () => {
    render(<SettingsPageHead title="Erscheinungsbild" desc="Theme und Sprache." />);
    const h = container.querySelector("h3.pv-setpage-title");
    expect(h?.textContent).toBe("Erscheinungsbild");
    expect(container.querySelector(".pv-setpage-desc")?.textContent).toBe("Theme und Sprache.");
  });

  it("SettingCard renders the group label above a labelled group container", () => {
    render(
      <SettingCard label="Design">
        <SettingRow label="Modus" />
      </SettingCard>
    );
    expect(container.querySelector(".pv-setgroup-label")?.textContent).toBe("Design");
    const card = container.querySelector(".pv-setcard");
    expect(card?.getAttribute("role")).toBe("group");
    expect(card?.getAttribute("aria-label")).toBe("Design");
  });

  it("SettingRow shows label/desc and stacks wide rows via the modifier class", () => {
    render(
      <SettingCard label="G">
        <SettingRow label="Sprache" desc="App-Sprache." >
          <select aria-label="Sprache" />
        </SettingRow>
        <SettingRow label="Theme" wide>
          <div data-testid="wide-control" />
        </SettingRow>
      </SettingCard>
    );
    const rows = container.querySelectorAll(".pv-setrow");
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector(".pv-setrow-label")?.textContent).toBe("Sprache");
    expect(rows[0].querySelector(".pv-setrow-desc")?.textContent).toBe("App-Sprache.");
    expect(rows[0].classList.contains("pv-setrow--wide")).toBe(false);
    expect(rows[1].classList.contains("pv-setrow--wide")).toBe(true);
    // A row without children renders no empty control shell.
    render(<SettingRow label="Nur Anzeige" />);
    expect(container.querySelector(".pv-setrow-ctrl")).toBeNull();
  });

  it("SettingCardNote renders a free-form note block inside the card", () => {
    render(
      <SettingCard label="Diagnose">
        <SettingCardNote>Keine Messwerte.</SettingCardNote>
      </SettingCard>
    );
    const note = container.querySelector(".pv-setrow--note");
    expect(note?.textContent).toBe("Keine Messwerte.");
  });
});
