import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { FloatingWindow, FontField, MenuItem, MenuSurface, Select } from "../../../../packages/ui/src/index";
import { AddPropertyPopover, PropertyRow, PropertyValue, SelectChip } from "../../src/components/PropertyValues";
import { InlineMultiSelect, InlineRelationEditor } from "../../src/components/BaseInlineEditors";
import { CustomDatePicker } from "../../src/components/DatePicker";
import { TableSizePicker } from "../../src/components/TableSizePicker";
import { BasePicker } from "../../src/components/BasePicker";
import { VaultContext } from "../../src/contexts/VaultContext";
import type { PropertyType } from "../../../../packages/ui/src/index";
import "../../../../packages/ui/src/styles/base-colors.css";
import "../../../../packages/ui/src/styles/tokens.css";
import "../../../../packages/ui/src/styles/ui.css";
import "../../../../packages/ui/src/themes/index.css";
import "../../src/App.css";
import "../../../../packages/ui/src/i18n";

/**
 * The probe for a surface that is left by a press beside it (Sammelplan
 * § 3.100): ONE such surface at a time — the real component, over the real
 * stylesheets — and three things to press beside it:
 *
 *  - the head of a real `FloatingWindow`. It takes the press for a drag and
 *    cancels its `pointerdown`; the browser then sends no `mousedown` at all.
 *  - a "stopper", an element that stops the `mousedown` on its way, as a
 *    table cell of the editor, a link in a rendered cell or a comment bubble
 *    do. What listens at the document in the bubble phase never hears it.
 *  - a "grip" that cancels its `pointerdown`, as a database column's grips do.
 *    It lies above every layer — above a palette's overlay too, which covers
 *    the window's head.
 *
 * Each surface writes what it was given (`value`) and how often it said it
 * was left (`closes`), so a test sees what a press beside it does beyond
 * closing it.
 */

export type StationName =
  | "select"
  | "font"
  | "relation"
  | "tags"
  | "select-chip"
  | "multi"
  | "type-menu"
  | "add-property"
  | "cell-multi"
  | "cell-relation"
  | "date"
  | "date-cell"
  | "table-size"
  | "base-picker"
  | "menu";

type T = (key: string, opts?: Record<string, unknown>) => string;

function Outputs({ value, closes }: { value: unknown; closes: number }) {
  return (
    <p>
      <output data-testid="value">{typeof value === "string" ? value : JSON.stringify(value)}</output>{" "}
      <output data-testid="closes">{closes}</output>
    </p>
  );
}

/** Opened by a button, as most of them are in the app; an editor as a table cell mounts it. */
function Opener({ label, onOpen }: { label: string; onOpen: () => void }) {
  return <button type="button" data-testid="open" onClick={onOpen}>{label}</button>;
}

function SelectStation() {
  const [value, setValue] = useState("a");
  const [closes, setCloses] = useState(0);
  return (
    <>
      <Select
        data-testid="select-trigger"
        ariaLabel="Probe list"
        value={value}
        onChange={setValue}
        onClose={() => setCloses((n) => n + 1)}
        options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma" }]}
      />
      <Outputs value={value} closes={closes} />
    </>
  );
}

function FontStation() {
  const [value, setValue] = useState("");
  return (
    <>
      <FontField value={value} onChange={setValue} defaultLabel="Default (Inter)" ariaLabel="Probe font" data-testid="font-field" />
      <Outputs value={value} closes={0} />
    </>
  );
}

function PropertyStation({ type, t }: { type: PropertyType; t: T }) {
  const { i18n } = useTranslation();
  const [value, setValue] = useState<unknown>(type === "multiselect" ? ["red"] : []);
  return (
    <>
      <PropertyValue
        type={type}
        value={value}
        propKey="Probe"
        onChange={setValue}
        tagSuggestions={[{ tag: "alpha", count: 3 }, { tag: "beta", count: 1 }]}
        curatedOptions={type === "multiselect" ? [{ value: "red" }, { value: "green" }, { value: "blue" }] : undefined}
        getRelationCandidates={async () => [{ path: "Alpha.md", title: "Alpha" }, { path: "Beta.md", title: "Beta" }]}
        t={t}
        locale={i18n.language}
      />
      <Outputs value={value} closes={0} />
    </>
  );
}

