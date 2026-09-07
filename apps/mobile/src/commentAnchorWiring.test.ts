import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The anchor bubble on the phone (Stufe E, E4).
 *
 * Every piece of it already lived in `packages/ui`: the bubble is a <button>
 * whose action hangs on `click`, the region picker is pointer-driven with
 * pointer capture, and three shared callers decorate images, diagrams and text.
 * What was missing was four lines of wiring — and each one failed SILENTLY.
 *
 * The shared session asks the deps whether anchors are on, so a missing getter
 * reads as "off": the bubble simply never appeared, with nothing to see and
 * nothing logged. The other three fail the same quiet way — a bubble that does
 * nothing when tapped, a payload that is dropped, frames that are resolved and
 * never handed to the session.
 *
 * These are SOURCE assertions on purpose. The pieces they guard are correct in
 * isolation and their own tests stayed green while the phone showed nothing;
 * the fault lived in the call sites, which no test looked at. Driving it for
 * real would mean mounting a CodeMirror session in jsdom and synthesising
 * pointer events — far more machinery than the four lines are worth, and it
 * would assert against that machinery rather than against the wiring.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");
/* Comments name these identifiers, so a comment alone must never satisfy an
   assertion — including the ones written directly above the code. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the bubble is armed on the phone", () => {
  const host = strip(read("EditorHost.tsx"));
  const depsFrom = host.indexOf("depsRef.current = {");
  const deps = host.slice(depsFrom, host.indexOf("onOpenPath:", depsFrom));

  it("tells the shared session that anchors are on", () => {
    // A missing getter reads as "off" — this is what left the bubble inert.
    expect(deps, "depsRef must carry commentAnchorsEnabled").toMatch(/commentAnchorsEnabled:/);
  });

  it("gates that on the capability AND the per-vault setting", () => {
    // Hard-coding it would offer the affordance in a read-only workspace and
    // to anyone who switched anchors off — the desktop gates both as well.
    const line = deps.split("\n").find((l) => l.includes("commentAnchorsEnabled:")) ?? "";
    expect(line, "commentAnchorsEnabled must not be hard-coded").not.toMatch(/=>\s*true/);
    expect(line, "the capability must gate it").toMatch(/canComment/);
    expect(line, "the per-vault setting must gate it").toMatch(/commentAnchors/);
  });

  it("passes the tapped range on instead of dropping it", () => {
    // Without this the bubble appears and does nothing at all.
    expect(deps, "depsRef must carry onCommentAnchorRequest").toMatch(/onCommentAnchorRequest:/);
  });

  it("re-applies the frames when a session is built, not only when they change", () => {
    // Switching notes remounts the host with a fresh, blank session while the
    // resolved list stays identical — an effect keyed on the list never fires,
    // and every marking silently disappears.
    const mountFrom = host.indexOf("sessionRef.current = session;");
    const mount = host.slice(mountFrom, host.indexOf("setEditorSelectionReader", mountFrom));
    expect(mount, "a fresh session must be given the frames it missed").toMatch(/setAnchorHighlights\(/);
  });
});

describe("the screen turns a tapped range into an anchor", () => {
  const screen = strip(read("screens", "NoteScreen.tsx"));

  it("parks the payload instead of discarding it", () => {
    const handlerFrom = screen.indexOf("onCommentAnchorRequest={");
    const handler = screen.slice(handlerFrom, handlerFrom + 400);
    expect(handler, "the range must be kept until the comment is written").toMatch(/setPendingRange\(/);
    expect(handler, "the sheet must open, or the parked range never becomes a comment").toMatch(/setCommentsOpen\(true\)/);
  });

  it("builds the anchor at submit time, against the text as it stands", () => {
    const submitFrom = screen.indexOf("onSubmit={async (body, parentCommentId)");
    const submit = screen.slice(submitFrom, screen.indexOf("onResolve={", submitFrom));
    expect(submit, "a parked range must become an anchor").toMatch(/buildCommentAnchor\(/);
    // The quote is what carries an anchor across an edit, so capturing it when
    // the sheet opened would already be stale by the time the comment lands.
    expect(submit, "the anchor must be built from the current text").toMatch(/const text = doc;/);
  });

  it("puts the marker pair in through the core helper, only where writing is allowed", () => {
    const submitFrom = screen.indexOf("onSubmit={async (body, parentCommentId)");
    const submit = screen.slice(submitFrom, screen.indexOf("onResolve={", submitFrom));
    // The core helper asserts the marker id and the bounds; rebuilding the
    // slices here would be a second, weaker copy of a rule that already exists.
    expect(submit, "markers must go through insertAnchorMarkers").toMatch(/insertAnchorMarkers\(/);
    // ...and never around a widget target (cell, picture, diagram): the pair
    // wrapped the table's whole source and broke it (finding 2026-09-03).
    expect(submit, "a read-only workspace must not be written to").toMatch(/if \(workspaceCanWrite && !pendingRange\.display\)/);
  });

  it("takes the markers back out when the comment never lands", () => {
    const submitFrom = screen.indexOf("onSubmit={async (body, parentCommentId)");
    const submit = screen.slice(submitFrom, screen.indexOf("onResolve={", submitFrom));
    const rollback = submit.slice(submit.indexOf("catch"));
    expect(rollback, "a failed post must restore the buffer").toMatch(/setDoc\(marker\.before\)/);
    // Restoring the buffer alone would leave the markers on disk: the note is
    // saved on a timer, and the write that carried them may already have run.
    expect(rollback, "a failed post must restore the file too").toMatch(/noteSaver\.schedule\(vault, path, marker\.before\)/);
    expect(rollback, "the failure must still reach the sheet").toMatch(/throw error;/);
  });
});

/**
 * A tap on a tinted passage names its card (finding 2026-09-03).
 *
 * The shared session already called `onAnchorActivate` for a comment tint, a
 * proposal's struck passage and the inline pill - and the phone never set it,
 * so every tap did nothing while the desktop selected the card. The pill's
 * accept and decline hung on the same two unset deps. Source assertions for
 * the same reason as above: the fault lives in the call sites.
 */
