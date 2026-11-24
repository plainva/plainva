// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InlineTextLinks, hasInlineLinks } from "@plainva/ui";

/**
 * Parity `base-cell-text-links`: free text of a database cell keeps its links
 * alive in both shells. A press on a link follows it and stops there (the cell
 * around it would start editing); a press on any other word reaches the cell.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const cellClicks = vi.fn();
const openLink = vi.fn();
const openExternal = vi.fn();

async function show(text: string, external = true) {
  await act(async () => {
    root.render(
      <div data-testid="cell" onClick={cellClicks}>
        <InlineTextLinks text={text} onOpenLink={(target, kind) => openLink(target, kind)} onOpenExternal={external ? openExternal : undefined} />
      </div>,
    );
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  cellClicks.mockReset();
  openLink.mockReset();
  openExternal.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("InlineTextLinks", () => {
  it("knows whether a text carries a link at all", () => {
    expect(hasInlineLinks("just words")).toBe(false);
    expect(hasInlineLinks("see [[Other note]] today")).toBe(true);
    expect(hasInlineLinks("a [label](notes/x.md) b")).toBe(true);
    expect(hasInlineLinks("at https://example.com/x")).toBe(true);
  });

  it("renders a text without a link as it is", async () => {
    await show("plain words");
    expect(host.textContent).toBe("plain words");
    expect(host.querySelector(".pv-web-link")).toBeNull();
  });

  it("follows a wiki link on a press and does not reach the cell", async () => {
    await show("see [[Other note|the other]] today");
    const link = host.querySelector<HTMLElement>(".pv-web-link")!;
    expect(link.textContent).toBe("the other");
    await act(async () => link.click());
    expect(openLink).toHaveBeenCalledWith("Other note", "wiki");
    expect(cellClicks).not.toHaveBeenCalled();
  });

  it("follows a Markdown link to a note on a press", async () => {
    await show("a [label](notes/x.md) b");
    await act(async () => host.querySelector<HTMLElement>(".pv-web-link")!.click());
    expect(openLink).toHaveBeenCalledWith("notes/x.md", "markdown");
    expect(cellClicks).not.toHaveBeenCalled();
  });

  it("hands a bare web address and a web Markdown link to the owner's opener", async () => {
    await show("at https://example.com/x and [site](https://example.org)");
    const links = host.querySelectorAll<HTMLAnchorElement>("a.pv-web-link");
    expect(links).toHaveLength(2);
    await act(async () => links[0].click());
    await act(async () => links[1].click());
    expect(openExternal.mock.calls).toEqual([["https://example.com/x"], ["https://example.org"]]);
    expect(openLink).not.toHaveBeenCalled();
    expect(cellClicks).not.toHaveBeenCalled();
  });

  it("leaves an unsafe destination unopened", async () => {
    await show("[bad](javascript:alert(1)) end");
    await act(async () => host.querySelector<HTMLElement>(".pv-web-link")?.click());
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("lets a press on the words around a link reach the cell", async () => {
    await show("before [[Note]] after");
    const words = [...host.querySelectorAll<HTMLElement>("span")].find((el) => el.textContent === "before ")!;
    await act(async () => words.click());
    expect(cellClicks).toHaveBeenCalledTimes(1);
    expect(openLink).not.toHaveBeenCalled();
  });
});
