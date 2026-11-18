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
    expect(eventInk("#0b8043f0")).toBe("light");
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

  // Review O7, second round: a grey half over white read 3.4:1 with the light theme's text.
  it("the text reaches 4.5:1 on every ground of both themes, on any translucent fill", () => {
    const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]!) + 0.7152 * lin(rgb[1]!) + 0.0722 * lin(rgb[2]!);
    const lin = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const themes = [
      { grounds: [[255, 255, 255], [0xef, 0xf5, 0xf4]], text: [0x1b, 0x2b, 0x29] },
      { grounds: [[0x0f, 0x1c, 0x1b], [0x15, 0x26, 0x25]], text: [0xd7, 0xe4, 0xe2] },
    ];
    const inks: Record<string, (text: number[]) => number[]> = { "var(--evt-ink-light)": () => [255, 255, 255], "var(--evt-ink-dark)": () => [0x10, 0x20, 0x1e], "var(--text-main)": (text) => text };
    const rgba = (color: string) => {
      const m = /^rgba\((\d+), ?(\d+), ?(\d+), ?([\d.]+)\)$/.exec(color.replace(/\s+/g, " "))!;
      return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    };
    for (const fill of ["rgba(0,0,0,0.5)", "rgba(128,128,128,0.9)", "rgba(255,0,0,0.6)", "rgba(3,155,229,0.3)", "rgba(255,255,255,0.5)", "rgba(0,0,0,0.3)", "rgba(80,80,80,0.7)"]) {
      const vars = eventColorVars(fill) as Record<string, string>;
      // The colour of the calendar stays as given; the fill the ink stands on may be fainter.
      expect(vars["--evt-color"]).toBe(fill);
      const [r, g, b, a] = rgba(vars["--evt-fill"] ?? fill);
      for (const theme of themes) {
        for (const ground of theme.grounds) {
          const shown = ground.map((v, i) => [r, g, b][i]! * a! + v * (1 - a!));
          expect(ratio(lum(shown), lum(inks[vars["--evt-ink"]!]!(theme.text))), `${fill} on ${ground.join(",")}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
    // A fill that reads already keeps its strength.
    expect(eventColorVars("rgba(0,0,0,0.1)")["--evt-fill" as never]).toBeUndefined();
  });
});
