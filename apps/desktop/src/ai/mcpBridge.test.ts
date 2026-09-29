import { describe, expect, it, vi } from "vitest";
import { effectivePolicy, notePolicyFrom, parsePolicyFile, toolsFor, type EgressRecipient } from "@plainva/core";
import { createVaultToolExecutor, type AiVaultHost, type ToolScope, type VaultToolDeps } from "@plainva/ui";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const { insideFolders, mcpToolSpecs, runMcpCall, topLevelFolders, claudeCodeCommand, mcpClientConfig, vaultName } = await import("../services/ai/mcpBridge");

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
    tools: (recipient: EgressRecipient, scope?: ToolScope) => ({ names: [], executor: createVaultToolExecutor(deps, { recipient, webTools: false }, scope) }),
  } as unknown as AiVaultHost;
}

const call = (tool: string, args: unknown, folders = ["Projects"]) => runMcpCall(host(), { requestId: "r1", clientId: "c1", client: "Test client", tool, args, folders });

describe("the MCP bridge", () => {
  it("a folder grants itself and below, never a sibling that shares its prefix", () => {
    expect(insideFolders("Projects/Offer.md", ["Projects"])).toBe(true);
    expect(insideFolders("ProjectsArchive/Old.md", ["Projects"])).toBe(false);
    expect(insideFolders("Anything.md", [""])).toBe(true);
    expect(insideFolders("projects/offer.md", ["Projects"])).toBe(true);
    expect(insideFolders("Cafe\u0301/x.md", ["Caf\u00e9"])).toBe(true);
    expect(insideFolders("x.md", [])).toBe(false);
  });

  it("serves only the read tools of the MCP surface, and names the arguments that are paths", () => {
    const specs = mcpToolSpecs();
    expect(specs.map((s) => s.name)).toEqual(toolsFor("mcp").map((t) => t.name));
    expect(specs.map((s) => s.name)).not.toContain("run_command");
    expect(toolsFor("mcp").every((t) => t.risk === "read" || t.risk === "ui")).toBe(true);
    expect(specs.find((s) => s.name === "read_note")!.pathArgs).toEqual(["path"]);
    expect(specs.find((s) => s.name === "query_base")!.pathArgs).toEqual(["base"]);
    expect(specs.find((s) => s.name === "search_vault")!.pathArgs).toEqual(["folder"]);
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

  it("refuses what is not a tool of this surface, bad arguments and a missing vault", async () => {
    expect((await call("run_command", { id: "open-graph" })).isError).toBe(true);
    expect((await call("write_note", { path: "Projects/Offer.md" })).isError).toBe(true);
    expect((await call("read_note", { path: 42 })).isError).toBe(true);
    const none = await runMcpCall(null, { requestId: "r", clientId: "c", client: "x", tool: "read_note", args: { path: "a.md" }, folders: [""] });
    expect(none).toEqual({ content: "Plainva has no vault open.", isError: true, paths: [] });
  });

  it("opens a note in the app only through the gate", async () => {
    expect((await call("open_in_app", { path: "Projects/Offer.md" })).isError).toBe(false);
    expect((await call("open_in_app", { path: "Finance/Salaries.md" })).isError).toBe(true);
  });

  it("lists top-level folders and writes the set-up snippets", () => {
    expect(topLevelFolders(["Projects/2026", "Projects", "Areas", ".plainva", "Areas/Home"])).toEqual(["Areas", "Projects"]);
    expect(vaultName("/home/u/notes/")).toBe("notes");
    expect(vaultName("D:/Vaults/Work")).toBe("Work");
    expect(claudeCodeCommand("C:\\Program Files\\Plainva\\plainva-mcp.exe", "com.plainva.desktop")).toBe('claude mcp add plainva -- "C:\\Program Files\\Plainva\\plainva-mcp.exe" --app com.plainva.desktop');
    expect(JSON.parse(mcpClientConfig("/Applications/Plainva.app/Contents/MacOS/plainva-mcp", "com.plainva.desktop"))).toEqual({
      mcpServers: { plainva: { command: "/Applications/Plainva.app/Contents/MacOS/plainva-mcp", args: ["--app", "com.plainva.desktop"] } },
    });
  });
});
