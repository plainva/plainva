import { describe, expect, it } from "vitest";
import type { EgressManifest } from "@plainva/core";
import { groundTitles } from "@plainva/ui";

const source = (path: string, title: string, extra: Partial<EgressManifest["sources"][number]> = {}) => ({ path, title, tier: "evidence" as const, chars: 10, reasons: [], ...extra });

/** Plan Oberfläche O7, M6: the calm line names what an answer rests on. */
describe("groundTitles", () => {
  it("names each note that went once, by its title, in the order of the overview — a picture is no note", () => {
    const manifest = { sources: [source("P/Website relaunch.md", "Website relaunch", { section: "Goals" }), source("P/Website relaunch.md", "Website relaunch", { section: "Pricing" }), source("img/shot.png", "shot.png", { image: { width: 1, height: 1, bytes: 1 } }), source("Areas/Roadmap.md", "Roadmap")] } as unknown as EgressManifest;
    expect(groundTitles({ sent: [], manifest })).toEqual(["Website relaunch", "Roadmap"]);
  });

  it("falls back to the file names of the run's paths where it kept no overview", () => {
    expect(groundTitles({ sent: ["Daily/2026-11-10.md", "Ideas.md"] })).toEqual(["2026-11-10", "Ideas"]);
  });

  it("is empty for a run that carried no note", () => {
    expect(groundTitles({ sent: [] })).toEqual([]);
  });
});
