import { describe, expect, it } from "vitest";
import { buildEntryPeek } from "./entryPeek";

const rows = [
  { "file.path": "T/a.md", "file.name": "Alpha", status: "open" },
  { "file.path": "T/b.md", "file.name": "Beta", status: "done" },
  { "file.path": "T/c.md", "file.name": "Gamma", status: "open" },
];

describe("entry peek", () => {
  it("reads the position from the view, not from the vault", () => {
    const p = buildEntryPeek(rows, ["status"], "T/b.md")!;
    expect(p.index).toBe(2);
    expect(p.total).toBe(3);
    expect(p.title).toBe("Beta");
    expect(p.row.status).toBe("done");
  });

  it("has no neighbour past either end", () => {
    expect(buildEntryPeek(rows, [], "T/a.md")!.prevPath).toBeNull();
    expect(buildEntryPeek(rows, [], "T/a.md")!.nextPath).toBe("T/b.md");
    expect(buildEntryPeek(rows, [], "T/c.md")!.nextPath).toBeNull();
    expect(buildEntryPeek(rows, [], "T/c.md")!.prevPath).toBe("T/b.md");
  });

  it("returns nothing for a row this view does not show", () => {
    // A filter can exclude the entry while its sheet is open — showing the
    // neighbours of a row that is not there would be a lie.
    expect(buildEntryPeek(rows, [], "T/gone.md")).toBeNull();
  });
});
