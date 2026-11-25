import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The editor's part of the save retry (decided 2026-11-17). The timer's own
 * rules are tested in `services/saveRetryTimer.test.ts`; the editor has no
 * render harness, so this holds the four places it hangs on: a failed save
 * plans a try, a save asked for now (Ctrl+S, the way out of the app, a step
 * that needs the note on disk) goes at once, and a pane that shows another
 * note or goes leaves no try behind.
 */

const editor = readFileSync(fileURLToPath(new URL("./components/Editor.tsx", import.meta.url)), "utf8");

/** The text between `from` and the next `until`. */
function between(from: string, until: string): string {
  const start = editor.indexOf(from);
  expect(start, `missing: ${from}`).toBeGreaterThanOrEqual(0);
  const end = editor.indexOf(until, start + from.length);
  return editor.slice(start, end < 0 ? undefined : end);
}

describe("the desktop editor tries a failed save again", () => {
  it("plans a try where a failed save sets its message, reading the pane's text when it comes", () => {
    const failure = between("setSaveError(e.message || String(error));", "throw error;");
    expect(failure).toMatch(/saveRetry\.failed\(\s*error,/);
    expect(failure).toMatch(/loadedPathRef\.current === path/);
    expect(failure).toMatch(/sessionRef\.current\?\.view\.state\.doc\.toString\(\)/);
  });

  it("lets a save that starts take the planned try's place, and resets after one went through", () => {
    expect(editor).toMatch(/setSaveError\(null\); \}\n\s*\/\/[^\n]*\n\s*if \(current\(\)\) saveRetry\.starting\(\);/);
    expect(editor).toMatch(/keep: keepTextBeside,\n\s*\}\);\n\s*\/\/[^\n]*\n\s*if \(current\(\)\) saveRetry\.reset\(\);/);
  });

  it("tries at once, not behind the timer, when a save is asked for now", () => {
    expect(between("const handleFlushRequest", "await persistText(")).toMatch(/saveRetry\.reset\(\);/);
  });

  it("starts at one second again when the person types", () => {
    expect(between("const scheduleSave = ", "saveTimeoutRef.current = window.setTimeout")).toMatch(/saveRetry\.reset\(\);/);
  });

  it("leaves no try behind when the pane shows another note, or goes", () => {
    expect(between("// The pane shows another note, or goes", "void persistText(text)")).toMatch(/saveRetry\.cancel\(\);/);
    expect(between("saveState.activate();", "}, [saveState, saveRetry]);")).toMatch(/saveRetry\.cancel\(\);\s*saveState\.deactivate\(\);/);
    expect(between("const captureTabDocument", "for (const timer of [saveTimeoutRef")).toMatch(/saveRetry\.cancel\(\);/);
  });

  it("hands a failed save of a note the pane has left to the saver beside it, which outlives the pane", () => {
    expect.hasAssertions();
    // The branch of a failed save once the pane no longer holds the note.
    const left = between("} else if (draftVault && !saveState.transferFrozen && saveState.revision === revAtSave) {", "throw error;");
    expect(left).toMatch(/adoptLeftNoteSave\(\{/);
    // The same text, of the same note, in the same vault: the closure of the lifetime that wrote it.
    expect(left).toMatch(/retry: \(\) => persistText\(val\),/);
    // Not due once an editor holds the note again, its save went through or was given up.
    expect(left).toMatch(/!saveState\.isActive\(\) && !EditorSaveLifetime\.holds\(draftVault, path\)/);
    expect(left).toMatch(/revAtSave > saveState\.savedRevision && revAtSave > saveState\.discardedRevision/);
    // Owned elsewhere, written elsewhere, moved or deleted: asked of the journal and the file before each try.
    expect(left).toMatch(/&& await leftNoteSaveDue\(\s*\{ path, sessionId: saveState\.id, revision: revAtSave, persisted: saveState\.persisted \}/);
    expect(left).toMatch(/newestDraft: \(\) => import\("\.\.\/services\/draftJournal"\)\.then\(\(\{ readDraft \}\) => readDraft\(draftVault, path\)\)/);
    // A save of a runtime that closed is refused (`leftNoteSaves.ts`).
    expect(left).toMatch(/epoch: saveState\.epoch,/);
    // The pane's last try is the save that is handed over when it fails.
    expect(between("// The pane shows another note, or goes", "session.view.scrollDOM.removeEventListener")).toMatch(/void persistText\(text\)\.catch/);
    const lifetime = readFileSync(fileURLToPath(new URL("./services/editorSaveLifetime.ts", import.meta.url)), "utf8");
    expect(lifetime).toMatch(/activate\(\): void \{\s*this\.active = true;\s*active\.add\(this\);\s*if \(this\.vaultPath && this\.path\) releaseLeftNoteSave\(this\.vaultPath, this\.path\);/);
    // Closing a vault waits for its writes; from then on none of its left saves is tried again.
    const pendingWrites = readFileSync(fileURLToPath(new URL("./services/pendingWrites.ts", import.meta.url)), "utf8");
    expect(pendingWrites).toMatch(/export async function settlePendingWrites\(vaultPath: string\): Promise<void> \{\s*\/\/[^\n]*\n\s*endLeftNoteSaves\(vaultPath\);/);
  });

  it("tries a save that rested after its last retry when the person comes back to the window", () => {
    expect(editor).toMatch(/window\.addEventListener\("focus", wakeRestingSave\)/);
    const wake = between("const wakeRestingSave = useStableHandler(", "});");
    // Only a save that rests, of the note the pane shows, with text still unsaved — no write at every switch of windows.
    expect(wake).toMatch(/if \(!saveRetry\.resting \|\| !activePath \|\| loadedPathRef\.current !== activePath\) return;/);
    expect(wake).toMatch(/if \(!saveState\.isActive\(\) \|\| !saveState\.dirty \|\| saveState\.transferFrozen\) return;/);
    expect(wake).toMatch(/saveRetry\.reset\(\);\s*void persistText\(/);
  });

  it("says \"trying again\" only while a try is planned, and why once it rests", () => {
    expect(editor).toMatch(/saveRetryState === "planned" \? t\("editor\.saveRetrying"\) : t\("editor\.saveFailed"\)/);
    expect(editor).toMatch(/saveRetryState === "resting" && saveError \? t\("editor\.saveFailedWhy", \{ reason: saveError \}\)/);
    expect(editor).toMatch(/data-tip=\{failedTip\} data-testid="editor-save-state"/);
  });

  it("looks for a vanished note only after a save that said the file is gone (review 2026-11-18)", () => {
    expect(editor).toMatch(/saveFailedVanishedRef\.current = isVanishedFileFailure\(error\);\s*setSaveError\(/);
    expect(editor).toMatch(/if \(!saveError \|\| !saveFailedVanishedRef\.current \|\| !path \|\| !vaultAdapter\) return;/);
    expect(between("const lookForVanishedFile = useStableHandler(", "if (!saveState.dirty)")).toMatch(/if \(\(await vaultFolderIsThere\(vaultAdapter\)\) === false\) return;/);
  });

  it("writes no note back into a vault folder that is not there", () => {
    expect(between("const restoreHere = useStableHandler(", "withPendingWrite(")).toMatch(/if \(\(await vaultFolderIsThere\(vaultAdapter\)\) === false\) \{\s*toast\.error/);
  });
});

describe("the phone keeps to the same rule", () => {
  const screen = readFileSync(fileURLToPath(new URL("../../mobile/src/screens/NoteScreen.tsx", import.meta.url)), "utf8");
  const part = (from: string, until: string) => screen.slice(screen.indexOf(from), screen.indexOf(until, screen.indexOf(from)));

  it("writes no note back into a vault folder that is not there, and does not look for one", () => {
    expect(part("const restoreHere = useStableHandler(", "vaultOps.saveEditorText(")).toMatch(/if \(\(await vaultFolderIsThere\(vault\.files\)\) === false\) \{\s*toast\.error/);
    expect(part("const lookForVanishedFile = useStableHandler(", "const text = liveText();")).toMatch(/if \(\(await vaultFolderIsThere\(vault\.files\)\) === false\) return;/);
  });
});
