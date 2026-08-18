import { describe, expect, it, vi } from "vitest";
import { isVaultPathLink, planRelativeLinkOpen, resolveRelativeTarget } from "@plainva/ui";

/**
 * Issue #61: a relative markdown link to an attachment used to fall into the
 * branch that creates a missing NOTE, so `../_resources/x.mp3` was written as
 * `../_resources/x.mp3.md` and hit the vault's path guard.
 *
 * The reporter's exact link is the first case here, because it carries all four
 * symptoms at once: percent-encoding, a `../` hop, a non-markdown extension and
 * a target that does not exist as an indexed note.
 */
describe("isVaultPathLink", () => {
  it("recognises the reporter's attachment link as a path, not a note name", () => {
    expect(isVaultPathLink("../_resources/6%20de%20mar.%2015.10.mp3")).toBe(true);
  });

  it("treats anything with a folder separator as a path", () => {
    expect(isVaultPathLink("img/shot.png")).toBe(true);
    expect(isVaultPathLink("../Areas/Health.md")).toBe(true);
    expect(isVaultPathLink("/Atlas/Idee.md")).toBe(true);
  });

  it("treats a non-markdown extension as a path even without a folder", () => {
    expect(isVaultPathLink("recording.mp3")).toBe(true);
    expect(isVaultPathLink("report.pdf")).toBe(true);
  });

  // A bare name keeps resolving through the index by title — that is how a
  // markdown link to a note has always worked here, and `.md` targets stay on
  // that path so an unresolved one can still offer to create the note.
  it("leaves bare note names and .md targets to the index lookup", () => {
    expect(isVaultPathLink("My Note")).toBe(false);
    expect(isVaultPathLink("Plan.md")).toBe(false);
    expect(isVaultPathLink("")).toBe(false);
  });

  it("ignores anything with a scheme", () => {
    expect(isVaultPathLink("https://example.org/a.pdf")).toBe(false);
    expect(isVaultPathLink("mailto:x@y.z")).toBe(false);
    expect(isVaultPathLink("wiki://Notiz")).toBe(false);
  });
});

describe("planRelativeLinkOpen", () => {
  const vault = (present: string[]) => vi.fn(async (p: string) => present.includes(p));

  it("opens the reporter's attachment once the path is resolved", async () => {
    // Joplin's layout: the note sits in a folder, the attachment one level up.
    const target = resolveRelativeTarget("Notizen/Reunião.md", "../_resources/6%20de%20mar.%2015.10.mp3");
    expect(target).toEqual({ kind: "file", path: "_resources/6 de mar. 15.10.mp3" });

    const exists = vault(["_resources/6 de mar. 15.10.mp3"]);
    await expect(planRelativeLinkOpen(target!, exists)).resolves.toEqual({
      action: "open",
      path: "_resources/6 de mar. 15.10.mp3",
    });
    // The `.md` that caused the guard error must never be asked for.
    expect(exists.mock.calls.flat()).not.toContain("_resources/6 de mar. 15.10.mp3.md");
  });

  it("reports a missing file instead of offering to create it", async () => {
    const target = resolveRelativeTarget("a/b/host.md", "../missing.pdf")!;
    await expect(planRelativeLinkOpen(target, vault([]))).resolves.toEqual({
      action: "notFound",
      path: "a/missing.pdf",
    });
  });

  it("prefers a folder's index.md and otherwise reveals the folder", async () => {
    const folder = resolveRelativeTarget("Efforts/index.md", "Plainva/")!;
    await expect(planRelativeLinkOpen(folder, vault(["Efforts/Plainva/index.md"]))).resolves.toEqual({
      action: "open",
      path: "Efforts/Plainva/index.md",
    });
    await expect(planRelativeLinkOpen(folder, vault([]))).resolves.toEqual({
      action: "revealFolder",
      path: "Efforts/Plainva",
    });
  });

  it("treats an adapter failure as not found rather than throwing", async () => {
    const target = resolveRelativeTarget("host.md", "sub/x.png")!;
    const exists = vi.fn(async () => { throw new Error("adapter down"); });
    await expect(planRelativeLinkOpen(target, exists)).resolves.toEqual({
      action: "notFound",
      path: "sub/x.png",
    });
  });
});
