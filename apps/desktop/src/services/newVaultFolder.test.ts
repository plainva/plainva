import { describe, expect, it } from "vitest";
import { writeNewVault, type NewVaultFolderPorts } from "./newVaultFolder";

/** A disk of folders and what was done to it. */
function ports(present: string[] = []): NewVaultFolderPorts & { removed: string[]; forgotten: string[]; made: Set<string> } {
  const made = new Set(present);
  const removed: string[] = [];
  const forgotten: string[] = [];
  return {
    made,
    removed,
    forgotten,
    exists: async (p) => made.has(p),
    remove: async (p) => { removed.push(p); made.delete(p); },
    forget: async (p) => { forgotten.push(p); },
  };
}

describe("writeNewVault (second review of O8: no half tour left behind)", () => {
  it("a write that fails in a folder this attempt made takes the folder and its app data with it", async () => {
    const io = ports();
    await expect(writeNewVault("/Docs/Plainva Tour", io, async () => {
      io.made.add("/Docs/Plainva Tour");
      throw new Error("disk full");
    })).rejects.toThrow("disk full");
    expect(io.removed).toEqual(["/Docs/Plainva Tour"]);
    expect(io.forgotten).toEqual(["/Docs/Plainva Tour"]);
  });

  it("a folder that was there before is never removed — it may be the person's", async () => {
    const io = ports(["/Docs/Picked"]);
    await expect(writeNewVault("/Docs/Picked", io, async () => { throw new Error("denied"); })).rejects.toThrow("denied");
    expect(io.removed).toEqual([]);
    expect(io.forgotten).toEqual([]);
  });

  it("a write that succeeds leaves everything as written", async () => {
    const io = ports();
    await writeNewVault("/Docs/Plainva Tour", io, async () => { io.made.add("/Docs/Plainva Tour"); });
    expect(io.removed).toEqual([]);
    expect(io.made.has("/Docs/Plainva Tour")).toBe(true);
  });

  it("a cleanup that fails itself does not hide the first error", async () => {
    const io = ports();
    io.remove = async () => { throw new Error("busy"); };
    await expect(writeNewVault("/Docs/T", io, async () => { io.made.add("/Docs/T"); throw new Error("disk full"); })).rejects.toThrow("disk full");
  });
});
