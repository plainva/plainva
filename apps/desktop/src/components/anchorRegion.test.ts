import { describe, expect, it } from "vitest";
import { normalizeRegionRect, regionStyle, type RegionBox } from "@plainva/ui";
import { assertWorkspaceCommentAnchor } from "@plainva/core";

// A picture the reader can point at. Round numbers so the expected fractions in
// the tests are readable rather than derived.
const BOX: RegionBox = { left: 100, top: 50, width: 400, height: 200 };

describe("normalizeRegionRect", () => {
  it("turns two points on the screen into fractions of the picture", () => {
    // Fractions, not pixels: the same picture is drawn at another width in read
    // mode and a third on a phone (plan section 4).
    expect(normalizeRegionRect({ x: 200, y: 100 }, { x: 300, y: 150 }, BOX)).toEqual({
      x: 0.25,
      y: 0.25,
      w: 0.25,
      h: 0.25,
    });
  });

  it("does not care which corner the reader started in", () => {
    const forward = normalizeRegionRect({ x: 200, y: 100 }, { x: 300, y: 150 }, BOX);
    expect(normalizeRegionRect({ x: 300, y: 150 }, { x: 200, y: 100 }, BOX)).toEqual(forward);
  });

  it("keeps a drag that leaves the picture inside it", () => {
    // Sweeping past the edge is the normal way to mark something at the border;
    // the marking must still describe a place ON the picture.
    expect(normalizeRegionRect({ x: -400, y: -400 }, { x: 300, y: 150 }, BOX)).toEqual({
      x: 0,
      y: 0,
      w: 0.5,
      h: 0.5,
    });
    expect(normalizeRegionRect({ x: 300, y: 150 }, { x: 9999, y: 9999 }, BOX)).toEqual({
      x: 0.5,
      y: 0.5,
      w: 0.5,
      h: 0.5,
    });
  });

  it("refuses a slip of the hand, so the caller can fall back to the whole picture", () => {
    // Under six pixels is a click that wandered, not a region.
    expect(normalizeRegionRect({ x: 200, y: 100 }, { x: 204, y: 150 }, BOX)).toBeNull();
    expect(normalizeRegionRect({ x: 200, y: 100 }, { x: 300, y: 104 }, BOX)).toBeNull();
    expect(normalizeRegionRect({ x: 200, y: 100 }, { x: 200, y: 100 }, BOX)).toBeNull();
  });

  it("measures the slip AFTER clamping, not before", () => {
    // A drag that starts far off-screen and ends two pixels inside the picture
    // has marked two pixels. Measured on the raw points it would look like a
    // sweep of hundreds and pass.
    expect(normalizeRegionRect({ x: -500, y: -500 }, { x: 102, y: 150 }, BOX)).toBeNull();
  });

  it("refuses a picture that has not been laid out yet", () => {
    // getBoundingClientRect returns zeroes before layout; dividing by that would
    // produce Infinity and the protocol would reject the anchor.
    expect(normalizeRegionRect({ x: 0, y: 0 }, { x: 50, y: 50 }, { left: 0, top: 0, width: 0, height: 200 })).toBeNull();
    expect(normalizeRegionRect({ x: 0, y: 0 }, { x: 50, y: 50 }, { left: 0, top: 0, width: 400, height: 0 })).toBeNull();
  });

  it("trims the extent when rounding would push the marking off the picture", () => {
    // Four decimals can round both the corner and the width up, and the sum then
    // leaves the picture by a ten-thousandth - which the protocol rejects. The
    // corner is where the reader started, so the extent gives way.
    const big: RegionBox = { left: 0, top: 0, width: 20000, height: 20000 };
    const rect = normalizeRegionRect({ x: 1, y: 1 }, { x: 20000, y: 20000 }, big);
    expect(rect).toEqual({ x: 0.0001, y: 0.0001, w: 0.9999, h: 0.9999 });
    // The whole point of the trim: what the picker produces, the core accepts.
    expect(() =>
      assertWorkspaceCommentAnchor({
        markerId: "7f3a",
        quote: "x",
        before: "",
        after: "",
        approximateOffset: 0,
        display: { kind: "image", rect: rect ?? undefined },
      }),
    ).not.toThrow();
  });
});

describe("regionStyle", () => {
  it("writes percentages, so the marking rides a resize without measuring", () => {
    // Percentages resolve against the box around the picture; a pixel offset
    // would have to be recomputed on every zoom step.
    expect(regionStyle({ x: 0.25, y: 0.5, w: 0.125, h: 0.75 })).toEqual({
      left: "25%",
      top: "50%",
      width: "12.5%",
      height: "75%",
    });
  });
});
