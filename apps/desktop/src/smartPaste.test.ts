import { describe, expect, it } from "vitest";
import { planPaste } from "@plainva/ui";

const file = (type: string, name = "x") => ({ type, name }) as unknown as File;

describe("what a paste means", () => {
  it("takes a file over anything else on the clipboard", () => {
    // A screenshot arrives WITH a text/plain fallback; the file wins.
    const plan = planPaste([file("image/png")], "https://example.com", { empty: true, text: "" });
    expect(plan.kind).toBe("file");
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

  it("takes a file of any type, not just images (issue #55)", () => {
    // This assertion used to say the opposite — it pinned the very restriction
    // the reporter ran into: copying a PDF in the file manager and pasting it
    // into a note did nothing at all. The drop path never had that limit and
    // has carried arbitrary files since P3.2, so the import behind it was
    // already proven; only the paste refused to hand anything over.
    const plan = planPaste([file("application/pdf", "Report.pdf")], "", { empty: true, text: "" });
    expect(plan).toEqual({ kind: "file", file: expect.objectContaining({ name: "Report.pdf" }) });
  });

  it("still wraps a selection when the clipboard holds no file", () => {
    // The guard for the change above: dropping the type filter must not let a
    // file-less clipboard fall past the link rule.
    const plan = planPaste([], "https://example.com", { empty: false, text: "docs" });
    expect(plan.kind).toBe("link");
  });
});
