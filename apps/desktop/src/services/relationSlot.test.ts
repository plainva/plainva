import { describe, expect, it } from "vitest";
import type { IVaultAdapter, VaultQueryService } from "@plainva/core";
import { wholeIndexReader } from "@plainva/core";
import { writeRelationLink } from "@plainva/ui";
import { shippedSources } from "../test-sourceTree";

/**
 * A new entry of an embedded database links itself into its host note
 * (upward scope). A limit-one slot that already holds a link is left alone —
 * and "already holds" was asked of the INDEX: where the index was behind the
 * note, or did not take the note's block at all (an empty `tags:`), it said
 * "empty", and the link the note carried was replaced without a word
 * (Sammelplan § 3.134 Nr. 1). The answer now comes from the text the write
 * is made to.
 */
function files(initial: Record<string, string>) {
  const disk = new Map(Object.entries(initial));
  const adapter = {
    readTextFile: async (p: string) => {
      const text = disk.get(p);
      if (text === undefined) throw new Error(`missing ${p}`);
      return text;
    },
    writeTextFile: async (p: string, text: string) => { disk.set(p, text); },
  } as unknown as IVaultAdapter;
  // The index knows the notes, and nothing of the host's properties.
  const queryService = wholeIndexReader({
    listNotes: async () => [...disk.keys()].map((path) => ({ path })),
    getFileProperties: async () => ({}),
  } as unknown as VaultQueryService);
  return { disk, adapter, queryService };
}

describe("linking a new entry into its host's single-value relation (§ 3.134 Nr. 1)", () => {
  it("leaves a link the host carries, though the index does not see its block", async () => {
    const host = "---\ntags:\nproject: \"[[Alpha]]\"\n---\n# Host\n";
    const { disk, adapter, queryService } = files({ "Host.md": host, "Alpha.md": "# Alpha\n", "New.md": "# New\n" });
    const linked = await writeRelationLink(adapter, queryService, "Host.md", "New.md", "project", true, { keepTaken: true });
    expect(linked).toBeNull();
    expect(disk.get("Host.md")).toBe(host);
  });

  it("fills an empty slot, and a missing one", async () => {
    for (const host of ["---\nproject:\n---\n# Host\n", "---\nstatus: open\n---\n# Host\n", "# Host\n"]) {
      const { disk, adapter, queryService } = files({ "Host.md": host, "New.md": "# New\n" });
      expect(await writeRelationLink(adapter, queryService, "Host.md", "New.md", "project", true, { keepTaken: true })).toBe("[[New]]");
      expect(disk.get("Host.md")).toContain("project: \"[[New]]\"");
    }
  });

  it("appends to a list relation whatever it holds", async () => {
    const { disk, adapter, queryService } = files({ "Host.md": "---\nitems:\n  - \"[[Alpha]]\"\n---\n", "Alpha.md": "", "New.md": "" });
    expect(await writeRelationLink(adapter, queryService, "Host.md", "New.md", "items", false, { keepTaken: true })).toBe("[[New]]");
    expect(disk.get("Host.md")).toContain("[[Alpha]]");
    expect(disk.get("Host.md")).toContain("[[New]]");
  });

  it("still replaces where the caller asked for it (the graph's connect, after its question)", async () => {
    const { disk, adapter, queryService } = files({ "Host.md": "---\nproject: \"[[Alpha]]\"\n---\n", "Alpha.md": "", "New.md": "" });
    expect(await writeRelationLink(adapter, queryService, "Host.md", "New.md", "project", true)).toBe("[[New]]");
    expect(disk.get("Host.md")).not.toContain("[[Alpha]]");
  });

  it("the database view does not ask the index whether the host's slot is taken", () => {
    const viewer = shippedSources().find((s) => s.rel === "apps/desktop/src/components/BaseViewer.tsx")!.text;
    const at = viewer.indexOf("const linkHostTo = async (");
    const body = viewer.slice(at, viewer.indexOf("\n  };\n", at));
    expect(body).not.toMatch(/getFileProperties/);
    expect(body).toMatch(/keepTaken: true/);
  });
});
