// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { setPlatformServices } from "@plainva/ui";
import { composeLinkPlugin } from "@plainva/ui/mail";

/**
 * Links in the mail composer (issue #34, wave 4). What matters: the markdown
 * syntax disappears while writing, the caret brings it back so the link stays
 * editable, a click opens externally — and a hostile scheme never becomes
 * clickable. Deliberately no vault resolution: a wiki link means nothing in an
 * email and must stay untouched text.
 */

const opened: string[] = [];

beforeAll(() => {
  setPlatformServices({
    loadSettings: async () => ({}) as never,
    credentials: {} as never,
    openExternal: async (url: string) => {
      opened.push(url);
    },
  } as never);
});

function mount(doc: string, cursor?: number) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [composeLinkPlugin()],
      selection: cursor != null ? { anchor: cursor } : undefined,
    }),
    parent,
  });
  return view;
}

/** The text the writer actually sees (replaced ranges are gone from the DOM). */
function visibleText(view: EditorView): string {
  return view.contentDOM.textContent ?? "";
}

function links(view: EditorView): HTMLElement[] {
  return [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-mail-link")];
}

describe("composeLinkPlugin", () => {
  it("hides the markdown syntax and keeps only the link text", () => {
    const view = mount("Mehr auf [meiner Website](https://plainva.com) — viele Grüße");
    expect(visibleText(view)).toContain("Mehr auf meiner Website");
    expect(visibleText(view)).not.toContain("https://plainva.com");
    expect(visibleText(view)).not.toContain("](");
    const [link] = links(view);
    expect(link?.textContent).toBe("meiner Website");
    expect(link?.getAttribute("data-mail-link")).toBe("https://plainva.com");
    view.destroy();
  });

  it("reveals the raw syntax when the caret is inside, so it stays editable", () => {
    const doc = "Mehr auf [meiner Website](https://plainva.com)";
    const view = mount(doc, doc.indexOf("Website") + 2);
    expect(visibleText(view)).toContain("](https://plainva.com)");
    // Still marked, so it does not visually jump between states.
    expect(links(view).length).toBe(1);
    view.destroy();
  });

  it("marks a bare URL without hiding anything", () => {
    const view = mount("Siehe https://plainva.com/docs dazu");
    expect(visibleText(view)).toContain("https://plainva.com/docs");
    expect(links(view)[0]?.getAttribute("data-mail-link")).toBe("https://plainva.com/docs");
    view.destroy();
  });

  it("opens an external target on click", () => {
    const view = mount("[Website](https://plainva.com)");
    const link = links(view)[0]!;
    opened.length = 0;
    link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    expect(opened).toEqual(["https://plainva.com"]);
    view.destroy();
  });

  it("never decorates a hostile scheme", () => {
    const view = mount("[Klick mich](javascript:alert(1))");
    expect(links(view).length).toBe(0);
    // The text stays exactly as written — nothing is hidden either.
    expect(visibleText(view)).toContain("javascript:alert(1)");
    view.destroy();
  });

  it("leaves wiki links alone — they mean nothing in an email", () => {
    const view = mount("Siehe [[Meine Notiz]] dazu");
    expect(links(view).length).toBe(0);
    expect(visibleText(view)).toContain("[[Meine Notiz]]");
    view.destroy();
  });

  it("does not swallow a footnote marker in front of a real link (issue #11 trap)", () => {
    const view = mount("Fussnote [^1] und [Website](https://plainva.com)");
    expect(visibleText(view)).toContain("[^1]");
    const all = links(view);
    expect(all.length).toBe(1);
    expect(all[0]?.textContent).toBe("Website");
    view.destroy();
  });

  it("leaves an image embed untouched", () => {
    const view = mount("![Logo](https://plainva.com/logo.png)");
    expect(links(view).length).toBe(0);
    expect(visibleText(view)).toContain("![Logo](https://plainva.com/logo.png)");
    view.destroy();
  });
});
