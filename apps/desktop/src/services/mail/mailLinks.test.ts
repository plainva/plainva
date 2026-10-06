// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LinkTarget } from "@plainva/ui";
import { attachMailLinks, mailTextSegments } from "@plainva/ui/mail";

/**
 * Links in a mail body (plan Befunde 06.10., M1): one wiring for the HTML
 * frame and the plain-text body, on both shells. The desktop caught only the
 * click, the phone nothing at all, and a text mail had no links.
 */

function body(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const HOLD_MS = 500;

describe("opening a link", () => {
  it("hands the click to the shell and never lets the surface navigate", () => {
    const root = body('<p>Hier: <a href="https://nordlicht.example/r"><b>Rechnung</b> ansehen</a></p>');
    const opened: LinkTarget[] = [];
    attachMailLinks(root, { onOpen: (link) => opened.push(link) });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    // The click lands on the <b> inside the link.
    root.querySelector("b")!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(opened.map((l) => l.href)).toEqual(["https://nordlicht.example/r"]);
  });

  it("stops a link it does not open from navigating, too", () => {
    const root = body('<a id="x" href="ftp://files.example/a">Datei</a><a id="y" href="#unten">nach unten</a>');
    const onOpen = vi.fn();
    attachMailLinks(root, { onOpen });
    const foreign = new MouseEvent("click", { bubbles: true, cancelable: true });
    root.querySelector("#x")!.dispatchEvent(foreign);
    expect(foreign.defaultPrevented).toBe(true);
    // A jump inside the message is the message's own business.
    const inner = new MouseEvent("click", { bubbles: true, cancelable: true });
    root.querySelector("#y")!.dispatchEvent(inner);
    expect(inner.defaultPrevented).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens mail addresses and phone numbers through the shell as well", () => {
    const root = body('<a id="m" href="mailto:anna@example.org">Anna</a><a id="t" href="tel:+4930123">anrufen</a>');
    const kinds: string[] = [];
    attachMailLinks(root, { onOpen: (link) => kinds.push(link.kind) });
    for (const id of ["#m", "#t"]) root.querySelector(id)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(kinds).toEqual(["mailto", "tel"]);
  });
});

describe("pointing at a link", () => {
  it("names the link under the pointer and forgets it when the pointer leaves", () => {
    const root = body('<p id="p">Text <a id="a" href="https://a.example/x">eins</a> <a id="b" href="https://b.example/y">zwei</a></p>');
    const seen: Array<string | null> = [];
    attachMailLinks(root, { onOpen: vi.fn(), onPoint: (link) => seen.push(link ? link.host : null) });
    const a = root.querySelector("#a")!;
    const b = root.querySelector("#b")!;
    const p = root.querySelector("#p")!;
    a.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    a.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: b }));
    b.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    b.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: p }));
    expect(seen).toEqual(["a.example", "b.example", null]);
  });

  it("names the link that holds the keyboard focus", () => {
    const root = body('<a id="a" href="https://a.example/x">eins</a><button id="k">k</button>');
    const seen: Array<string | null> = [];
    attachMailLinks(root, { onOpen: vi.fn(), onPoint: (link) => seen.push(link ? link.host : null) });
    (root.querySelector("#a") as HTMLElement).focus();
    (root.querySelector("#k") as HTMLElement).focus();
    expect(seen).toEqual(["a.example", null]);
  });

  it("the pointer wins over the focus, and the focus returns when the pointer leaves", () => {
    const root = body('<a id="a" href="https://a.example/x">eins</a> <a id="b" href="https://b.example/y">zwei</a>');
    const seen: Array<string | null> = [];
    attachMailLinks(root, { onOpen: vi.fn(), onPoint: (link) => seen.push(link ? link.host : null) });
    (root.querySelector("#a") as HTMLElement).focus();
    const b = root.querySelector("#b")!;
    b.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    b.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: null }));
    expect(seen).toEqual(["a.example", "b.example", "a.example"]);
  });

  it("says what the text claims when it names another host", () => {
    const root = body('<a id="a" href="https://nordlicht-rechnung.example/login">https://nordlicht.example/rechnung</a>');
    const seen: Array<LinkTarget | null> = [];
    attachMailLinks(root, { onOpen: vi.fn(), onPoint: (link) => seen.push(link) });
    root.querySelector("#a")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(seen[0]?.host).toBe("nordlicht-rechnung.example");
    expect(seen[0]?.textHost).toBe("nordlicht.example");
  });

  it("tells the shell that nothing is pointed at when the body goes away", () => {
    const root = body('<a id="a" href="https://a.example/x">eins</a>');
    const seen: Array<string | null> = [];
    const detach = attachMailLinks(root, { onOpen: vi.fn(), onPoint: (link) => seen.push(link ? link.host : null) });
    root.querySelector("#a")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    detach();
    root.querySelector("#a")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(seen).toEqual(["a.example", null]);
  });
});

