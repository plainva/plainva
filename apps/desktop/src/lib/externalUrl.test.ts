// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contactPropertyHref, EXTERNAL_SCHEMES, externalUrlToOpen, guardedExternalOpener, opensOutside, safeHref, toast, toastStore } from "@plainva/ui";
import { shippedSources, sourceFile } from "../test-sourceTree";

/**
 * Only web, mail and phone addresses leave the app — in both shells, through
 * one sink (Sammelplan § 3.138, review 2026-10-22). The phone handed every
 * other scheme to `window.open` inside its WebView; a URL property in a
 * database cell reached it with `javascript:` or `intent:` from a synced vault.
 */

const ctrl = (code: number) => String.fromCharCode(code);

describe("the one rule for what leaves the app", () => {
  it("allows web, mail and phone addresses, whatever their case", () => {
    expect(EXTERNAL_SCHEMES).toEqual(["http:", "https:", "mailto:", "tel:"]);
    for (const url of ["https://plainva.com/a?b=1", "http://a.example", "HTTPS://A.EXAMPLE/X", "mailto:hello@example.com", "MailTo:a@b.c", "tel:+4930123", "tel:+49 30 123"]) {
      expect(externalUrlToOpen(url)).toBe(url);
    }
  });

  it("reads the address as the browser does: blanks and controls around it go, tabs and line breaks inside go", () => {
    expect(externalUrlToOpen("  https://a.example/x  ")).toBe("https://a.example/x");
    expect(externalUrlToOpen(`${ctrl(1)}${ctrl(0x1f)} https://a.example/x${ctrl(0)}`)).toBe("https://a.example/x");
    expect(externalUrlToOpen(`ht${ctrl(9)}tps://a.exa${ctrl(10)}mple/x`)).toBe("https://a.example/x");
  });

  it("refuses every other scheme, however it is dressed up", () => {
    const refused = [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "  javascript:alert(1)",
      `${ctrl(1)}javascript:alert(1)`,
      `${ctrl(0)}${ctrl(0x0b)}javascript:alert(1)`,
      `java${ctrl(9)}script:alert(1)`,
      `java${ctrl(10)}script:alert(1)`,
      `java${ctrl(13)}script:alert(1)`,
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///C:/Users/x/secret.txt",
      "blob:https://a.example/123",
      "intent://scan/#Intent;scheme=zxing;package=x;end",
      "obsidian://open?vault=v",
      "shortcuts://run-shortcut?name=x",
      "about:blank",
    ];
    for (const url of refused) expect(externalUrlToOpen(url), JSON.stringify(url)).toBeNull();
  });

  it("refuses a scheme hidden behind percent-encoding, a relative value and nothing at all", () => {
    for (const url of ["%6Aavascript:alert(1)", "javascript%3Aalert(1)", "Notes/Brief.md", "www.example.com", "//cdn.example.org/x", "#heading", "", "   ", "https://", "http://exa mple.com"]) {
      expect(externalUrlToOpen(url), JSON.stringify(url)).toBeNull();
    }
    expect(externalUrlToOpen(42)).toBeNull();
    expect(externalUrlToOpen(null)).toBeNull();
  });

  it("is the rule a click on a link and an href follow too", () => {
    expect(opensOutside(`${ctrl(1)}javascript:alert(1)`)).toBe(false);
    expect(opensOutside(" https://a.example")).toBe(true);
    // An href keeps relative values (no scheme to run) but reads the scheme as the browser does.
    expect(safeHref(`${ctrl(1)}javascript:alert(1)`)).toBeUndefined();
    expect(safeHref(`java${ctrl(9)}script:alert(1)`)).toBeUndefined();
    expect(safeHref("intent://x#Intent;end")).toBeUndefined();
    expect(safeHref("img/cover.png")).toBe("img/cover.png");
    expect(safeHref("tel:+491")).toBe("tel:+491");
  });

  it("gives a contact property the address it opens, the same in a cell and in a note's properties", () => {
    expect(contactPropertyHref("email", " a@b.c ")).toBe("mailto:a@b.c");
    expect(contactPropertyHref("phone", "+49 30 1")).toBe("tel:+49 30 1");
    expect(contactPropertyHref("url", "plainva.com/docs")).toBe("https://plainva.com/docs");
    expect(contactPropertyHref("url", "http://a.example")).toBe("http://a.example");
    // Written with a scheme, it stays as written — the sink decides, and refuses this one.
    expect(contactPropertyHref("url", "javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(externalUrlToOpen(contactPropertyHref("url", "javascript:alert(1)"))).toBeNull();
    expect(contactPropertyHref("url", "  ")).toBeNull();
    expect(contactPropertyHref("text", "https://a.example")).toBeNull();
  });
});

describe("the sink both shells register", () => {
  beforeEach(() => toast.clearAll());
  afterEach(() => toast.clearAll());

  it("hands an allowed address to the shell's opener, as the browser reads it", async () => {
    const opened: string[] = [];
    const open = guardedExternalOpener(async (url) => { opened.push(url); });
    await open(" https://a.example/x\n");
    await open("mailto:a@b.c");
    expect(opened).toEqual(["https://a.example/x", "mailto:a@b.c"]);
    expect(toastStore.get()).toEqual([]);
  });

  it("never hands a refused address on, says so once, and resolves", async () => {
    const opened: string[] = [];
    const open = guardedExternalOpener(async (url) => { opened.push(url); });
    await expect(open("javascript:alert(1)")).resolves.toBeUndefined();
    expect(opened).toEqual([]);
    expect(toastStore.get()).toHaveLength(1);
    const [notice] = toastStore.get();
    expect(notice.kind).toBe("warning");
    expect(notice.message).toBe("This link was not opened for your safety: Plainva only opens web, mail and phone links.");
    // The address itself never goes into the message.
    expect(notice.message).not.toContain("alert");
  });

  it("lets the opener's own failure through to the caller", async () => {
    const open = guardedExternalOpener(async () => { throw new Error("no browser"); });
    await expect(open("https://a.example")).rejects.toThrow("no browser");
  });
});

describe("no way out of the app beside the sink", () => {
  const shipped = shippedSources();

  it("registers the guarded opener in both shells", () => {
    expect(sourceFile("apps/desktop/src/main.tsx")).toMatch(/openExternal: openExternalUrl,/);
    expect(sourceFile("apps/desktop/src/services/openExternal.ts")).toMatch(/guardedExternalOpener\(\(allowed\) => openUrl\(allowed\)\)/);
    expect(sourceFile("apps/mobile/src/main.tsx")).toMatch(/openExternal: openExternalUrl,/);
    expect(sourceFile("apps/mobile/src/services/openExternal.ts")).toMatch(/return guardedExternalOpener\(async \(allowed\) =>/);
  });

  it("imports the desktop opener plugin's openUrl in one file only", () => {
    const offenders: string[] = [];
    for (const { rel, text } of shipped) {
      if (!rel.startsWith("apps/desktop/src/") || rel === "apps/desktop/src/services/openExternal.ts") continue;
      for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@tauri-apps\/plugin-opener["']/g)) {
        if (/\bopenUrl\b/.test(m[1])) offenders.push(rel);
      }
      // A dynamic import of the plugin may only take what opens a FILE.
      for (const m of text.matchAll(/(?:const|let)\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*["']@tauri-apps\/plugin-opener["']\s*\)/g)) {
        if (!/^\s*(openPath|revealItemInDir)(\s*,\s*(openPath|revealItemInDir))*\s*$/.test(m[1])) offenders.push(rel);
      }
      const dynamic = (text.match(/import\(\s*["']@tauri-apps\/plugin-opener["']\s*\)/g) ?? []).length;
      const fileOnly = (text.match(/(?:const|let)\s*\{\s*(?:openPath|revealItemInDir)[^}]*\}\s*=\s*await\s+import\(\s*["']@tauri-apps\/plugin-opener["']\s*\)/g) ?? []).length;
      if (dynamic !== fileOnly) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("calls window.open only in the phone's sink, and Browser.open only there and in the sign-in", () => {
    const sink = "apps/mobile/src/services/openExternal.ts";
    const windowOpen: string[] = [];
    const browserOpen: string[] = [];
    for (const { rel, text } of shipped) {
      if (/\bwindow\.open\s*\(/.test(text) && rel !== sink) windowOpen.push(rel);
      if (/\bBrowser\.open\s*\(/.test(text) && rel !== sink && rel !== "apps/mobile/src/platform/webAuth.ts") browserOpen.push(rel);
    }
    expect(windowOpen).toEqual([]);
    expect(browserOpen).toEqual([]);
  });
});
