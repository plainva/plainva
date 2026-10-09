// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useState, type ReactElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import "@plainva/ui/i18n";
import { FloatingWindow, MenuItem, MenuSurface, Modal } from "@plainva/ui";

// Where a floating window lies among the other windows and the dialogs, and
// who gets Escape (Design_Language.md, "Z layers"). What the layers LOOK like
// — which surface a click reaches — needs a browser and is asked in
// e2e/floatingLayer.spec.ts; this file holds the decisions the primitive makes
// on the way there: the place it gives itself, the mark it takes inside a
// dialog, and the Escape it leaves to what is in front.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(el: ReactElement) {
  act(() => root.render(el));
}

function Win({ id, onEscape, subject, children }: { id: string; onEscape?: () => void; subject?: string; children?: ReactNode }) {
  return (
    <FloatingWindow persistKey={`test-${id}`} defaultWidth={400} defaultHeight={300} ariaLabel={id} testId={`win-${id}`} head={<span>{id}</span>} onEscape={onEscape} subject={subject}>
      <input data-testid={`field-${id}`} />
      {children}
    </FloatingWindow>
  );
}

/**
 * A window with a state of its own that closes itself on Escape — the way the
 * app hosts its windows: a database, the calendar and the shell each keep
 * theirs, so closing one re-renders nothing of another. flushSync makes the
 * window go while the key press is still being handed round, which is what a
 * browser does through the microtask between two listeners.
 */
function Host({ id, onClosed }: { id: string; onClosed: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <Win
      id={id}
      onEscape={() => {
        flushSync(() => setOpen(false));
        onClosed(id);
      }}
    />
  );
}

/** A button that opens a menu and keeps that to itself: opening it re-renders nothing around it. */
function MenuInside({ onCloseMenu }: { onCloseMenu: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button data-testid="open-menu" onClick={() => setOpen(true)}>More</button>
      {open && (
        <MenuSurface open at={{ x: 10, y: 10 }} onClose={() => { setOpen(false); onCloseMenu(); }}>
          <MenuItem>One</MenuItem>
        </MenuSurface>
      )}
    </>
  );
}

const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const place = (id: string) => byId(`win-${id}`).style.getPropertyValue("--peek-order");
function fire(target: Element, type: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}
const escape = (target: Element = document.body) => fire(target, "keydown", { key: "Escape" });

describe("FloatingWindow: which window is in front", () => {
  it("counts the open windows from back to front; a new one opens in front", () => {
    render(<><Win id="a" /></>);
    expect(place("a")).toBe("0");
    render(<><Win id="a" /><Win id="b" /></>);
    expect([place("a"), place("b")]).toEqual(["0", "1"]);
  });

  it("brings the window in use forward: a pointer pressed in it, or a key while the keyboard is in it", () => {
    render(<><Win id="a" /><Win id="b" /></>);
    fire(byId("field-a"), "pointerdown");
    expect([place("a"), place("b")]).toEqual(["1", "0"]);
    fire(byId("field-b"), "keydown", { key: "x" });
    expect([place("a"), place("b")]).toEqual(["0", "1"]);
    // The Tab that enters a window arrives there as a key-up.
    fire(byId("field-a"), "keyup", { key: "Tab" });
    expect([place("a"), place("b")]).toEqual(["1", "0"]);
  });

  it("does not bring a window forward on focus alone — code moves focus too", () => {
    render(<><Win id="a" /><Win id="b" /></>);
    act(() => byId("field-a").focus());
    expect([place("a"), place("b")]).toEqual(["0", "1"]);
  });

  it("brings a window forward when its host shows something else in it", () => {
    render(<><Win id="a" subject="one" /><Win id="b" /></>);
    expect([place("a"), place("b")]).toEqual(["0", "1"]);
    render(<><Win id="a" subject="two" /><Win id="b" /></>);
    expect([place("a"), place("b")]).toEqual(["1", "0"]);
    // The same subject again is no news.
    fire(byId("field-b"), "pointerdown");
    render(<><Win id="a" subject="two" /><Win id="b" /></>);
    expect([place("a"), place("b")]).toEqual(["0", "1"]);
  });

  it("closes the gap when a window goes", () => {
    // Keyed, so that it is b that unmounts — not c handing its props to b's place.
    render(<><Win key="a" id="a" /><Win key="b" id="b" /><Win key="c" id="c" /></>);
    expect([place("a"), place("b"), place("c")]).toEqual(["0", "1", "2"]);
    render(<><Win key="a" id="a" /><Win key="c" id="c" /></>);
    expect([place("a"), place("c")]).toEqual(["0", "1"]);
  });
});

