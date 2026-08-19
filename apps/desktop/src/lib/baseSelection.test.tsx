// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

import { BaseTableView } from "../components/base/BaseTableView";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: any) => o?.defaultValue ?? k }),
}));

/**
 * The two things P3 could break silently.
 *
 * The click is already spoken for in both shells — a cell click opens the
 * inline editor and always has (S18). If the selection column ever swallowed
 * that click, the table would stop being editable and no type error would say
 * so. Both assertions below fail without the guard they describe.
 */
function render(ui: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => act(() => { root.unmount(); }) };
}

const ROWS = [
  { "file.path": "a.md", "file.name": "A", status: "open" },
  { "file.path": "b.md", "file.name": "B", status: "done" },
];

function cells(onCellClick: (path: string) => void) {
  return {
    editingCell: null,
    columnLabel: (c: string) => c,
    formatValueForDisplay: (v: any) => ({ displayVal: String(v ?? ""), isMissing: false }),
    // The real cell is a button that opens the editor; this stands in for it.
    renderEditableCell: (row: any, col: string) => (
      <span data-testid={`cell-${row["file.path"]}-${col}`} onClick={() => onCellClick(row["file.path"])}>
        {String(row[col] ?? "")}
      </span>
    ),
  } as any;
}

describe("database rows: selecting must not take the cell's click", () => {
  it("a click in a CELL still edits while a selection exists", () => {
    const edited: string[] = [];
    const onClick = vi.fn();
    const { host, unmount } = render(
      <BaseTableView
        dbData={ROWS}
        visibleColumns={["status"]}
        colWidths={{}}
        cells={cells((p) => edited.push(p))}
        getSortState={() => null}
        onToggleHeaderSort={() => {}}
        onReorderColumns={() => {}}
        onPersistColumnWidth={() => {}}
        onOpenColumnEditor={() => {}}
        onToggleColumn={() => {}}
        selection={{
          selected: new Set(["a.md"]),
          allSelected: false,
          onToggleAll: () => {},
          onClick,
        }}
      />
    );
    const cell = host.querySelector('[data-testid="cell-b.md-status"]') as HTMLElement;
    act(() => { cell.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    // The cell reached its own handler …
    expect(edited).toEqual(["b.md"]);
    // … and the selection did NOT eat it.
    expect(onClick).not.toHaveBeenCalled();
    unmount();
  });

  it("the table announces an active selection so the column stops hiding", () => {
    // The column is ghosted until it is needed — it appears on hover, on focus,
    // when checked, and for EVERY row while a selection exists. That last one
    // hangs on this class: without it a person who selected one row would see
    // the other checkboxes vanish again the moment the pointer left.
    const props = {
      dbData: ROWS,
      visibleColumns: ["status"],
      colWidths: {},
      cells: cells(() => {}),
      getSortState: () => null,
      onToggleHeaderSort: () => {},
      onReorderColumns: () => {},
      onPersistColumnWidth: () => {},
      onOpenColumnEditor: () => {},
      onToggleColumn: () => {},
    } as any;
    const empty = render(
      <BaseTableView {...props} selection={{ selected: new Set<string>(), allSelected: false, onToggleAll: () => {}, onClick: () => {} }} />
    );
    expect(empty.host.querySelector("table")!.className).not.toContain("is-selecting");
    empty.unmount();

    const picked = render(
      <BaseTableView {...props} selection={{ selected: new Set(["a.md"]), allSelected: false, onToggleAll: () => {}, onClick: () => {} }} />
    );
    expect(picked.host.querySelector("table")!.className).toContain("is-selecting");
    // And the picked row carries the tint.
    expect(picked.host.querySelectorAll("tr.is-selected").length).toBe(1);
    picked.unmount();
  });

  it("without a selection prop there is no column at all", () => {
    const { host, unmount } = render(
      <BaseTableView
        dbData={ROWS}
        visibleColumns={["status"]}
        colWidths={{}}
        cells={cells(() => {})}
        getSortState={() => null}
        onToggleHeaderSort={() => {}}
        onReorderColumns={() => {}}
        onPersistColumnWidth={() => {}}
        onOpenColumnEditor={() => {}}
        onToggleColumn={() => {}}
      />
    );
    expect(host.querySelectorAll(".pv-selcol").length).toBe(0);
    unmount();
  });
});
