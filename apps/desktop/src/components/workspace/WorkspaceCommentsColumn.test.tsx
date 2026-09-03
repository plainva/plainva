// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { WorkspaceCommentAnchorResolution, WorkspaceCommentRecord } from "@plainva/core";

import { WorkspaceCommentsColumn, type PublicationCommentEntry } from "./WorkspaceCommentsColumn";
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
      i18n: { language: "en" },
      t: (key: string, vars?: Record<string, string | number>) => {
        const value = lookup(key);
        return vars ? Object.entries(vars).reduce((out, [name, v]) => out.split(`{{${name}}}`).join(String(v)), value) : value;
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
const NAMES = new Map([["aabbccdd11223344", "Marco"], ["9999888877776666", "Anna"]]);
const NO_RESOLUTIONS = new Map<string, WorkspaceCommentAnchorResolution>();

/** The head hides settled threads by default (K3); a test about them looks under "All". */
function showAll(host: HTMLElement) {
  act(() => { (host.querySelector("[data-testid=comment-filter-all]") as HTMLElement).click(); });
}

function props(over: Partial<React.ComponentProps<typeof WorkspaceCommentsColumn>> = {}) {
  return {
    comments: [], memberNames: NAMES, selfMemberId: null, resolutions: NO_RESOLUTIONS, canComment: true, canWrite: true,
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
    const stranger = comment({ commentId: "bb".repeat(16), authorMemberId: "1234123412341234", body: "Von wem?" });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ comments: [known, stranger] })} />);
    const metas = [...host.querySelectorAll(".pv-comment-card__name")];
    expect(metas[0].textContent).toContain("Marco");
    expect(metas[0].getAttribute("data-tip")).toBe("aabbccdd11223344");
    // A name is a claim the policy carries. Where it carries none, the column
    // says so in words - it does not print eight characters of an id.
    expect(metas[1].textContent).toContain(tr("workspaceSecurity.commentUnknownAuthor"));
    expect(metas[1].textContent).not.toContain("1234");
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
    showAll(second.host);
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
    // The head's filter is the only control left; nothing that writes.
    const labels = [...host.querySelectorAll("button")].map((b) => b.textContent?.trim());
    for (const key of ["send", "commentReply", "resolve", "commentToTask"]) expect(labels).not.toContain(tr(`workspaceSecurity.${key}`));
    unmount();
  });

  it("shows a suggestion as before and after, not as a sentence about the text", () => {
    // The whole point of a suggestion over a comment is that the reader does
    // not have to reconstruct the proposal from prose: the quoted passage is
    // struck through and what would replace it stands directly underneath.
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({
      comments: [comment({ commentId: "aa".repeat(16), anchor: ANCHOR, body: "zu vage", suggestion: SUGGESTION })],
    })} />);
    // One line, word by word (K5): what goes is struck, what comes is inserted.
    const diff = host.querySelector(".pv-comment-card__diff")!;
    expect([...diff.querySelectorAll("del")].map((d) => d.textContent).join("")).toBe("Ende des Jahres");
    expect([...diff.querySelectorAll("ins")].map((d) => d.textContent).join("")).toBe("zum 31.12.2026");
    expect(diff.textContent).toContain("bis ");
    unmount();
  });

  it("names a deletion instead of showing an empty line", () => {
    // An empty replacement is a proposal too - "remove this". Rendered as-is it
    // would be a blank strip that says nothing.
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({
      comments: [comment({ commentId: "aa".repeat(16), anchor: ANCHOR, suggestion: { replacement: "", appliedAt: null, appliedBy: null, declinedAt: null } })],
    })} />);
    expect(host.querySelector(".pv-comment-card__diff")?.textContent).toContain(tr("workspaceSecurity.suggestionDeletes"));
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
    showAll(applied.host);
    expect(applied.host.querySelector(".pv-comment-card__state")?.textContent).toContain(tr("workspaceSecurity.suggestionApplied"));
    applied.unmount();

    const declined = render(<WorkspaceCommentsColumn {...props({
      comments: [comment({ commentId: "aa".repeat(16), anchor: ANCHOR, resolvedAt: NOW, suggestion: { ...SUGGESTION, declinedAt: NOW } })],
    })} />);
    showAll(declined.host);
    expect(declined.host.querySelector(".pv-comment-card__state")?.textContent).toContain(tr("workspaceSecurity.suggestionDeclined"));
    declined.unmount();
  });

  it("no longer offers to propose from the compose box - the suggestion mode does that (V4)", () => {
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ selectionQuote: "bis Ende des Jahres" })} />);
    expect(host.querySelector(".pv-comment-compose__replacement")).toBeNull();
    expect([...host.querySelectorAll("button")].map((b) => b.textContent?.trim())).toContain(tr("workspaceSecurity.send"));
    unmount();
  });
  it("marks a thread that names you and lifts it to the top", () => {
    // A mention exists to pull attention. A card that carries the name but
    // sits fourth in the column has done nothing the writer intended.
    const other = comment({ commentId: "aa".repeat(16), body: "Nur eine Notiz" });
    const forMe = comment({ commentId: "bb".repeat(16), body: "Bitte @Anna schauen" });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({
      comments: [other, forMe], selfMemberId: "9999888877776666",
    })} />);
    const cards = [...host.querySelectorAll(".pv-comment-card")];
    expect(cards[0].textContent).toContain("Bitte @Anna schauen");
    expect(cards[0].querySelector(".pv-comment-card__state")?.textContent).toContain(tr("workspaceSecurity.commentMentionsYou"));
    // ...and the other card keeps quiet, or the badge would say nothing.
    expect(cards[1].querySelector(".pv-comment-card__state")).toBeNull();
    unmount();
  });

  it("counts a mention in a reply, not just in the first comment", () => {
    const root = comment({ commentId: "aa".repeat(16), body: "Wer weiss das?" });
    const reply = comment({ commentId: "bb".repeat(16), parentCommentId: root.commentId, body: "@Anna weiss es" });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({
      comments: [root, reply], selfMemberId: "9999888877776666",
    })} />);
    expect(host.querySelector(".pv-comment-card__state")?.textContent).toContain(tr("workspaceSecurity.commentMentionsYou"));
    unmount();
  });

  it("leaves a resolved thread where it is, even when it names you", () => {
    // Resolved means it needs no attention any more. Floating it would push
    // the open threads down for nothing.
    const open = comment({ commentId: "aa".repeat(16), body: "Offen" });
    const done = comment({ commentId: "bb".repeat(16), body: "@Anna, erledigt", resolvedAt: NOW });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({
      comments: [open, done], selfMemberId: "9999888877776666",
    })} />);
    const cards = [...host.querySelectorAll(".pv-comment-card")];
    expect(cards[0].textContent).toContain("Offen");
    expect(host.textContent).not.toContain(tr("workspaceSecurity.commentMentionsYou"));
    unmount();
  });

  it("claims nothing while this device cannot say who it is", () => {
    const forSomeone = comment({ commentId: "aa".repeat(16), body: "Bitte @Anna schauen" });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ comments: [forSomeone] })} />);
    expect(host.textContent).not.toContain(tr("workspaceSecurity.commentMentionsYou"));
    unmount();
  });

  it("lifts @Name out of the body without changing a character of it", () => {
    const body = "Bitte @Anna und @Niemand schauen";
    const { host, unmount } = render(<WorkspaceCommentsColumn {...props({
      comments: [comment({ commentId: "aa".repeat(16), body })],
    })} />);
    const rendered = host.querySelector(".pv-comment-card__body");
    // The text is what the file says - the highlight is the only difference.
    expect(rendered?.textContent).toBe(body);
    const mentions = [...host.querySelectorAll(".pv-comment-card__mention")];
    expect(mentions.map((m) => m.textContent)).toEqual(["@Anna"]);
    // The id rides along so an ambiguous name is still identifiable on hover.
    expect(mentions[0].getAttribute("data-tip")).toBe("9999888877776666");
    unmount();
  });

  /**
   * What came back from a publication (D7).
   *
   * The returns are the one place in this column where a card must NOT offer
   * what every other card offers: a reply, a resolve, an apply. Each of those
   * would write into another workspace, and a button that looked like the ones
   * above would promise an answer that never arrives.
   */
  describe("returns from a publication", () => {
    // The prop's type is `readonly Entry[] | undefined`, and a union does not
    // match `readonly (infer E)[]` - inferring the element back out of it
    // silently yields `never`. The column exports the element type; take it.
    function incoming(over: Partial<PublicationCommentEntry> = {}): PublicationCommentEntry {
      return {
        comment: comment({ commentId: "77".repeat(16), body: "Bitte praezisieren" }),
        publicationId: "11".repeat(16), publicationName: "Beirat Q3", path: "Notiz.md",
        authorDisplayName: "Dr. Weber", authorActive: true, suggestionApplicable: false,
        ...over,
      } as PublicationCommentEntry;
    }

    it("names the publication and the recipient, and offers nothing to answer with", () => {
      const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ publicationComments: [incoming()] })} />);
      const section = host.querySelector(".pv-comment-returns");
      expect(section?.textContent).toContain("Beirat Q3");
      // The name comes from the publication's OWN policy - this vault's member
      // list does not contain this person at all, so a lookup there would print
      // "Unknown member" over a perfectly well-known recipient.
      expect(section?.textContent).toContain("Dr. Weber");
      expect(section?.textContent).toContain("Bitte praezisieren");
      // Not a single control: every one of them would be a write into the
      // publication, which this side cannot do from here.
      expect(section?.querySelectorAll("button")).toHaveLength(0);
      unmount();
    });

    it("keeps the returns out of the vault's own thread list", () => {
      // One card in the column proper would mean the remark had been made in
      // THIS vault - it was not, and mixing the two would misstate where it
      // came from and who can act on it.
      const own = comment({ commentId: "aa".repeat(16), body: "Intern" });
      const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ comments: [own], publicationComments: [incoming()] })} />);
      const outside = host.querySelector(".pv-comment-returns");
      expect(outside).not.toBeNull();
      expect(host.querySelectorAll(".pv-comment-card")).toHaveLength(2);
      expect(host.querySelectorAll(".pv-comment-card--incoming")).toHaveLength(1);
      expect(outside?.textContent).not.toContain("Intern");
      unmount();
    });

    it("does not claim the note has no comments when returns are the only thing on it", () => {
      const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ publicationComments: [incoming()] })} />);
      expect(host.querySelector(".pv-comment-column__empty")).toBeNull();
      unmount();
    });

    it("says when the author lost access and when a suggestion cannot be applied", () => {
      const stale = incoming({
        authorActive: false,
        comment: comment({ commentId: "88".repeat(16), body: "Vorschlag", anchor: ANCHOR, suggestion: SUGGESTION }),
        suggestionApplicable: false,
      });
      const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ publicationComments: [stale] })} />);
      // Both are facts about the record, not failures: the remark stands, and
      // hiding either would rewrite what was actually said.
      expect(host.textContent).toContain(tr("workspaceSecurity.publicationCommentAuthorGone"));
      expect(host.textContent).toContain(tr("workspaceSecurity.publicationSuggestionStale"));
      // The proposed wording is still shown - a recipient wrote it, whether or
      // not this side can paste it in.
      expect([...host.querySelectorAll(".pv-comment-card__diff ins")].map((n) => n.textContent).join("")).toContain("zum 31.12.2026");
      unmount();
    });

    it("never threads a reply from one publication under a root from another", () => {
      // A comment id is only unique INSIDE its publication. Grouping first is
      // what keeps two recipients' threads from being stapled together.
      const a = incoming({ publicationId: "11".repeat(16), publicationName: "Beirat", comment: comment({ commentId: "99".repeat(16), body: "Erstes" }) });
      const b = incoming({
        publicationId: "22".repeat(16), publicationName: "Redaktion", authorDisplayName: "Frau Sun",
        comment: comment({ commentId: "aa".repeat(16), parentCommentId: "99".repeat(16), body: "Zweites" }),
      });
      const { host, unmount } = render(<WorkspaceCommentsColumn {...props({ publicationComments: [a, b] })} />);
      expect(host.querySelectorAll(".pv-comment-returns")).toHaveLength(2);
      // Two roots, no nesting: the second is not a reply to the first.
      expect(host.querySelectorAll(".pv-comment-card--incoming")).toHaveLength(2);
      expect(host.querySelectorAll(".pv-comment-card__reply")).toHaveLength(0);
      unmount();
    });
  });
});

