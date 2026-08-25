// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { WorkspaceCommentAnchorResolution, WorkspaceCommentRecord } from "@plainva/core";

import { WorkspaceCommentsColumn } from "./WorkspaceCommentsColumn";
import en from "../../../../../packages/ui/src/locales/en.json";

/** The catalogue is nested; a key is a dotted path into it. */
function tr(key: string): string {
  const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);
  return typeof value === "string" ? value : key;
}

// Resolving through the REAL English catalogue, not echoing the key. Two things
// only become checkable that way: that every key this column asks for exists
// (a typo would render the bare key), and that the target sentence really
// carries a {{quote}} placeholder - without it the column would name no
// selection at all and still look fine.
vi.mock("react-i18next", async () => {
  const catalogue = (await import("../../../../../packages/ui/src/locales/en.json")).default as Record<string, unknown>;
  const lookup = (key: string): string => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);
    return typeof value === "string" ? value : key;
  };
  return {
    useTranslation: () => ({
      t: (key: string, vars?: Record<string, string>) => {
        const value = lookup(key);
        return vars ? Object.entries(vars).reduce((out, [name, v]) => out.split(`{{${name}}}`).join(v), value) : value;
      },
    }),
  };
});

/**
 * What the comment column must not get wrong.
 *
 * Every assertion below stands for something that fails SILENTLY: a reply that
 * disappears looks like it was never posted, an orphaned anchor that keeps
 * quiet looks like it still points somewhere, and a name that falls back to an
 * id fragment looks like a person nobody can identify - which is exactly the
 * design this column replaced.
 */
function render(ui: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => act(() => { root.unmount(); }) };
}

const NOW = "2026-08-25T10:00:00.000Z";

function comment(over: Partial<WorkspaceCommentRecord> & { commentId: string }): WorkspaceCommentRecord {
  return {
    targetObjectId: "41".repeat(16), targetRevisionId: "42".repeat(16), parentCommentId: null,
    authorMemberId: "aabbccdd11223344", authorDeviceId: "de".repeat(16), operationHash: "ff".repeat(32),
    payloadHash: "ee".repeat(32), body: "-", anchor: null, createdAt: NOW,
    suggestion: null, resolvedCommentId: null, resolvedAt: null, ...over,
  } as WorkspaceCommentRecord;
}

const ANCHOR = { markerId: "7f3a", quote: "bis Ende des Jahres", before: "Der Vertrag laeuft ", after: ".", approximateOffset: 19 };
const SUGGESTION = { replacement: "bis zum 31.12.2026", appliedAt: null, appliedBy: null, declinedAt: null };
const NAMES = new Map([["aabbccdd11223344", "Marco"]]);
const NO_RESOLUTIONS = new Map<string, WorkspaceCommentAnchorResolution>();

function props(over: Partial<React.ComponentProps<typeof WorkspaceCommentsColumn>> = {}) {
  return {
    comments: [], memberNames: NAMES, resolutions: NO_RESOLUTIONS, canComment: true, canWrite: true,
    activeCommentId: null, selectionQuote: null,
    onSelect: vi.fn(), onSubmit: vi.fn(async () => {}), onResolve: vi.fn(),
    onApplySuggestion: vi.fn(), onDeclineSuggestion: vi.fn(),
    ...over,
  } as React.ComponentProps<typeof WorkspaceCommentsColumn>;
}

