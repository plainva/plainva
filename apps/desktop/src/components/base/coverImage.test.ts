import { describe, it, expect } from "vitest";
import { resolveCoverSource } from "@plainva/ui";

/**
 * Gallery cover classification (plan "Vorlagen-Überarbeitung + Plainva-Tour",
 * P1.4). The gallery used to hand the raw value to `<img src>`, so a cover
 * stored IN the vault — the normal case for a local vault — rendered as nothing:
 * the WebView cannot fetch a file path. The resolution order matters as much as
 * the safety check, hence a test rather than an inline regex.
 */

describe("resolveCoverSource", () => {
  it("passes fetchable URLs through verbatim", () => {
    expect(resolveCoverSource("https://example.org/a.png")).toEqual({ kind: "url", url: "https://example.org/a.png" });
    expect(resolveCoverSource("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toMatchObject({ kind: "url" });
    expect(resolveCoverSource("blob:abc")).toMatchObject({ kind: "url" });
  });

  it("refuses schemes an image must never carry", () => {
    expect(resolveCoverSource("javascript:alert(1)")).toBeNull();
    expect(resolveCoverSource("file:///etc/passwd")).toBeNull();
    expect(resolveCoverSource("vbscript:x")).toBeNull();
    // A non-image data URL is not a cover either.
    expect(resolveCoverSource("data:text/html,<script>")).toBeNull();
  });

  it("treats a scheme-less value as a vault path, root first, then note-relative", () => {
    const src = resolveCoverSource("cover.svg", "Bereiche/Arbeit.md");
    expect(src).toMatchObject({ kind: "vault" });
    expect((src as { candidates: string[] }).candidates).toEqual(["cover.svg", "Bereiche/cover.svg"]);
  });

  it("resolves a vault path without a note folder to the root candidate only", () => {
    const src = resolveCoverSource("Anhänge/cover.svg", "Arbeit.md");
    expect((src as { candidates: string[] }).candidates).toEqual(["Anhänge/cover.svg"]);
  });

  it("accepts a wiki embed, so a value copied out of a note still works", () => {
    const src = resolveCoverSource("![[Anhänge/cover.svg]]", "Bereiche/Arbeit.md");
    expect((src as { candidates: string[] }).candidates[0]).toBe("Anhänge/cover.svg");
    expect(resolveCoverSource("[[cover.svg|Alt]]", "x.md")).toMatchObject({ kind: "vault" });
  });

  it("returns nothing for empty, blank or non-string values", () => {
    expect(resolveCoverSource("")).toBeNull();
    expect(resolveCoverSource("   ")).toBeNull();
    expect(resolveCoverSource(null)).toBeNull();
    expect(resolveCoverSource(42)).toBeNull();
  });

  it("refuses a path that escapes the vault", () => {
    expect(resolveCoverSource("../../secrets.png", "a/b.md")).toBeNull();
  });
});
