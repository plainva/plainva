import { describe, expect, it } from "vitest";
import { attachmentFolderFor, pastedAttachmentName, resolveAttachmentPath, sanitizeAttachmentName, uniqueAttachmentPath } from "@plainva/ui";

const none = async () => false;
const taken = (...paths: string[]) => async (p: string) => paths.includes(p);

/**
 * Attachments used to land beside the note, which scatters them across every
 * folder that ever received one and leaves them behind when the note moves
 * (S17). One resolver now decides for both shells.
 */
describe("attachment paths", () => {
  it("uses the configured folder, not the note's", async () => {
    const path = await resolveAttachmentPath(
      { configuredFolder: "Attachments", noteFolder: "Projects/2026", fileName: "Screenshot.png", mime: "image/png" },
      none
    );
    expect(path).toBe("Attachments/Screenshot.png");
  });

  it("falls back to the note's folder when the setting is empty — the old behaviour, on purpose", () => {
    expect(attachmentFolderFor("", "Projects/2026")).toBe("Projects/2026");
    expect(attachmentFolderFor("  ", "")).toBe("");
  });

  it("numbers a collision instead of overwriting", async () => {
    // Two screenshots called Screenshot.png are two files; replacing the first
    // would destroy something the user cannot get back.
    const path = await uniqueAttachmentPath("Attachments", "Screenshot.png", taken("Attachments/Screenshot.png"));
    expect(path).toBe("Attachments/Screenshot-2.png");
    const third = await uniqueAttachmentPath("Attachments", "Screenshot.png", taken("Attachments/Screenshot.png", "Attachments/Screenshot-2.png"));
    expect(third).toBe("Attachments/Screenshot-3.png");
  });

  it("keeps a name inside its folder", () => {
    // A name from a drag or a share sheet is untrusted input.
    // The property matters, not the exact spelling: no separator survives and
    // no leading dot remains, so the name cannot climb out or hide.
    const escaped = sanitizeAttachmentName("../../etc/passwd");
    expect(escaped).not.toContain("/");
    expect(escaped).not.toContain(String.fromCharCode(92));
    expect(escaped.startsWith(".")).toBe(false);
    expect(sanitizeAttachmentName("sub/dir/file.png")).toBe("sub-dir-file.png");
    expect(sanitizeAttachmentName("   ")).toBe("");
  });

  it("names a pasted image that arrived without one", () => {
    const name = pastedAttachmentName("image/svg+xml", new Date(2026, 6, 28, 9, 5, 3));
    expect(name).toBe("Pasted-20260728-090503.svg");
    expect(pastedAttachmentName("", new Date(2026, 0, 1, 0, 0, 0))).toBe("Pasted-20260101-000000.png");
  });

  it("trims slashes off the configured folder so it cannot escape the vault", () => {
    expect(attachmentFolderFor("/Attachments/", "x")).toBe("Attachments");
  });
});
