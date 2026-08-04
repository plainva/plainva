import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { isImagePath } from "@plainva/ui";

/**
 * Attachments on the phone (S42).
 *
 * A photo inserted into a note was in the vault, synced and backed up — and
 * no screen would admit it existed, because the navigator listed `.md` and
 * `.base` and nothing else. These pin the two decisions that fix it: what the
 * listing shows, and what a tap does.
 */
const here = dirname(fileURLToPath(import.meta.url));
const service = readFileSync(join(here, "..", "services", "vaultService.ts"), "utf8");
const browse = readFileSync(join(here, "BrowseScreen.tsx"), "utf8");
const open = readFileSync(join(here, "..", "services", "openAttachment.ts"), "utf8");
const viewer = readFileSync(join(here, "ImageViewerScreen.tsx"), "utf8");

describe("attachments in the navigator", () => {
  it("lists everything that is not a note, a database or machinery", () => {
    // The filter is the whole feature: it must exclude .md/.base (they have
    // their own rows) and dot-files (.plainva is machinery, not content).
    expect(service).toContain("attachments");
    expect(service).toMatch(/!\/\\\.\(md\|base\)\$\/i\.test\(e\.name\)/);
    expect(service).toContain('!e.name.startsWith(".")');
  });

  it("asks the shared helper what an image is", () => {
    // Three copies of the same seven extensions existed before S42; the phone
    // must not become a fourth.
    expect(service).toContain("isImagePath(e.path)");
    expect(browse).toContain("a.isImage");
    for (const p of ["a.png", "b.JPEG", "c.webp", "d.svg", "e.avif"]) expect(isImagePath(p), p).toBe(true);
    for (const p of ["a.pdf", "b.md", "c.zip"]) expect(isImagePath(p), p).toBe(false);
  });

  it("opens an image itself and hands everything else to the system", () => {
    // A row that does nothing is worse than one that opens the OS — Plainva
    // has no viewer for a PDF and should not pretend otherwise.
    expect(open).toContain("if (isImage) openImage(path)");
    expect(open).toContain("shareVaultFile");
  });

  it("releases the image blob when the viewer closes", () => {
    // Without this a gallery of photos holds every one of them for the session.
    expect(viewer).toContain("URL.revokeObjectURL");
  });

  it("counts an attachment-only folder as non-empty", () => {
    // Otherwise a folder holding just images still offers "create a note",
    // claiming there is nothing there while showing rows.
    expect(browse).toContain("listing.attachments.length === 0 &&");
  });
});
