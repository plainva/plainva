import { afterAll, beforeEach, describe, it, expect } from "vitest";
import { ConflictError, OPEN_CONFLICT_MESSAGE, OpenConflictError, VaultFileExistsError, VaultFileNotFoundError, VaultPermissionDeniedError } from "@plainva/core";
import { errorText } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * The case that shipped: a string from the Tauri boundary, `.message` on it is
 * undefined, and the interpolation renders as nothing. Every assertion here is
 * really the same one — the result is never empty.
 */
describe("errorText", () => {
  it("returns the string a Tauri command rejected with", () => {
    // This is the shape that broke the delete message on issue #46: Rust
    // returns Err(String), the plugin rejects with it, `.message` is undefined.
    const fromTauri = "Operation not permitted (os error 1)";
    expect(errorText(fromTauri)).toBe(fromTauri);
    expect((fromTauri as unknown as { message?: string }).message).toBeUndefined();
  });

  it("returns the message of a real Error", () => {
    expect(errorText(new Error("disk is full"))).toBe("disk is full");
  });

  it("falls back to the Error name when the message is empty", () => {
    expect(errorText(new TypeError(""))).toBe("TypeError");
  });

  it("reads a message off a prototype-less object", () => {
    // Structured clone strips prototypes, so `instanceof Error` can be false
    // for something that is an error in every other respect.
    expect(errorText({ message: "rejected by the server" })).toBe("rejected by the server");
  });

  it("never renders an object as [object Object]", () => {
    expect(errorText({ code: 42 })).toBe("unknown error");
  });

  it("never returns an empty string", () => {
    // A blank reason is worse than an ugly one: it reads as if the app had
    // nothing to say, which is exactly how the bug looked on screen.
    for (const value of [null, undefined, "", "   ", {}, new Error("")]) {
      expect(errorText(value), `for ${JSON.stringify(value)}`).not.toBe("");
    }
  });

  it("trims surrounding whitespace", () => {
    expect(errorText("  path is a directory  ")).toBe("path is a directory");
  });
});

/**
 * The vault's own refusals are the reason of a write that did not land. They
 * reached the user in English with the vault path, or not at all (Sammelplan
 * § 3.135 no. 3: "File or directory already exists: Projects/index.md" under
 * an overview that could not be adopted; § 3.87 no. 1: the open conflict of a
 * database that could not be saved).
 */
describe("errorText: the vault's refusals in the user's words", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("an open conflict, as the error and as the text that crossed a window boundary", () => {
    const said = "The file has an open conflict. Resolve the conflict first, then try again.";
    expect(errorText(new OpenConflictError("Note.CONFLICT-1.md"))).toBe(said);
    expect(errorText(OPEN_CONFLICT_MESSAGE)).toBe(said);
    expect(errorText(new ConflictError("Resolve the open conflict before moving or deleting this file or folder", "x"))).toBe(said);
  });

  it("a refused, a taken and a vanished file, named by its name", () => {
    expect(errorText(new VaultPermissionDeniedError("Projects/Plan.md"))).toBe("No permission to change “Plan.md”.");
    expect(errorText(new VaultFileExistsError("Projects/index.md"))).toBe("“index.md” already exists.");
    expect(errorText(new VaultFileNotFoundError("Projects/Gone.md"))).toBe("“Gone.md” is no longer there.");
    // Across the window bus the error is its message.
    expect(errorText("File or directory already exists: Projects/index.md")).toBe("“index.md” already exists.");
  });

  it("speaks the user's language", async () => {
    await i18n.changeLanguage("de");
    expect(errorText(new VaultFileExistsError("Projects/index.md"))).toBe("„index.md“ ist schon vorhanden.");
    expect(errorText(new OpenConflictError())).toMatch(/offenen Konflikt/);
  });

  it("leaves every other text as it is", () => {
    expect(errorText("Permission denied (os error 13)")).toBe("Permission denied (os error 13)");
  });
});
