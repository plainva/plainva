// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createRef, type ReactElement } from "react";
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
import { MenuSurface, MenuItem } from "@plainva/ui";
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
