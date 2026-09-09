import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One store per vault (Nachschaerfung, N0).
 *
 * The choice between the sealed store and the open bundle used to be written
 * six times in the vault context, and a seventh place - the editor's
 * capability effect - gated the whole comment column on an encrypted
 * workspace, so the desktop never showed in a plain vault what the phone had
 * all along (finding 2026-09-07). These are SOURCE assertions on purpose: the
 * two stores have their own behaviour tests; what regresses silently is a new
 * branch at a call site, and no behaviour test looks at those.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the vault context chooses one comment store", () => {
  const context = strip(read("contexts", "VaultContext.tsx"));

  it("forks on the workspace status exactly once, inside the store choice", () => {
    const choice = context.slice(context.indexOf("const commentStoreMemo = useMemo("), context.indexOf("const getCommentStoreState"));
    expect(choice, "the store choice reads the status").toMatch(/state\.workspaceSecurityStatus/);
    // Every comment function after the choice goes through `commentStore()`;
    // none of them may ask the status again.
    const after = context.slice(context.indexOf("const getCommentStoreState"), context.indexOf("const postWorkspaceComment = ("));
    const branches = after.match(/workspaceSecurityStatus/g) ?? [];
    // The three publication/ownership readers legitimately need a workspace
    // (guest remarks, owned notes); nothing else in that span may.
    expect(branches.length, "no comment reader forks on the status besides the three publication ones").toBeLessThanOrEqual(3);
    for (const name of ["getWorkspaceCapabilities", "listWorkspaceComments", "listAllWorkspaceComments", "listWorkspaceMembers", "getCommentSelfId", "postWorkspaceCommentRecord", "retryWorkspaceComment", "discardWorkspaceComment"]) {
      const at = after.indexOf(`const ${name} =`);
      expect(at, `${name} exists`).toBeGreaterThanOrEqual(0);
      expect(after.slice(at, at + 900), `${name} delegates to the store`).toMatch(/commentStore\(\)/);
    }
  });

  it("no longer reaches into the bundle helpers itself", () => {
    expect(context).not.toMatch(/listLocalComments|listAllLocalComments|postLocalComment|localCommentContext/);
  });

  it("serves the store state to auxiliary windows", () => {
    expect(context).toMatch(/getCommentStoreState: \(\) => getWindowBus\(\)\.then\(\(bus\) => bus\.request\("comment-state"/);
    expect(context).toMatch(/state: getCommentStoreState/);
  });
});

describe("the editor asks for its capabilities in every vault", () => {
  const editor = strip(read("components", "Editor.tsx"));

  it("does not gate the capability read on an encrypted workspace", () => {
    const from = editor.indexOf("void getWorkspaceCapabilities(activePath)");
    expect(from).toBeGreaterThan(0);
    const effect = editor.slice(editor.lastIndexOf("useEffect(", from), from);
    expect(effect, "the guard must look at the path only").toMatch(/if \(!activePath\) \{ setWorkspaceCapabilities\(null\); return; \}/);
    expect(effect).not.toMatch(/!workspaceSecurityStatus/);
  });
});

