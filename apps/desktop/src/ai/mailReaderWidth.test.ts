// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyFrameFit, engineWidths, forgetMailReaderWidth, mailReaderWidth } from "@plainva/ui/mail";

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
});

describe("the reader's width", () => {
  it("follows every fit of a reader's frame: dragging the window or the column, turning the phone, a split view", () => {
    const el = frame(812);
    applyFrameFit(el, { reader: true });
    expect(mailReaderWidth()).toBe(812);
    // The column was dragged wider; the frame's resize fits it again.
    Object.defineProperty(el, "clientWidth", { configurable: true, get: () => 1240 });
    applyFrameFit(el, { reader: true });
    expect(mailReaderWidth()).toBe(1240);
    expect(engineWidths()).toEqual([343, 760, 1240]);
    // A phone turned to landscape, then a split view.
    Object.defineProperty(el, "clientWidth", { configurable: true, get: () => 684 });
    applyFrameFit(el, { growHeight: true, reader: true });
    expect(engineWidths()).toEqual([343, 684, 760]);
  });

  it("is not taken from a frame that is no reader's (the engine's own, the gate's)", () => {
    applyFrameFit(frame(900), { reader: true });
    applyFrameFit(frame(1500));
    expect(mailReaderWidth()).toBe(900);
  });

  it("is kept on the device: after a restart it holds before a reader opens again", () => {
    applyFrameFit(frame(1100), { reader: true });
    // A new run of the app: the memory is gone, the kept value stays.
    const kept = globalThis.localStorage.getItem("plainva.mailReaderWidth");
    forgetMailReaderWidth();
    globalThis.localStorage.setItem("plainva.mailReaderWidth", kept!);
    expect(mailReaderWidth()).toBe(1100);
  });

  it("is the window's width where no mail was ever shown on this device", () => {
    expect(globalThis.localStorage.getItem("plainva.mailReaderWidth")).toBeNull();
    expect(mailReaderWidth()).toBe(window.innerWidth);
  });

  it("is noted by both shells' readers at every fit", () => {
    for (const file of ["apps/desktop/src/components/mail/MailView.tsx", "apps/mobile/src/screens/MailMessageScreen.tsx"]) {
      const calls = readFileSync(resolve(ROOT, file), "utf8").match(/applyFrameFit\([^)]*\)/g) ?? [];
      expect(calls.length, file).toBeGreaterThan(0);
      for (const call of calls) expect(call, file).toContain("reader: true");
    }
  });
});