/**
 * A remark still in the outbox (K6, finding 2026-09-03): the card is there the
 * moment it was sent, says so, and once it failed offers retry and discard to
 * the person who wrote it - and nothing else, because reply/resolve/task would
 * queue behind a remark that may never land.
 */
describe("pending remarks (K6)", () => {
  const baseProps = {
    publicationComments: [] as PublicationCommentEntry[],
    memberNames: NAMES,
    selfMemberId: "aabbccdd11223344",
    resolutions: NO_RESOLUTIONS,
    canComment: true,
    canWrite: true,
    activeCommentId: null,
    selectionQuote: null,
    onSelect: () => {},
    onSubmit: async () => {},
    onResolve: () => {},
    onApplySuggestion: () => {},
    onDeclineSuggestion: () => {},
    onPromoteToTask: () => {},
  };

  it("shows a just-sent remark as sending, without the usual actions", () => {
    const pending = comment({ commentId: "c1", body: "On its way", pending: { outboxId: "o1", attempts: 0, lastError: null } });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...baseProps} comments={[pending]} />);
    try {
      expect(host.textContent).toContain("On its way");
      expect(host.textContent).toContain(tr("workspaceSecurity.commentSending"));
      expect(host.querySelector(".pv-comment-card.is-pending")).not.toBeNull();
      expect(host.textContent).not.toContain(tr("workspaceSecurity.commentReply"));
      expect(host.textContent).not.toContain(tr("workspaceSecurity.resolve"));
    } finally { unmount(); }
  });

  it("names the reason a remark was not sent and lets its author retry or discard it", () => {
    const onRetryPending = vi.fn();
    const onDiscardPending = vi.fn();
    const failed = comment({ commentId: "c2", body: "Stuck", pending: { outboxId: "o2", attempts: 3, lastError: "workspace-object-not-synced" } });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...baseProps} comments={[failed]} onRetryPending={onRetryPending} onDiscardPending={onDiscardPending} />);
    try {
      expect(host.textContent).toContain(tr("workspaceSecurity.commentSendFailed").replace("{{reason}}", "workspace-object-not-synced"));
      const buttons = [...host.querySelectorAll("button")];
      const retry = buttons.find((b) => b.textContent?.trim() === tr("workspaceSecurity.commentSendRetry"))!;
      const discard = buttons.find((b) => b.textContent?.trim() === tr("workspaceSecurity.commentSendDiscard"))!;
      act(() => { retry.click(); });
      act(() => { discard.click(); });
      expect(onRetryPending).toHaveBeenCalledWith("o2");
      expect(onDiscardPending).toHaveBeenCalledWith("o2");
    } finally { unmount(); }
  });

  it("offers neither retry nor discard on somebody else's stuck remark", () => {
    const failed = comment({ commentId: "c3", body: "Theirs", authorMemberId: "9999888877776666", pending: { outboxId: "o3", attempts: 1, lastError: "x" } });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...baseProps} comments={[failed]} onRetryPending={() => {}} onDiscardPending={() => {}} />);
    try {
      expect(host.textContent).not.toContain(tr("workspaceSecurity.commentSendRetry"));
    } finally { unmount(); }
  });
});

