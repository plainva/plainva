// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { CommentBody } from "@plainva/ui";

function render(ui: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => act(() => { root.unmount(); }) };
}

const NAMES = new Map([["aabbccdd11223344", "Marco"]]);

/**
 * The text of a remark (K4, finding 2026-09-03): a `[[wiki link]]` is a link,
 * not brackets; a mention stays a mention; a click on the link does not
 * select the card around it.
 */
describe("CommentBody", () => {
  it("renders a wiki link as a link that opens the note and stops at itself", () => {
    const onOpenNote = vi.fn();
    const cardClick = vi.fn();
    const { host, unmount } = render(
      <div onClick={cardClick}>
        <CommentBody body="Task created: [[Aufgaben/Budgetzeile verlinken|Budgetzeile verlinken]]" names={NAMES} onOpenNote={onOpenNote} />
      </div>,
    );
    try {
      const link = host.querySelector("a.pv-comment-card__link") as HTMLAnchorElement;
      expect(link.textContent).toBe("Budgetzeile verlinken");
      expect(host.textContent).not.toContain("[[");
      act(() => { link.click(); });
      expect(onOpenNote).toHaveBeenCalledWith("Aufgaben/Budgetzeile verlinken");
      expect(cardClick).not.toHaveBeenCalled();
    } finally { unmount(); }
  });

  it("keeps a mention a mention and hands a bare URL to the URL opener", () => {
    const onOpenUrl = vi.fn();
    const { host, unmount } = render(<CommentBody body="@Marco see https://plainva.com/docs" names={NAMES} onOpenUrl={onOpenUrl} />);
    try {
      expect(host.querySelector(".pv-comment-card__mention")?.textContent).toBe("@Marco");
      const link = host.querySelector("a.pv-comment-card__link") as HTMLAnchorElement;
      act(() => { link.click(); });
      expect(onOpenUrl).toHaveBeenCalledWith("https://plainva.com/docs");
    } finally { unmount(); }
  });

  it("renders plain text unchanged", () => {
    const { host, unmount } = render(<CommentBody body="Just words, no links." names={NAMES} />);
    try {
      expect(host.textContent).toBe("Just words, no links.");
      expect(host.querySelector("a")).toBeNull();
    } finally { unmount(); }
  });
});
