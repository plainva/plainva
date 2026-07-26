// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import "@plainva/ui/i18n";
import { ChipField } from "@plainva/ui";

/**
 * The chip field is shared by three surfaces (mail recipients, event attendees,
 * sender addresses), so its behaviour is pinned once here rather than three
 * times over. What matters is the contract those surfaces rely on: Enter and
 * the separators commit, Backspace on an empty input takes the last chip back,
 * duplicates are dropped quietly, blur commits what is still typed (a click on
 * Send must not drop a half-typed address), and the uncommitted draft is
 * reported so callers can fold it in.
 */

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

const parse = (raw: string) =>
  raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

function mount(values: string[] = [], extra: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  const onDraftChange = vi.fn();
  render(
    <ChipField
      values={values}
      onChange={onChange}
      onDraftChange={onDraftChange}
      parse={parse}
      removeLabel={(v) => `remove ${v}`}
      testId="cf"
      {...extra}
    />
  );
  const input = container.querySelector("input")!;
  return { onChange, onDraftChange, input };
}

function type(input: HTMLInputElement, value: string) {
  act(() => {
    // React tracks the previous value on the node; bypass it so `change` fires.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function key(input: HTMLInputElement, k: string) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
}

describe("ChipField", () => {
  it("commits on Enter", () => {
    const { onChange, input } = mount();
    type(input, "a@b.c");
    key(input, "Enter");
    expect(onChange).toHaveBeenCalledWith(["a@b.c"]);
  });

  it("commits on a separator and splits a pasted list in one go", () => {
    const { onChange, input } = mount(["first@x.y"]);
    type(input, "a@b.c, d@e.f");
    key(input, ";");
    expect(onChange).toHaveBeenCalledWith(["first@x.y", "a@b.c", "d@e.f"]);
  });

  it("drops a duplicate quietly instead of rejecting it", () => {
    const { onChange, input } = mount(["a@b.c"]);
    type(input, "a@b.c");
    key(input, "Enter");
    expect(onChange).toHaveBeenCalledWith(["a@b.c"]);
  });

  it("ignores input that parses to nothing", () => {
    const { onChange, input } = mount();
    type(input, "   ");
    key(input, "Enter");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("takes the last chip back on Backspace in an empty input", () => {
    const { onChange, input } = mount(["a@b.c", "d@e.f"]);
    key(input, "Backspace");
    expect(onChange).toHaveBeenCalledWith(["a@b.c"]);
  });

  it("leaves the chips alone when Backspace edits actual text", () => {
    const { onChange, input } = mount(["a@b.c"]);
    type(input, "typ");
    key(input, "Backspace");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("commits what is still typed when focus leaves", () => {
    const { onChange, input } = mount();
    type(input, "late@x.y");
    // React maps onBlur onto the native `focusout` (blur does not bubble).
    act(() => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(onChange).toHaveBeenCalledWith(["late@x.y"]);
  });

  it("reports the uncommitted draft so callers can fold it in", () => {
    const { onDraftChange, input } = mount();
    type(input, "half");
    expect(onDraftChange).toHaveBeenLastCalledWith("half");
  });

  it("removes a chip through its labelled button", () => {
    const { onChange } = mount(["a@b.c", "d@e.f"]);
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="remove a@b.c"]')!;
    act(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onChange).toHaveBeenCalledWith(["d@e.f"]);
  });

  it("renders one chip per value and shows the placeholder only while empty", () => {
    const { input } = mount([], { placeholder: "name@example.org" });
    expect(input.placeholder).toBe("name@example.org");
    expect(container.querySelectorAll(".pv-chip").length).toBe(0);

    render(
      <ChipField
        values={["a@b.c", "d@e.f"]}
        onChange={() => {}}
        parse={parse}
        removeLabel={(v) => `remove ${v}`}
        testId="cf"
        placeholder="name@example.org"
      />
    );
    expect(container.querySelectorAll(".pv-chip").length).toBe(2);
    expect(container.querySelector("input")!.placeholder).toBe("");
  });
});
