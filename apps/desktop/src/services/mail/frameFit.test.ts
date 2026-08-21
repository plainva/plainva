import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyFrameFit, computeFrameFit, MIN_FRAME_SCALE } from "@plainva/ui/mail";

/**
 * The reported case: a newsletter built on a fixed 600px table, opened on a
 * phone. Before this the reader showed its left third and the rest was
 * unreachable — the page around the frame does not scroll sideways.
 */
describe("computeFrameFit", () => {
  it("shrinks a fixed-width newsletter to the frame it was given", () => {
    const fit = computeFrameFit({ frameWidth: 347, contentWidth: 600, contentHeight: 1200 });
    expect(fit.scale).toBeCloseTo(347 / 600, 5);
    // The height follows the scale, or the frame would keep empty space below.
    expect(fit.height).toBe(Math.ceil(1200 * (347 / 600)));
  });

  it("leaves content that already fits completely alone", () => {
    const fit = computeFrameFit({ frameWidth: 800, contentWidth: 640, contentHeight: 400 });
    expect(fit.scale).toBe(1);
    expect(fit.height).toBe(400);
  });

  it("stops shrinking where the text would stop being readable", () => {
    // 1600px into 347px would be 0.22 — roughly 3px type.
    const fit = computeFrameFit({ frameWidth: 347, contentWidth: 1600, contentHeight: 1000 });
    expect(fit.scale).toBe(MIN_FRAME_SCALE);
    expect(fit.height).toBe(Math.ceil(1000 * MIN_FRAME_SCALE));
  });

  it("treats a frame that has not been laid out yet as unknown, not as zero", () => {
    // Called before the first layout pass, clientWidth is 0. Scaling to 0
    // would blank the message; the next call (on load or resize) measures.
    const fit = computeFrameFit({ frameWidth: 0, contentWidth: 600, contentHeight: 800 });
    expect(fit.scale).toBe(1);
    expect(fit.height).toBe(800);
  });
});

describe("applyFrameFit", () => {
  it("scales the body and pins the frame's height to the scaled content", () => {
    const frame = fakeFrame({ frameWidth: 347, contentWidth: 600, contentHeight: 1200 });
    const fit = applyFrameFit(frame.el, { growHeight: true });

    expect(fit?.scale).toBeCloseTo(347 / 600, 5);
    expect(frame.body.style.transform).toBe(`scale(${347 / 600})`);
    expect(frame.body.style.transformOrigin).toBe("0 0");
    // Without pinning the width, the transform leaves the layout box at 600px
    // and the frame still offers a horizontal scroll over empty space.
    expect(frame.body.style.width).toBe("600px");
    expect(frame.root.style.overflowX).toBe("hidden");
    expect(frame.el.style.height).toBe(`${Math.ceil(1200 * (347 / 600))}px`);
  });

  it("measures the same numbers on a second call", () => {
    // The regression this guards: a scaled body still reports its full layout
    // width, but overflow-x:hidden clamps scrollWidth to the frame — measuring
    // on top of the previous result would report "it fits" and undo the fit.
    const frame = fakeFrame({ frameWidth: 347, contentWidth: 600, contentHeight: 1200 });
    const first = applyFrameFit(frame.el, { growHeight: true });
    const second = applyFrameFit(frame.el, { growHeight: true });
    expect(second).toEqual(first);
    expect(frame.body.style.transform).toBe(`scale(${347 / 600})`);
  });

  it("leaves the height alone when the shell scrolls the frame itself", () => {
    // The desktop frame fills its column; growing it would break the layout.
    const frame = fakeFrame({ frameWidth: 347, contentWidth: 600, contentHeight: 1200 });
    applyFrameFit(frame.el);
    expect(frame.el.style.height).toBe("");
    expect(frame.body.style.transform).toBe(`scale(${347 / 600})`);
  });

  it("returns null when the document cannot be reached", () => {
    // A frame that kept the opaque origin (sandbox="") — the fit is simply
    // not available, and the caller must not crash on it.
    const el = document.createElement("iframe");
    Object.defineProperty(el, "contentDocument", { get: () => null });
    expect(applyFrameFit(el, { growHeight: true })).toBeNull();
  });
});

/** jsdom does not lay anything out, so the measurements are stated. */
function fakeFrame(sizes: { frameWidth: number; contentWidth: number; contentHeight: number }) {
  const doc = document.implementation.createHTMLDocument("mail");
  const body = doc.body;
  const root = doc.documentElement;

  const measure = (el: HTMLElement, axis: "scrollWidth" | "scrollHeight") =>
    Object.defineProperty(el, axis, {
      get: () => {
        // What a real engine does once the fit is applied: the clamped axis
        // reports the frame's width, not the content's.
        if (axis === "scrollWidth") {
          return root.style.overflowX === "hidden" ? sizes.frameWidth : sizes.contentWidth;
        }
        return sizes.contentHeight;
      },
    });
  for (const el of [root, body]) {
    measure(el as HTMLElement, "scrollWidth");
    measure(el as HTMLElement, "scrollHeight");
  }

  const el = document.createElement("iframe");
  Object.defineProperty(el, "clientWidth", { get: () => sizes.frameWidth });
  Object.defineProperty(el, "contentDocument", { get: () => doc });
  return { el, doc, body: body as HTMLElement, root: root as HTMLElement };
}

/**
 * The security boundary of the whole mail viewer, in one line of markup.
 *
 * Measuring the message needs `allow-same-origin` — that is what lets the
 * parent reach `contentDocument`. It is safe ONLY as long as `allow-scripts`
 * stays out: with both together the sandbox is worthless, because the mail
 * HTML could then remove the sandbox attribute from its own frame. The
 * sanitiser and the frame's CSP are the other two layers; this is the one a
 * well-meant edit could undo without anything else turning red.
 */
describe("the mail frames stay script-free", () => {
  const FRAMES = [
    ["desktop viewer", "../../components/mail/MailView.tsx"],
    ["mobile reader", "../../../../mobile/src/screens/MailMessageScreen.tsx"],
  ] as const;

  for (const [name, rel] of FRAMES) {
    it(`${name}: same-origin to measure, never allow-scripts`, () => {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
      // Read the ATTRIBUTE, not the prose: both files explain in a comment
      // why allow-scripts must stay out, and a plain text search would trip
      // over the explanation instead of the markup.
      const values = [...src.matchAll(/sandbox="([^"]*)"/g)].map((m) => m[1]);
      expect(values).toEqual(["allow-same-origin"]);
      // The reach is only useful with a fit behind it; without this call the
      // attribute would be a widened sandbox buying nothing.
      expect(src).toContain("applyFrameFit");
    });
  }
});