describe("a rename reaches the comment store on the desktop (N1)", () => {
  const context = strip(read("contexts", "VaultContext.tsx"));

  it("listens to the file operations once and records the moves", () => {
    expect(context.match(/addEventListener\("plainva-file-ops"/g) ?? []).toHaveLength(1);
    expect(context).toMatch(/commentStore\(\)\?\.recordMoves\(moves\)/);
    // A client window has no store; it hands the moves to the owner.
    expect(context).toMatch(/bus\.request\("comment-move", \{ moves \}\)/);
    // A failed marker leaves the rename standing and says so.
    expect(context).toMatch(/commentMoveFailed/);
  });
});

describe("one comment file per device on the desktop (N2)", () => {
  it("hands the sideband step this device's id and a way to report unreadable files", () => {
    const profile = strip(read("services", "settingsProfile.ts"));
    const step = profile.slice(profile.indexOf("new CommentsSyncStep({"), profile.indexOf("});", profile.indexOf("new CommentsSyncStep({")));
    expect(step).toMatch(/deviceId: await getDeviceId\(\)/);
    expect(step).toMatch(/onFaults:/);
    // The open column re-reads after every cycle: "*" is every note.
    expect(profile).toMatch(/"plainva-workspace-comments-changed", \{ detail: \{ path: "\*" \} \}/);
  });

  it("re-reads when a foreign sync drops another device's file into the folder", () => {
    // No cycle of ours runs for Dropbox, iCloud or a network share; only the
    // watcher sees the file land.
    const context = strip(read("contexts", "VaultContext.tsx"));
    const watch = context.slice(context.indexOf("state.vaultAdapter.watch(("), context.indexOf("const relevantEvents"));
    expect(watch).toMatch(/\.plainva\/sync\/comments\./);
    expect(watch).toMatch(/path: "\*"/);
  });

  it("lets the editor accept the wildcard", () => {
    const editor = strip(read("components", "Editor.tsx"));
    expect(editor).toMatch(/path === activePath \|\| path === "\*"/);
  });
});

describe("locked and unreadable are said, not hidden (N3)", () => {
  it("lets the editor read the store state and hand the column its locked state", () => {
    const editor = strip(read("components", "Editor.tsx"));
    expect(editor).toMatch(/getCommentStoreState\(\)/);
    expect(editor).toMatch(/locked=\{commentsLocked \? \{ onUnlock: requestCommentUnlock \} : undefined\}/);
    // The suggest verb stays and leads to the explanation, never into a mode
    // whose send would fail a minute later.
    const start = editor.slice(editor.indexOf("const startSuggesting = useStableHandler("), editor.indexOf("const stopSuggesting"));
    expect(start).toMatch(/if \(commentsLocked\) \{ setCommentColumnSession\("open"\)/);
    // Retry and discard exist only where an outbox does.
    expect(editor).toMatch(/onRetryPending=\{commentStoreState\?\.hasOutbox \?/);
    expect(editor).toMatch(/onDiscardPending=\{commentStoreState\?\.hasOutbox \?/);
  });

  it("asks the unlock prompt by force from the column, and the prompt honours it", () => {
    const editor = strip(read("components", "Editor.tsx"));
    expect(editor).toMatch(/"plainva-encryption-locked", \{ detail: \{ vaultPath, force: true \} \}/);
    const host = strip(read("components", "settings", "EncryptionUnlockHost.tsx"));
    expect(host).toMatch(/dismissedFor\.current === vaultPath && !detail\?\.force/);
  });

  it("installs the fault reporter for the life of a vault, owner only", () => {
    const context = strip(read("contexts", "VaultContext.tsx"));
    expect(context).toMatch(/if \(!state\.vaultPath \|\| isClient\) return;\s*return installCommentFaultReporter\(state\.vaultPath\);/);
    const overview = strip(read("components", "comments", "CommentsOverview.tsx"));
    expect(overview).toMatch(/storeState\?\.mode === "locked"/);
  });
});

describe("the comment texts live in their own namespace (N4)", () => {
  it("no code asks for a comment or suggestion text under workspaceSecurity any more", () => {
    // The feature stopped hanging on the encryption in Stufe D; the KI harness
    // adds more comment texts, and they must not land under "security" either.
    // `commentOnly` is a workspace ROLE description and stays where it is.
    const roots = [join(SRC), join(SRC, "..", "..", "mobile", "src"), join(SRC, "..", "..", "..", "packages", "ui", "src")];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(path); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name) || path.endsWith("commentStoreWiring.test.ts")) continue;
        const content = readFileSync(path, "utf8").split("workspaceSecurity.commentOnly").join("");
        const hit = content.match(/workspaceSecurity\.(?:comment|suggest)[A-Za-z]*/);
        if (hit) offenders.push(`${path} :: ${hit[0]}`);
      }
    };
    for (const root of roots) walk(root);
    expect(offenders).toEqual([]);
  });
});

describe("the name a remark is signed with (finding 2026-09-09)", () => {
  it("is asked for once, in the post funnel, for remarks and proposals only", () => {
    const context = strip(read("contexts", "VaultContext.tsx"));
    const funnel = context.slice(context.indexOf("const postWorkspaceCommentInput = async"), context.indexOf("const retryWorkspaceComment"));
    expect(funnel).toMatch(/const captured = structuredClone\(input\)/);
    expect(funnel).toMatch(/if \(state\.vaultPath && !captured\.resolvedCommentId && !captured\.retractsCommentId && \(captured\.body\.trim\(\) \|\| captured\.suggestion\)\)\s+await ensureCommentAuthorName\(store, state\.vaultPath\)/);
    const ask = context.slice(context.indexOf("const ensureCommentAuthorName = async"), context.indexOf("const postWorkspaceCommentRecord"));
    // Never in a workspace (the member signs), never twice a session, and the
    // answer lands in the one field the app has.
    expect(ask).toMatch(/mode === "workspace"\) return/);
    expect(ask).toMatch(/commentNameAskedRef\.current\.add\(vaultPath\)/);
    expect(ask).toMatch(/settings\.set\(verifierNameKey\(vaultPath\), answer\.trim\(\)\)/);
  });

  it("falls back to the device's own label, never to nothing", () => {
    const local = strip(read("services", "localComments.ts"));
    expect(local).toMatch(/\(await authorName\(\)\)\?\.trim\(\) \|\| commentDeviceFallbackName\(/);
  });
});
