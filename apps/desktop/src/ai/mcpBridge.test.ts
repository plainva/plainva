import { describe, expect, it, vi } from "vitest";
import { effectivePolicy, notePolicyFrom, parsePolicyFile, toolsFor, type EgressRecipient } from "@plainva/core";
import { createVaultToolExecutor, type AiVaultHost, type ToolScope, type VaultToolDeps } from "@plainva/ui";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
// The event plugin as the E2E browser has it: registering works, stopping rejects.
const events = vi.hoisted(() => ({ handlers: [] as Array<(event: { payload: unknown }) => void> }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, handler: (event: { payload: unknown }) => void) => {
    events.handlers.push(handler);
    return () => Promise.reject(new TypeError("Cannot read properties of undefined (reading 'unregisterListener')"));
  }),
}));

const { MCP_JUDGE_BLOCK, MCP_LEFT_OUT, MCP_UNSURE, MCP_VAULT_CHANGED, configureMcp, mcpCallScope, insideFolders, listenQuietly, mcpToolSpecs, runMcpCall, topLevelFolders, claudeCodeCommand, mcpClientConfig, vaultName } = await import("../services/ai/mcpBridge");

const files: Record<string, string> = {
  "Projects/Offer.md": "# Offer\n\nRates as in [[Finance/Salaries]] and [[Projects/Plan]].",
  "Projects/Plan.md": "# Plan\n\n📍 52.5200, 13.4050\nsteps",
  "Projects/Secret.md": "---\nplainva:\n  ai:\n    cloud: deny\n---\nhidden",
  "ProjectsArchive/Old.md": "# Old",
  "Finance/Salaries.md": "# Salaries",
};
const rules = parsePolicyFile("").rules;