function SelectChipStation({ t }: { t: T }) {
  const [value, setValue] = useState("active");
  const [closes, setCloses] = useState(0);
  return (
    <>
      <SelectChip value={value} onChange={setValue} propKey="Status" curated={[{ value: "active" }, { value: "paused" }]} t={t} onClose={() => setCloses((n) => n + 1)} />
      <Outputs value={value} closes={closes} />
    </>
  );
}

function TypeMenuStation({ t }: { t: T }) {
  const { i18n } = useTranslation();
  const [type, setType] = useState<PropertyType>("text");
  return (
    <>
      <PropertyRow
        propKey="Probe"
        value="x"
        type={type}
        onChangeValue={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        onChangeType={(_key, next) => setType(next)}
        tagSuggestions={[]}
        t={t}
        locale={i18n.language}
      />
      <Outputs value={type} closes={0} />
    </>
  );
}

function AddPropertyStation({ t }: { t: T }) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [closes, setCloses] = useState(0);
  return (
    <>
      <button ref={button} type="button" data-testid="open" onClick={() => setOpen((o) => !o)}>Add property</button>
      {open && (
        <AddPropertyPopover
          source={null}
          registry={{}}
          existing={[]}
          onAdd={(name, type) => setValue(`${name}:${type}`)}
          onClose={() => { setOpen(false); setCloses((n) => n + 1); }}
          t={t}
          anchorRef={button}
        />
      )}
      <Outputs value={value} closes={closes} />
    </>
  );
}

function CellStation({ kind, t }: { kind: "multi" | "relation"; t: T }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string[]>(kind === "multi" ? ["red"] : []);
  const [closes, setCloses] = useState(0);
  const close = () => { setEditing(false); setCloses((n) => n + 1); };
  return (
    <>
      <Opener label="Edit cell" onOpen={() => setEditing(true)} />
      <div style={{ width: 320 }}>
        {editing && kind === "multi" && (
          <InlineMultiSelect value={value} options={[{ value: "red" }, { value: "green" }, { value: "blue" }]} onCommit={setValue} onClose={close} t={t} />
        )}
        {editing && kind === "relation" && (
          <InlineRelationEditor
            value={value}
            search={async () => [{ path: "Alpha.md", title: "Alpha" }, { path: "Beta.md", title: "Beta" }]}
            onCommit={setValue}
            onClose={close}
            t={t}
          />
        )}
      </div>
      <Outputs value={value} closes={closes} />
    </>
  );
}

function DateStation({ cell }: { cell: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("2026-10-22");
  const [closes, setCloses] = useState(0);
  const onClose = () => { setCloses((n) => n + 1); if (cell) setEditing(false); };
  return (
    <>
      {cell && <Opener label="Edit cell" onOpen={() => setEditing(true)} />}
      <div style={{ width: 240 }}>
        {(!cell || editing) && (
          <CustomDatePicker value={value} onChange={setValue} includeTime={cell} autoOpen={cell} onClose={onClose} />
        )}
      </div>
      <Outputs value={value} closes={closes} />
    </>
  );
}

function TableSizeStation() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [closes, setCloses] = useState(0);
  return (
    <>
      <Opener label="Insert table" onOpen={() => setOpen(true)} />
      {open && (
        <TableSizePicker
          x={40}
          y={140}
          onSelect={(rows, cols) => { setValue(`${rows}x${cols}`); setOpen(false); }}
          onClose={() => { setOpen(false); setCloses((n) => n + 1); }}
        />
      )}
      <Outputs value={value} closes={closes} />
    </>
  );
}

/** The one thing of the vault the picker reads: the `.base` files. */
const pickerVault = { queryService: { db: { query: async () => [{ path: "Board.base", title: "Board" }] } } };