describe("workspace comment column", () => {
  it("hangs a reply off its thread instead of showing it as its own card", () => {
    const root = comment({ commentId: "aa".repeat(16), body: "Welches Jahr?" });
    const reply = comment({ commentId: "bb".repeat(16), parentCommentId: root.commentId, body: "2027." });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ comments: [root, reply] })} />);
    expect(host.querySelectorAll(".pv-comment-card")).toHaveLength(1);
    const replies = host.querySelectorAll(".pv-comment-card__reply");
    expect(replies).toHaveLength(1);
    expect(replies[0].textContent).toContain("2027.");
    unmount();
  });

  it("still shows a reply whose thread root has not synced yet", () => {
    // Partial sync is the normal state on a second device. Hiding the reply
    // until its root arrives would look like the reply was lost.
    const orphanReply = comment({ commentId: "bb".repeat(16), parentCommentId: "cc".repeat(16), body: "Passt" });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ comments: [orphanReply] })} />);
    expect(host.querySelectorAll(".pv-comment-card")).toHaveLength(1);
    expect(host.textContent).toContain("Passt");
    unmount();
  });

  it("says when the commented passage moved or is gone, and stays quiet when it still fits", () => {
    const anchored = comment({ commentId: "aa".repeat(16), anchor: ANCHOR, body: "Welches Jahr?" });
    // "marker" and "quote" both land the comment safely - the first because the
    // marker pair survived, the second because the quote occurs exactly once.
    // Neither needs a word; only a guess ("moved") and a loss ("orphan") do.
    const cases: Array<[WorkspaceCommentAnchorResolution, string | null]> = [
      [{ status: "marker", from: 19, to: 38 }, null],
      [{ status: "quote", from: 19, to: 38 }, null],
      [{ status: "moved", from: 42, to: 61 }, "workspaceSecurity.commentAnchorMoved"],
      [{ status: "orphan" }, "workspaceSecurity.commentAnchorOrphan"],
    ];
    for (const [resolution, expected] of cases) {
      const resolutions = new Map([[anchored.commentId, resolution]]);
      const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ comments: [anchored], resolutions })} />);
      const state = host.querySelector(".pv-comment-card__state");
      expect(state?.textContent ?? null).toBe(expected === null ? null : tr(expected));
      // The quote is the anchor's own stored text - never a re-slice of the
      // current document, which may have changed since.
      expect(host.querySelector(".pv-comment-card__quote")?.textContent).toBe(ANCHOR.quote);
      unmount();
    }
  });

  it("names the author from the policy and keeps the member id reachable", () => {
    const known = comment({ commentId: "aa".repeat(16), body: "Von Marco" });
    const stranger = comment({ commentId: "bb".repeat(16), authorMemberId: "9999888877776666", body: "Von wem?" });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ comments: [known, stranger] })} />);
    const metas = [...host.querySelectorAll(".pv-comment-card__meta")];
    expect(metas[0].textContent).toContain("Marco");
    expect(metas[0].getAttribute("data-tip")).toBe("aabbccdd11223344");
    // A name is a claim the policy carries. Where it carries none, the column
    // says so in words - it does not print eight characters of an id.
    expect(metas[1].textContent).toContain(tr("workspaceSecurity.commentUnknownAuthor"));
    expect(metas[1].textContent).not.toContain("9999");
    unmount();
  });

  it("offers resolving until a thread is resolved, and then shows the state instead", () => {
    const open = comment({ commentId: "aa".repeat(16), body: "Offen" });
    const onResolve = vi.fn();
    const first = render(<WorkspaceCommentsColumn {...props({ comments: [open], onResolve })} />);
    const resolve = [...first.host.querySelectorAll("button")].find((b) => b.textContent?.trim() === tr("workspaceSecurity.resolve"));
    act(() => { resolve!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onResolve).toHaveBeenCalledWith(open.commentId);
    first.unmount();

    const done = comment({ commentId: "aa".repeat(16), body: "Offen", resolvedAt: NOW });
    const second = render(<WorkspaceCommentsColumn {...props({ comments: [done] })} />);
    expect(second.host.textContent).toContain(tr("workspaceSecurity.resolved"));
    expect([...second.host.querySelectorAll("button")].some((b) => b.textContent?.trim() === tr("workspaceSecurity.resolve"))).toBe(false);
    second.unmount();
  });

  it("names what a new comment would attach to", () => {
    // Once the caret sits in the text field the selection is no longer visible,
    // so the compose box has to say what it is about to anchor to.
    const withSelection = render(<WorkspaceCommentsColumn {...props({ selectionQuote: "bis Ende des Jahres" })} />);
    expect(withSelection.host.querySelector(".pv-comment-compose__target")?.textContent).toContain("bis Ende des Jahres");
    withSelection.unmount();

    const withoutSelection = render(<WorkspaceCommentsColumn {...props()} />);
    expect(withoutSelection.host.querySelector(".pv-comment-compose__target")?.textContent).toBe(tr("workspaceSecurity.commentOnNote"));
    withoutSelection.unmount();
  });

  it("shows a reader no compose box at all", () => {
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ canComment: false, comments: [comment({ commentId: "aa".repeat(16) })] })} />);
    expect(host.querySelector(".pv-comment-compose")).toBeNull();
    expect([...host.querySelectorAll("button")]).toHaveLength(0);
    unmount();
  });

  it("shows a suggestion as before and after, not as a sentence about the text", () => {
    // The whole point of a suggestion over a comment is that the reader does
    // not have to reconstruct the proposal from prose: the quoted passage is
    // struck through and what would replace it stands directly underneath.
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({
      comments: [comment({ commentId: "aa".repeat(16), anchor: ANCHOR, body: "zu vage", suggestion: SUGGESTION })],
    })} />);
    expect(host.querySelector(".pv-comment-card__quote--replaced")?.textContent).toBe("bis Ende des Jahres");
    expect(host.querySelector(".pv-comment-card__replacement")?.textContent).toContain("bis zum 31.12.2026");
    unmount();
  });

  it("names a deletion instead of showing an empty line", () => {
    // An empty replacement is a proposal too - "remove this". Rendered as-is it
    // would be a blank strip that says nothing.
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({
      comments: [comment({ commentId: "aa".repeat(16), anchor: ANCHOR, suggestion: { replacement: "", appliedAt: null, appliedBy: null, declinedAt: null } })],
    })} />);
    expect(host.querySelector(".pv-comment-card__replacement")?.textContent).toContain(tr("workspaceSecurity.suggestionDeletes"));
    unmount();
  });

  it("offers accepting only to someone who may write the note", () => {
    // Accepting swaps text in the note; declining only closes the thread. A
    // commenter therefore gets one of the two buttons, not both - and the one
    // they get must not be the one that writes.
    const open = comment({ commentId: "aa".repeat(16), anchor: ANCHOR, suggestion: SUGGESTION });
    const writer = render(<WorkspaceCommentsColumn {...props({ comments: [open] })} />);
    const writerLabels = [...writer.host.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(writerLabels).toContain(tr("workspaceSecurity.suggestionApply"));
    expect(writerLabels).toContain(tr("workspaceSecurity.suggestionDecline"));
    writer.unmount();

    const commenter = render(<WorkspaceCommentsColumn {...props({ comments: [open], canWrite: false })} />);
    const commenterLabels = [...commenter.host.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(commenterLabels).not.toContain(tr("workspaceSecurity.suggestionApply"));
    expect(commenterLabels).toContain(tr("workspaceSecurity.suggestionDecline"));
    commenter.unmount();
  });

  it("says which way a decided suggestion went", () => {
    // Accepting and declining both resolve the thread. The plain "resolved"
    // word would read the same either way and hide the one fact that matters.
    const applied = render(<WorkspaceCommentsColumn {...props({
      comments: [comment({ commentId: "aa".repeat(16), anchor: ANCHOR, resolvedAt: NOW, suggestion: { ...SUGGESTION, appliedAt: NOW, appliedBy: "aabbccdd11223344" } })],
    })} />);
    expect(applied.host.querySelector(".pv-comment-card__state")?.textContent).toContain(tr("workspaceSecurity.suggestionApplied"));
    applied.unmount();

    const declined = render(<WorkspaceCommentsColumn {...props({
      comments: [comment({ commentId: "aa".repeat(16), anchor: ANCHOR, resolvedAt: NOW, suggestion: { ...SUGGESTION, declinedAt: NOW } })],
    })} />);
    expect(declined.host.querySelector(".pv-comment-card__state")?.textContent).toContain(tr("workspaceSecurity.suggestionDeclined"));
    declined.unmount();
  });

  it("offers a suggestion only where there is a passage to replace", async () => {
    // A proposal names the text it replaces. Without a selection there is
    // nothing to propose against, so the switch must not even appear - the
    // protocol would refuse the comment, and the refusal would arrive as an
    // error after the writing.
    const without = render(<WorkspaceCommentsColumn {...props()} />);
    expect([...without.host.querySelectorAll("button")].map((b) => b.textContent?.trim())).not.toContain(tr("workspaceSecurity.suggestionStart"));
    without.unmount();

    const onSubmit = vi.fn(async () => {});
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ selectionQuote: "bis Ende des Jahres", onSubmit })} />);
    const start = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === tr("workspaceSecurity.suggestionStart"));
    expect(start).toBeDefined();
    act(() => { start!.click(); });

    // The proposal starts as the selected text - a suggestion is nearly always
    // an edit of the passage, not a blank page.
    const field = host.querySelector<HTMLTextAreaElement>(".pv-comment-compose__replacement");
    expect(field?.value).toBe("bis Ende des Jahres");

    const send = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === tr("workspaceSecurity.suggestionSend"));
    // A suggestion may carry no sentence at all: the replacement IS the content.
    expect(send?.hasAttribute("disabled")).toBe(false);
    await act(async () => { send!.click(); });
    expect(onSubmit).toHaveBeenCalledWith("", null, { replacement: "bis Ende des Jahres" });
    unmount();
  });
});
