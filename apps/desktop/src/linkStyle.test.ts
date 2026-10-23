// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyLinkStyle,
  isNoteLinkTarget,
  readNoteLinkStyle,
  readWebLinkStyle,
  DEFAULT_NOTE_LINK_STYLE,
  DEFAULT_WEB_LINK_STYLE,
} from "@plainva/ui";

/**
 * Appearance -> Links (maintainer, 2026-10-23): the look of links is a device
 * choice in both shells, and the default is the underline every version up to
 * 0.8.5 had - not the tint one tester asked for.
 */

const REPO = join(__dirname, "../../..");
const source = (rel: string) => readFileSync(join(REPO, rel), "utf8");
const root = () => document.documentElement;

afterEach(() => {
  root().removeAttribute("data-link-note");
  root().removeAttribute("data-link-web");
});

describe("the link look of a device", () => {
  it("defaults to underlined for both kinds", () => {
    expect(DEFAULT_NOTE_LINK_STYLE).toBe("underline");
    expect(DEFAULT_WEB_LINK_STYLE).toBe("underline");
    expect(readNoteLinkStyle(undefined)).toBe("underline");
    expect(readNoteLinkStyle("glitter")).toBe("underline");
    expect(readWebLinkStyle("subtle")).toBe("underline");
    expect(readNoteLinkStyle("subtle")).toBe("subtle");
    expect(readWebLinkStyle("color")).toBe("color");
  });

  it("writes a choice onto <html> and the default as no attribute", () => {
    applyLinkStyle("tint", "color");
    expect(root().getAttribute("data-link-note")).toBe("tint");
    expect(root().getAttribute("data-link-web")).toBe("color");
    applyLinkStyle("underline", "underline");
    expect(root().hasAttribute("data-link-note")).toBe(false);
    expect(root().hasAttribute("data-link-web")).toBe(false);
  });

  it("tells a link into the vault from a link out of it", () => {
    expect(isNoteLinkTarget("Projects/Atlas.md")).toBe(true);
    expect(isNoteLinkTarget("../Atlas.md#Plan")).toBe(true);
    expect(isNoteLinkTarget("#Plan")).toBe(true);
    expect(isNoteLinkTarget("https://example.org")).toBe(false);
    expect(isNoteLinkTarget("mailto:a@b.c")).toBe(false);
    expect(isNoteLinkTarget("obsidian://open?vault=x")).toBe(false);
    expect(isNoteLinkTarget("  ")).toBe(false);
  });
});

describe("every surface follows the choice", () => {
  it("draws a Markdown link into the vault like a wiki link, in the editor, the cells and the reading view", () => {
    expect(source("packages/ui/src/components/WikiLinkPlugin.ts")).toContain('const toNote = m.type === "wiki" || (m.type === "markdown" && isNoteLinkTarget(m.target));');
    expect(source("packages/ui/src/lib/inlineMarkdown.ts")).toMatch(/onOpenNote\?\.\(n\.written, e\.ctrlKey \|\| e\.metaKey, "markdown"\), true\)\)/);
    const reader = source("apps/desktop/src/components/MarkdownReader.tsx");
    expect(reader).not.toContain("textDecoration: 'underline'");
    expect(reader).toContain('className="pv-web-link"');
  });

  it("draws a link out of the vault from the web token", () => {
    expect(source("packages/ui/src/components/WikiLinkPlugin.ts")).toContain('textDecoration: "var(--web-link-decoration)"');
    expect(source("packages/ui/src/components/MarkdownTheme.ts")).toContain('textDecoration: "var(--web-link-decoration)"');
    expect(source("packages/ui/src/styles/ui.css")).toMatch(/\.pv-web-link \{[^}]*text-decoration: var\(--web-link-decoration\);/);
  });

  it("is a setting in both shells, applied at start", () => {
    expect(source("apps/desktop/src/main.tsx")).toContain("initLinkStyle();");
    expect(source("apps/desktop/src/services/appearanceSync.ts")).toContain('import("./linkStyle")');
    expect(source("apps/desktop/src/components/settings/AppPages.tsx")).toContain("<LinkStyleSettings />");
    expect(source("apps/mobile/src/services/mobileSettings.ts")).toContain("applyLinkStyle(readNoteLinkStyle(live().noteLinkStyle), readWebLinkStyle(live().webLinkStyle));");
    expect(source("apps/mobile/src/screens/AppearanceScreen.tsx")).toContain("<LinkStylePreview");
  });

  it("has a preview sentence with all three kinds of link in every language", () => {
    const dir = join(REPO, "packages/ui/src/locales");
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
      const sentence = JSON.parse(readFileSync(join(dir, file), "utf8")).settings.linkPreviewSentence as string;
      for (const tag of ["note", "web", "missing"]) expect(sentence, `${file}: <${tag}>`).toMatch(new RegExp(`<${tag}>[^<]+</${tag}>`));
    }
  });
});
