// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import "@plainva/ui/i18n";
import { ColumnSchemaEditor } from "./ColumnSchemaEditor";
import type { ColumnSchema } from "../services/baseSchema";

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

async function render(el: ReactElement) {
  await act(async () => root.render(el));
}

const t = ((k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k) as (
  key: string,
  opts?: unknown
) => string;

/** Values of every option/name text field currently on screen (the picker is a modal). */
function inputValues(): string[] {
  return [...document.querySelectorAll("input.pv-field")].map((el) => (el as HTMLInputElement).value);
}

describe("ColumnSchemaEditor option seeding (WP2)", () => {
  it("pre-fills the option list with the values used in the rows for a status column", async () => {
    await render(
      <ColumnSchemaEditor
        column="status"
        schema={{ input: "status" } as ColumnSchema}
        baseFiles={[]}
        currentBasePath="DB/Tasks.base"
        rows={[{ status: "draft" }, { status: "final" }, { status: "draft" }]}
        onSave={() => {}}
        onClose={() => {}}
        t={t}
      />
    );
    const values = inputValues();
    expect(values).toContain("draft");
    expect(values).toContain("final");
  });

  it("keeps curated options and appends only new observed values", async () => {
    await render(
      <ColumnSchemaEditor
        column="status"
        schema={{ input: "status", options: [{ value: "final", color: "green" }] } as ColumnSchema}
        baseFiles={[]}
        currentBasePath="DB/Tasks.base"
        rows={[{ status: "final" }, { status: "draft" }]}
        onSave={() => {}}
        onClose={() => {}}
        t={t}
      />
    );
    // "final" (curated) appears once and "draft" (observed) is appended.
    const values = inputValues().filter((v) => v === "final" || v === "draft");
    expect(values).toEqual(["final", "draft"]);
  });

  it("does not seed options for a plain text column", async () => {
    await render(
      <ColumnSchemaEditor
        column="notes"
        schema={{ input: "text" } as ColumnSchema}
        baseFiles={[]}
        currentBasePath="DB/Tasks.base"
        rows={[{ notes: "hello" }, { notes: "world" }]}
        onSave={() => {}}
        onClose={() => {}}
        t={t}
      />
    );
    const values = inputValues();
    expect(values).not.toContain("hello");
    expect(values).not.toContain("world");
  });
});

/** Text of the labels currently rendered in the modal. */
function labelTexts(): string[] {
  return [...document.querySelectorAll(".pv-modal-label")].map((el) => el.textContent ?? "");
}

describe("ColumnSchemaEditor rollup mode", () => {
  const base = {
    baseFiles: [],
    currentBasePath: "Projekte.base",
    allColumns: {
      aufgaben: { reverseOf: { base: "Aufgaben.base", property: "projekt" } },
      status: { input: "status" },
    } as Record<string, ColumnSchema>,
    onSave: () => {},
    onClose: () => {},
    t,
  };

  it("shows the aggregate fields and hides the property picker for a plain count", async () => {
    await render(
      <ColumnSchemaEditor
        column="anzahl"
        schema={{ rollup: { through: "aufgaben", fn: "count" } } as ColumnSchema}
        {...base}
      />
    );
    const labels = labelTexts();
    expect(labels).toContain("properties.rollupThrough");
    expect(labels).toContain("properties.rollupFn");
    // `count` counts the linked notes — there is no property to choose.
    expect(labels).not.toContain("properties.rollupOf");
    expect(labels).not.toContain("properties.rollupWhere");
  });

  it("asks for a property and a condition once the function needs them", async () => {
    await render(
      <ColumnSchemaEditor
        column="offen"
        schema={{ rollup: { through: "aufgaben", of: "status", fn: "countWhere", where: { op: "!=", value: "Erledigt" } } } as ColumnSchema}
        {...base}
      />
    );
    const labels = labelTexts();
    expect(labels).toContain("properties.rollupOf");
    expect(labels).toContain("properties.rollupWhere");
    expect(inputValues()).toContain("Erledigt");
  });

  it("saves the rollup without an input type — a derived column has none", async () => {
    let saved: ColumnSchema | null = null;
    await render(
      <ColumnSchemaEditor
        column="anzahl"
        schema={{ rollup: { through: "aufgaben", fn: "count" } } as ColumnSchema}
        {...base}
        onSave={(s) => { saved = s; }}
      />
    );
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent === "Speichern");
    await act(async () => { save?.click(); });
    expect(saved).toEqual({ rollup: { through: "aufgaben", fn: "count" } });
    expect((saved as unknown as ColumnSchema).input).toBeUndefined();
  });

  it("names the incomplete state instead of silently dropping the column on save", async () => {
    await render(
      <ColumnSchemaEditor
        column="summe"
        // `sum` needs a property; without one the spec is malformed.
        schema={{ rollup: { through: "aufgaben", fn: "sum" } } as ColumnSchema}
        {...base}
      />
    );
    expect(document.body.textContent).toContain("properties.rollupIncomplete");
  });

  it("says so when the database has no link column to reach through", async () => {
    await render(
      <ColumnSchemaEditor
        column="anzahl"
        schema={{ rollup: { through: "", fn: "count" } } as ColumnSchema}
        {...base}
        allColumns={{ status: { input: "status" } } as Record<string, ColumnSchema>}
      />
    );
    expect(document.body.textContent).toContain("properties.rollupNoLinks");
  });
});