describe("holding a link", () => {
  const pointer = (type: string, x = 10, y = 10) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    return e;
  };

  it("shows where it leads, and the tap that ends the hold does not open it", () => {
    vi.useFakeTimers();
    const root = body('<a id="a" href="https://a.example/x">eins</a>');
    const onOpen = vi.fn();
    const held: string[] = [];
    attachMailLinks(root, { onOpen, onHold: (link) => held.push(link.host), holdMs: HOLD_MS });
    const a = root.querySelector("#a")!;
    a.dispatchEvent(pointer("pointerdown"));
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(held).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(held).toEqual(["a.example"]);
    a.dispatchEvent(pointer("pointerup"));
    a.dispatchEvent(pointer("click"));
    expect(onOpen).not.toHaveBeenCalled();
    // The next, ordinary tap opens again.
    a.dispatchEvent(pointer("pointerdown"));
    a.dispatchEvent(pointer("pointerup"));
    a.dispatchEvent(pointer("click"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("a finger that moves is scrolling, not holding", () => {
    vi.useFakeTimers();
    const root = body('<a id="a" href="https://a.example/x">eins</a>');
    const onHold = vi.fn();
    attachMailLinks(root, { onOpen: vi.fn(), onHold, holdMs: HOLD_MS });
    const a = root.querySelector("#a")!;
    a.dispatchEvent(pointer("pointerdown", 10, 10));
    a.dispatchEvent(pointer("pointermove", 10, 40));
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
  });

  it("takes the platform's own long press as the hold and keeps its menu away", () => {
    const root = body('<a id="a" href="https://a.example/x">eins</a>');
    const held: string[] = [];
    attachMailLinks(root, { onOpen: vi.fn(), onHold: (link) => held.push(link.host), holdMs: HOLD_MS });
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    root.querySelector("#a")!.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    expect(held).toEqual(["a.example"]);
  });

  it("a right click asks for the link's menu, says where, and leaves the next click alone", () => {
    const root = body('<a id="a" href="https://a.example/x">eins</a>');
    const onOpen = vi.fn();
    const asked: Array<{ host: string; x: number; y: number }> = [];
    // The desktop: a menu on right click, no hold timer.
    attachMailLinks(root, { onOpen, onHold: (link, at) => asked.push({ host: link.host, ...at }) });
    const a = root.querySelector("#a")!;
    a.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }));
    expect(asked).toEqual([{ host: "a.example", x: 40, y: 60 }]);
    // A mouse is not followed by a tap to swallow.
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("a mouse button held down is not a hold", () => {
    vi.useFakeTimers();
    const root = body('<a id="a" href="https://a.example/x">eins</a>');
    const onHold = vi.fn();
    attachMailLinks(root, { onOpen: vi.fn(), onHold, holdMs: HOLD_MS });
    const down = new MouseEvent("pointerdown", { bubbles: true, clientX: 1, clientY: 1 });
    Object.defineProperty(down, "pointerType", { value: "mouse" });
    root.querySelector("#a")!.dispatchEvent(down);
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
  });

  it("leaves the context menu alone where no menu is wanted", () => {
    const root = body('<a id="a" href="https://a.example/x">eins</a>');
    attachMailLinks(root, { onOpen: vi.fn() });
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    root.querySelector("#a")!.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(false);
  });
});

describe("links in a plain-text body", () => {
  it("keeps the text character for character", () => {
    const text = "Hallo,\n\ndie Rechnung: https://nordlicht.example/r?id=1&x=2.\n(siehe http://a.example/b) <https://c.example>\n\tGruß";
    const segments = mailTextSegments(text);
    expect(segments.map((s) => s.text).join("")).toBe(text);
    expect(segments.filter((s) => s.kind === "link").map((s) => (s.kind === "link" ? s.href : ""))).toEqual([
      "https://nordlicht.example/r?id=1&x=2",
      "http://a.example/b",
      "https://c.example",
    ]);
  });

  it("only links http(s), and nothing glued to a word", () => {
    const hrefs = (text: string) => mailTextSegments(text).filter((s) => s.kind === "link").map((s) => s.text);
    expect(hrefs("javascript:alert(1) data:text/html,x file:///etc mailto:a@b.example")).toEqual([]);
    expect(hrefs("xhttps://a.example nothttp://b.example")).toEqual([]);
    expect(hrefs("https:// http://")).toEqual([]);
    expect(hrefs("HTTPS://A.EXAMPLE/X")).toEqual(["HTTPS://A.EXAMPLE/X"]);
    expect(hrefs("")).toEqual([]);
  });

  it("is markup-proof: an address cannot smuggle an element in", () => {
    const segments = mailTextSegments('https://a.example/"><img src=x onerror=alert(1)>');
    // The address ends at the quote; the rest stays text, to be rendered as text.
    expect(segments[0]).toEqual({ kind: "link", href: "https://a.example/", text: "https://a.example/" });
    expect(segments.slice(1).every((s) => s.kind === "text")).toBe(true);
  });

  it("stays linear on a body of nothing but address starts", () => {
    const start = performance.now();
    const segments = mailTextSegments("http://".repeat(50_000));
    expect(performance.now() - start).toBeLessThan(1500);
    expect(segments.map((s) => s.text).join("").length).toBe(350_000);
  });
});