function host(): AiVaultHost {
  const deps: VaultToolDeps = {
    async search() {
      return Object.keys(files).map((path) => ({ path, title: path.replace(/^.*\//, "").replace(/\.md$/, ""), snippet: files[path]!.slice(0, 40) }));
    },
    async readNote(path) {
      return files[path] ?? null;
    },
    async resolveLink(target) {
      return files[`${target}.md`] !== undefined ? `${target}.md` : null;
    },
    async policyOf(path, text) {
      const t = text ?? files[path] ?? "";
      return effectivePolicy(path, notePolicyFrom(t.includes("cloud: deny") ? { plainva: { ai: { cloud: "deny" } } } : {}), rules);
    },
    async taskRows() {
      return [];
    },
    todayKey: () => "2026-09-29",
    commands: () => [{ id: "open-note", label: "Open a note", run: () => true }],
  };
  return {
    key: "vault-key",
    // The bridge says how a call stands at the gate; the host passes it on as every shell's does.
    tools: (recipient: EgressRecipient, scope?: ToolScope, _redact?: unknown, web?: boolean) => {
      gates.push(web === true);
      return { names: [], executor: createVaultToolExecutor(deps, { recipient, webTools: web === true }, scope) };
    },
  } as unknown as AiVaultHost;
}
/** Whether each call was made as one that may reach the internet. */
const gates: boolean[] = [];

/** The native wall as a vault without folder links has it: the name decides (`answer_path_allowed`). */
const byName = (folders: readonly string[]) => async (paths: readonly string[]) => paths.map((path) => insideFolders(path, folders));
const call = (tool: string, args: unknown, folders = ["Projects"], judge = byName(folders)) => runMcpCall(host(), { requestId: "r1", clientId: "c1", client: "Test client", vaultKey: "vault-key", tool, args, folders }, undefined, judge);

describe("the MCP bridge", () => {
  it("a folder grants itself and below, never a sibling that shares its prefix", () => {
    expect(insideFolders("Projects/Offer.md", ["Projects"])).toBe(true);
    expect(insideFolders("Projects", ["Projects"])).toBe(true);
    expect(insideFolders("ProjectsArchive/Old.md", ["Projects"])).toBe(false);
    expect(insideFolders("Anything.md", [""])).toBe(true);
    expect(insideFolders("x.md", [])).toBe(false);
  });

  it("compares exactly as both are spelled: a folder that only folds to the granted one is another (review of R19, wave 2)", () => {
    // Another real folder on a case-sensitive disk, and `ẞ`/`ß`, the Kelvin sign and `K` everywhere.
    for (const [path, folder] of [
      ["projects/offer.md", "Projects"],
      ["STRA\u1e9eE/x.md", "Stra\u00dfe"],
      ["\u212aELVIN/x.md", "Kelvin"],
      // A backslash is a character of a name, never a separator; an NFD name is another spelling.
      ["Projects\\secret.md", "Projects"],
      ["Cafe\u0301/x.md", "Caf\u00e9"],
      // A folder spelled in a way no vault path is grants nothing.
      ["Projects/x.md", "/Projects"],
      ["Projects/x.md", "Projects/"],
    ]) {
      expect(insideFolders(path!, [folder!]), `${path} in ${folder}`).toBe(false);
    }
  });

  it("serves the tools of the MCP surface, says which of them only read, and names the arguments that are paths", () => {
    const specs = mcpToolSpecs();
    expect(specs.map((s) => s.name)).toEqual(toolsFor("mcp").map((t) => t.name));
    expect(specs.map((s) => s.name)).not.toContain("run_command");
    // Every paired client reads; what proposes or plans is served only to one the user allowed (stage 2, `mcpWrites.test.ts`).
    const reading = specs.filter((s) => s.kind === "read").map((s) => s.name);
    expect(reading).toEqual(toolsFor("mcp").filter((t) => t.risk === "read" || t.risk === "ui").map((t) => t.name));
    expect(reading).toHaveLength(8);
    expect(specs.find((s) => s.name === "read_note")!.pathArgs).toEqual(["path"]);
    expect(specs.find((s) => s.name === "query_base")!.pathArgs).toEqual(["base"]);
    expect(specs.find((s) => s.name === "search_vault")!.pathArgs).toEqual(["folder"]);
  });

  it("an outside client is at the gate a cloud that may reach the internet", async () => {
    gates.length = 0;
    await call("read_note", { path: "Projects/Offer.md", maxChars: 8000 });
    await call("search_vault", { query: "offer", limit: 10 });
    expect(gates).toEqual([true, true]);
  });

  it("outside the granted folders a note does not exist, and a denied one neither", async () => {
    const outside = await call("read_note", { path: "Finance/Salaries.md" });
    const missing = await call("read_note", { path: "Projects/Nowhere.md" });
    const denied = await call("read_note", { path: "Projects/Secret.md" });
    expect(outside).toEqual(missing);
    expect(denied).toEqual(missing);
    expect(outside.isError).toBe(true);
    expect(outside.paths).toEqual([]);
  });

  it("an answer names only notes inside the folders, and reports each one for the native check", async () => {
    const note = await call("read_note", { path: "Projects/Offer.md", maxChars: 8000 });
    expect(note.isError).toBe(false);
    expect(note.content).toContain("⟦withheld note⟧");
    expect(note.content).not.toContain("Salaries");
    expect(note.paths).toContain("Projects/Offer.md");
    expect(note.paths.every((p) => insideFolders(p, ["Projects"]))).toBe(true);
    const plan = await call("read_note", { path: "Projects/Plan.md", maxChars: 8000 });
    expect(plan.content).not.toContain("52.5200");
    const search = await call("search_vault", { query: "offer", limit: 10 });
    expect(search.content).toContain("Projects/Offer.md");
    expect(search.content).not.toMatch(/Salaries|Secret|ProjectsArchive/);
  });

  it("a twin folder's notes do not exist for a call, so its answer is never withheld for them (review of R19, wave 2)", async () => {
    files["projects/Twin.md"] = "# Twin\n\nsecretword";
    try {
      // The stand-in index returns every note for any query: the twin's hit is in what it found.
      const twin = await call("search_vault", { query: "secretword", limit: 10 });
      expect(twin.isError).toBe(false);
      expect(twin.paths).not.toContain("projects/Twin.md");
      expect(twin.paths.every((path) => path.startsWith("Projects/"))).toBe(true);
      expect(twin.content).not.toContain("Twin");
    } finally {
      delete files["projects/Twin.md"];
    }
  });

  it("a path the native wall refuses is left out before the answer is built, like a note that is not there (review of R19, wave 2)", async () => {
    // `Projects/link` is a folder link into a folder the app was not given: by name inside, on the disk outside.
    files["Projects/link/Inner.md"] = "# Inner\n\nsecretword";
    try {
      const wall = async (paths: readonly string[]) => paths.map((path) => insideFolders(path, ["Projects"]) && !path.startsWith("Projects/link"));
      const linked = await call("search_vault", { query: "secretword", limit: 10 }, ["Projects"], wall);
      expect(linked.paths).not.toContain("Projects/link/Inner.md");
      expect(linked.content).not.toContain("Inner");
      const read = await call("read_note", { path: "Projects/link/Inner.md" }, ["Projects"], wall);
      expect(read).toEqual(await call("read_note", { path: "Projects/Nowhere.md" }, ["Projects"], wall));
      // A wall that cannot answer fails the call, and says so: it never looks like a note that is not there.
      const silent = await call("read_note", { path: "Projects/Offer.md" }, ["Projects"], () => Promise.reject(new Error("closed")));
      expect(silent).toEqual({ content: MCP_UNSURE, isError: true, paths: [] });
    } finally {
      delete files["Projects/link/Inner.md"];
    }
  });

  it("counts a note left out for its name only where the gate lets it through and the wall judges its folder inside (review of R19, wave 2)", async () => {
    files["Projects/Kept:1.md"] = "---\nplainva:\n  ai:\n    cloud: deny\n---\nOffer";
    files["Projects/link/Draft./Odd.md"] = "# Odd\n\nOffer";
    files["Projects/link/Odd:2.md"] = "# Odd\n\nOffer";
    files["projects/Odd:3.md"] = "# Odd\n\nOffer";
    try {
      const wall = async (paths: readonly string[]) => paths.map((path) => insideFolders(path, ["Projects"]) && !path.startsWith("Projects/link"));
      const answer = await call("search_vault", { query: "Offer" }, ["Projects"], wall);
      expect(answer.isError).toBe(false);
      // Kept by its rules, under a folder link out of the grant, in a twin folder: nothing is counted.
      expect(answer.content).not.toContain("left out");
      files["Projects/Odd:1.md"] = "# Odd\n\nOffer";
      const counted = await call("search_vault", { query: "Offer" }, ["Projects"], wall);
      expect(counted.content).toContain(MCP_LEFT_OUT(1));
    } finally {
      for (const path of ["Projects/Kept:1.md", "Projects/link/Draft./Odd.md", "Projects/link/Odd:2.md", "projects/Odd:3.md", "Projects/Odd:1.md"]) delete files[path];
    }
  });

  it("asks the native side in blocks it takes, and never keeps a verdict it could not have (review of R19, wave 2)", async () => {
    const questions: number[] = [];
    let fail = true;
    const judge = async (paths: readonly string[]) => {
      questions.push(paths.length);
      if (fail) throw new Error("not now");
      return paths.map(() => true);
    };
    const { scope, unsure } = mcpCallScope([""], judge);
    const many = Array.from({ length: 2 * MCP_JUDGE_BLOCK + 5 }, (_, i) => `n${i}.md`);
    await scope.prefetch(many);
    expect(questions).toEqual([MCP_JUDGE_BLOCK, MCP_JUDGE_BLOCK, 5]);
    await expect(scope.confirm("n0.md")).rejects.toThrow("not now");
    expect(unsure()).toBe(true);
    // Asked again, not answered from what failed.
    fail = false;
    questions.length = 0;
    expect(await scope.confirm("n0.md")).toBe(true);
    expect(questions).toEqual([1]);
  });

  it("links in what an app reads stay only where they lead to a note it may read (review of R19, wave 2)", async () => {
    files["Projects/Links.md"] = "# Links\n\nSee [[Projects/Plan]], [[Finance/Salaries]] and [[Nowhere at all]].";
    try {
      const note = await call("read_note", { path: "Projects/Links.md", maxChars: 8000 });
      expect(note.content).toContain("[[Projects/Plan]]");
      // Outside the app's folders, and leading nowhere: told alike, so neither says whether a note lies outside.
      expect(note.content).not.toMatch(/Salaries|Nowhere/);
      expect(note.content.match(/⟦withheld note⟧/g)).toHaveLength(2);
    } finally {
      delete files["Projects/Links.md"];
    }
  });

  it("refuses what is not a tool of this surface, bad arguments and a missing vault", async () => {
    expect((await call("run_command", { id: "open-graph" })).isError).toBe(true);
    expect((await call("write_note", { path: "Projects/Offer.md" })).isError).toBe(true);
    expect((await call("read_note", { path: 42 })).isError).toBe(true);
    const none = await runMcpCall(null, { requestId: "r", clientId: "c", client: "x", vaultKey: "vault-key", tool: "read_note", args: { path: "a.md" }, folders: [""] });
    expect(none).toEqual({ content: "Plainva has no vault open.", isError: true, paths: [] });
  });

  it("answers nothing of this vault to a call made for another — opened since the client was admitted", async () => {
    gates.length = 0;
    const other = await runMcpCall(host(), { requestId: "r2", clientId: "c1", client: "Test client", vaultKey: "another-vault", tool: "read_note", args: { path: "Projects/Offer.md" }, folders: ["Projects"] });
    expect(other).toEqual({ content: MCP_VAULT_CHANGED, isError: true, paths: [] });
    // Not even the gate was asked: nothing of this vault was looked at.
    expect(gates).toEqual([]);
  });

  it("leaves out, and counts, a note whose name the native wall could not judge as it stands (review of R19)", async () => {
    files["Projects/Draft:1.md"] = "# Odd\n\nOffer";
    // In a folder whose own name cannot be judged: where that folder leads is not known, so it is left out, uncounted.
    files["Projects/Draft./Odd.md"] = "# Odd\n\nOffer";
    try {
      const answer = await call("search_vault", { query: "Offer" });
      expect(answer.isError).toBe(false);
      expect(answer.paths).not.toContain("Projects/Draft:1.md");
      expect(answer.paths).not.toContain("Projects/Draft./Odd.md");
      expect(answer.content).toContain(MCP_LEFT_OUT(1));
      // Outside the app's folders nothing is counted: the count says nothing about the rest of the vault.
      const elsewhere = await call("search_vault", { query: "Offer" }, ["Finance"]);
      expect(elsewhere.content).not.toContain("left out");
    } finally {
      delete files["Projects/Draft:1.md"];
      delete files["Projects/Draft./Odd.md"];
    }
  });

  it("says there are more search results only where there are more it may see (review of R19)", async () => {
    // One result per page: the first page of a search whose other hits lie outside the app's folders says no more.
    const first = await call("search_vault", { query: "Salaries", limit: 1 }, ["Finance"]);
    expect(first.content).not.toContain("More results");
    const outside = await call("search_vault", { query: "Offer", limit: 1 }, ["Finance"]);
    expect(outside.content).not.toContain("More results");
    // Two notes the app may see answer "Plan": the offer that links to it, and the plan.
    const inside = await call("search_vault", { query: "Plan", limit: 1 });
    expect(inside.content).toContain("More results");
  });

  it("refuses a search folder with a quote instead of changing it (review of R19)", async () => {
    const quoted = await call("search_vault", { query: "Offer", folder: 'Pro"jects' });
    expect(quoted.isError).toBe(true);
    expect(quoted.paths).toEqual([]);
    const plain = await call("search_vault", { query: "Offer", folder: "Projects" });
    expect(plain.isError).toBe(false);
  });

  it("opens a note in the app only through the gate", async () => {
    expect((await call("open_in_app", { path: "Projects/Offer.md" })).isError).toBe(false);
    expect((await call("open_in_app", { path: "Finance/Salaries.md" })).isError).toBe(true);
  });

  it("lists top-level folders and writes the set-up snippets", () => {
    expect(topLevelFolders(["Projects/2026", "Projects", "Areas", ".plainva", "Areas/Home"])).toEqual(["Areas", "Projects"]);
    // Folders the native side refuses as a grant are not offered (review of R19).
    expect(topLevelFolders(["Projects", "node_modules", "node_modules/x", "$RECYCLE.BIN", "Node_Modules", "node_modules_archive"])).toEqual(["node_modules_archive", "Projects"]);
    // Nor a folder the native side could not keep as it is named: it would be refused, never trimmed into another.
    expect(topLevelFolders([" Notes", "Notes ", "Notes", "Draft.", "a:b", "Cafe\u0301", "Caf\u00e9"])).toEqual(["Caf\u00e9", "Notes"]);
    expect(vaultName("/home/u/notes/")).toBe("notes");
    expect(vaultName("D:/Vaults/Work")).toBe("Work");
    expect(claudeCodeCommand("C:\\Program Files\\Plainva\\plainva-mcp.exe", "com.plainva.desktop")).toBe('claude mcp add plainva -- "C:\\Program Files\\Plainva\\plainva-mcp.exe" --app com.plainva.desktop');
    expect(JSON.parse(mcpClientConfig("/Applications/Plainva.app/Contents/MacOS/plainva-mcp", "com.plainva.desktop"))).toEqual({
      mcpServers: { plainva: { command: "/Applications/Plainva.app/Contents/MacOS/plainva-mcp", args: ["--app", "com.plainva.desktop"] } },
    });
  });
});

/** R19 of the stability plan: an encrypted workspace takes no change of an app, so it is offered none. */
describe("what the native side is told to serve", () => {
  const served = () => {
    const calls = vi.mocked(invoke).mock.calls.filter(([command]) => command === "mcp_configure");
    return (calls[calls.length - 1]![1] as { tools: { name: string; kind: string }[]; vault: { key: string; name: string; root: string } | null });
  };

  it("in an encrypted workspace only the tools that read; elsewhere the tools that write as well", async () => {
    await configureMcp(true, { path: "D:/Vaults/Work", name: "Work" });
    const open = served();
    expect(open.tools.some((tool) => tool.kind !== "read")).toBe(true);
    expect(open.vault).toEqual({ key: expect.stringMatching(/^v[0-9a-f]{16}$/), name: "Work", root: "D:/Vaults/Work" });
    await configureMcp(true, { path: "D:/Vaults/Work", name: "Work" }, { sealed: true });
    const sealed = served();
    expect(sealed.tools.length).toBeGreaterThan(0);
    expect(sealed.tools.every((tool) => tool.kind === "read")).toBe(true);
    expect(sealed.tools.map((tool) => tool.name)).toEqual(open.tools.filter((tool) => tool.kind === "read").map((tool) => tool.name));
  });
});

/** CI 2026-09-29: Tauri's unlisten rejected in the E2E browser, and five runs saw a page error. */
describe("a native event listener", () => {
  it("hands over the payload and stops quietly where the event plugin is missing", async () => {
    const seen: unknown[] = [];
    const stop = listenQuietly<string>("mcp-pair", (payload) => seen.push(payload));
    await vi.waitFor(() => expect(events.handlers).toHaveLength(1));
    events.handlers[0]!({ payload: "hello" });
    expect(seen).toEqual(["hello"]);
    expect(() => stop()).not.toThrow();
    // Stopped before it was even registered: it is stopped the moment it is.
    const early = listenQuietly("mcp-call", () => undefined);
    expect(() => early()).not.toThrow();
    await vi.waitFor(() => expect(events.handlers).toHaveLength(2));
    // A rejection left unhandled would fail this run.
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