function BasePickerStation() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [closes, setCloses] = useState(0);
  return (
    <VaultContext.Provider value={pickerVault as never}>
      <Opener label="Embed database" onOpen={() => setOpen(true)} />
      {open && (
        <BasePicker
          onPick={(path) => { setValue(path); setOpen(false); }}
          onCreate={() => {}}
          onClose={() => { setOpen(false); setCloses((n) => n + 1); }}
        />
      )}
      <Outputs value={value} closes={closes} />
    </VaultContext.Provider>
  );
}

function MenuStation() {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  return (
    <>
      <button ref={anchor} type="button" data-testid="open" onClick={() => setOpen((o) => !o)}>Menu</button>
      <MenuSurface open={open} onClose={() => setOpen(false)} anchorRef={anchor} ariaLabel="Probe menu">
        <MenuItem onSelect={() => setValue("one")}>One</MenuItem>
        <MenuItem onSelect={() => setValue("two")}>Two</MenuItem>
      </MenuSurface>
      <Outputs value={value} closes={0} />
    </>
  );
}

function Station({ name }: { name: StationName }) {
  const { t } = useTranslation();
  const tt = t as unknown as T;
  switch (name) {
    case "select": return <SelectStation />;
    case "font": return <FontStation />;
    case "relation": return <PropertyStation type="link" t={tt} />;
    case "tags": return <PropertyStation type="tags" t={tt} />;
    case "select-chip": return <SelectChipStation t={tt} />;
    case "multi": return <PropertyStation type="multiselect" t={tt} />;
    case "type-menu": return <TypeMenuStation t={tt} />;
    case "add-property": return <AddPropertyStation t={tt} />;
    case "cell-multi": return <CellStation kind="multi" t={tt} />;
    case "cell-relation": return <CellStation kind="relation" t={tt} />;
    case "date": return <DateStation cell={false} />;
    case "date-cell": return <DateStation cell />;
    case "table-size": return <TableSizeStation />;
    case "base-picker": return <BasePickerStation />;
    case "menu": return <MenuStation />;
  }
}

/** Stops the `mousedown` on its way, as the editor's table cell does (`LivePreviewPlugin`). */
function Stopper({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
    el.addEventListener("mousedown", stop);
    return () => el.removeEventListener("mousedown", stop);
  }, []);
  return (
    <div ref={ref} data-testid="stopper" style={{ position: "fixed", right: 24, top: 24, width: 220, height: 48, display: "grid", placeItems: "center", border: "1px dashed var(--border-color)" }}>
      {children}
    </div>
  );
}

function Desk({ name }: { name: StationName }) {
  return (
    <>
      <section data-testid="station" style={{ padding: 16, width: 560, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
        <Station name={name} />
      </section>
      <Stopper>A cell of the editor</Stopper>
      {/* A grip as a column's: it takes the press for a drag. Above every layer. */}
      <div
        data-testid="grip"
        onPointerDown={(e) => e.preventDefault()}
        style={{ position: "fixed", right: 24, top: 96, width: 220, height: 48, zIndex: 2000, display: "grid", placeItems: "center", cursor: "col-resize", background: "var(--bg-secondary)" }}
      >
        A grip
      </div>
      <FloatingWindow
        persistKey="probe-press-beside"
        defaultWidth={360}
        defaultHeight={240}
        minWidth={240}
        minHeight={160}
        ariaLabel="Window"
        testId="win"
        head={<span className="pv-peek-title">Window</span>}
      >
        <p data-testid="win-text" style={{ padding: 16 }}>Text in the window</p>
      </FloatingWindow>
    </>
  );
}

let root: Root | undefined;
export const pressBesideProbe = {
  mount(name: StationName) {
    root?.unmount();
    root = createRoot(document.getElementById("host")!);
    root.render(<Desk name={name} />);
  },
};
export type PressBesideProbeWindow = Window & { pressBesideProbe: typeof pressBesideProbe };
(window as PressBesideProbeWindow).pressBesideProbe = pressBesideProbe;
