// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createRef, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import "@plainva/ui/i18n";
import { Button } from "@plainva/ui";
import { Fab, Segmented, ScrollEdge, DockedToolbar } from "@plainva/ui";
import { IconButton } from "@plainva/ui";
import { TextInput, SelectField, TextArea } from "@plainva/ui";
import { Checkbox } from "@plainva/ui";
import { Switch } from "@plainva/ui";
import { EmptyState } from "@plainva/ui";
import { Modal } from "@plainva/ui";
import { ClickCatch, MenuSurface, MenuItem } from "@plainva/ui";
import { GroupCard, Row, RowList, SectionLabel } from "@plainva/ui";
import { SearchField } from "@plainva/ui";
import { TooltipHost } from "@plainva/ui";
import { Chip } from "@plainva/ui";
import { DropdownMenu } from "../DropdownMenu";

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

function press(key: string, target: EventTarget = document) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("Button", () => {
  it("renders secondary/md by default with type=button", () => {
    render(<Button>Ok</Button>);
    const btn = container.querySelector("button")!;
    expect(btn.className).toContain("pv-btn");
    expect(btn.className).toContain("pv-btn--secondary");
    expect(btn.getAttribute("type")).toBe("button");
  });

  it("applies variant and size classes", () => {
    render(<Button variant="danger" size="sm">Löschen</Button>);
    const btn = container.querySelector("button")!;
    expect(btn.className).toContain("pv-btn--danger");
    expect(btn.className).toContain("pv-btn--sm");
  });

  it("supports the UI 2.0 tonal variant", () => {
    render(<Button variant="tonal">Verbinden</Button>);
    expect(container.querySelector("button")!.className).toContain("pv-btn--tonal");
  });
});

describe("IconButton", () => {
  it("carries aria-label and data-tip from the label", () => {
    render(<IconButton label="Schließen"><span>x</span></IconButton>);
    const btn = container.querySelector("button")!;
    expect(btn.getAttribute("aria-label")).toBe("Schließen");
    expect(btn.getAttribute("data-tip")).toBe("Schließen");
  });

  it("tip=false keeps the accessible name but drops the tooltip", () => {
    render(<IconButton label="Menü" tip={false}><span>m</span></IconButton>);
    const btn = container.querySelector("button")!;
    expect(btn.getAttribute("aria-label")).toBe("Menü");
    expect(btn.hasAttribute("data-tip")).toBe(false);
  });
});

describe("Fields", () => {
  it("TextInput/SelectField/TextArea render the pv-field classes", () => {
    render(
      <div>
        <TextInput placeholder="Name" />
        <SelectField><option>a</option></SelectField>
        <TextArea />
      </div>
    );
    expect(container.querySelector("input")!.className).toContain("pv-field");
    expect(container.querySelector("select")!.className).toContain("pv-field--select");
    expect(container.querySelector("textarea")!.className).toContain("pv-field--area");
  });
});

