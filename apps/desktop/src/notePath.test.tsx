// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NotePath } from "@plainva/ui";

/**
 * E3: the path clips at the FRONT, so the file name survives.
 *
 * The clipping itself is CSS and was measured in a real browser at 375 px
 * (folder shown as `3/Verwaltung/Anträge`, file complete, and a file name wider
 * than the row clipping at its end). What a unit test can pin is the SPLIT that
 * makes it possible — including the one detail that looks like a tidy-up and
 * would bring the bidi bug back: the separator belongs to the FILE part, so the
 * right-to-left folder run ends on a letter and has nothing to reorder.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function draw(el: React.ReactElement): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("NotePath", () => {
  it("puts the separator on the file part, not the folder part", () => {
    const el = draw(<NotePath path="Archiv/2026/Q3/Foerderung.md" />);
    expect(el.querySelector(".pv-notepath-dir")?.textContent).toBe("Archiv/2026/Q3");
    expect(el.querySelector(".pv-notepath-file")?.textContent).toBe("/Foerderung");
  });

  it("drops the extension every note has anyway", () => {
    expect(draw(<NotePath path="Notizen/Fahrplan.md" />).textContent).toBe("Notizen/Fahrplan");
  });

  it("keeps the extension when asked", () => {
    expect(draw(<NotePath path="Notizen/Fahrplan.md" stripExtension={false} />).textContent).toBe(
      "Notizen/Fahrplan.md",
    );
  });

  it("renders a note at the vault root without an empty folder part", () => {
    const el = draw(<NotePath path="Fahrplan.md" />);
    expect(el.querySelector(".pv-notepath-dir")).toBeNull();
    expect(el.textContent).toBe("Fahrplan");
  });

  it("keeps the full path reachable as a tooltip", () => {
    const el = draw(<NotePath path="Archiv/2026/Foerderung.md" />);
    expect(el.querySelector(".pv-notepath")?.getAttribute("data-tip")).toBe(
      "Archiv/2026/Foerderung.md",
    );
  });
});
