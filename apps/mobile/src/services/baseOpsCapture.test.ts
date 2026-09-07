import { beforeEach, describe, expect, it, vi } from "vitest";

const saved: Array<{ path: string; content: string }> = [];
vi.mock("./vaultService", () => ({
  vaultOps: {
    save: async (_v: unknown, path: string, content: string) => {
      saved.push({ path, content });
    },
    read: async () => "",
  },
  noteSaver: { flush: async () => {} },
}));
vi.mock("./mobileSettings", () => ({ getMobileSettings: () => ({ defaultNoteType: "Note", attachmentFolder: "Attachments" }) }));
vi.mock("./syncService", () => ({ syncSoon: () => {} }));

import { captureBaseItem } from "./baseOps";

const fakeVault = (existing: string[] = []) =>
  ({ files: { exists: async (p: string) => existing.includes(p) } }) as any;

/** Build-91 feedback, P2: the pinboard's quick capture on a tag-sourced base. */
describe("captureBaseItem", () => {
  beforeEach(() => {
    saved.length = 0;
  });

  const zettel = {
    filters: { and: ['file.hasTag("zettel")'] },
    views: [{ type: "table", name: "Pinnwand", filters: { and: ['status == "offen"'] } }],
  };

  it("writes nothing and returns null when the base has no folder — the caller has to ask", async () => {
    expect(await captureBaseItem(fakeVault(), zettel, { title: "Probe", text: "Probe" })).toBeNull();
    expect(saved).toEqual([]);
  });

  it("with the answered folder it writes the note there, with the tag and the view's prefill", async () => {
    const path = await captureBaseItem(fakeVault(), zettel, { title: "Probe", text: "Probe" }, { folder: "Zettel", viewIndex: 0 });
    expect(path).toBe("Zettel/Probe.md");
    expect(saved).toHaveLength(1);
    expect(saved[0].content).toMatch(/tags:\n\s+- zettel/);
    expect(saved[0].content).toMatch(/status: offen/);
    expect(saved[0].content).toContain("# Probe");
  });

  it("a persisted newItemFolder answers the question for good", async () => {
    const path = await captureBaseItem(fakeVault(["Zettel/Probe.md"]), { ...zettel, newItemFolder: "Zettel" }, { title: "Probe", text: "" });
    expect(path).toBe("Zettel/Probe 2.md");
  });
});
