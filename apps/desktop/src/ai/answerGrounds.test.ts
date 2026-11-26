import { describe, expect, it } from "vitest";
import { type AnswerGrounding, type EgressManifest, type RunMeta } from "@plainva/core/ai";
import { answerLinksShown, conversationGrounding, groundTitles, unfoundedAmongShown } from "@plainva/ui/ai";

const unfoundedNoteCitations = (answer: string, grounding: AnswerGrounding) => unfoundedAmongShown(answerLinksShown(answer), grounding);

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

/** Review O7, R1: what the model had is what the whole conversation sent and read by then, not what one run packed. */
describe("conversationGrounding", () => {
  const run = (over: Partial<RunMeta>) => ({ sent: [], kept: [], ...over }) as unknown as RunMeta;
  const runs = [
    run({ sent: ["Projects/Website relaunch.md"], manifest: { sources: [source("Projects/Website relaunch.md", "Relaunch plan")] } as unknown as EgressManifest }),
    run({ sent: ["Areas/Roadmap.md"], read: ["Ideas.md"] }),
    run({ sent: ["Later.md"] }),
  ];

  it("a follow-up that cites a note of the first turn cites a note the model had", async () => {
    const grounding = conversationGrounding(runs, 1);
    expect(await unfoundedNoteCitations("As said [[Website relaunch]], see [[Relaunch plan]], [[Ideas]] and [[Roadmap]].", grounding)).toEqual([]);
  });

  it("counts no run after the one asked about", async () => {
    expect(await unfoundedNoteCitations("[[Later]]", conversationGrounding(runs, 1))).toEqual(["Later"]);
  });

  it("a run whose request reached no model still counts: its context goes with the next request (review O7, second round)", async () => {
    const unreached = [run({ sent: ["Ghost.md"], unreached: true }), run({ sent: [] })];
    expect(await unfoundedNoteCitations("[[Ghost]]", conversationGrounding(unreached, 1))).toEqual([]);
  });

  it("one run that read more than it listed makes the rest unknown", () => {
    expect(conversationGrounding([run({ readMore: true }), run({})], 1).readMore).toBe(true);
  });
});