/**
 * The column's head (K3): the open count, the Open/All filter, the close
 * button, and the who-and-when line on every card.
 */
describe("column head and card head (K3)", () => {
  const baseProps = {
    publicationComments: [] as PublicationCommentEntry[],
    memberNames: NAMES,
    selfMemberId: "aabbccdd11223344",
    resolutions: NO_RESOLUTIONS,
    canComment: true,
    canWrite: true,
    activeCommentId: null,
    selectionQuote: null,
    onSelect: () => {},
    onSubmit: async () => {},
    onResolve: () => {},
    onApplySuggestion: () => {},
    onDeclineSuggestion: () => {},
    onPromoteToTask: () => {},
  };

  it("counts open threads, hides resolved ones by default and shows them under All", () => {
    const open = comment({ commentId: "o1", body: "Still open" });
    const done = comment({ commentId: "d1", body: "Settled", resolvedAt: NOW });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...baseProps} comments={[open, done]} />);
    try {
      expect(host.querySelector("[data-testid=comment-open-count]")?.textContent).toBe(tr("workspaceSecurity.commentOpenCount").replace("{{n}}", "1"));
      expect(host.textContent).toContain("Still open");
      expect(host.textContent).not.toContain("Settled");
      act(() => { (host.querySelector("[data-testid=comment-filter-all]") as HTMLElement).click(); });
      expect(host.textContent).toContain("Settled");
    } finally { unmount(); }
  });

  it("closes through the head and names author and time on the card", () => {
    const onClose = vi.fn();
    const c = comment({ commentId: "c1", body: "Hello", authorMemberId: "9999888877776666" });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...baseProps} comments={[c]} onClose={onClose} />);
    try {
      expect(host.querySelector(".pv-comment-card__avatar")?.textContent).toBe("AN");
      expect(host.querySelector(".pv-comment-card__name")?.textContent).toBe("Anna");
      expect(host.querySelector("time.pv-comment-card__when")?.getAttribute("dateTime")).toBe(NOW);
      act(() => { (host.querySelector("[data-testid=comment-column-close]") as HTMLElement).click(); });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally { unmount(); }
  });
});

