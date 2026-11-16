import { describe, expect, it } from "vitest";
import { eventColorVars, eventInk } from "@plainva/ui";

/** Plan Oberfläche O7, D15: the text on an appointment reads on its calendar's colour. */
describe("eventInk", () => {
  it("puts dark ink on a light turquoise and on yellow, light ink on dark colours", () => {
    expect(eventInk("#2dd4bf")).toBe("dark");
    expect(eventInk("#f6bf26")).toBe("dark");
    expect(eventInk("#1a73e8")).toBe("light");
    expect(eventInk("#0b8043")).toBe("light");
    expect(eventInk("#000")).toBe("light");
    expect(eventInk("#fff")).toBe("dark");
  });

  it("reads #rgb, #rrggbb, #rrggbbaa and rgb()", () => {
    expect(eventInk("#FFF")).toBe("dark");
    expect(eventInk("#1a73e8ff")).toBe("light");
    expect(eventInk("rgb(246, 191, 38)")).toBe("dark");
    expect(eventInk("rgb(26 115 232 / 100%)")).toBe("light");
  });

  it("lays a translucent colour over the ground first — the theme's own text where the grounds disagree (review O7, A1)", () => {
    expect(eventInk("rgba(0,0,0,0.1)")).toBe("text");
    expect(eventInk("#00000000")).toBe("text");
    expect(eventInk("#fff0")).toBe("text");
    // Nearly opaque, it is its colour: both grounds call for the same ink.
    expect(eventInk("#1a73e8f0")).toBe("light");
    expect(eventInk("rgba(246, 191, 38, 0.95)")).toBe("dark");
    expect(eventColorVars("rgba(0,0,0,0.1)")).toEqual({ "--evt-color": "rgba(0,0,0,0.1)", "--evt-ink": "var(--text-main)", "--evt-hatch": "var(--bg-primary)" });
  });

  it("leaves the accent pair where the fill is no literal colour", () => {
    expect(eventInk("var(--accent-color)")).toBeNull();
    expect(eventInk("teal")).toBeNull();
    expect(eventColorVars("var(--accent-color)")).toEqual({ "--evt-color": "var(--accent-color)" });
  });

  it("sets the calendar's colour and its ink together", () => {
    expect(eventColorVars("#2dd4bf")).toEqual({ "--evt-color": "#2dd4bf", "--evt-ink": "var(--evt-ink-dark)", "--evt-hatch": "var(--evt-hatch-dark-ink)" });
    expect(eventColorVars("#1a73e8")).toEqual({ "--evt-color": "#1a73e8", "--evt-ink": "var(--evt-ink-light)", "--evt-hatch": "var(--evt-hatch-light-ink)" });
  });
});
