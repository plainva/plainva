import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every request to a model leaves the device through ONE place (plan Umsetzung 0.9.x, B7, review S1): the native
 * egress each shell makes is handed to the AI session and to nothing else, and the session puts the device's switch
 * in front of it once (`localOnlyEgress`). What a run says about sending is a fact of that run alone: each run gets
 * an egress of its own (`runDepartures`, counting with `departingEgress`) and hands it explicitly to every request it
 * makes — the model call, the reader without tools, a page's processing, and the question embedded for the search.
 * Read from the sources: a new way to the native egress, or a request inside a run that does not take the run's
 * egress, fails here.
 */
const ROOT = resolve(__dirname, "../../../..");
const SOURCES = ["packages/ui/src", "packages/core/src", "apps/desktop/src", "apps/mobile/src"];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const sources = SOURCES.flatMap((dir) => files(join(ROOT, dir))).map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, "utf8") }));
/** The places that name it, test harnesses aside. */
const where = (pattern: RegExp) => sources.filter((file) => pattern.test(file.text) && !/Harness\.ts$|harness\.ts$|TestHost\.ts$/.test(file.path)).map((file) => file.path).sort();

describe("the one way out of the device for a model request", () => {
  it("the desktop's native call is made in its egress alone", () => {
    expect(where(/["']ai_http["']/)).toEqual(["apps/desktop/src/services/ai/desktopAiEgress.ts"]);
  });

  it("the phone's native plugin is reached in its egress alone", () => {
    expect(where(/registerPlugin<[^>]*>\(\s*["']AiNet["']/)).toEqual(["apps/mobile/src/platform/aiNet.ts"]);
  });

  it("each shell's egress is made once, and handed to the AI session", () => {
    for (const [factory, file] of [
      ["createDesktopAiEgress", "apps/desktop/src/services/ai/desktopAi.ts"],
      ["createMobileAiEgress", "apps/mobile/src/services/ai/mobileAi.ts"],
    ] as const) {
      const calls = where(new RegExp(`\\b${factory}\\(`)).filter((path) => !path.endsWith("Egress.ts") && !path.endsWith("aiNet.ts"));
      expect(calls, factory).toEqual([file]);
      const text = sources.find((source) => source.path === file)!.text;
      expect(text.match(new RegExp(`\\b${factory}\\(`, "g"))).toHaveLength(1);
      expect(text).toMatch(new RegExp(`new AiSession\\(\\{\\s*egress:\\s*${factory}\\(`));
    }
  });

  it("the session takes the shell's egress in one place, behind the device's switch", () => {
    const session = text("packages/ui/src/ai/aiSession.ts");
    expect(session.match(/\bhost\.egress\b/g)).toHaveLength(1);
    expect(session).toMatch(/this\.out = localOnlyEgress\(host\.egress,/);
    // Counted for a run only: the session's own egress counts for nobody.
    expect(session.match(/\bdepartingEgress\(/g)).toHaveLength(2);
    // A run's egress wraps the session's — or, for a routine's confirmation while the device asks before every request,
    // the one that sends nothing off this device (review B7-4, M-R4-5).
    expect(session).toMatch(/private runDepartures\(already: readonly string\[\] = \[\], through: LocalOnlyEgress = this\.out\): RunDepartures \{\s*const to: string\[\] = \[\.\.\.already\];\s*const egress = departingEgress\(through,/);
  });
});

/** The body of a method of the session, from its head to the line that closes it. */
function method(source: string, head: string): string {
  const start = source.indexOf(head);
  expect(start, head).toBeGreaterThan(-1);
  const end = source.indexOf("\n  }\n", start);
  return source.slice(start, end);
}
const text = (path: string) => sources.find((source) => source.path === path)!.text;

describe("every request of a run goes through that run's own egress", () => {
  const session = text("packages/ui/src/ai/aiSession.ts");
  const run = method(session, "  private async runMessage(");
  const execute = method(session, "  private async execute(input: {");

  it("a run and its execution reach no other egress than the run's", () => {
    for (const [name, body] of [["runMessage", run], ["execute", execute]] as const) {
      expect(body, name).not.toMatch(/this\.out\b|host\.egress|this\.egress\b/);
      for (const given of body.match(/\begress: [^,\n}]+/g) ?? []) expect(["egress: run.egress", "egress: input.departures.egress"], `${name}: ${given}`).toContain(given);
    }
    // A server's prompt starts with the server in the list (review B7-2, S4); every other run with an empty one.
    // and "Send again" with whom the turn's earlier tries reached (review B7-3, S6).
    expect(run).toMatch(/const earlier = retry \? retry\.of\.departedTo \?\? \[\] : \[\];[^;]*?const run = this\.runDepartures\(\[\.\.\.\(server \? \[`mcp:\$\{server\.id\}`\] : \[\]\), \.\.\.earlier\], held \? this\.deviceOnlyEgress\(\)\.egress : undefined\);/);
    // The model call, the reader without tools, a page's processing, and the context (its search).
    expect(execute).toMatch(/runAgent\(\{[\s\S]*?egress: input\.departures\.egress,/);
    expect(run.match(/egress: run\.egress,/g)?.length).toBeGreaterThanOrEqual(3);
    expect(run).toMatch(/this\.contextOf\([^)]*\{\s*egress: run\.egress,/);
  });

  it("every execution is handed the departures of a run", () => {
    const calls = session.match(/this\.execute\(\{\s*departures: [^,]+,/g) ?? [];
    expect(calls.length).toBe((session.match(/this\.execute\(\{/g) ?? []).length);
  });

  it("the question goes to a search model through the egress it is handed, never the host's", () => {
    const contextOf = method(session, "  private async contextOf(");
    expect(contextOf).toMatch(/vault\.candidates\([^;]*conversation\.egress\)/);
    expect(text("packages/ui/src/ai/aiVaultHost.ts")).toMatch(/gatherCandidates\(input\.retrieval, question, activePath, recipient, egress\)/);
    expect(text("packages/ui/src/ai/aiVaultHost.ts")).toMatch(/semanticCandidates\(question, 20, \{ cloudQuestion, egress \}\)/);
    const embeddings = text("packages/ui/src/ai/localEmbeddings.ts");
    expect(method(embeddings, "  async semanticCandidates(")).toMatch(/indexer\.rankedSearch\([^;]*\{ egress: options\.egress \}\)/);
    expect(embeddings).toMatch(/const egress = via\?\.egress \?\? host\.egress;/);
    expect(method(text("packages/core/src/ai/embeddings/pipeline.ts"), "  async rankedSearch(")).toMatch(/this\.engine\.embed\(\[question\], "query", signal, via\)/);
    const provider = text("packages/core/src/ai/embeddings/providerEngine.ts");
    expect(provider).toMatch(/await send\(embeddingRequest\([^;]*signal, via\)/);
    // The shells hand the options on as they are, the egress with them.
    expect(text("apps/desktop/src/services/ai/desktopAi.ts")).toMatch(/semanticCandidates: async \(question, limit, options\) => \(await input\.semantic\?\.\(\)\?\.semanticCandidates\(question, limit, options\)\)/);
    expect(text("apps/mobile/src/services/ai/mobileAi.ts")).toMatch(/semanticCandidates: async \(question, limit, options\) => \(await embeddingsRef\.current\?\.semanticCandidates\(question, limit, options\)\)/);
  });
});

/**
 * The session's methods by name, and those a body calls on `this` (review B7-4, M-R4-4): what `runMessage` and
 * `execute` reach, step by step — a way out in a helper they call counts as one in them.
 */
function methodsOf(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of source.matchAll(/\n {2}(?:(?:private|protected|public|static|async|readonly|get)\s+)*([a-zA-Z_]\w*)\s*(?:<[^>\n]*>)?\(/g)) {
    if (out.has(m[1]!)) continue;
    const start = m.index! + 1;
    out.set(m[1]!, source.slice(start, source.indexOf("\n  }\n", start)));
  }
  // A class field that holds an arrow function is a method too (review B7-5, H-R5-1): its body to the field's end.
  for (const m of source.matchAll(/\n {2}(?:(?:private|protected|public|static|readonly)\s+)*([a-zA-Z_]\w*)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:\([^)\n]*\)|[a-zA-Z_]\w*)\s*(?::[^=\n]+)?=>/g)) {
    if (out.has(m[1]!)) continue;
    const start = m.index! + 1;
    const line = source.indexOf("\n", start);
    const oneLine = source.slice(start, line).trimEnd().endsWith(";");
    out.set(m[1]!, source.slice(start, oneLine ? line : source.indexOf("\n  };\n", start)));
  }
  return out;
}
function reached(source: string, from: readonly string[]): Map<string, string> {
  const all = methodsOf(source);
  const out = new Map<string, string>();
  const todo = [...from];
  while (todo.length) {
    const name = todo.pop()!;
    const body = all.get(name);
    if (out.has(name) || body === undefined) continue;
    out.set(name, body);
    // Called or handed on as a value (`.call(this, …)`, `forEach(this.x, this)`): either way its body is part of the run.
    for (const call of body.matchAll(/this\.([a-zA-Z_]\w*)/g)) todo.push(call[1]!);
  }
  return out;
}

describe("what a run reaches: every method runMessage and execute call, and those they call (review B7-4, M-R4-4)", () => {
  const session = text("packages/ui/src/ai/aiSession.ts");
  const bodies = reached(session, ["runMessage", "execute"]);
  /** The two that make a way out: the run's own egress, and the one that sends nothing off this device. */
  const MAKERS = new Set(["runDepartures", "deviceOnlyEgress"]);

  it("reaches the methods it is known to reach", () => {
    for (const name of ["contextOf", "memoryStart", "styleStart", "furtherTools", "serverSkills", "skillRuntime", "readServerSkill", "offeredTools"]) expect(bodies.has(name), name).toBe(true);
  });

  it("none of them names the session's egress, the host's, or the session by another name", () => {
    for (const [name, body] of bodies) {
      if (MAKERS.has(name)) continue;
      expect(body, name).not.toMatch(/this\.out\b|host\.egress|this\.egress\b/);
      // A cast, a destructuring, an alias or a computed member would hide a way out from the lines below.
      expect(body, name).not.toMatch(/this\[|=\s*this\s*[;,)]|this\.(?:host|mcp)\b(?!\.[a-zA-Z])/);
      // Nor is the session itself handed on (review B7-5, H-R5-1): to a free function, as `.call`'s or `forEach`'s `this`.
      expect(body, name).not.toMatch(/[(,]\s*this\s*(?:as\b[^,)]*)?[,)]|\.(?:call|apply|bind)\(\s*this\b/);
    }
  });

  it("of the hosts: only the members table 1 names, the page fetcher never called but through its wrapper", () => {
    const all = [...bodies.values()].join("\n");
    expect([...new Set(Array.from(all.matchAll(/this\.host\.([a-zA-Z]+)/g), (m) => m[1]!))].sort()).toEqual(["label", "language", "newId", "now", "today", "web"]);
    expect([...new Set(Array.from(all.matchAll(/this\.mcp\.([a-zA-Z]+)/g), (m) => m[1]!))].sort()).toEqual(["call", "check", "log", "manifests", "offeredNames", "openPage", "readSkillFile", "servers", "state"]);
    expect(all).not.toMatch(/this\.host\.web\.|this\.host\.web\(/);
    // A server skill's files are read from its server: noted in the run's list before the request (review B7-4).
    const runtime = bodies.get("skillRuntime")!;
    expect(runtime).toMatch(/note\(found\.entry\.source\.server\.serverId\);\s*const read = await this\.readServerSkill\(/);
    expect(runtime).toMatch(/note\(entry\.source\.server\.serverId\);\s*return this\.serverSkillFile\(/);
    expect(bodies.get("runMessage")!).toMatch(/this\.skillRuntime\(vault, record, \(serverId\) => run\.note\(`mcp:\$\{serverId\}`\)\)/);
  });
});

/** The members of an interface as its source names them (`name:`, `name?:`, `name(`, `name?(`), at its first level. */
function membersOf(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name} {`);
  expect(start, name).toBeGreaterThan(-1);
  const out: string[] = [];
  let depth = 0;
  for (const line of source.slice(source.indexOf("{", start) + 1).split("\n")) {
    if (depth === 0) {
      if (/^\}/.test(line)) break;
      const member = /^ {2}(?:readonly )?([a-zA-Z_][a-zA-Z0-9_]*)\??[:(<]/.exec(line);
      if (member) out.push(member[1]!);
    }
    for (const c of line) depth += c === "{" || c === "(" ? 1 : c === "}" || c === ")" ? -1 : 0;
  }
  return out;
}

/**
 * Every member of the hosts through which the AI session reaches the shell, with the transport of table 1 it is
 * (`docs/engineering/AI_Failed_Requests_and_Mail_Visibility.md`), or `device` where nothing leaves (review B7-2).
 */
const TRANSPORTS: Record<string, Record<string, string>> = {
  AiSessionHost: {
    egress: "Model egress",
    loadSettings: "device",
    saveSettings: "device",
    defaults: "device",
    language: "device",
    today: "device",
    now: "device",
    newId: "device",
    label: "device",
    web: "The internet",
    mcp: "Foreign servers",
    acp: "External agents",
    scripts: "Scripts",
    localOnly: "device",
  },
  AiMcpHost: {
    native: "Foreign servers",
    browser: "Foreign servers",
    openPage: "Foreign servers",
    clientDocument: "device",
    store: "device",
    version: "device",
  },
};

describe("every way out of the device the AI side has is in table 1 (review B7-2)", () => {
  const table = readFileSync(join(ROOT, "docs/engineering/AI_Failed_Requests_and_Mail_Visibility.md"), "utf8");
  const sources: Record<string, string> = { AiSessionHost: text("packages/ui/src/ai/aiSession.ts"), AiMcpHost: text("packages/ui/src/ai/mcpSession.ts") };

  for (const [host, members] of Object.entries(TRANSPORTS)) {
    it(`${host}: no member that this list — and the table — does not name`, () => {
      expect(membersOf(sources[host]!, host).sort()).toEqual(Object.keys(members).sort());
      for (const [member, transport] of Object.entries(members)) {
        if (transport === "device") continue;
        expect(table, `${host}.${member}`).toContain(`| ${transport}`);
        expect(table, `${host}.${member}`).toContain(`${host}.${member}`);
      }
    });
  }

  it("the vault's host reaches out through its tools and the search alone; the table names both", () => {
    const vaultHost = membersOf(text("packages/ui/src/ai/aiSession.ts"), "AiVaultHost");
    // Its members as of review B7-2: a new one is looked at here, and named in the table where it leaves the device.
    expect(vaultHost.length).toBe(KNOWN_VAULT_MEMBERS.length);
    expect([...vaultHost].sort()).toEqual([...KNOWN_VAULT_MEMBERS].sort());
    expect(table).toContain("`AiVaultHost.tools`");
    expect(table).toContain("`AiVaultHost.agents`");
  });
});

/** The vault host's members; `tools` (mail) and `agents` (external agents) leave the device, `candidates` through the run's egress. */
const KNOWN_VAULT_MEMBERS = [
  "composerDrafts", "key", "conversations", "ledger", "activeNote", "readNote", "situation", "candidates", "noteSizes", "linkFilesFor",
  "policy", "tools", "web", "mcp", "agents", "keepOnDevice", "gists", "capture", "noteType", "embedders", "propose", "encrypted", "reply",
  "skillTests", "upkeep", "routines", "changedSince", "log", "hints", "hintPrefs", "instructions", "memory", "style", "drafts", "creates",
  "proposals", "direct", "folderRules", "showVersions",
];

/**
 * A new way out through a member the hosts already have (review B7-3, M14): inside a run, the session reaches the shell
 * only by these calls, each one in table 1 — a page fetch only through the fetcher that notes it, a foreign server's
 * call only through the noting wrapper, the vault's tools only once, wrapped by the executor that notes the mail.
 */
describe("a run reaches the shell's ways out only as table 1 names them", () => {
  const session = text("packages/ui/src/ai/aiSession.ts");
  const run = method(session, "  private async runMessage(");
  const execute = method(session, "  private async execute(input: {");
  const calls = (body: string, pattern: RegExp) => [...new Set(Array.from(body.matchAll(pattern), (m) => m[0]))].sort();

  it("of the session's host: the clock, ids, words — and the page fetcher, wrapped", () => {
    expect(calls(run + execute, /this\.host\.[a-zA-Z]+/g)).toEqual(["this.host.label", "this.host.language", "this.host.newId", "this.host.now", "this.host.today", "this.host.web"]);
    // The fetcher appears in one form only: handed to the web executor through `notingFetcher`.
    expect(run.match(/this\.host\.web\b[^\n]*/g)).toEqual(["this.host.web ? notingFetcher(this.host.web, () => run.note(\"web\")) : null,"]);
  });

  it("of the foreign servers: listing, checking, logging — and a call only after it is noted", () => {
    expect(calls(run + execute, /this\.mcp\.[a-zA-Z]+/g)).toEqual(["this.mcp.call", "this.mcp.check", "this.mcp.log", "this.mcp.manifests", "this.mcp.servers"]);
    expect(run).toMatch(/run\.note\(`mcp:\$\{serverId\}`\);\s*return this\.mcp\.call\(/);
    expect(run.match(/this\.mcp\.call\(/g)).toHaveLength(1);
  });

  it("of the vault's host: its tools once, wrapped by what notes the mail", () => {
    expect(run.match(/\bvault\.tools\(/g)).toHaveLength(1);
    expect(run).toMatch(/executor: notingExecutor\(vaultTools\.executor, \(tool\) => \(MAIL_TOOL_NAMES\.includes\(tool\) \? "mail" : null\), run\.note\)/);
    expect(run).not.toMatch(/vaultTools\.executor\.execute|vault\.(?:web|mcp|agents)\./);
  });
});

describe("both shells say whom a note embedding already went to (review B7-6, H-R6-1)", () => {
  it("hand the run's departure on to the failure text, the desktop's card and the phone's section alike", () => {
    expect.hasAssertions();
    for (const file of ["apps/desktop/src/components/settings/SemanticSearchCard.tsx", "apps/mobile/src/components/MobileSemanticSection.tsx"]) {
      expect(text(file), file).toMatch(/semanticRunFailureText\(t, engine\.source, state\?\.runFailure \?\? null, progress\.error \?\? "", state\?\.runDeparted === true, i18n\.language\)/);
    }
  });
});