describe("Checkbox / Switch", () => {
  it("Checkbox renders a labelled native checkbox", () => {
    render(<Checkbox defaultChecked>Aktiv</Checkbox>);
    const input = container.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    expect(input.checked).toBe(true);
    expect(container.querySelector("label")!.textContent).toContain("Aktiv");
  });

  it("Switch toggles via role=switch", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Dichte" />);
    const sw = container.querySelector<HTMLButtonElement>("[role=switch]")!;
    expect(sw.getAttribute("aria-checked")).toBe("false");
    act(() => sw.click());
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("EmptyState", () => {
  it("renders message and action as a status region", () => {
    render(<EmptyState action={<Button>Neu</Button>}>Keine Einträge</EmptyState>);
    const region = container.querySelector("[role=status]")!;
    expect(region.textContent).toContain("Keine Einträge");
    expect(region.querySelector("button")).toBeTruthy();
  });

  it("renders the optional emphasis title (UI 2.0)", () => {
    render(<EmptyState title="Nichts hier">Lege etwas an</EmptyState>);
    const t = container.querySelector(".pv-empty-title");
    expect(t?.textContent).toBe("Nichts hier");
    expect(container.querySelector(".pv-empty-msg")!.textContent).toBe("Lege etwas an");
  });
});

describe("Fab", () => {
  it("renders a round FAB by default and an extended pill with a label", () => {
    render(<Fab icon={<span>+</span>} aria-label="Neu" />);
    const fab = container.querySelector("button.pv-fab")!;
    expect(fab.getAttribute("type")).toBe("button");
    expect(fab.className).not.toContain("pv-fab--extended");
    expect(fab.getAttribute("aria-label")).toBe("Neu");

    render(<Fab icon={<span>+</span>} label="Neue Notiz" />);
    const ext = container.querySelector("button.pv-fab")!;
    expect(ext.className).toContain("pv-fab--extended");
    expect(ext.querySelector(".pv-fab-label")!.textContent).toBe("Neue Notiz");
  });
});

describe("Segmented", () => {
  it("renders a radiogroup, marks the active option and fires onChange", () => {
    const onChange = vi.fn();
    render(
      <Segmented
        ariaLabel="Ansicht"
        value="table"
        onChange={onChange}
        options={[
          { value: "table", label: "Tabelle" },
          { value: "board", label: "Board" },
        ]}
      />
    );
    const group = container.querySelector("[role=radiogroup]")!;
    expect(group.getAttribute("aria-label")).toBe("Ansicht");
    const radios = container.querySelectorAll<HTMLButtonElement>("[role=radio]");
    expect(radios).toHaveLength(2);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(radios[0].className).toContain("is-active");
    expect(radios[1].getAttribute("aria-checked")).toBe("false");
    act(() => radios[1].click());
    expect(onChange).toHaveBeenCalledWith("board");
  });
});

describe("ScrollEdge", () => {
  it("wraps its children in a scroll-edge container with an inner scroller", () => {
    render(
      <ScrollEdge className="custom-scrollbar" style={{ maxHeight: 100 }}>
        <div>row-a</div>
        <div>row-b</div>
      </ScrollEdge>
    );
    const wrap = container.querySelector(".pv-scroll-edge")!;
    expect(wrap).toBeTruthy();
    const scroller = wrap.querySelector<HTMLElement>(".custom-scrollbar")!;
    expect(scroller.style.overflowY).toBe("auto");
    expect(scroller.textContent).toBe("row-arow-b");
  });
});

describe("Modal", () => {
  it("renders title, closes via X, Escape and overlay click — not via panel click", () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} title="Testdialog" footer={<Button>Ok</Button>}>
        <p>Inhalt</p>
      </Modal>
    );
    const dialog = container.querySelector("[role=dialog]")!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(container.querySelector(".pv-modal-heading")!.textContent).toBe("Testdialog");
    expect(container.querySelector(".pv-modal-footer")).toBeTruthy();
    // Focus is trapped inside the dialog.
    expect(dialog.contains(document.activeElement)).toBe(true);

    act(() => container.querySelector<HTMLButtonElement>(".pv-modal-header button")!.click());
    expect(onClose).toHaveBeenCalledTimes(1);

    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(2);

    const overlay = container.querySelector(".pv-overlay")!;
    act(() => {
      overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(3);

    act(() => {
      dialog.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("closeOnOverlay=false ignores backdrop clicks", () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} title="Fest" closeOnOverlay={false}>
        <p>Inhalt</p>
      </Modal>
    );
    const overlay = container.querySelector(".pv-overlay")!;
    act(() => {
      overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("parks the initial focus on the panel, not the close button (2026-07-06)", () => {
    render(
      <Modal onClose={() => {}} title="Fokus">
        <p>Inhalt</p>
      </Modal>
    );
    const dialog = container.querySelector<HTMLElement>("[role=dialog]")!;
    // The X button must NOT open pre-lit in its focus/hover look.
    expect(document.activeElement).toBe(dialog);
    // Tab enters the focus ring at its first control (the header X).
    press("Tab", dialog);
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/Close|Schließen/);
  });
});

describe("MenuSurface / MenuItem", () => {
  it("selecting an item runs onSelect and closes; keepOpen keeps it open", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const onStay = vi.fn();
    render(
      <MenuSurface open onClose={onClose} at={{ x: 10, y: 10 }} ariaLabel="Testmenü">
        <MenuItem onSelect={onSelect}>Öffnen</MenuItem>
        <MenuItem onSelect={onStay} keepOpen>Bleiben</MenuItem>
        <MenuItem disabled onSelect={() => {}}>Gesperrt</MenuItem>
      </MenuSurface>
    );
    const items = container.querySelectorAll<HTMLButtonElement>(".pv-menu-item");
    expect(items).toHaveLength(3);
    // Roving focus starts on the first enabled item.
    expect(document.activeElement).toBe(items[0]);

    act(() => items[1].click());
    expect(onStay).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    act(() => items[0].click());
    expect(onSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    expect(items[2].disabled).toBe(true);
  });

  it("Escape closes the surface", () => {
    const onClose = vi.fn();
    render(
      <MenuSurface open onClose={onClose} at={{ x: 0, y: 0 }}>
        <MenuItem onSelect={() => {}}>Eintrag</MenuItem>
      </MenuSurface>
    );
    press("Escape");
    expect(onClose).toHaveBeenCalled();
  });

  it("puts the focus on the first entry once the menu is shown — a browser gives a hidden element none", () => {
    // The menu is measured hidden and shown once it is placed. jsdom focuses a
    // hidden element, a browser does not: the call used to come while the menu
    // was still hidden, and in the app the focus never moved (Sammelplan
    // § 3.99). So this looks at WHEN the call comes, not at where focus ends up.
    const shown: string[] = [];
    const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement) {
      shown.push(this.closest<HTMLElement>(".pv-menu")?.style.visibility ?? "outside the menu");
    });
    try {
      render(
        <MenuSurface open onClose={() => {}} at={{ x: 10, y: 10 }}>
          <MenuItem disabled onSelect={() => {}}>Gesperrt</MenuItem>
          <MenuItem onSelect={() => {}}>Erster</MenuItem>
        </MenuSurface>
      );
      const first = container.querySelectorAll<HTMLElement>(".pv-menu-item")[1];
      expect(focus.mock.contexts).toEqual([first]);
      expect(shown).toEqual(["visible"]);
    } finally {
      // A spy left in place makes every later focus() a no-op.
      focus.mockRestore();
    }
  });

  /** A button that opens a menu, the way every menu button does. */
  function MenuButton({ onPick, onOpenerFocus, children }: { onPick?: () => void; onOpenerFocus?: () => void; children?: ReactElement }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button data-testid="opener" onClick={() => setOpen(true)} onFocus={onOpenerFocus}>Mehr</button>
        {children}
        <MenuSurface open={open} onClose={() => setOpen(false)} at={{ x: 10, y: 10 }}>
          <MenuItem onSelect={() => onPick?.()}>Eintrag</MenuItem>
        </MenuSurface>
      </>
    );
  }
  const opener = () => container.querySelector<HTMLButtonElement>("[data-testid=opener]")!;
  function openFromButton() {
    act(() => opener().focus());
    act(() => opener().click());
    expect(document.activeElement).toBe(container.querySelector(".pv-menu-item"));
  }
  /** The hand-back comes after the event that closed the menu. */
  async function handBack() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("hands the focus back to what opened it when Escape closes it", async () => {
    render(<MenuButton />);
    openFromButton();
    press("Escape");
    expect(container.querySelector(".pv-menu")).toBeNull();
    await handBack();
    expect(document.activeElement).toBe(opener());
  });

  it("hands the focus back where React hears it: the opener's own focus handlers run", async () => {
    // A field that keeps a draft knows it has the focus through onFocus; a
    // focus given during React's commit reaches no handler at all.
    const onOpenerFocus = vi.fn();
    render(<MenuButton onOpenerFocus={onOpenerFocus} />);
    openFromButton();
    expect(onOpenerFocus).toHaveBeenCalledTimes(1);
    press("Escape");
    await handBack();
    expect(document.activeElement).toBe(opener());
    expect(onOpenerFocus).toHaveBeenCalledTimes(2);
  });

  it("hands the focus back when an entry is picked that leaves it nowhere", async () => {
    const onPick = vi.fn();
    render(<MenuButton onPick={onPick} />);
    openFromButton();
    act(() => container.querySelector<HTMLButtonElement>(".pv-menu-item")!.click());
    expect(onPick).toHaveBeenCalled();
    expect(container.querySelector(".pv-menu")).toBeNull();
    await handBack();
    expect(document.activeElement).toBe(opener());
  });

  it("leaves the focus where a picked entry put it", async () => {
    // "Rename" puts the caret into a field: the menu closing after it must not
    // take the caret back to the button.
    render(<MenuButton onPick={() => container.querySelector<HTMLInputElement>("[data-testid=field]")!.focus()}><input data-testid="field" /></MenuButton>);
    openFromButton();
    act(() => container.querySelector<HTMLButtonElement>(".pv-menu-item")!.click());
    expect(container.querySelector(".pv-menu")).toBeNull();
    await handBack();
    expect(document.activeElement).toBe(container.querySelector("[data-testid=field]"));
  });

  it("hands the focus back when it is taken away whole, open — the way the app's context menu goes", async () => {
    const menu = (shown: boolean) => (
      <>
        <button data-testid="opener">Mehr</button>
        {shown && (
          <MenuSurface open onClose={() => {}} at={{ x: 10, y: 10 }}>
            <MenuItem onSelect={() => {}}>Eintrag</MenuItem>
          </MenuSurface>
        )}
      </>
    );
    render(menu(false));
    act(() => opener().focus());
    render(menu(true));
    expect(document.activeElement).toBe(container.querySelector(".pv-menu-item"));
    render(menu(false));
    await handBack();
    expect(document.activeElement).toBe(opener());
  });

  it("with nothing focused when it opened — WebKit gives a clicked button no focus — hands the focus to what it hangs on", async () => {
    const anchor = createRef<HTMLButtonElement>();
    const view = (open: boolean) => (
      <>
        <button ref={anchor}>Mehr</button>
        <MenuSurface open={open} onClose={() => {}} anchorRef={anchor}>
          <MenuItem onSelect={() => {}}>Eintrag</MenuItem>
        </MenuSurface>
      </>
    );
    render(view(false));
    expect(document.activeElement).toBe(document.body);
    render(view(true));
    expect(document.activeElement).toBe(container.querySelector(".pv-menu-item"));
    render(view(false));
    await handBack();
    expect(document.activeElement).toBe(anchor.current);
  });

  it("hands the focus back to what opened the first menu when an entry of it opened a second one", async () => {
    // The row menu of a task opens the menu of its state: closing that second
    // menu returns to the row, not to nowhere.
    function Chain() {
      const [first, setFirst] = useState(false);
      const [second, setSecond] = useState(false);
      return (
        <>
          <button data-testid="opener" onClick={() => setFirst(true)}>Zeile</button>
          <MenuSurface open={first} onClose={() => setFirst(false)} at={{ x: 10, y: 10 }}>
            <MenuItem onSelect={() => setSecond(true)}>Status …</MenuItem>
          </MenuSurface>
          <MenuSurface open={second} onClose={() => setSecond(false)} at={{ x: 20, y: 20 }} ariaLabel="Status">
            <MenuItem onSelect={() => {}}>Erledigt</MenuItem>
          </MenuSurface>
        </>
      );
    }
    render(<Chain />);
    openFromButton();
    act(() => container.querySelector<HTMLButtonElement>(".pv-menu-item")!.click());
    expect(document.activeElement?.textContent).toBe("Erledigt");
    await handBack();
    expect(document.activeElement?.textContent).toBe("Erledigt");
    press("Escape");
    await handBack();
    expect(container.querySelector(".pv-menu")).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  for (const type of ["text", "number"]) {
    it(`leaves the keyboard in a ${type} field someone is typing in when it opens over it — losing the focus would end the field's edit`, async () => {
      // A right-click into a field, the row menu of a cell being edited, the
      // menu of a file being renamed: such a field commits or saves when it is
      // left — and a number half typed ("-", "1e") reads as empty then.
      const onBlur = vi.fn();
      const view = (open: boolean) => (
        <>
          <input data-testid="field" type={type} onBlur={onBlur} />
          <MenuSurface open={open} onClose={() => {}} at={{ x: 10, y: 10 }}>
            <MenuItem onSelect={() => {}}>Einfügen</MenuItem>
          </MenuSurface>
        </>
      );
      render(view(false));
      const field = container.querySelector<HTMLInputElement>("[data-testid=field]")!;
      act(() => field.focus());
      render(view(true));
      expect(container.querySelector(".pv-menu")).not.toBeNull();
      expect(document.activeElement).toBe(field);
      expect(onBlur).not.toHaveBeenCalled();
      render(view(false));
      await handBack();
      expect(document.activeElement).toBe(field);
    });
  }

  it("takes a press on an entry without the focus over such a field: a pick with the mouse leaves the field its edit", async () => {
    // The press used to blur the field before the pick ran — a rename took the
    // half-typed name, Paste then went into a field that was leaving.
    const onBlur = vi.fn();
    const onPick = vi.fn();
    function FieldWithMenu() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <input data-testid="field" onBlur={onBlur} onContextMenu={(e) => { e.preventDefault(); setOpen(true); }} />
          <MenuSurface open={open} onClose={() => setOpen(false)} at={{ x: 10, y: 10 }}>
            <MenuItem onSelect={onPick}>Einfügen</MenuItem>
          </MenuSurface>
        </>
      );
    }
    render(<FieldWithMenu />);
    const field = container.querySelector<HTMLInputElement>("[data-testid=field]")!;
    act(() => field.focus());
    act(() => void field.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    const entry = container.querySelector<HTMLButtonElement>(".pv-menu-item")!;
    expect(document.activeElement).toBe(field);
    // The press: its mousedown is what would move the focus to the entry.
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => void entry.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true);
    act(() => entry.click());
    expect(onPick).toHaveBeenCalled();
    expect(container.querySelector(".pv-menu")).toBeNull();
    await handBack();
    expect(document.activeElement).toBe(field);
    expect(onBlur).not.toHaveBeenCalled();
  });

  it("takes the focus from a menu entry's press as usual when no field kept it", () => {
    render(<MenuButton />);
    openFromButton();
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => void container.querySelector<HTMLButtonElement>(".pv-menu-item")!.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(false);
  });

  it("hands the focus back right after React's commit, before the next key is handled", async () => {
    // A timer let keys typed in between go to <body>.
    render(<MenuButton />);
    openFromButton();
    press("Escape");
    await Promise.resolve();
    expect(document.activeElement).toBe(opener());
  });

  it("passes over an entry that takes no focus and starts at the next", () => {
    const view = (
      <MenuSurface open onClose={() => {}} at={{ x: 10, y: 10 }}>
        <MenuItem onSelect={() => {}}>Erster</MenuItem>
        <MenuItem onSelect={() => {}}>Zweiter</MenuItem>
      </MenuSurface>
    );
    // A style that hides an element keeps the focus from it in a browser;
    // jsdom has no styles, so the first entry refuses it here by hand.
    const focus = HTMLElement.prototype.focus;
    const spy = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      if (this.textContent === "Erster") return;
      focus.call(this, options);
    });
    try {
      render(view);
      expect(document.activeElement?.textContent).toBe("Zweiter");
    } finally {
      spy.mockRestore();
    }
  });

  it("starts at the first entry when the menu's own field is hidden or read-only", () => {
    render(
      <MenuSurface open onClose={() => {}} at={{ x: 10, y: 10 }}>
        <input hidden data-testid="hidden" />
        <input readOnly defaultValue="fest" data-testid="readonly" />
        <MenuItem onSelect={() => {}}>Erster</MenuItem>
      </MenuSurface>
    );
    expect(document.activeElement?.textContent).toBe("Erster");
  });

  it("puts the caret into a field of its own first; Home and End stay the field's, the arrows step into the entries", () => {
    // The labels of a pinboard card: a filter above the entries.
    render(
      <MenuSurface open onClose={() => {}} at={{ x: 10, y: 10 }}>
        <input data-testid="filter" />
        <MenuItem keepOpen onSelect={() => {}}>Rot</MenuItem>
        <MenuItem keepOpen onSelect={() => {}}>Blau</MenuItem>
      </MenuSurface>
    );
    const filter = container.querySelector<HTMLInputElement>("[data-testid=filter]")!;
    const [red, blue] = Array.from(container.querySelectorAll<HTMLButtonElement>(".pv-menu-item"));
    expect(document.activeElement).toBe(filter);
    const key = (k: string) => {
      const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
      act(() => void (document.activeElement ?? document.body).dispatchEvent(ev));
      return ev;
    };
    expect(key("Home").defaultPrevented).toBe(false);
    expect(key("End").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(filter);
    key("ArrowUp");
    expect(document.activeElement).toBe(blue);
    act(() => filter.focus());
    key("ArrowDown");
    expect(document.activeElement).toBe(red);
  });

  it("leaves the arrow keys to a number field of its own, and starts at the first entry", () => {
    render(
      <MenuSurface open onClose={() => {}} at={{ x: 10, y: 10 }}>
        <input type="number" data-testid="count" />
        <MenuItem onSelect={() => {}}>Eintrag</MenuItem>
      </MenuSurface>
    );
    expect(document.activeElement?.textContent).toBe("Eintrag");
    const count = container.querySelector<HTMLInputElement>("[data-testid=count]")!;
    act(() => count.focus());
    const down = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    act(() => void count.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(count);
  });

  it("leaves Escape to an input method composing in the field it kept the keyboard in", () => {
    function FieldWithMenu() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <input data-testid="field" onContextMenu={(e) => { e.preventDefault(); setOpen(true); }} />
          <MenuSurface open={open} onClose={() => setOpen(false)} at={{ x: 10, y: 10 }}>
            <MenuItem onSelect={() => {}}>Einfügen</MenuItem>
          </MenuSurface>
        </>
      );
    }
    render(<FieldWithMenu />);
    const field = container.querySelector<HTMLInputElement>("[data-testid=field]")!;
    act(() => field.focus());
    act(() => void field.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    const composing = new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true });
    act(() => void field.dispatchEvent(composing));
    expect(composing.defaultPrevented).toBe(false);
    expect(container.querySelector(".pv-menu")).not.toBeNull();
  });

  it("does not let an Enter held down on the button that opened it pick the first entry", () => {
    // The browser repeats a held key into whatever has the focus — now the
    // first entry; a repeated Enter there must do nothing. (A cancelled keydown
    // is what keeps a browser from activating the button; jsdom activates
    // nothing on a key, so the pick itself is the E2E's to show.)
    render(<MenuButton />);
    openFromButton();
    const first = container.querySelector<HTMLButtonElement>(".pv-menu-item")!;
    const held = new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true });
    act(() => void first.dispatchEvent(held));
    expect(held.defaultPrevented).toBe(true);
    const pressed = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    act(() => void first.dispatchEvent(pressed));
    expect(pressed.defaultPrevented).toBe(false);
    act(() => void window.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter" })));
  });

  it("swallows the repeats of the key that picked an entry until it is released — they would land on what gets the focus back", async () => {
    // Enter on "Copy" over the editor: the editor gets the focus back, and a
    // repeated Enter there replaced the selection with a line break.
    const onPick = vi.fn();
    render(<MenuButton onPick={onPick} />);
    openFromButton();
    const entry = container.querySelector<HTMLButtonElement>(".pv-menu-item")!;
    act(() => void entry.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    act(() => entry.click());
    expect(onPick).toHaveBeenCalled();
    await handBack();
    expect(document.activeElement).toBe(opener());
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    try {
      const repeat = () => {
        const ev = new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true });
        act(() => void opener().dispatchEvent(ev));
        return ev;
      };
      expect(repeat().defaultPrevented).toBe(true);
      expect(seen).not.toHaveBeenCalled();
      act(() => void window.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter" })));
      expect(repeat().defaultPrevented).toBe(false);
      expect(seen).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", seen);
    }
  });

  it("lets go of a held key at its next fresh press — macOS sends no keyup for a key let go while ⌘ is held", () => {
    render(<MenuButton />);
    openFromButton();
    press("Escape");
    expect(container.querySelector(".pv-menu")).toBeNull();
    const key = (repeat: boolean) => {
      const ev = new KeyboardEvent("keydown", { key: "Escape", repeat, bubbles: true, cancelable: true });
      act(() => void document.body.dispatchEvent(ev));
      return ev;
    };
    expect(key(true).defaultPrevented).toBe(true);
    key(false);
    expect(key(true).defaultPrevented).toBe(false);
  });

  it("leaves the focus where a press beside it lands — or nowhere — instead of handing it back", async () => {
    render(<MenuButton />);
    openFromButton();
    const send = (type: string) => act(() => void document.body.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })));
    send("pointerdown");
    expect(container.querySelector(".pv-menu")).toBeNull();
    send("mousedown");
    send("pointerup");
    await handBack();
    expect(document.activeElement).not.toBe(opener());
  });

  it("hands the focus back when the press beside it moved none — a handle took it for a drag — once the press ends", async () => {
    render(
      <>
        <MenuButton />
        {/* The head of a floating window: it cancels the press, and a browser
            then sends no mousedown — nothing takes the focus. */}
        <div data-testid="handle" onPointerDown={(e) => e.preventDefault()} />
      </>
    );
    openFromButton();
    const handle = container.querySelector("[data-testid=handle]")!;
    act(() => void handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true })));
    expect(container.querySelector(".pv-menu")).toBeNull();
    await handBack();
    expect(document.activeElement).not.toBe(opener());
    act(() => void window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })));
    await handBack();
    expect(document.activeElement).toBe(opener());
  });

  it("hands the focus back after a scroll that closed it has reached the page, not before", async () => {
    // The editor, focused before it has seen the scroll, would put a scroll
    // to its very top back.
    render(<MenuButton />);
    openFromButton();
    // The menu hears scrolls from its first frame on.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    act(() => void document.body.dispatchEvent(new Event("scroll")));
    expect(container.querySelector(".pv-menu")).toBeNull();
    // Microtasks only — an async act() waits out a macrotask itself.
    await Promise.resolve();
    await Promise.resolve();
    expect(document.activeElement).not.toBe(opener());
    await handBack();
    expect(document.activeElement).toBe(opener());
  });

  it("takes Escape before the field it left the keyboard in: one press closes the menu, the next is the field's", async () => {
    // The field may give its edit up on Escape (a rename, a property value):
    // with a menu in front of it, the first press is the menu's.
    const fieldEscape = vi.fn();
    function FieldWithMenu() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <input
            data-testid="field"
            onContextMenu={(e) => { e.preventDefault(); setOpen(true); }}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); fieldEscape(); } }}
          />
          <MenuSurface open={open} onClose={() => setOpen(false)} at={{ x: 10, y: 10 }}>
            <MenuItem onSelect={() => {}}>Einfügen</MenuItem>
          </MenuSurface>
        </>
      );
    }
    render(<FieldWithMenu />);
    const field = container.querySelector<HTMLInputElement>("[data-testid=field]")!;
    act(() => field.focus());
    act(() => void field.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(container.querySelector(".pv-menu")).not.toBeNull();
    const escape = () => act(() => void field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    escape();
    expect(container.querySelector(".pv-menu")).toBeNull();
    expect(fieldEscape).not.toHaveBeenCalled();
    await handBack();
    expect(document.activeElement).toBe(field);
    escape();
    expect(fieldEscape).toHaveBeenCalledTimes(1);
  });

  it("with autoFocus={false} leaves the focus in the field it completes, opening and closing", () => {
    const view = (open: boolean) => (
      <>
        <input data-testid="field" />
        <MenuSurface open={open} onClose={() => {}} at={{ x: 10, y: 10 }} autoFocus={false}>
          <MenuItem onSelect={() => {}}>Vorschlag</MenuItem>
        </MenuSurface>
      </>
    );
    render(view(false));
    const field = container.querySelector<HTMLInputElement>("[data-testid=field]")!;
    act(() => field.focus());
    render(view(true));
    expect(container.querySelector(".pv-menu")).not.toBeNull();
    expect(document.activeElement).toBe(field);
    render(view(false));
    expect(document.activeElement).toBe(field);
  });

  it("closes on a press outside, heard as pointerdown at the window — not on a press in the menu or on its anchor", () => {
    const onClose = vi.fn();
    const anchor = createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={anchor}>Mehr</button>
        <MenuSurface open onClose={onClose} anchorRef={anchor}>
          <MenuItem onSelect={() => {}}>Eintrag</MenuItem>
        </MenuSurface>
        {/* What is dragged by takes the press for itself: it cancels it and
            stops it. A browser then sends no mousedown at all — the head of a
            floating window is such a handle, and a menu that waited for
            mousedown stayed open while the window beside it was moved. */}
        <div data-testid="handle" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }} />
      </>
    );
    const down = (target: Element, type = "pointerdown") =>
      act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })));

    down(container.querySelector(".pv-menu-item")!);
    down(anchor.current!);
    expect(onClose).not.toHaveBeenCalled();

    down(container.querySelector("[data-testid=handle]")!);
    expect(onClose).toHaveBeenCalledTimes(1);
    down(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
    // One press is one pointerdown; the mousedown that follows it is not a second one.
    down(document.body, "mousedown");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("hears a finger when its tap has been made out — by the mousedown the browser sends for it, not by the raw pointerdown", () => {
    const onClose = vi.fn();
    render(
      <MenuSurface open onClose={onClose} at={{ x: 10, y: 10 }} autoFocus={false}>
        <MenuItem onSelect={() => {}}>Eintrag</MenuItem>
      </MenuSurface>
    );
    const send = (target: Element, type: string, pointerType?: string) =>
      act(() => {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true });
        if (pointerType) Object.defineProperty(event, "pointerType", { value: pointerType });
        target.dispatchEvent(event);
      });
    // A finger comes down beside the list: nothing yet. It may go on to
    // scroll, and the tap may still be given to a row a few pixels away.
    send(document.body, "pointerdown", "touch");
    expect(onClose).not.toHaveBeenCalled();
    // The tap the browser gave to a row is no press beside the list…
    send(container.querySelector(".pv-menu-item")!, "mousedown");
    expect(onClose).not.toHaveBeenCalled();
    // …the tap that stayed beside it is.
    send(document.body, "pointerdown", "touch");
    send(document.body, "mousedown");
    expect(onClose).toHaveBeenCalledTimes(1);
    // A mouse after the finger is heard at once again.
    send(document.body, "pointerdown", "mouse");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not lose a finger's tap when its owner renders again between the press and the tap", () => {
    // `onClose` is a closure of the owner's render almost everywhere. A
    // listener put up anew with each render forgot, between a finger's press
    // and the mousedown of its tap, that a finger had come down: the tap went
    // unheard and the menu stayed.
    const closed: string[] = [];
    const show = (rendering: string) =>
      render(
        <MenuSurface open onClose={() => closed.push(rendering)} at={{ x: 10, y: 10 }} autoFocus={false}>
          <MenuItem onSelect={() => {}}>Eintrag</MenuItem>
        </MenuSurface>
      );
    const send = (type: string, pointerType?: string) =>
      act(() => {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true });
        if (pointerType) Object.defineProperty(event, "pointerType", { value: pointerType });
        document.body.dispatchEvent(event);
      });
    show("first");
    send("pointerdown", "touch");
    show("second");
    send("mousedown");
    // Heard — and by the closure of the render that is current.
    expect(closed).toEqual(["second"]);
  });

  it("is exactly as wide as its anchor where it is asked to be — no wider, and no narrower than a narrow one", () => {
    const anchor = createRef<HTMLDivElement>();
    const box = (width: number) => ({ left: 40, top: 500, right: 40 + width, bottom: 540, width, height: 40, x: 40, y: 500, toJSON: () => ({}) }) as DOMRect;
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
    const menu = () => container.querySelector<HTMLElement>(".pv-menu")!;
    const open = (key: string, match: boolean) =>
      render(
        <>
          <div ref={anchor} />
          <MenuSurface key={key} open onClose={() => {}} anchorRef={anchor} matchAnchorWidth={match}>
            <MenuItem onSelect={() => {}}>Ein Eintrag mit einem sehr langen Namen</MenuItem>
          </MenuSurface>
        </>
      );
    try {
      rect.mockReturnValue(box(240));
      open("wide", true);
      expect([menu().style.minWidth, menu().style.maxWidth]).toEqual(["240px", "240px"]);
      // Under a line narrower than a menu's own least width it does not hang
      // out of the panel: the line's width wins.
      rect.mockReturnValue(box(133));
      open("narrow", true);
      expect([menu().style.minWidth, menu().style.maxWidth]).toEqual(["133px", "133px"]);
      // Not asked: its own least width, and the stylesheet's ceiling.
      open("plain", false);
      expect([menu().style.minWidth, menu().style.maxWidth]).toEqual(["180px", ""]);
    } finally {
      rect.mockRestore();
    }
  });

  it("does not close itself by opening: its focus scrolls nothing, and a scroll already on its way is not its own", async () => {
    // A context menu in the file tree (finding 2026-10-06). The menu is
    // rendered inside the list it belongs to and measured off screen first;
    // focusing its first item scrolled the list, and that scroll closed the
    // menu. So did the scroll of the click before it (a folder opening), whose
    // event the browser only delivers with the next frame.
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const onClose = vi.fn();
    render(
      <div data-testid="list" style={{ overflow: "auto" }}>
        <MenuSurface open onClose={onClose} at={{ x: 10, y: 10 }}>
          <MenuItem onSelect={() => {}}>Umbenennen</MenuItem>
        </MenuSurface>
      </div>
    );
    const list = container.querySelector<HTMLElement>("[data-testid=list]")!;
    const first = container.querySelector<HTMLElement>(".pv-menu-item")!;
    expect(focus.mock.contexts).toContain(first);
    expect(focus.mock.calls[focus.mock.contexts.indexOf(first)]).toEqual([{ preventScroll: true }]);
    focus.mockRestore();

    // The scroll that was pending when the menu opened.
    act(() => void list.dispatchEvent(new Event("scroll")));
    expect(onClose).not.toHaveBeenCalled();

    // From the first frame on, the list scrolling under the menu closes it — its own scrolling never does.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    act(() => void container.querySelector(".pv-menu")!.dispatchEvent(new Event("scroll")));
    expect(onClose).not.toHaveBeenCalled();
    act(() => void list.dispatchEvent(new Event("scroll")));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ClickCatch", () => {
  const send = (target: Element, type: string) =>
    act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })));

  it("catches the press beside its popover, and hears the press it does not get", () => {
    const onPress = vi.fn();
    const popover = createRef<HTMLDivElement>();
    render(
      <>
        <ClickCatch onPress={onPress} popover={popover} />
        <div ref={popover}><button>Übernehmen</button></div>
        {/* Something that lies in front of the catcher — a floating window when
            the popover sits in a stacking context of its own. */}
        <div data-testid="in-front" />
      </>
    );
    const catcher = container.querySelector<HTMLElement>(".pv-click-catch")!;

    // In the popover: no press beside it.
    send(popover.current!.querySelector("button")!, "pointerdown");
    expect(onPress).not.toHaveBeenCalled();

    // On the catcher: the press is the catcher's own, and its click closes —
    // once, not a second time through the listener.
    send(catcher, "pointerdown");
    expect(onPress).not.toHaveBeenCalled();
    act(() => catcher.click());
    expect(onPress).toHaveBeenCalledTimes(1);

    // In front of the catcher: it never gets that press, and hears it all the same.
    send(container.querySelector("[data-testid=in-front]")!, "pointerdown");
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it("closes on the mousedown already where it is asked to", () => {
    const onPress = vi.fn();
    const popover = createRef<HTMLDivElement>();
    render(
      <>
        <ClickCatch onPress={onPress} popover={popover} on="mousedown" />
        <div ref={popover} />
      </>
    );
    const catcher = container.querySelector<HTMLElement>(".pv-click-catch")!;
    send(catcher, "mousedown");
    expect(onPress).toHaveBeenCalledTimes(1);
    act(() => catcher.click());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("carries no layer of its own: the class does", () => {
    const popover = createRef<HTMLDivElement>();
    render(
      <>
        <ClickCatch onPress={() => {}} popover={popover} />
        <div ref={popover} />
      </>
    );
    expect(container.querySelector<HTMLElement>(".pv-click-catch")!.getAttribute("style")).toBeNull();
  });
});

describe("DropdownMenu (adapter)", () => {
  it("renders entries with separator and danger, select closes", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const anchorRef = createRef<HTMLElement>();
    (anchorRef as { current: HTMLElement | null }).current = anchor;
    render(
      <DropdownMenu
        open
        anchorRef={anchorRef}
        onClose={onClose}
        items={[
          { id: "a", label: "Aktion", onSelect },
          "separator",
          { id: "b", label: "Löschen", danger: true, onSelect: () => {} },
        ]}
      />
    );
    expect(container.querySelector("[role=separator]")).toBeTruthy();
    const danger = Array.from(container.querySelectorAll<HTMLButtonElement>(".pv-menu-item")).find(
      (b) => b.textContent === "Löschen"
    )!;
    expect(danger.className).toContain("pv-menu-item--danger");
    const first = container.querySelector<HTMLButtonElement>(".pv-menu-item")!;
    act(() => first.click());
    expect(onSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    anchor.remove();
  });
});

describe("TooltipHost", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the data-tip text after the delay and hides on keydown", () => {
    render(
      <div>
        <button data-tip="Hinweistext">i</button>
        <TooltipHost />
      </div>
    );
    const target = container.querySelector("button")!;
    act(() => {
      target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(document.querySelector(".pv-tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const tip = document.querySelector(".pv-tooltip");
    expect(tip?.textContent).toBe("Hinweistext");
    // Presentation only; the accessible name stays on the target.
    expect(tip?.getAttribute("aria-hidden")).toBe("true");

    press("a");
    expect(document.querySelector(".pv-tooltip")).toBeNull();
  });
});

describe("DockedToolbar", () => {
  it("renders a toolbar role on the shared class and hosts children", () => {
    render(
      <DockedToolbar className="extra">
        <button>B</button>
        <button>I</button>
      </DockedToolbar>
    );
    const bar = container.querySelector('[role="toolbar"]')!;
    expect(bar).not.toBeNull();
    expect(bar.classList.contains("pv-docked-toolbar")).toBe(true);
    expect(bar.classList.contains("extra")).toBe(true);
    expect(bar.querySelectorAll("button")).toHaveLength(2);
  });
});

// The field is laid out by its CALLER, so `style` — like `className` — has to
// address the whole field. It used to ride along in `...rest` onto the inner
// <input>, which is why the left sidebar's head could not shrink: the caller
// wrote `flex: 1; min-width: 0` and styled the wrong box.
describe("SearchField", () => {
  it("puts className and style on the field, not on the input", () => {
    render(
      <SearchField
        value=""
        onValueChange={() => {}}
        clearLabel="clear"
        className="extra"
        style={{ flex: 1, minWidth: 0 }}
        placeholder="find"
      />
    );
    const field = container.querySelector(".pv-searchfield") as HTMLElement;
    const input = container.querySelector("input") as HTMLInputElement;
    expect(field.classList.contains("extra")).toBe(true);
    expect(field.style.flex).toMatch(/^1\b/); // jsdom expands the shorthand
    expect(field.style.minWidth).toBe("0px");
    // The input keeps every prop that is genuinely an input's business.
    expect(input.getAttribute("style")).toBeNull();
    expect(input.placeholder).toBe("find");
  });
});

/**
 * The container grammar (mobile rework N2). Shared, so the desktop is the
 * shell that proves the primitive renders outside the phone — and it is
 * strictly additive: nothing here restyles an existing class, so no desktop
 * surface changes until one opts in.
 */
describe("GroupedRows", () => {
  it("puts rows in ONE clipping card, so the hairlines belong to the group", () => {
    render(
      <GroupCard>
        <RowList>
          <Row title="Erste" />
          <Row title="Zweite" />
        </RowList>
      </GroupCard>,
    );
    const card = container.querySelector(".pv-card");
    expect(card, "the group is not a card").not.toBeNull();
    // Flush: the card carries no padding and clips, so a row's hairline runs
    // edge to edge instead of stopping short of a rounded corner.
    expect(card!.className).toContain("pv-card--flush");
    expect(container.querySelectorAll(".pv-grouprows .pv-grouprow")).toHaveLength(2);
  });

  it("renders a row as icon slot, two lines and a trailing element", () => {
    render(<Row end="›" icon={<span>i</span>} subtitle="zweite Zeile" title="erste Zeile" />);
    expect(container.querySelector(".pv-grouprow-icon")?.textContent).toBe("i");
    expect(container.querySelector(".pv-grouprow-title")?.textContent).toBe("erste Zeile");
    expect(container.querySelector(".pv-grouprow-sub")?.textContent).toBe("zweite Zeile");
    expect(container.querySelector(".pv-grouprow-end")?.textContent).toBe("›");
  });

  it("leaves out the parts it was not given, rather than reserving empty ones", () => {
    render(<Row title="nur ein Titel" />);
    expect(container.querySelector(".pv-grouprow-icon")).toBeNull();
    expect(container.querySelector(".pv-grouprow-sub")).toBeNull();
    expect(container.querySelector(".pv-grouprow-end")).toBeNull();
  });

  it("is a button only when it does something", () => {
    // A row that merely SHOWS something must not appear in the accessibility
    // tree as a control the reader can act on.
    render(<Row title="nur Anzeige" />);
    expect(container.querySelector("button")).toBeNull();
    render(<Row onClick={() => {}} title="führt irgendwohin" />);
    expect(container.querySelector("button")).not.toBeNull();
  });

  it("indents by moving the left edge only", () => {
    render(
      <RowList>
        <Row title="Ebene 1" />
        <Row indent={1} title="Ebene 2" />
        <Row indent={2} title="Ebene 3" />
      </RowList>,
    );
    const rows = [...container.querySelectorAll(".pv-grouprow")];
    expect(rows[1]!.className).toContain("pv-grouprow--indent");
    expect(rows[2]!.className).toContain("pv-grouprow--indent2");
    // Every row keeps the same base class — the height is not a variant.
    for (const r of rows) expect(r.className).toContain("pv-grouprow");
  });

  it("gives the section heading one optional trailing slot, not a second heading", () => {
    render(<SectionLabel end={3}>Verbindung</SectionLabel>);
    const label = container.querySelector(".pv-grouplabel");
    expect(label?.textContent).toBe("Verbindung3");
    expect(container.querySelector(".pv-grouplabel-end")?.textContent).toBe("3");
    render(<SectionLabel>Ohne Zähler</SectionLabel>);
    expect(container.querySelector(".pv-grouplabel-end")).toBeNull();
  });

  it("changes the fill for a tone, never the metric", () => {
    render(<GroupCard tone="warn"><RowList><Row title="x" /></RowList></GroupCard>);
    const card = container.querySelector(".pv-card")!;
    expect(card.className).toContain("pv-card--warn");
    // Still the same flush card: a warning group is the same group.
    expect(card.className).toContain("pv-card--flush");
  });
});

describe("Chip", () => {
  it("keeps a leading icon OUT of the label's ellipsis span", () => {
    render(<Chip icon={<svg data-testid="glyph" />}>Notizen</Chip>);
    const chip = container.querySelector(".pv-chip")!;
    const glyph = container.querySelector(".pv-chip-icon")!;
    const text = container.querySelector(".pv-chip-text")!;

    // The reported defect, exactly: the icon lived INSIDE `.pv-chip-text`, so it
    // joined that span's `text-overflow` chain and rendered on the text baseline
    // instead of the optical centre.
    expect(text.querySelector("svg")).toBeNull();
    expect(glyph.querySelector("svg")).not.toBeNull();

    // And it comes first — a leading icon that follows its label is not a
    // leading icon.
    const kids = [...chip.children];
    expect(kids.indexOf(glyph)).toBeLessThan(kids.indexOf(text));
    expect(text.textContent).toBe("Notizen");
  });

  it("renders nothing extra without an icon", () => {
    render(<Chip>Notizen</Chip>);
    expect(container.querySelector(".pv-chip-icon")).toBeNull();
  });

  it("carries the gap that separates icon from label", async () => {
    // jsdom does not lay out, so the metric is pinned at the source: without
    // this declaration the glyph sits at 0px from the text — which is what the
    // maintainer saw on the bookmark chips.
    const { readFileSync } = await import("node:fs");
    // vitest runs with apps/desktop as its root.
    const css = readFileSync("../../packages/ui/src/styles/ui.css", "utf-8");
    const block = css.slice(css.indexOf(".pv-chip {"));
    expect(block.slice(0, block.indexOf("}"))).toMatch(/gap:\s*6px/);
  });
});
