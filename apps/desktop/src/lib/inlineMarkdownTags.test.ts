// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderInlineMarkdown } from "@plainva/ui";

/**
 * A tag inside a rendered table cell (finding 2026-09-19). The live editor
 * replaces a table by a widget with its own inline renderer; without this the
 * pill would stop at the table's edge.
 */
function render(text: string, onOpenTag?: (tag: string) => void): HTMLElement {
  const host = document.createElement("div");
  host.appendChild(renderInlineMarkdown(text, onOpenTag ? { onOpenTag } : {}));
  return host;
}

describe("tags in rendered cell content", () => {
  it("draws the pill the editor draws, the path quieter than the leaf", () => {
    const host = render("see #project/site and #idea, not #42");
    const pills = [...host.querySelectorAll<HTMLElement>(".pv-tag-pill")];
    expect(pills.map((pill) => pill.textContent)).toEqual(["#project/site", "#idea"]);
    expect(pills[0].getAttribute("data-tag")).toBe("project/site");
    expect(pills[0].getAttribute("data-tag-color")).toMatch(/^[1-7]$/);
    expect(pills[0].querySelector(".pv-tag-parent")?.textContent).toBe("#project/");
    // The cell's text is complete and in order.
    expect(host.textContent).toBe("see #project/site and #idea, not #42");
  });

  it("leaves code and links alone", () => {
    const host = render("`#code` [[Note|alias #alias]] [x](#heading)");
    expect(host.querySelectorAll(".pv-tag-pill")).toHaveLength(0);
  });

  it("opens the tag on a click and keeps the click from the cell editor", () => {
    const opened: string[] = [];
    const host = render("a #idea", (tag) => opened.push(tag));
    const pill = host.querySelector<HTMLElement>(".pv-tag-pill")!;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    let reachedHost = false;
    host.addEventListener("mousedown", () => { reachedHost = true; });
    pill.dispatchEvent(down);
    expect(reachedHost).toBe(false);
    pill.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(opened).toEqual(["idea"]);
  });

  it("is a look and nothing else without a handler: the cell editor keeps its mousedown", () => {
    const host = render("a #idea");
    let reachedHost = false;
    host.addEventListener("mousedown", () => { reachedHost = true; });
    host.querySelector(".pv-tag-pill")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    expect(reachedHost).toBe(true);
  });
});