/**
 * Deleting (K7): offered to the author and to a moderator, asked IN the card,
 * and only then handed out.
 */
describe("deleting a remark (K7)", () => {
  const baseProps = {
    publicationComments: [] as PublicationCommentEntry[],
    memberNames: NAMES,
    selfMemberId: "aabbccdd11223344",
    resolutions: NO_RESOLUTIONS,
    canComment: true,
    canWrite: true,
    activeCommentId: null,
    selectionQuote: null,
    onSelect: () => {},
    onSubmit: async () => {},
    onResolve: () => {},
    onApplySuggestion: () => {},
    onDeclineSuggestion: () => {},
    onPromoteToTask: () => {},
  };

  it("asks first and then hands the author's remark to onDelete", () => {
    const onDelete = vi.fn();
    const mine = comment({ commentId: "m1", body: "Mine" });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...baseProps} comments={[mine]} onDelete={onDelete} />);
    try {
      act(() => { (host.querySelector("[data-testid=comment-delete-m1]") as HTMLElement).click(); });
      expect(host.querySelector(".pv-comment-card__confirm")?.textContent).toContain(tr("workspaceSecurity.commentDeleteConfirm"));
      expect(onDelete).not.toHaveBeenCalled();
      act(() => { (host.querySelector("[data-testid=comment-delete-confirm]") as HTMLElement).click(); });
      expect(onDelete).toHaveBeenCalledWith(mine);
      expect(host.querySelector(".pv-comment-card__confirm")).toBeNull();
    } finally { unmount(); }
  });

  it("offers a stranger's remark only to a moderator, and names the replies it takes along", () => {
    const theirs = comment({ commentId: "t1", body: "Theirs", authorMemberId: "9999888877776666" });
    const reply = comment({ commentId: "r1", body: "Mine under theirs", parentCommentId: "t1" });
    const plain = render(<WorkspaceCommentsColumn {...baseProps} comments={[theirs, reply]} onDelete={() => {}} />);
    try {
      expect(plain.host.querySelector("[data-testid=comment-delete-t1]")).toBeNull();
      // The reply is mine, so it carries its own control.
      expect(plain.host.querySelector("[data-testid=comment-delete-r1]")).not.toBeNull();
    } finally { plain.unmount(); }
    const moderator = render(<WorkspaceCommentsColumn {...baseProps} comments={[theirs, reply]} onDelete={() => {}} canModerate />);
    try {
      act(() => { (moderator.host.querySelector("[data-testid=comment-delete-t1]") as HTMLElement).click(); });
      expect(moderator.host.querySelector(".pv-comment-card__confirm")?.textContent).toContain(tr("workspaceSecurity.commentDeleteConfirmThread"));
    } finally { moderator.unmount(); }
  });
});

