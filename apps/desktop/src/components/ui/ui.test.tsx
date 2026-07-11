// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import "@plainva/ui/i18n";
import { Button } from "@plainva/ui";
import { Fab, Segmented } from "@plainva/ui";
import { IconButton } from "@plainva/ui";
import { TextInput, SelectField, TextArea } from "@plainva/ui";
import { Checkbox } from "@plainva/ui";
import { Switch } from "@plainva/ui";
import { EmptyState } from "@plainva/ui";
import { Modal } from "@plainva/ui";
import { MenuSurface, MenuItem } from "@plainva/ui";
import { TooltipHost } from "@plainva/ui";
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

    press("a");
    expect(document.querySelector(".pv-tooltip")).toBeNull();
  });
});
