import { describe, expect, it } from "vitest";
import { folderIndexState } from "@plainva/ui";

/**
 * The one question three surfaces ask (P6): what is this folder's overview?
 *
 * It lives in @plainva/ui because the folder sheet, the overviews list and the
 * read-only banner must not answer it differently — "manual" in particular is
 * the case where a wrong answer overwrites a note the user wrote.
 */

const MARKER = "<!-- plainva:index generated -->";

const adapterWith = (files: Record<string, string>) => ({
  readTextFile: async (path: string) => {
    const hit = files[path];
    if (hit === undefined) throw new Error(`ENOENT ${path}`);
    return hit;
  },
});

describe("folderIndexState", () => {
  it("reports a folder without index.md as missing", async () => {
    const adapter = adapterWith({ "Projects/A.md": "# A" });
    expect(await folderIndexState(adapter, "Projects")).toBe("missing");
  });

  it("reports a listing carrying the managed marker as ours", async () => {
    const adapter = adapterWith({ "Projects/index.md": `# Projects\n\n${MARKER}\n\n* [A](A.md)\n` });
    expect(await folderIndexState(adapter, "Projects")).toBe("managed");
  });

  it("reports an index.md WITHOUT the marker as the user's own", async () => {
    // The case that matters: nothing may offer to overwrite this in passing.
    const adapter = adapterWith({ "Projects/index.md": "# My own overview\n\nHand written.\n" });
    expect(await folderIndexState(adapter, "Projects")).toBe("manual");
  });

  it("asks about the vault root without a leading slash", async () => {
    const adapter = adapterWith({ "index.md": `# Vault\n\n${MARKER}\n` });
    expect(await folderIndexState(adapter, "")).toBe("managed");
  });
});