/**
 * A proposal round in the column (V3): its blocks stay together under the
 * author and the round's sentence, and one control decides all of them.
 */
describe("proposal rounds (V3)", () => {
  const baseProps = {
    publicationComments: [] as PublicationCommentEntry[],
    memberNames: NAMES,
    selfMemberId: "aabbccdd11223344",
    resolutions: NO_RESOLUTIONS,
    canComment: true,
    canWrite: true,
    activeCommentId: null,
    selectionQuote: null,
    onSelect: () => {},
    onSubmit: async () => {},
    onResolve: () => {},
    onApplySuggestion: () => {},
    onDeclineSuggestion: () => {},
    onPromoteToTask: () => {},
  };

  it("groups the blocks of a round and hands the whole round to onApplyRound", () => {
    const onApplyRound = vi.fn();
    const block = (id: string, index: number, over: Partial<WorkspaceCommentRecord> = {}) =>
      comment({ commentId: id, anchor: ANCHOR, suggestion: SUGGESTION, suggestionBatchId: "ab".repeat(16), batchIndex: index, batchNote: "From the PDF", authorMemberId: "9999888877776666", ...over });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...baseProps} comments={[block("b1", 0), block("b2", 1)]} onApplyRound={onApplyRound} />);
    try {
      act(() => { (host.querySelector("[data-testid=comment-kind-suggestions]") as HTMLElement).click(); });
      const round = host.querySelector(".pv-comment-round")!;
      expect(round.textContent).toContain("From the PDF");
      expect(round.textContent).toContain(tr("workspaceSecurity.suggestRoundCount").replace("{{n}}", "2"));
      expect(round.querySelectorAll(".pv-comment-card")).toHaveLength(2);
      act(() => { (host.querySelector("[data-testid=round-apply-" + "ab".repeat(16) + "]") as HTMLElement).click(); });
      expect(onApplyRound).toHaveBeenCalledWith("ab".repeat(16));
    } finally { unmount(); }
  });
});

