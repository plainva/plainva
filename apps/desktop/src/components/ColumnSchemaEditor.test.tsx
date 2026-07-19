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
