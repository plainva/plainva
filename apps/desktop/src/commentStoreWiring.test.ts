import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
    const choice = context.slice(context.indexOf("const commentStore = ("), context.indexOf("const getCommentStoreState"));
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
