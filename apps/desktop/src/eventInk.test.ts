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
    expect(eventInk("rgba(26,115,232,0.5)")).toBe("light");
  });

  it("leaves the accent pair where the fill is no literal colour", () => {
    expect(eventInk("var(--accent-color)")).toBeNull();
    expect(eventInk("teal")).toBeNull();
    expect(eventColorVars("var(--accent-color)")).toEqual({ "--evt-color": "var(--accent-color)" });
  });

  it("sets the calendar's colour and its ink together", () => {
    expect(eventColorVars("#2dd4bf")).toEqual({ "--evt-color": "#2dd4bf", "--evt-ink": "var(--evt-ink-dark)" });
  });
});