describe("FloatingWindow: a window and the dialogs", () => {
  const overDialog = (id: string) => byId(`win-${id}`).hasAttribute("data-over-dialog");

  it("stays on its own layer beside a dialog", () => {
    render(<><Win id="a" /><Modal onClose={() => {}} title="Dialog"><p>…</p></Modal></>);
    expect(overDialog("a")).toBe(false);
  });

  it("lies on the dialog's layer when the dialog opened it", () => {
    render(<Modal onClose={() => {}} title="Dialog"><Win id="a" /></Modal>);
    expect(overDialog("a")).toBe(true);
    // The window itself is portalled out of the dialog — what it was opened
    // from is read off its mount point, which stays behind.
    expect(byId("win-a").closest(".pv-overlay")).toBeNull();
  });

  it("reads that off the document, so a window mounted from a root of its own counts as well", () => {
    render(<Modal onClose={() => {}} title="Dialog"><span data-testid="embed" /></Modal>);
    const embedded = createRoot(byId("embed"));
    act(() => embedded.render(<Win id="a" />));
    expect(overDialog("a")).toBe(true);
    act(() => embedded.unmount());
  });

  it("counts a palette as a dialog too", () => {
    render(<div className="pv-palette-overlay"><Win id="a" /></div>);
    expect(overDialog("a")).toBe(true);
  });
});

