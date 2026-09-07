import { describe, expect, it } from "vitest";
import { dailyNotePathFor, existingDailyNoteDays, sanitizeDailyNoteFormat } from "@plainva/ui";

/** Build-91 feedback, P4: the daily-note rule both shells run. */
describe("dailyNotes (shared)", () => {
  const aug31 = new Date(2026, 7, 31);

  it("builds the path through the configured format — dots included", () => {
    expect(dailyNotePathFor(aug31, { folder: "Tagebuch", format: "YY.MM.DD" })).toBe("Tagebuch/26.08.31.md");
    expect(dailyNotePathFor(aug31, { folder: "Tagebuch/", format: "YYYY-MM-DD" })).toBe("Tagebuch/2026-08-31.md");
    // An empty folder is the vault root — no leading slash.
    expect(dailyNotePathFor(aug31, { folder: "", format: "" })).toBe("2026-08-31.md");
  });

  it("marks exactly the days whose expected note exists", async () => {
    const onDisk = new Set(["Tagebuch/26.08.31.md", "Tagebuch/26.09.02.md"]);
    const days = [aug31, new Date(2026, 8, 1), new Date(2026, 8, 2)];
    const marked = await existingDailyNoteDays(days, { folder: "Tagebuch", format: "YY.MM.DD" }, async (p) => onDisk.has(p));
    expect([...marked].sort()).toEqual(["2026-08-31", "2026-09-02"]);
  });

  it("an unreadable path counts as absent", async () => {
    const marked = await existingDailyNoteDays([aug31], { folder: "x", format: "YY.MM.DD" }, async () => {
      throw new Error("no access");
    });
    expect(marked.size).toBe(0);
  });

  it("the format keeps its dots and loses its slashes (E4)", () => {
    expect(sanitizeDailyNoteFormat("YY.MM.DD")).toBe("YY.MM.DD");
    expect(sanitizeDailyNoteFormat("YYYY/MM/DD")).toBe("YYYY-MM-DD");
    expect(sanitizeDailyNoteFormat("YYYY\\MM")).toBe("YYYY-MM");
  });
});