describe("a card named from the text (finding 2026-09-03)", () => {
  const baseProps = {
    publicationComments: [] as PublicationCommentEntry[],
    memberNames: NAMES,
    selfMemberId: "aabbccdd11223344",
    resolutions: NO_RESOLUTIONS,
    canComment: true,
    canWrite: true,
    selectionQuote: null,
    onSelect: () => {},
    onSubmit: async () => {},
    onResolve: () => {},
    onApplySuggestion: () => {},
    onDeclineSuggestion: () => {},
    onPromoteToTask: () => {},
  };
  const remark = comment({ commentId: "r1", body: "A remark", anchor: ANCHOR });
  const proposal = comment({ commentId: "p1", anchor: ANCHOR, suggestion: SUGGESTION, authorMemberId: "9999888877776666" });

  it("switches to the proposals tab when the named card is a proposal, and back for a remark", () => {
    const { host, unmount } = render(<WorkspaceCommentsColumn {...baseProps} comments={[remark, proposal]} activeCommentId="p1" />);
    try {
      // The column opened on "Comments" (a remark is open) - the pick wins.
      expect(host.querySelector(".pv-comment-round")).not.toBeNull();
      expect(host.querySelector(".pv-comment-round .pv-comment-card.is-active")).not.toBeNull();
    } finally { unmount(); }
    const back = render(<WorkspaceCommentsColumn {...baseProps} comments={[remark, proposal]} activeCommentId="r1" />);
    try {
      expect(back.host.querySelector(".pv-comment-round")).toBeNull();
      expect(back.host.querySelector(".pv-comment-card.is-active")?.textContent).toContain("A remark");
    } finally { back.unmount(); }
  });

  it("brings a settled thread back under 'all' when it is the one named", () => {
    const settled = comment({ commentId: "s1", body: "Done long ago", anchor: ANCHOR, resolvedAt: NOW });
    const { host, unmount } = render(<WorkspaceCommentsColumn {...baseProps} comments={[remark, settled]} activeCommentId="s1" />);
    try {
      expect(host.querySelector(".pv-comment-card.is-active")?.textContent).toContain("Done long ago");
    } finally { unmount(); }
  });
});
