import { describe, it, expect } from "vitest";
import { errorText } from "@plainva/ui";

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