describe("FloatingWindow: Escape goes to what is in front", () => {
  it("closes the window when nothing lies in front of it — wherever the keyboard is", () => {
    const onEscape = vi.fn();
    render(<Win id="a" onEscape={onEscape} />);
    escape();
    const used = escape(byId("field-a"));
    expect(onEscape).toHaveBeenCalledTimes(2);
    // The key is marked as used, so nobody further out acts on it.
    expect(used.defaultPrevented).toBe(true);
  });

  it("leaves a key alone that somebody has used already", () => {
    // A picker that listens in the capture phase and was there first.
    const earlier = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener("keydown", earlier, { capture: true });
    try {
      const onEscape = vi.fn();
      render(<Win id="a" onEscape={onEscape} />);
      escape();
      expect(onEscape).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", earlier, { capture: true });
    }
  });

  it("closes one window at a time, the one in front", () => {
    const a = vi.fn();
    const b = vi.fn();
    render(<><Win id="a" onEscape={a} /><Win id="b" onEscape={b} /></>);
    escape();
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([0, 1]);
    fire(byId("field-a"), "pointerdown");
    escape();
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1]);
  });

  it("closes ONE window even when closing it makes the next one the front window mid-key", () => {
    // Each window listens for itself, and the hosts are apart: closing a
    // re-renders nothing of b, so b's listener is still to come in the same
    // key press — after a has gone and b has become the front window.
    const closed: string[] = [];
    const onClosed = (id: string) => {
      closed.push(id);
    };
    render(<><Host id="a" onClosed={onClosed} /><Host id="b" onClosed={onClosed} /></>);
    // a was opened first, so its listener runs first; using it puts it in front.
    fire(byId("field-a"), "pointerdown");
    escape();
    expect(closed).toEqual(["a"]);
    expect(byId("win-b")).not.toBeNull();
    escape();
    expect(closed).toEqual(["a", "b"]);
  });

  it("closes one window for a held key, not one with every repeat", () => {
    const a = vi.fn();
    render(<Win id="a" onEscape={a} />);
    const repeat = fire(document.body, "keydown", { key: "Escape", repeat: true });
    expect(a).not.toHaveBeenCalled();
    // …and the repeat goes no further: it is the window's key, held.
    expect(repeat.defaultPrevented).toBe(true);
  });

  it("leaves a window alone that lies behind one keeping Escape for its content", () => {
    const a = vi.fn();
    render(<><Win id="a" onEscape={a} /><Win id="writing" /></>);
    escape(byId("field-writing"));
    expect(a).not.toHaveBeenCalled();
  });

  it("goes to a dialog opened beside the window, then to the window", () => {
    const closeWindow = vi.fn();
    const closeDialog = vi.fn();
    render(<><Win id="a" onEscape={closeWindow} /><Modal onClose={closeDialog} title="Dialog"><p>…</p></Modal></>);
    escape();
    expect([closeWindow.mock.calls.length, closeDialog.mock.calls.length]).toEqual([0, 1]);
    render(<><Win id="a" onEscape={closeWindow} /></>);
    escape();
    expect([closeWindow.mock.calls.length, closeDialog.mock.calls.length]).toEqual([1, 1]);
  });

  it("goes to a palette opened beside the window, wherever the keyboard is", () => {
    const closeWindow = vi.fn();
    render(<><Win id="a" onEscape={closeWindow} /><div className="pv-palette-overlay"><input data-testid="palette-field" /></div></>);
    escape(byId("palette-field"));
    escape();
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it("goes to the window's own menu and its own dialog before the window", () => {
    const closeWindow = vi.fn();
    const closeMenu = vi.fn();
    const closeDialog = vi.fn();
    render(
      <Win id="a" onEscape={closeWindow}>
        <MenuSurface open at={{ x: 10, y: 10 }} onClose={closeMenu}><MenuItem>One</MenuItem></MenuSurface>
      </Win>
    );
    escape();
    expect([closeWindow.mock.calls.length, closeMenu.mock.calls.length]).toEqual([0, 1]);
    render(
      <Win id="a" onEscape={closeWindow}>
        <Modal onClose={closeDialog} title="Dialog"><p>…</p></Modal>
      </Win>
    );
    escape();
    expect([closeWindow.mock.calls.length, closeDialog.mock.calls.length]).toEqual([0, 1]);
  });

  it("does not wait for what has no Escape of its own: a hand-built menu, a click catcher, a list nobody is in", () => {
    // The vault menu and a database's header menu are `.pv-menu` without the
    // menu primitive, the calendar's quick-create card lays a bare
    // `.pv-overlay` under itself, and a select list opened with the mouse has
    // no focus where a clicked button takes none. None of them closes on
    // Escape by itself — a window that stood back for them would be deaf to
    // the key for as long as they are open.
    const closeWindow = vi.fn();
    render(
      <>
        <Win id="a" onEscape={closeWindow} />
        <div className="pv-menu"><button data-testid="vault-item">Vault</button></div>
        <div className="pv-overlay" />
        <div className="pv-selectpanel" />
      </>
    );
    escape();
    expect(closeWindow).toHaveBeenCalledTimes(1);
    // With the keyboard IN one of them it is not the window's key.
    escape(byId("vault-item"));
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it("goes to a popover or an open select while the keyboard is in it, and to the window otherwise", () => {
    const closeWindow = vi.fn();
    render(
      <Win id="a" onEscape={closeWindow}>
        <div className="pv-popover pv-popover--fixed"><input data-testid="popover-field" /></div>
        <button className="pv-selecttrigger" aria-expanded="true" data-testid="open-select">Choice</button>
        <button className="pv-selecttrigger" aria-expanded="false" data-testid="closed-select">Choice</button>
      </Win>
    );
    escape(byId("popover-field"));
    escape(byId("open-select"));
    expect(closeWindow).not.toHaveBeenCalled();
    // A popover that does not hold the keyboard — the selection toolbar of an
    // editor — does not keep the window open, and neither does a closed select.
    escape(byId("field-a"));
    escape(byId("closed-select"));
    expect(closeWindow).toHaveBeenCalledTimes(2);
  });

  it("goes to a menu before the dialog behind it, whichever of the two was attached first", () => {
    // Menu and dialog both listen on the document. A menu opened by something
    // inside the dialog that keeps its own state is attached AFTER the dialog,
    // so the dialog heard the key first and closed, menu and all.
    const closeDialog = vi.fn();
    const closeMenu = vi.fn();
    render(<Modal onClose={closeDialog} title="Dialog"><MenuInside onCloseMenu={closeMenu} /></Modal>);
    act(() => byId("open-menu").click());
    escape();
    expect([closeDialog.mock.calls.length, closeMenu.mock.calls.length]).toEqual([0, 1]);
    escape();
    expect([closeDialog.mock.calls.length, closeMenu.mock.calls.length]).toEqual([1, 1]);
  });

  it("closes a window a dialog opened before that dialog: the dialog is behind it", () => {
    const closeWindow = vi.fn();
    const closeDialog = vi.fn();
    render(
      <Modal onClose={closeDialog} title="Dialog">
        <button data-testid="opener">open</button>
        <Win id="a" onEscape={closeWindow} />
      </Modal>
    );
    // Also while the keyboard is still on the button that opened the window.
    escape(byId("opener"));
    escape(byId("field-a"));
    expect([closeWindow.mock.calls.length, closeDialog.mock.calls.length]).toEqual([2, 0]);
  });
});