describe("a tap names its card on the phone", () => {
  const host = strip(read("EditorHost.tsx"));
  const depsFrom = host.indexOf("depsRef.current = {");
  const deps = host.slice(depsFrom, host.indexOf("onOpenPath:", depsFrom));
  const screen = strip(read("screens", "NoteScreen.tsx"));
  const sheet = strip(read("components", "CommentsSheet.tsx"));

  it("hands the tapped comment id from the session to the screen", () => {
    expect(deps).toMatch(/onAnchorActivate:\s*\(commentId\)\s*=>\s*onAnchorActivate\?\.\(commentId\)/);
    expect(screen).toMatch(/onAnchorActivate=\{\(commentId\)\s*=>\s*\{\s*setActiveCommentId\(commentId\);\s*setCommentsOpen\(true\);/);
  });

  it("arms the inline pill's accept and decline on the same handlers the sheet uses, gated like the sheet", () => {
    expect(deps).toMatch(/onSuggestionApply:\s*onSuggestionApply\s*\?/);
    expect(deps).toMatch(/onSuggestionDecline:\s*onSuggestionDecline\s*\?/);
    expect(screen).toMatch(/onSuggestionApply=\{workspaceCanWrite\s*\?/);
    expect(screen).toMatch(/onSuggestionDecline=\{canComment\s*\?/);
    expect(screen).toMatch(/applySuggestion\(found, "applied"\)/);
    expect(screen).toMatch(/applySuggestion\(found, "declined"\)/);
  });

  it("opens the sheet on the card's tab, scrolled to it and marked", () => {
    expect(screen).toMatch(/activeCommentId=\{activeCommentId\}/);
    expect(sheet).toMatch(/setKind\(thread\.root\.suggestion \? "suggestions" : "comments"\)/);
    expect(sheet).toMatch(/card\.scrollIntoView\(\{ block: "nearest" \}\)/);
    expect(sheet).toMatch(/activeCommentId === root\.commentId \? " is-active" : ""/);
  });
});

/**
 * The two ways from a database into a remark (finding 2026-09-04), the phone's
 * half: the dot opens the entry on its thread, the cell sheet starts one on
 * that property. Same shared jump as the desktop; the note screen answers it.
 */
describe("a database opens and starts property comments on the phone", () => {
  const base = strip(read("screens", "base", "BaseScreen.tsx"));
  const sheet = strip(read("screens", "base", "CellEditSheet.tsx"));
  const screen = strip(read("screens", "NoteScreen.tsx"));

  it("makes the dot a button that parks the thread it stands for", () => {
    expect(base).toMatch(/const commentId = findPropertyCommentThread\(noteComments\.get\(path\) \?\? \[\], col,/);
    expect(base).toMatch(/requestCommentJump\(commentId \? \{ path, commentId \} : \{ path, property: col \}\)/);
    expect(base).toMatch(/onClick=\{\(e\) => \{ e\.stopPropagation\(\); openPropertyComments\(path, col\); \}\}/);
  });

  it("offers the remark in the cell sheet, and only where this device may write one", () => {
    expect(base).toMatch(/void canCommentOnNote\(vault, rowPath\(r\)\)\.then\(setCellEditCanComment\)/);
    expect(base).toMatch(/onCommentProperty=\{cellEditCanComment \?/);
    expect(base).toMatch(/composePropertyComment\(c\.notePath, c\.col\)/);
    expect(sheet).toContain('data-testid="base-comment-property"');
    expect(sheet).toContain('t("workspaceSecurity.commentOnProperty")');
  });

  it("lands the note screen on the named card, or on the composer for the named property", () => {
    expect(screen).toMatch(/if \(jump\.commentId\) setActiveCommentId\(jump\.commentId\);/);
    expect(screen).toMatch(/else if \(jump\.property\) setPendingPropertyJump\(jump\.property\)/);
    expect(screen).toMatch(/if \(!pendingPropertyJump \|\| doc === null\) return;/);
    expect(screen).toMatch(/startPropertyComment\(pendingPropertyJump\)/);
  });

  it("asks the shared helper what this device may do, instead of a second copy", () => {
    expect(screen).toMatch(/void noteWorkspaceCapabilities\(vault, path\)/);
    expect(screen).not.toMatch(/effectiveWorkspaceCapabilities\(/);
  });
});

/**
 * One store per vault (Nachschaerfung, N0).
 *
 * The phone's comment service used to re-implement the bundle logic the
 * desktop had - the mode fork, the read, the record a post writes - and the
 * two drifted in wording while meaning the same. Now both shells hand a few
 * device facts to the core's `BundleCommentStore`; what this pins is that the
 * service stays that thin, so the next branch lands in the core, not here.
 */
describe("the phone's comment service is a thin shell over the core store", () => {
  const service = strip(read("services", "mobileComments.ts"));

  it("builds the core store instead of reading the bundle itself", () => {
    expect(service).toMatch(/new BundleCommentStore\(/);
    expect(service).not.toMatch(/readLocalComments|localCommentsForPath|localCommentsByPath|appendLocalComment/);
  });

  it("never forks on the workspace status - the store decides its mode", () => {
    expect(service).not.toMatch(/workspaceSecurityStatus|kind === "locked"/);
  });

  it("signs with the reviewer name the phone already carries", () => {
    expect(service).toMatch(/authorName: async \(\) => getMobileSettings\(\)\.verifierName/);
  });
});

/**
 * A renamed note keeps its remarks (Nachschaerfung, N1).
 *
 * The open store addresses a note by path, so before N1 a rename orphaned
 * every remark on it - silently. The rename paths report themselves through
 * `plainva-file-ops`; what has to hold is that somebody listens and hands the
 * moves to the store, and that the shell mounts that listener.
 */
describe("a rename reaches the comment store on the phone", () => {
  const hook = strip(read("hooks", "useCommentMoves.ts"));
  const app = strip(read("App.tsx"));

  it("listens to the file operations and records the moves", () => {
    expect(hook).toMatch(/addEventListener\("plainva-file-ops"/);
    expect(hook).toMatch(/mobileCommentStore\(vault\)\.recordMoves\(/);
    // A failed marker leaves the rename standing and says so.
    expect(hook).toMatch(/commentMoveFailed/);
  });

  it("is mounted by the shell", () => {
    // Through the one comment-shell hook: App.tsx is at its structure budget.
    const shell = strip(read("hooks", "useCommentShell.ts"));
    expect(shell).toMatch(/useCommentMoves\(vault\)/);
    expect(app).toMatch(/useCommentShell\(vault,/);
  });
});

describe("one comment file per device on the phone (N2)", () => {
  it("hands the sideband step this device's id and a way to report unreadable files", () => {
    const sync = strip(read("services", "mobileSettingsSync.ts"));
    const step = sync.slice(sync.indexOf("new CommentsSyncStep({"), sync.indexOf("});", sync.indexOf("new CommentsSyncStep({")));
    expect(step).toMatch(/deviceId: device/);
    expect(step).toMatch(/onFaults:/);
    expect(sync).toMatch(/"plainva-workspace-comments-changed", \{ detail: \{ path: "\*" \} \}/);
  });

  it("re-reads on return to the foreground - the phone's moment to notice a foreign file", () => {
    const lifecycle = strip(read("services", "appLifecycle.ts"));
    const foreground = lifecycle.slice(lifecycle.indexOf("export function onAppForeground"), lifecycle.indexOf("export function", lifecycle.indexOf("export function onAppForeground") + 10));
    expect(foreground).toMatch(/"plainva-workspace-comments-changed", \{ detail: \{ path: "\*" \} \}/);
    const screen = strip(read("screens", "NoteScreen.tsx"));
    expect(screen).toMatch(/changed === path \|\| changed === "\*"/);
  });
});

describe("locked and unreadable are said, not hidden, on the phone (N3)", () => {
  it("reads the store state on the note screen and hands the sheet its locked state", () => {
    const screen = strip(read("screens", "NoteScreen.tsx"));
    expect(screen).toMatch(/mobileCommentStoreState\(vault\)/);
    expect(screen).toMatch(/locked=\{commentsLocked \? \{ onUnlock: requestCommentUnlock \} : undefined\}/);
    // The suggest verb stays and leads to the sheet, not into the mode.
    expect(screen).toMatch(/if \(commentsLocked\) \{ setCommentsOpen\(true\); return; \}/);
    const overview = strip(read("screens", "CommentsScreen.tsx"));
    expect(overview).toMatch(/mobileCommentStoreState\(vault\)/);
    expect(overview).toMatch(/m-comments-unlock/);
  });

  it("opens the sync screen on the unlock request and reports unreadable files once", () => {
    const shell = strip(read("hooks", "useCommentShell.ts"));
    expect(shell).toMatch(/addEventListener\("m-comments-unlock"/);
    expect(shell).toMatch(/navigate\(\{ kind: "sync", path: "" \}\)/);
    expect(shell).toMatch(/useCommentFaults\(vault\)/);
    const faults = strip(read("hooks", "useCommentFaults.ts"));
    expect(faults).toMatch(/addEventListener\("plainva-comment-faults"/);
    expect(faults).toMatch(/shareVaultText\(/);
  });
});
