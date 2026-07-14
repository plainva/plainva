import { describe, expect, it } from "vitest";
import { safeHref } from "@plainva/ui";

describe("safeHref", () => {
  it("keeps http, https, mailto and tel URLs", () => {
    expect(safeHref("https://example.org/x")).toBe("https://example.org/x");
    expect(safeHref("http://example.org")).toBe("http://example.org");
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeHref("tel:+49123")).toBe("tel:+49123");
  });

  it("drops executable schemes from hostile cell content", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("  JavaScript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeHref("vbscript:msgbox(1)")).toBeUndefined();
  });

  it("passes relative, fragment and scheme-relative URLs through unchanged", () => {
    expect(safeHref("img/cover.png")).toBe("img/cover.png");
    expect(safeHref("#section")).toBe("#section");
    expect(safeHref("//cdn.example.org/x")).toBe("//cdn.example.org/x");
  });
});
