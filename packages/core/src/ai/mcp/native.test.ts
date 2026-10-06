import { describe, expect, it } from "vitest";
import { checkMcpAddress, mcpServerTarget, mcpStartFailure, readMcpRegisteredServers, MCP_START_PROBLEMS } from "./native.js";

/**
 * [what the user typed, whether it is an address a server may have] — the
 * contract of every shell's native side. The Rust registry
 * (apps/desktop/src-tauri/src/mcp_client/registry.rs), Android's
 * `AiMcpRulesTest` and iOS's `AiMcpRulesTests` run the same list: a case
 * added here is added there. The two letters outside ASCII are built below,
 * so that this file holds none.
 */
const CYRILLIC_A = String.fromCharCode(0x430);
const E_ACUTE = String.fromCharCode(0xe9);
export const MCP_ADDRESS_CASES: ReadonlyArray<readonly [string, boolean]> = [
  [" https://MCP.Example.com/mcp ", true],
  ["https://mcp.example.com/mcp?toolsets=issues#top", true],
  ["https://mcp.example.com:8443", true],
  ["https://192.168.1.20/mcp", true],
  ["https://xn--bcher-kva.example/mcp", true],
  ["http://localhost:3000/mcp", true],
  ["http://127.0.0.1:3000/mcp", true],
  ["http://[::1]:3000/mcp", true],
  ["", false],
  ["   ", false],
  ["mcp.example.com/mcp", false],
  ["http://mcp.example.com/mcp", false],
  ["http://192.168.1.20:3000/mcp", false],
  ["http://localhost.evil.test/mcp", false],
  ["https://user:secret@mcp.example.com/mcp", false],
  ["https://user@mcp.example.com/mcp", false],
  ["ftp://mcp.example.com/", false],
  ["file:///etc/passwd", false],
  ["javascript:alert(1)", false],
  ["https://", false],
  ["https://mcp.example.com/a b", false],
  // A Cyrillic letter in the host: what only looks like a name is not one.
  [`https://ex${CYRILLIC_A}mple.com/mcp`, false],
  [`https://mcp.example.com/caf${E_ACUTE}`, false],
];

describe("the address of a remote server", () => {
  it("is printable ASCII, https or this device, and carries no credentials", () => {
    for (const [typed, accepted] of MCP_ADDRESS_CASES) expect(checkMcpAddress(typed).ok, JSON.stringify(typed)).toBe(accepted);
    expect(checkMcpAddress(`https://mcp.example.com/${"a".repeat(3000)}`)).toEqual({ ok: false, problem: "too-long" });
  });

  it("says what is wrong with one that is refused", () => {
    expect(checkMcpAddress("")).toEqual({ ok: false, problem: "empty" });
    expect(checkMcpAddress(`https://ex${CYRILLIC_A}mple.com/`)).toEqual({ ok: false, problem: "not-ascii" });
    expect(checkMcpAddress("https://mcp.example.com/a b")).toEqual({ ok: false, problem: "not-ascii" });
    expect(checkMcpAddress("mcp.example.com/mcp")).toEqual({ ok: false, problem: "not-a-url" });
    expect(checkMcpAddress("javascript:alert(1)")).toEqual({ ok: false, problem: "not-a-url" });
    expect(checkMcpAddress("http://mcp.example.com/mcp")).toEqual({ ok: false, problem: "scheme" });
    expect(checkMcpAddress("ftp://mcp.example.com/")).toEqual({ ok: false, problem: "scheme" });
    expect(checkMcpAddress("https://user:secret@mcp.example.com/mcp")).toEqual({ ok: false, problem: "credentials" });
  });

  it("is read in one form, with the host a grant names", () => {
    expect(checkMcpAddress(" https://MCP.Example.com/mcp#top ")).toEqual({ ok: true, url: "https://mcp.example.com/mcp", host: "mcp.example.com" });
    expect(checkMcpAddress("https://mcp.example.com:8443")).toEqual({ ok: true, url: "https://mcp.example.com:8443/", host: "mcp.example.com:8443" });
    expect(checkMcpAddress("https://mcp.example.com:443/mcp?a=1")).toEqual({ ok: true, url: "https://mcp.example.com/mcp?a=1", host: "mcp.example.com" });
    expect(checkMcpAddress("http://[::1]:3000/mcp")).toEqual({ ok: true, url: "http://[::1]:3000/mcp", host: "[::1]:3000" });
  });
});

describe("what the native side answers", () => {
  it("is read defensively: an entry that is none is left out", () => {
    const servers = readMcpRegisteredServers([
      { id: "tracker", kind: "http", url: "https://mcp.example.com/mcp", args: [], env: [], sandbox: false, stored: [""] },
      { id: "local", kind: "program", program: "/usr/bin/server", args: ["--stdio", 5], env: ["TOKEN"], sandbox: true, stored: ["TOKEN"] },
      { id: "broken", kind: "http" },
      { id: "odd", kind: "socket", url: "x" },
      { kind: "http", url: "https://no-id.example/" },
      null,
      "text",
    ]);
    expect(servers).toEqual([
      { id: "tracker", kind: "http", url: "https://mcp.example.com/mcp", args: [], env: [], sandbox: false, stored: [""] },
      { id: "local", kind: "program", program: "/usr/bin/server", args: ["--stdio"], env: ["TOKEN"], sandbox: true, stored: ["TOKEN"] },
    ]);
    for (const junk of [null, undefined, "text", {}, 7]) expect(readMcpRegisteredServers(junk)).toEqual([]);
  });

  it("names a server by what it is: another address or another command is another server", () => {
    const http = { id: "a", kind: "http" as const, url: "https://mcp.example.com/mcp", args: [], env: [], sandbox: false, stored: [] };
    const program = { id: "a", kind: "program" as const, program: "/usr/bin/npx", args: ["-y", "@scope/server"], env: ["TOKEN"], sandbox: true, stored: [] };
    expect(mcpServerTarget(http)).toBe("http https://mcp.example.com/mcp");
    expect(mcpServerTarget(program)).toBe('program ["/usr/bin/npx","-y","@scope/server"]');
    expect(mcpServerTarget({ ...http, url: "https://mcp.example.org/mcp" })).not.toBe(mcpServerTarget(http));
    expect(mcpServerTarget({ ...program, args: ["-y", "@scope/server", "--write"] })).not.toBe(mcpServerTarget(program));
    // Arguments are told apart from one another: two that would join to the same text are two commands.
    expect(mcpServerTarget({ ...program, args: ["-y @scope/server"] })).not.toBe(mcpServerTarget(program));
  });

  it("turns the reason a program did not start into a failure, and knows only the reasons there are", () => {
    expect(mcpStartFailure("not-registered")).toEqual({ kind: "refused", detail: "not-registered" });
    for (const problem of MCP_START_PROBLEMS.filter((p) => p !== "not-registered")) expect(mcpStartFailure(new Error(problem))).toEqual({ kind: "unreachable", detail: problem });
    // Anything else — a system's own message, a path — is not passed on.
    expect(mcpStartFailure("C:\\Users\\me\\secret.exe: access denied")).toEqual({ kind: "unreachable", detail: "start-failed" });
    expect(mcpStartFailure(undefined)).toEqual({ kind: "unreachable", detail: "start-failed" });
  });
});
