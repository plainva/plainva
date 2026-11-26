// @vitest-environment jsdom
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorState } from "@codemirror/state";
import { DESKTOP_NOTE_BUDGET, NOTE_BUDGET, readAsTextParts, setNoteBudget } from "@plainva/core";
import { ReadAsTextNotice } from "@plainva/ui";
import { readAsText, readAsTextField } from "../../../../packages/ui/src/components/readAsText";
import en from "../../../../packages/ui/src/locales/en.json";

/**
 * The notice says a part's links are not read wherever a part is not read
 * even in pieces — in each of the cases the handbook names, with the budget of
 * each shell: a paragraph too large for a piece, a list under one item too
 * heavy for a piece (not cut at its items), such a paragraph behind an
 * unclosed `---` in the first line. In the editor (its own decision) and in
 * the reading view (the text alone) alike, and its button goes to that part.
 */
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key.split(".").reduce<any>((o, k) => o?.[k], en) ?? key,
    i18n: { language: "en" },
  }),
}));

const mounted: { root: Root; host: HTMLDivElement }[] = [];
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
});
afterAll(() => setNoteBudget(NOTE_BUDGET));

async function shown(props: Parameters<typeof ReadAsTextNotice>[0]): Promise<HTMLElement | null> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => root.render(<ReadAsTextNotice {...props} />));
  return host.querySelector<HTMLElement>("[data-testid='read-as-text-notice']");
}

const FORMS: Record<string, (n: number) => string> = {
  "a paragraph too large for a piece": (n) => `# Big\n\n${Array.from({ length: n }, (_, i) => `line ${i} [[Target]] see words ${i}`).join("\n")}\n`,
  "a list under one item too heavy for a piece": (n) => `# Big\n\n- outer\n${Array.from({ length: n }, (_, i) => `  - sub ${i} [[Target]] words ${i}`).join("\n")}\n`,
  "such a paragraph behind an unclosed `---`": (n) => `---\n${Array.from({ length: n }, (_, i) => `line ${i} [[Target]] words ${i}`).join("\n")}\n`,
};

for (const [shell, budget] of [["phone", NOTE_BUDGET], ["desktop", DESKTOP_NOTE_BUDGET]] as const) {
  describe(`the notice of a part not read, on the ${shell}`, () => {
    for (const [name, make] of Object.entries(FORMS)) {
      it(`${name}: says its links are not read, in the editor and in the reading view, and goes there`, async () => {
        expect.hasAssertions();
        setNoteBudget(budget);
        let n = 256;
        while (readAsTextParts(make(n)).unread.length === 0) n *= 2;
        const text = make(n);
        const state = EditorState.create({ doc: text, extensions: [readAsText()] }).field(readAsTextField);
        expect(state.unread.length).toBeGreaterThan(0);
        const jumps: number[] = [];
        for (const props of [{ state, onJump: (at: number) => jumps.push(at) }, { content: text, onJump: (at: number) => jumps.push(at) }]) {
          const notice = await shown(props);
          expect(notice?.dataset.unread).toBe("true");
          expect(notice?.textContent).toContain(en.editor.readAsTextUnread);
          await act(async () => notice!.querySelector<HTMLButtonElement>("[data-testid='read-as-text-jump']")!.click());
        }
        expect(jumps).toEqual([state.unread[0].from, state.unread[0].from]);
      }, 120_000);
    }
  });
}
