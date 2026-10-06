// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GrowingField,
  TextArea,
  TextInput,
  isSpellcheckOn,
  resetSpellcheckForTests,
  setSpellcheckOn,
  spellcheckAttr,
  spellcheckFor,
  subscribeSpellcheck,
  wantsSystemTextMenu,
  type WritingPurpose,
} from "@plainva/ui";

/**
 * Spell checking: one switch, one rule (plan Befunde 2026-10-06, E3).
 *
 * What is tested is what the app decides - which fields carry
 * `spellcheck="true"` and when. The squiggles are drawn by the system's
 * checker inside the WebView; no suite can see them, and none pretends to.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PURPOSES: WritingPurpose[] = ["prose", "code", "secret", "search", "name", "address", "number"];

afterEach(() => resetSpellcheckForTests());

describe("the rule", () => {
  it("is off by default", () => {
    expect(isSpellcheckOn()).toBe(false);
    for (const purpose of PURPOSES) expect(spellcheckFor(purpose), purpose).toBe(false);
  });

  it("checks prose and nothing else when the switch is on", () => {
    setSpellcheckOn(true);
    for (const purpose of PURPOSES) {
      expect(spellcheckFor(purpose), purpose).toBe(purpose === "prose");
      expect(spellcheckAttr(purpose), purpose).toBe(purpose === "prose" ? "true" : "false");
    }
  });

  it("tells its listeners about a change, once, and not about a repeat", () => {
    const listener = vi.fn();
    const stop = subscribeSpellcheck(listener);
    setSpellcheckOn(true);
    setSpellcheckOn(true);
    expect(listener).toHaveBeenCalledTimes(1);
    setSpellcheckOn(false);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    setSpellcheckOn(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("the system's menu", () => {
  function field(spellcheck: string | null): HTMLElement {
    const el = document.createElement("textarea");
    if (spellcheck !== null) el.setAttribute("spellcheck", spellcheck);
    document.body.appendChild(el);
    return el;
  }

  it("is never wanted while the switch is off", () => {
    expect(wantsSystemTextMenu(field("true"))).toBe(false);
  });

  it("is wanted exactly where the field is checked", () => {
    setSpellcheckOn(true);
    expect(wantsSystemTextMenu(field("true"))).toBe(true);
    expect(wantsSystemTextMenu(field("false"))).toBe(false);
    expect(wantsSystemTextMenu(null)).toBe(false);
  });

  it("an unclassified field inherits the nearest answer above it - the root's false", () => {
    setSpellcheckOn(true);
    const root = document.documentElement;
    root.setAttribute("spellcheck", "false");
    try {
      expect(wantsSystemTextMenu(field(null))).toBe(false);
    } finally {
      root.removeAttribute("spellcheck");
    }
  });
});

describe("the field primitives", () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    host = null;
    root = null;
  });
  function render(node: React.ReactNode): HTMLDivElement {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(node));
    return host;
  }
  const attr = (testid: string) => host!.querySelector(`[data-testid="${testid}"]`)!.getAttribute("spellcheck");

  it("a multi-line field holds prose and follows the switch while it is mounted", () => {
    render(
      <>
        <TextArea data-testid="area" defaultValue="" />
        <GrowingField data-testid="grow" value="" onChange={() => {}} />
      </>,
    );
    expect([attr("area"), attr("grow")]).toEqual(["false", "false"]);
    act(() => setSpellcheckOn(true));
    expect([attr("area"), attr("grow")]).toEqual(["true", "true"]);
    act(() => setSpellcheckOn(false));
    expect([attr("area"), attr("grow")]).toEqual(["false", "false"]);
  });

  it("a one-line field is checked only when it says it holds prose", () => {
    render(
      <>
        <TextInput data-testid="plain" defaultValue="" />
        <TextInput data-testid="subject" purpose="prose" defaultValue="" />
      </>,
    );
    act(() => setSpellcheckOn(true));
    expect(attr("plain")).toBe("false");
    expect(attr("subject")).toBe("true");
  });

  it("code, secrets and addresses stay off whatever the switch says", () => {
    render(
      <>
        <TextInput data-testid="secret" purpose="secret" defaultValue="" />
        <TextArea data-testid="code" purpose="code" defaultValue="" />
        <TextArea data-testid="address" purpose="address" defaultValue="" />
        <GrowingField data-testid="number" purpose="number" value="" onChange={() => {}} />
      </>,
    );
    act(() => setSpellcheckOn(true));
    expect([attr("secret"), attr("code"), attr("address"), attr("number")]).toEqual(["false", "false", "false", "false"]);
  });
});
