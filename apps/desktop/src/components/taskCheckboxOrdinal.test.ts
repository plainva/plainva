// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { taskCheckboxOrdinal } from "./MarkdownReader";

/**
 * Regression for the read-mode checkbox off-by-one: clicking the first box
 * toggled the second because a render-time counter drifted under StrictMode.
 * The ordinal is now read from the DOM at click time.
 */
function reader(html: string): HTMLElement {
  const div = document.createElement("div");
  div.className = "markdown-reader";
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

describe("taskCheckboxOrdinal", () => {
  it("returns the visual position of each checkbox (first -> 0, not 1)", () => {
    const root = reader(`
      <ul>
        <li><input type="checkbox"> A</li>
        <li><input type="checkbox"> B</li>
        <li><input type="checkbox"> C</li>
      </ul>`);
    const boxes = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(taskCheckboxOrdinal(boxes[0])).toBe(0);
    expect(taskCheckboxOrdinal(boxes[1])).toBe(1);
    expect(taskCheckboxOrdinal(boxes[2])).toBe(2);
  });

  it("does not count checkboxes from an embedded (nested) reader", () => {
    const root = reader(`
      <input type="checkbox" id="own0">
      <div class="markdown-reader">
        <input type="checkbox" id="embed0">
        <input type="checkbox" id="embed1">
      </div>
      <input type="checkbox" id="own1">`);
    const own0 = root.querySelector<HTMLInputElement>("#own0")!;
    const own1 = root.querySelector<HTMLInputElement>("#own1")!;
    const embed1 = root.querySelector<HTMLInputElement>("#embed1")!;
    // The outer note's two boxes are 0 and 1; the two embed boxes are skipped.
    expect(taskCheckboxOrdinal(own0)).toBe(0);
    expect(taskCheckboxOrdinal(own1)).toBe(1);
    // A box inside the embed counts within its OWN reader (0-based there).
    expect(taskCheckboxOrdinal(embed1)).toBe(1);
  });
});
