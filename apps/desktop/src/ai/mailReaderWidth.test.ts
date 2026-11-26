// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyFrameFit, engineWidths, forgetMailReaderWidth, mailReaderWidth, mailReaderWidths, noteMailReaderWidth, READER_WIDTHS_MEASURED } from "@plainva/ui/mail";

/**
 * The width the assistant measures a mail at besides 343 and 760 px (B7, review S2): the width this device's reader
 * shows a mail in — following every fit of the reader's frame, on every resize — and, where no mail was ever shown on
 * this device, the window's width.
 */
const ROOT = resolve(__dirname, "../../../..");

/** A reader's frame of `width` CSS pixels, as the shells fit it. */
function frame(width: number): HTMLIFrameElement {
  const el = document.createElement("iframe");
  document.body.append(el);
  el.contentDocument!.body.innerHTML = "<p>A mail</p>";
  Object.defineProperty(el, "clientWidth", { configurable: true, get: () => width });
  return el;
}

afterEach(() => {
  forgetMailReaderWidth();
  document.body.innerHTML = "";
  vi.useRealTimers();
});
const KEY = "plainva.mailReaderWidths";
/** Only the readers on screen count: what is kept on the device is cleared. */
const forgetKeptOnly = () => globalThis.localStorage.removeItem(KEY);

describe("the reader's width", () => {
  it("follows every fit of a reader's frame: dragging the window or the column, turning the phone, a split view", () => {
    const el = frame(812);
    applyFrameFit(el, { reader: true });
    expect(mailReaderWidth()).toBe(812);
    // The column was dragged wider; the frame's resize fits it again.
    Object.defineProperty(el, "clientWidth", { configurable: true, get: () => 1240 });
    applyFrameFit(el, { reader: true });
    expect(mailReaderWidth()).toBe(1240);
    // The width it had before is kept as one of this device's: a reader may show it again.
    expect(engineWidths()).toEqual([343, 760, 812, 1240]);
    // A phone turned to landscape, then a split view.
    Object.defineProperty(el, "clientWidth", { configurable: true, get: () => 684 });
    applyFrameFit(el, { growHeight: true, reader: true });
    expect(mailReaderWidth()).toBe(684);
    expect(engineWidths()).toEqual([343, 684, 760, 812, 1240]);
  });

  it("is not taken from a frame that is no reader's (the engine's own, the gate's)", () => {
    applyFrameFit(frame(900), { reader: true });
    applyFrameFit(frame(1500));
    expect(mailReaderWidth()).toBe(900);
  });

  it("is kept on the device: after a restart it holds before a reader opens again", () => {
    applyFrameFit(frame(1100), { reader: true });
    // A new run of the app: the readers on screen are gone, the kept value stays.
    const kept = globalThis.localStorage.getItem(KEY);
    forgetMailReaderWidth();
    document.body.innerHTML = "";
    globalThis.localStorage.setItem(KEY, kept!);
    expect(mailReaderWidth()).toBe(1100);
  });

  it("is the window's width where no mail was ever shown on this device", () => {
    expect(globalThis.localStorage.getItem(KEY)).toBeNull();
    expect(mailReaderWidth()).toBe(window.innerWidth);
  });

  it("counts every reader on screen, not only the one fitted last: two mail panes side by side (H13)", () => {
    const left = frame(520);
    const right = frame(980);
    applyFrameFit(left, { reader: true });
    applyFrameFit(right, { reader: true });
    forgetKeptOnly();
    expect(mailReaderWidths().sort((a, b) => a - b)).toEqual([520, 980]);
    // A pane closed: its frame left the document, its width counts no more as one on screen.
    left.remove();
    expect(mailReaderWidths()).toEqual([980]);
  });

  it("takes what another window of the app kept, read anew each time (H13)", () => {
    applyFrameFit(frame(700), { reader: true });
    // Another window's reader fitted a mail meanwhile: it wrote into the device's list.
    const list = JSON.parse(globalThis.localStorage.getItem(KEY)!) as Array<{ width: number; at: number }>;
    globalThis.localStorage.setItem(KEY, JSON.stringify([{ width: 1500, at: Date.now() }, ...list]));
    expect(mailReaderWidths()).toEqual([700, 1500]);
  });

  it("measures at most a few widths, the readers on screen first", () => {
    for (const width of [300, 400, 500, 600, 700]) noteMailReaderWidth(width);
    const shown = frame(1800);
    applyFrameFit(shown, { reader: true });
    expect(mailReaderWidths()).toHaveLength(READER_WIDTHS_MEASURED);
    expect(mailReaderWidths()[0]).toBe(1800);
    expect(engineWidths()).toHaveLength(2 + READER_WIDTHS_MEASURED);
  });

  it("takes no width below 200 or above 4000 px: a frame not laid out yet, or a wrong number (W4)", () => {
    for (const width of [0, 199, 4001, Number.NaN, Number.POSITIVE_INFINITY]) noteMailReaderWidth(width);
    expect(globalThis.localStorage.getItem(KEY)).toBeNull();
    noteMailReaderWidth(200);
    noteMailReaderWidth(4000);
    expect(mailReaderWidths().sort((a, b) => a - b)).toEqual([200, 4000]);
    // Nor what a kept list says beyond them.
    globalThis.localStorage.setItem(KEY, JSON.stringify([{ width: 150, at: Date.now() }, { width: 5000, at: Date.now() }]));
    expect(mailReaderWidths()).toEqual([window.innerWidth]);
  });

  it("lets a kept width go after 30 days without a reader in it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T09:00:00Z"));
    noteMailReaderWidth(900);
    vi.setSystemTime(new Date("2026-11-30T09:00:00Z"));
    expect(mailReaderWidths()).toEqual([900]);
    vi.setSystemTime(new Date("2026-12-02T09:00:00Z"));
    expect(mailReaderWidths()).toEqual([window.innerWidth]);
  });

  it("is noted by both shells' readers at every fit", () => {
    for (const file of ["apps/desktop/src/components/mail/MailView.tsx", "apps/mobile/src/screens/MailMessageScreen.tsx"]) {
      const calls = readFileSync(resolve(ROOT, file), "utf8").match(/applyFrameFit\([^)]*\)/g) ?? [];
      expect(calls.length, file).toBeGreaterThan(0);
      for (const call of calls) expect(call, file).toContain("reader: true");
    }
  });
});
