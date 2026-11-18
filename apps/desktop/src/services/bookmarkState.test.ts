import { describe, expect, it } from "vitest";
import { setBookmarkOnDisk, type BookmarksIO } from "@plainva/ui";

/**
 * Another window asks for the star's state, not for a toggle (review
 * 2026-11-17): a try that arrives twice sets it once, and the next click asks
 * for the other state.
 */
function disk(): BookmarksIO & { text: string | null } {
  const io = {
    text: null as string | null,
    async readTextFile() {
      if (io.text === null) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return io.text;
    },
    async writeTextFile(_path: string, content: string) {
      io.text = content;
    },
  };
  return io;
}

describe("the star set to a state", () => {
  it("lands once when the same request comes twice", async () => {
    const io = disk();
    await setBookmarkOnDisk(io, "A.md", true);
    expect(await setBookmarkOnDisk(io, "A.md", true)).toEqual([{ path: "A.md", type: "file" }]);
  });

  it("is taken off by the next click, which asks for the other state", async () => {
    const io = disk();
    await setBookmarkOnDisk(io, "A.md", true);
    expect(await setBookmarkOnDisk(io, "A.md", false)).toEqual([]);
    expect(await setBookmarkOnDisk(io, "A.md", false)).toEqual([]);
  });
});
