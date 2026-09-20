import { describe, expect, it } from "vitest";
import { formatListingReport } from "@plainva/ui";

/**
 * The diagnostics line of a full remote listing (finding 2026-09-20, plan A0).
 * What matters: the numbers of that day are all there, and nothing in the line
 * could be a file or folder name.
 */
describe("formatListingReport", () => {
  it("writes the counters of an incomplete first listing in one line", () => {
    const line = formatListingReport(
      {
        folders: 23, pages: 25, files: 168, ms: 5120, rootId: "1AbCdE",
        known: 1142, missing: 974, firstOfSession: true,
        worstFolders: [{ key: "a1b2c3", missing: 412 }, { key: "0f9e8d", missing: 388 }],
      },
      "drive",
    );
    expect(line).toBe(
      "listing drive: 168 files, 23 folders, 25 pages, 5120 ms, known 1142, missing 974, first listing of this session, root 1AbCdE, worst folders a1b2c3×412 0f9e8d×388",
    );
  });

  it("stays short for an ordinary listing and names no provider it was not given", () => {
    const line = formatListingReport(
      { folders: 0, pages: 0, files: 40, ms: 90, known: 40, missing: 0, firstOfSession: false, worstFolders: [] },
      null,
    );
    expect(line).toBe("listing remote: 40 files, 0 folders, 0 pages, 90 ms, known 40, missing 0");
  });
});
