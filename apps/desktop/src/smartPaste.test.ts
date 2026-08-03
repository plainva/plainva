import { describe, expect, it } from "vitest";
import { planPaste } from "@plainva/ui";

const file = (type: string, name = "x") => ({ type, name }) as unknown as File;

describe("what a paste means", () => {
  it("takes an image over anything else on the clipboard", () => {
    // A screenshot arrives WITH a text/plain fallback; the image wins.
    const plan = planPaste([file("image/png")], "https://example.com", { empty: true, text: "" });
    expect(plan.kind).toBe("image");
  });

  it("wraps a selection in a pasted bare URL", () => {
    const plan = planPaste([], " https://example.com/a?b=1 ", { empty: false, text: "the docs" });
    expect(plan).toEqual({ kind: "link", insert: "[the docs](https://example.com/a?b=1)" });
  });

  it("leaves a URL alone when nothing is selected", () => {
    // Pasting a link into empty space means pasting a link, not making one.
    expect(planPaste([], "https://example.com", { empty: true, text: "" }).kind).toBe("default");
  });

  it("does not treat prose containing a URL as a link paste", () => {
    const plan = planPaste([], "see https://example.com for more", { empty: false, text: "x" });
    expect(plan.kind).toBe("default");
  });

  it("ignores non-image files", () => {
    expect(planPaste([file("application/pdf")], "", { empty: true, text: "" }).kind).toBe("default");
  });
});
