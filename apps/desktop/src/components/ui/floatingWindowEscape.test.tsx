// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import "@plainva/ui/i18n";
import { FloatingWindow, Modal } from "@plainva/ui";

/**
 * Whose key Escape is, for a floating window (finding 2026-10-09).
 *
 * A floating window is not modal: it lies beside the work, and whatever is open
 * in the app keeps running. Its Escape listener used to sit on `window` in the
 * capture phase and stop the event — first in line for every Escape anywhere.
 * For a preview that is the point. For the composer it meant that the key
 * which should close a menu inside it, or anything in the note beside it,
 * closed the composer, and that Escape in a dialog ABOUT a floating window
 * never reached the dialog.
 *
 * So there are two scopes now. A preview keeps the one it always had; a window
 * people write in gives the key to its content, to the work beside it and to a
 * dialog on top before it takes it.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let escaped: number;
/** Stands for every listener further out: a view's own Escape handler on `window`. */
const outer = vi.fn();

beforeEach(() => {
  escaped = 0;
  outer.mockClear();
  window.addEventListener("keydown", outer);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.removeEventListener("keydown", outer);
});

function render(el: ReactElement) {
  act(() => root.render(el));
}

function windowWith(scope: "window" | "content" | undefined, content: ReactElement) {
  return (
    <FloatingWindow persistKey="test" defaultWidth={400} defaultHeight={300} ariaLabel="Test" head={<span>Test</span>} escapeScope={scope} onEscape={() => (escaped += 1)}>
      {content}
    </FloatingWindow>
  );
}

/** A real key press: it starts at the element that has the focus and can be cancelled. */
function pressEscape(at: Element = document.activeElement ?? document.body) {
  act(() => {
    at.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
}

const inside = () => document.querySelector<HTMLInputElement>('[data-testid="inside"]')!;

describe('scope "window" — a preview', () => {
  it("takes Escape wherever it is pressed, and before anything else", () => {
    render(windowWith(undefined, <input data-testid="inside" />));
    const beside = document.createElement("input");
    document.body.appendChild(beside);

    pressEscape(beside);
    expect(escaped).toBe(1);
    expect(outer, "the event stops with the window").not.toHaveBeenCalled();
    beside.remove();
  });

  it("takes it even when its own content would use the key", () => {
    // An editor inside the preview: the preview closes all the same.
    render(windowWith("window", <input data-testid="inside" onKeyDown={(e) => e.preventDefault()} />));
    pressEscape(inside());
    expect(escaped).toBe(1);
  });
});

describe('scope "content" — a window people write in', () => {
  it("takes Escape when it is pressed inside and nothing there used it", () => {
    render(windowWith("content", <input data-testid="inside" />));
    pressEscape(inside());
    expect(escaped).toBe(1);
    expect(outer, "nobody further out acts on a key the window used").not.toHaveBeenCalled();
  });

  it("leaves the key to what is open inside", () => {
    // The composer's command menu: its editor closes the menu and marks the
    // key as used, the way CodeMirror does for a binding that ran.
    const used = vi.fn((e: Event) => e.preventDefault());
    render(windowWith("content", <input data-testid="inside" />));
    inside().addEventListener("keydown", used);
    pressEscape(inside());
    expect(used).toHaveBeenCalledTimes(1);
    expect(escaped).toBe(0);
  });

  it("leaves the key alone when it is pressed in something else", () => {
    render(windowWith("content", <input data-testid="inside" />));
    const beside = document.createElement("input");
    document.body.appendChild(beside);
    pressEscape(beside);
    expect(escaped).toBe(0);
    expect(outer, "the key reaches whoever it was meant for").toHaveBeenCalledTimes(1);
    beside.remove();
  });

  it("takes it when the focus is nowhere: nothing else is claiming the key", () => {
    render(windowWith("content", <input data-testid="inside" />));
    pressEscape(document.body);
    expect(escaped).toBe(1);
  });
});

describe('scope "content" under a dialog', () => {
  it("leaves Escape to the dialog: it closes, and the window does not hear the key", () => {
    // The question about the window itself. Escape there answers it.
    let dialogClosed = 0;
    render(
      <>
        {windowWith("content", <input data-testid="inside" />)}
        <Modal title="Discard your input?" onClose={() => (dialogClosed += 1)}>
          <button type="button" data-testid="in-dialog">
            Cancel
          </button>
        </Modal>
      </>,
    );
    pressEscape(document.querySelector('[data-testid="in-dialog"]')!);
    expect(dialogClosed).toBe(1);
    expect(escaped).toBe(0);
    // Pressed in the window underneath, with the dialog still open: the same.
    pressEscape(inside());
    expect(escaped).toBe(0);
    // With the focus nowhere, too — the dialog is what is on top.
    pressEscape(document.body);
    expect(escaped).toBe(0);
  });
});
