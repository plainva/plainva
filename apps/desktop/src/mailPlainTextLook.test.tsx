// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MailPlainText } from "@plainva/ui/mail";

/**
 * A plain-text mail reads in one font on both shells. The desktop's body
 * inherited the font of the surrounding chrome, the phone's took the content
 * font: the same message looked like two. One rule now, the component's own
 * (`.pv-mailtext` in ui.css), and each shell's class only places it.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
/** The declarations of one rule, by its selector as written. */
const rule = (css: string, selector: string) => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? null : css.slice(at, css.indexOf("}", at));
};

describe("the look of a plain-text mail", () => {
  it("is the component's: it always carries the shared class", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<MailPlainText text="Hallo" events={{ onOpen: () => {} }} className="m-mailtext" />));
    expect(host.querySelector("pre")?.className).toBe("pv-mailtext m-mailtext");
    act(() => root.render(<MailPlainText text="Hallo" events={{ onOpen: () => {} }} />));
    expect(host.querySelector("pre")?.className).toBe("pv-mailtext");
    act(() => root.unmount());
  });

  it("sets the content font once, for both shells, and neither shell sets a font of its own", () => {
    expect(rule(read("packages/ui/src/styles/ui.css"), ".pv-mailtext")).toContain("font-family: var(--font-content)");
    expect(rule(read("apps/mobile/src/mobile.css"), ".m-mailtext")).not.toMatch(/font-family|font-size|white-space/);
    expect(read("apps/desktop/src/components/mail/mail.css")).not.toContain(".pv-mail-text");
  });
});
