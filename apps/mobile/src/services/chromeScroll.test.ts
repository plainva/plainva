import { beforeEach, describe, expect, it } from "vitest";
import { chromeScrollPublisher, getChromeScroll, noteChromeTucked, resetChromeScroll, scrolledToEnd } from "./chromeScroll";

describe("reader chrome movement", () => {
  beforeEach(resetChromeScroll);
  it("accumulates small downward moves, returns on the first upward move, and clamps overscroll", () => {
    const publish = chromeScrollPublisher("reader");
    for (let top = 0; top <= 80; top += 2) publish(top);
    expect(getChromeScroll()).toMatchObject({ scrolled: true, away: true, source: "reader" });
    publish(79); expect(getChromeScroll().away).toBe(false);
    publish(-30); expect(getChromeScroll()).toMatchObject({ scrolled: false, away: false, source: "reader" });
  });
  it("restores a saved position without hiding navigation and identifies the actual scroller", () => {
    const reader = chromeScrollPublisher("reader"); reader(900, true); reader(900);
    expect(getChromeScroll().away).toBe(false);
    reader(928); expect(getChromeScroll().away).toBe(true);
    chromeScrollPublisher("navigator")(120);
    expect(getChromeScroll().source).toBe("navigator");
  });
});

describe("bars that make room (wishes 2026-10-25, W3/F8)", () => {
  beforeEach(resetChromeScroll);
  it("brings the chrome back at the end of a list, even while still moving down", () => {
    const publish = chromeScrollPublisher("list");
    for (let top = 0; top <= 200; top += 4) publish(top);
    expect(getChromeScroll().away).toBe(true);
    publish(204, false, true);
    expect(getChromeScroll().away).toBe(false);
  });
  it("dates an upward move, once per quarter second", () => {
    let now = 1000;
    const publish = chromeScrollPublisher("reader", () => now);
    publish(300); expect(getChromeScroll().upAt).toBeUndefined();
    publish(290); expect(getChromeScroll().upAt).toBe(1000);
    now = 1100; publish(280); expect(getChromeScroll().upAt).toBe(1000);
    now = 1300; publish(270); expect(getChromeScroll().upAt).toBe(1300);
    // A restored position is not a move of the reader's.
    now = 2000; publish(100, true); expect(getChromeScroll().upAt).toBe(1300);
  });
  it("knows when the last pixel is in view", () => {
    expect(scrolledToEnd({ scrollTop: 592, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(scrolledToEnd({ scrollTop: 500, scrollHeight: 1000, clientHeight: 400 })).toBe(false);
    // A page that does not scroll has no end to reach.
    expect(scrolledToEnd({ scrollTop: 0, scrollHeight: 400, clientHeight: 400 })).toBe(false);
  });
  it("tucks the note's bar away only while writing with the keyboard up, until the text is pulled down", () => {
    const base = { editing: true, enabled: true, keyboard: true, keyboardAt: 1000, active: true, blocked: false, scroll: { scrolled: true, away: false, upAt: 900 } };
    expect(noteChromeTucked(base)).toBe(true);
    expect(noteChromeTucked({ ...base, editing: false })).toBe(false);
    expect(noteChromeTucked({ ...base, keyboard: false })).toBe(false);
    expect(noteChromeTucked({ ...base, enabled: false })).toBe(false);
    expect(noteChromeTucked({ ...base, blocked: true })).toBe(false);
    // Pulled down after the keyboard came: back.
    expect(noteChromeTucked({ ...base, scroll: { scrolled: true, away: false, upAt: 1200 } })).toBe(false);
    // ...and away again once the text runs on downwards.
    expect(noteChromeTucked({ ...base, scroll: { scrolled: true, away: true, upAt: 1200 } })).toBe(true);
  });
});
