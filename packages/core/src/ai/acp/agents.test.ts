import { describe, expect, it } from "vitest";
import {
  ACP_KNOWN_AGENTS,
  acpAgentLabel,
  acpAgentTarget,
  acpAuthorId,
  acpCommandText,
  acpKnownAgentOf,
  acpLoginProblem,
  acpStartProblem,
  acpToolbox,
  isAcpAgentId,
  readAcpRegisteredAgents,
  suggestAcpAgentId,
} from "./agents.js";

describe("the agents Plainva knows by name", () => {
  it("are found by a bare program name and started with arguments a person can read", () => {
    expect(ACP_KNOWN_AGENTS.length).toBeGreaterThan(5);
    expect(new Set(ACP_KNOWN_AGENTS.map((agent) => agent.key)).size).toBe(ACP_KNOWN_AGENTS.length);
    for (const agent of ACP_KNOWN_AGENTS) {
      // The key is the id an agent added from the entry gets, so it has an id's shape.
      expect(isAcpAgentId(agent.key), agent.key).toBe(true);
      expect(agent.name.trim(), agent.key).toBe(agent.name);
      expect(agent.name.length, agent.key).toBeGreaterThan(0);
      expect(agent.programs.length, agent.key).toBeGreaterThan(0);
      // A name, never a path, a package to fetch or a shell: Plainva starts what is installed, and nothing else.
      for (const program of agent.programs) expect(program, agent.key).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
      for (const program of agent.programs) expect(["npx", "uvx", "node", "sh", "bash", "cmd", "powershell", "pwsh"], agent.key).not.toContain(program);
      for (const arg of agent.args) expect(arg, agent.key).toMatch(/^[A-Za-z0-9=_-]+$/);
    }
    // No two entries are started by the same command.
    const commands = ACP_KNOWN_AGENTS.flatMap((agent) => agent.programs.map((program) => JSON.stringify([program, ...agent.args])));
    expect(new Set(commands).size).toBe(commands.length);
  });

  it("recognise a registered agent by its program and its arguments, whatever the system appended to the name", () => {
    expect(acpKnownAgentOf({ program: "/opt/homebrew/bin/gemini", args: ["--acp"] })?.key).toBe("gemini");
    expect(acpKnownAgentOf({ program: "C:\\Users\\mara\\AppData\\Roaming\\npm\\codex-acp.cmd", args: [] })?.key).toBe("codex");
    expect(acpKnownAgentOf({ program: "C:\\Tools\\Goose.EXE", args: ["acp"] })?.key).toBe("goose");
    // Another program of the same name's stem, other arguments, or a name that only starts like one: a command of the user's own.
    expect(acpKnownAgentOf({ program: "/usr/bin/gemini", args: [] })).toBeNull();
    expect(acpKnownAgentOf({ program: "/usr/bin/gemini", args: ["--acp", "--yolo"] })).toBeNull();
    expect(acpKnownAgentOf({ program: "/usr/bin/gemini-wrapper", args: ["--acp"] })).toBeNull();
    expect(acpKnownAgentOf({ program: "/usr/bin/goose.sh", args: ["acp"] })).toBeNull();
  });
});

describe("an agent the user added", () => {
  it("has an id of the shape a server's has, suggested from its name", () => {
    expect(isAcpAgentId("gemini")).toBe(true);
    expect(isAcpAgentId("a1")).toBe(true);
    for (const bad of ["", "1a", "Gemini", "my-agent", "a".repeat(17), "a b"]) expect(isAcpAgentId(bad), bad).toBe(false);
    const first = suggestAcpAgentId("Gemini CLI");
    expect(isAcpAgentId(first)).toBe(true);
    const second = suggestAcpAgentId("Gemini CLI", [first]);
    expect(isAcpAgentId(second)).toBe(true);
    expect(second).not.toBe(first);
  });

  it("is read from the native list as exactly what was confirmed", () => {
    expect(
      readAcpRegisteredAgents([
        { id: "gemini", program: "/usr/bin/gemini", args: ["--acp"] },
        { id: "own", program: "/home/mara/bin/my-agent", args: ["--stdio", 5, null] },
        { id: "Bad Id", program: "/x", args: [] },
        { id: "noprogram", args: [] },
        { id: "empty", program: "", args: [] },
        "not an agent",
      ]),
    ).toEqual([
      { id: "gemini", program: "/usr/bin/gemini", args: ["--acp"] },
      { id: "own", program: "/home/mara/bin/my-agent", args: ["--stdio"] },
    ]);
    expect(readAcpRegisteredAgents(null)).toEqual([]);
    expect(readAcpRegisteredAgents({ agents: [] })).toEqual([]);
  });

  it("is one registration: another program or other arguments are another", () => {
    const one = acpAgentTarget({ program: "/usr/bin/gemini", args: ["--acp"] });
    expect(acpAgentTarget({ program: "/usr/bin/gemini", args: ["--acp"] })).toBe(one);
    expect(acpAgentTarget({ program: "/usr/local/bin/gemini", args: ["--acp"] })).not.toBe(one);
    expect(acpAgentTarget({ program: "/usr/bin/gemini", args: ["--acp", "--debug"] })).not.toBe(one);
    // Where one argument ends and the next begins is part of it.
    expect(acpAgentTarget({ program: "a", args: ["b c"] })).not.toBe(acpAgentTarget({ program: "a", args: ["b", "c"] }));
  });

  it("signs what it proposes with the id the user gave it — never with the name it gives itself", () => {
    expect(acpAuthorId("gemini")).toBe("acp:gemini");
  });

  it("gets Plainva's tools as a program it starts itself, and nothing is granted by that", () => {
    expect(acpToolbox("C:\\Program Files\\Plainva\\plainva-mcp.exe", "com.plainva.app.labs")).toEqual({
      name: "plainva",
      command: "C:\\Program Files\\Plainva\\plainva-mcp.exe",
      args: ["--app", "com.plainva.app.labs"],
      env: [],
    });
  });

  it("has a label of one short line", () => {
    const invisible = String.fromCharCode(0x200b);
    expect(acpAgentLabel(`  My${invisible}\n agent  `, "fallback")).toBe("My agent");
    expect(acpAgentLabel("", "fallback")).toBe("fallback");
    expect(acpAgentLabel(5, "fallback")).toBe("fallback");
    expect(acpAgentLabel("x".repeat(200), "fallback")).toHaveLength(60);
  });

  it("shows its command for copying, with every part that needs it in quotes", () => {
    expect(acpCommandText("/usr/bin/gemini", ["--acp"])).toBe("/usr/bin/gemini --acp");
    expect(acpCommandText("C:\\Program Files\\Agent\\agent.exe", ["login", 'say "hi"'])).toBe('"C:\\\\Program Files\\\\Agent\\\\agent.exe" login "say \\"hi\\""');
    expect(acpCommandText("agent", [""])).toBe('agent ""');
  });

  it("names why a start or a sign-in did not happen in a fixed set of words", () => {
    expect(acpStartProblem(new Error("program-moved"))).toBe("program-moved");
    expect(acpStartProblem("not-a-vault")).toBe("not-a-vault");
    expect(acpStartProblem(new Error("os error 5: C:\\secret"))).toBe("start-failed");
    expect(acpLoginProblem(new Error("no-terminal"))).toBe("no-terminal");
    expect(acpLoginProblem("cancelled")).toBe("cancelled");
    expect(acpLoginProblem(undefined)).toBe("start-failed");
  });
});
