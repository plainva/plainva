import { describe, expect, it } from "vitest";
import { sha256Hex, utf8Encode } from "../../workspace/encoding.js";
import type { ToolOutcome } from "../orchestrator.js";
import { isEffectTool } from "../ruleOfTwo.js";
import {
  approvalOf,
  approveInstruction,
  EMPTY_INSTRUCTION_APPROVALS,
  instructionStatus,
  readInstructionApprovals,
  serializeInstructionApprovals,
  switchInstruction,
  type ScriptApprovalCheck,
} from "../skills/approvals.js";
import { nameOf, resolveInstructions } from "../skills/catalog.js";
import { scanInstruction, scanVaultInstructions, type InstructionIO, type InstructionSource } from "../skills/sources.js";
import { parseToolInput, TOOL_MANIFESTS, TOOL_NAME_PATTERN, toolByName, toolInputJsonSchema } from "../tools.js";
import {
  isScriptToolName,
  parseScriptInput,
  parseScriptManifest,
  SCRIPT_LIMIT_BOUNDS,
  SCRIPT_LIMIT_DEFAULTS,
  SCRIPT_MAIN_MAX_BYTES,
  SCRIPT_MAX_FILES,
  SCRIPT_READ_TOOL_NAMES,
  SCRIPT_TOOL_NAMES,
  SCRIPT_WRITE_TOOL_NAMES,
  scriptToolManifest,
  scriptToolName,
  scriptWrites,
  serializeScriptManifest,
  type ScriptDefinition,
} from "./manifest.js";
import { runScript, scriptCallResult, scriptFailureText, type SandboxEnd, type SandboxHost, type SandboxJob, type ScriptSandbox } from "./run.js";
import { SCRIPT_READING_RULE, scanScriptFolder } from "./scan.js";
import {
  checkPublisherSignature,
  deviceScriptPublicKey,
  newDeviceScriptKey,
  publisherKeyId,
  readPublisherKey,
  scriptPublishers,
  scriptSeal,
  sealHash,
  signScriptApproval,
  verifyScriptApproval,
} from "./seal.js";

const MANIFEST = `{
  "name": "tag-count",
  "description": "Counts the notes a search finds.",
  "tools": ["search_vault"],
  "input": [{ "name": "query", "type": "text", "required": true }]
}
`;
const MAIN = `const found = await tools.search_vault({ query: input.query });
return { count: found.results.length };
`;

const codes = (text: string, folder?: string) => parseScriptManifest(text, folder).problems.map((p) => p.code);
const manifestOf = (fields: Record<string, unknown>) => JSON.stringify({ name: "s", description: "Does a thing.", ...fields });

describe("a script's manifest", () => {
  it("reads name, description, tools, parameters and limits", () => {
    const { script, problems } = parseScriptManifest(
      JSON.stringify({
        name: "tag-count",
        title: "Count by tag",
        description: "Counts the notes that carry a tag.",
        version: "1.2",
        tools: ["search_vault", "get_outline", "search_vault"],
        input: [
          { name: "tag", type: "text", description: "The tag, without #", required: true },
          { name: "depth", type: "number" },
          { name: "mode", type: "text", options: ["all", "open"] },
          { name: "strict", type: "boolean" },
        ],
        limits: { seconds: 10, calls: 5 },
      }),
      "tag-count",
    );
    expect(problems).toEqual([]);
    expect(script).toEqual({
      name: "tag-count",
      title: "Count by tag",
      description: "Counts the notes that carry a tag.",
      version: "1.2",
      tools: ["search_vault", "get_outline"],
      parameters: [
        { name: "tag", type: "text", description: "The tag, without #", required: true },
        { name: "depth", type: "number", description: "", required: false },
        { name: "mode", type: "text", description: "", required: false, options: ["all", "open"] },
        { name: "strict", type: "boolean", description: "", required: false },
      ],
      limits: { ...SCRIPT_LIMIT_DEFAULTS, seconds: 10, calls: 5 },
    });
  });

  it("a script that names no tool and asks for nothing is a script: it computes on what it has", () => {
    const { script, problems } = parseScriptManifest(manifestOf({}), "s");
    expect(problems).toEqual([]);
    expect(script).toMatchObject({ tools: [], parameters: [], limits: SCRIPT_LIMIT_DEFAULTS });
  });

  it("reports what it does not allow, and never throws", () => {
    expect(codes("no json")).toEqual(["manifest-json"]);
    expect(codes("[1, 2]")).toEqual(["manifest-json"]);
    expect(codes("null")).toEqual(["manifest-json"]);
    expect(codes(JSON.stringify({ description: "x" }))).toEqual(["name-missing"]);
    expect(codes(JSON.stringify({ name: "s" }), "s")).toEqual(["description-missing"]);
    expect(codes(manifestOf({ description: "x".repeat(401) }), "s")).toEqual(["description-too-long"]);
    expect(codes(manifestOf({ permissions: ["all"] }), "s")).toEqual(["field-unknown"]);
    expect(codes(manifestOf({ name: 7 }))).toEqual(["field-type", "name-missing"]);
    expect(codes(manifestOf({ tools: "search_vault" }), "s")).toEqual(["field-type"]);
    expect(codes(manifestOf({ input: {} }), "s")).toEqual(["field-type"]);
    expect(codes(manifestOf({ limits: [] }), "s")).toEqual(["field-type"]);
    expect(codes(manifestOf({ title: "t".repeat(81) }), "s")).toEqual(["field-type"]);
  });

  it("a name is lower case, digits and single hyphens — it becomes a tool's name — and equals its folder", () => {
    for (const name of ["Tag", "tag_count", "-tag", "tag-", "tag--count", "9tag", "übersicht", "a".repeat(41), "a b"]) {
      expect(codes(manifestOf({ name }), name), name).toEqual(["name-characters"]);
    }
    expect(codes(manifestOf({ name: "tag-count" }), "tags")).toEqual(["name-folder"]);
    expect(codes(manifestOf({ name: "tag-count-2" }), "tag-count-2")).toEqual([]);
    expect(scriptToolName("tag-count-2")).toBe("script_tag_count_2");
    expect(scriptToolName("a".repeat(40))).toMatch(TOOL_NAME_PATTERN);
  });

  it("names only tools the app has, and only those open to scripts", () => {
    expect(codes(manifestOf({ tools: ["read_everything"] }), "s")).toEqual(["tool-unknown"]);
    expect(codes(manifestOf({ tools: [7] }), "s")).toEqual(["tool-unknown"]);
    // Mail, the internet, the tool search, the skills, an appointment's description — and of the writing tools the plans
    // (each asks the user about one thing) and the drafts that are on their way out of the vault.
    for (const name of ["read_mail", "search_mail", "fetch_url", "web_search", "find_tools", "call_tool", "use_skill", "get_event", "rename_note", "move_note", "delete_note", "draft_mail", "draft_event", "open_in_app"]) {
      expect(codes(manifestOf({ tools: [name] }), "s"), name).toEqual(["tool-not-for-scripts"]);
    }
    for (const name of SCRIPT_TOOL_NAMES) expect(codes(manifestOf({ tools: [name] }), "s"), name).toEqual([]);
  });

  it("the second stage: a script can name the tools that suggest and draft, and is then an effect", () => {
    // What it can lay down ends as a suggestion or a draft: the six tools of that kind, and no other writing tool.
    expect(SCRIPT_WRITE_TOOL_NAMES).toEqual(["propose_edit", "set_property", "create_note", "create_entry", "create_task", "add_journal_entry"]);
    expect(SCRIPT_TOOL_NAMES).toEqual([...SCRIPT_READ_TOOL_NAMES, ...SCRIPT_WRITE_TOOL_NAMES]);
    for (const name of SCRIPT_WRITE_TOOL_NAMES) expect(toolByName(name)?.risk, name).toBe("write");
    for (const name of SCRIPT_READ_TOOL_NAMES) expect(["read", "ui"], name).toContain(toolByName(name)?.risk);

    const reading = parseScriptManifest(manifestOf({ name: "s", tools: ["read_note", "run_command"] }), "s").script!;
    const writing = parseScriptManifest(manifestOf({ name: "s", tools: ["read_note", "propose_edit"] }), "s").script!;
    expect(scriptWrites(reading)).toBe(false);
    expect(scriptWrites(writing)).toBe(true);
    // Whether a script is an outside effect is its manifest's to say — the Rule of Two reads it there.
    expect(isEffectTool(scriptToolManifest(".agent/scripts/s", reading))).toBe(false);
    expect(isEffectTool(scriptToolManifest(".agent/scripts/s", writing))).toBe(true);
    expect(scriptToolManifest(".agent/scripts/s", writing).script).toEqual({ id: ".agent/scripts/s", name: "s", effect: true });
  });

  it("the tools open to scripts read, show or suggest — and reach neither mail nor the internet", () => {
    for (const name of SCRIPT_TOOL_NAMES) {
      const tool = toolByName(name);
      expect(tool, name).toBeDefined();
      // What suggests or drafts is a write that changes nothing by itself; nothing critical, nothing external.
      expect(["read", "ui", "write"], name).toContain(tool!.risk);
      expect(tool!.outward, name).not.toBe(true);
      expect(tool!.dataClasses, name).not.toContain("mail");
      expect(tool!.dataClasses, name).not.toContain("web");
    }
  });

  it("a parameter has a name, a type and nothing the format does not know", () => {
    const bad = (entry: unknown) => codes(manifestOf({ input: [entry] }), "s");
    expect(bad("tag")).toEqual(["input-entry"]);
    expect(bad({ name: "Tag", type: "text" })).toEqual(["input-entry"]);
    expect(bad({ name: "tag", type: "list" })).toEqual(["input-entry"]);
    expect(bad({ name: "tag", type: "text", pattern: ".*" })).toEqual(["input-entry"]);
    expect(bad({ name: "tag", type: "number", options: ["1"] })).toEqual(["input-entry"]);
    expect(bad({ name: "tag", type: "text", options: [] })).toEqual(["input-entry"]);
    expect(bad({ name: "tag", type: "text", options: ["a", "a"] })).toEqual(["input-entry"]);
    expect(bad({ name: "tag", type: "text", required: "yes" })).toEqual(["input-entry"]);
    expect(codes(manifestOf({ input: [{ name: "a", type: "text" }, { name: "a", type: "text" }] }), "s")).toEqual(["input-entry"]);
    expect(codes(manifestOf({ input: Array.from({ length: 13 }, (_, i) => ({ name: `p${i}`, type: "text" })) }), "s")).toEqual(["input-too-many"]);
  });

  it("a limit outside its range is a problem, never clamped", () => {
    for (const [key, [low, high]] of Object.entries(SCRIPT_LIMIT_BOUNDS)) {
      expect(codes(manifestOf({ limits: { [key]: low } }), "s"), key).toEqual([]);
      expect(codes(manifestOf({ limits: { [key]: high } }), "s"), key).toEqual([]);
      expect(codes(manifestOf({ limits: { [key]: low - 1 } }), "s"), key).toEqual(["limit-value"]);
      expect(codes(manifestOf({ limits: { [key]: high + 1 } }), "s"), key).toEqual(["limit-value"]);
      expect(codes(manifestOf({ limits: { [key]: 1.5 } }), "s"), key).toEqual(["limit-value"]);
      expect(codes(manifestOf({ limits: { [key]: "5" } }), "s"), key).toEqual(["limit-value"]);
    }
    expect(codes(manifestOf({ limits: { threads: 4 } }), "s")).toEqual(["limit-value"]);
    // A name every object has is no limit.
    expect(codes('{"name":"s","description":"x","limits":{"toString":5}}', "s")).toEqual(["limit-value"]);
  });

  it("a detail names the field in one short line, whatever the file wrote there", () => {
    const hostile = `x${String.fromCharCode(0x202e)}\n${"y".repeat(200)}`;
    const [problem] = parseScriptManifest(JSON.stringify({ name: "s", description: "x", [hostile]: 1 }), "s").problems;
    expect(problem!.code).toBe("field-unknown");
    expect(problem!.detail!.length).toBeLessThanOrEqual(60);
    expect(problem!.detail).not.toMatch(/[\p{Cc}\p{Cf}]/u);
  });

  it("writes a manifest that reads back the same, with only what differs from the defaults", () => {
    const script: ScriptDefinition = {
      name: "weekly",
      title: "Weekly numbers",
      description: "Counts what changed this week.",
      tools: ["get_recent"],
      parameters: [{ name: "days", type: "number", description: "How far back", required: true }],
      limits: { ...SCRIPT_LIMIT_DEFAULTS, seconds: 8 },
    };
    const text = serializeScriptManifest(script);
    expect(JSON.parse(text).limits).toEqual({ seconds: 8 });
    expect(parseScriptManifest(text, "weekly")).toEqual({ script, problems: [] });
    expect(JSON.parse(serializeScriptManifest({ name: "plain", description: "x" }))).toEqual({ name: "plain", description: "x", tools: [] });
  });
});

describe("what a caller hands a script", () => {
  const parameters = parseScriptManifest(
    manifestOf({
      input: [
        { name: "tag", type: "text", required: true },
        { name: "depth", type: "number" },
        { name: "mode", type: "text", options: ["all", "open"] },
        { name: "strict", type: "boolean" },
      ],
    }),
    "s",
  ).script!.parameters;

  it("is held against the parameters: required, of its type, nothing unnamed", () => {
    expect(parseScriptInput(parameters, { tag: "x", depth: 2, mode: "open", strict: false })).toEqual({ ok: true, value: { tag: "x", depth: 2, mode: "open", strict: false } });
    expect(parseScriptInput(parameters, { tag: "x", depth: null })).toEqual({ ok: true, value: { tag: "x" } });
    expect(parseScriptInput(parameters, {})).toMatchObject({ ok: false, error: "tag: is required" });
    expect(parseScriptInput(parameters, undefined)).toMatchObject({ ok: false });
    expect(parseScriptInput(parameters, "x")).toMatchObject({ ok: false });
    expect(parseScriptInput(parameters, ["x"])).toMatchObject({ ok: false });
    expect(parseScriptInput(parameters, { tag: 5 })).toMatchObject({ ok: false, error: "tag: must be a text" });
    expect(parseScriptInput(parameters, { tag: "x", depth: "2" })).toMatchObject({ ok: false });
    expect(parseScriptInput(parameters, { tag: "x", depth: Number.NaN })).toMatchObject({ ok: false });
    expect(parseScriptInput(parameters, { tag: "x", mode: "some" })).toMatchObject({ ok: false });
    expect(parseScriptInput(parameters, { tag: "x", strict: "true" })).toMatchObject({ ok: false });
    expect(parseScriptInput(parameters, { tag: "x", other: 1 })).toMatchObject({ ok: false, error: "other: is not a parameter of this script" });
    expect(parseScriptInput(parameters, { tag: "x".repeat(4001) })).toMatchObject({ ok: false });
    expect(parseScriptInput([], undefined)).toEqual({ ok: true, value: {} });
  });

  it("a script is a tool of a run: its parameters are the tool's arguments", () => {
    const script = parseScriptManifest(manifestOf({ name: "tag-count", tools: ["search_vault", "get_tasks", "run_command"], input: [{ name: "tag", type: "text", required: true, description: "Without #" }, { name: "mode", type: "text", options: ["all", "open"] }] }), "tag-count").script!;
    const tool = scriptToolManifest(".agent/scripts/tag-count", script);
    expect(tool).toMatchObject({ name: "script_tag_count", risk: "script", core: false, surfaces: ["harness"], untrustedResult: true, script: { id: ".agent/scripts/tag-count", name: "tag-count", effect: false } });
    expect([...tool.dataClasses].sort()).toEqual(["commands", "notes", "tasks"]);
    expect(parseToolInput(tool, { tag: "x" })).toEqual({ ok: true, value: { tag: "x" } });
    expect(parseToolInput(tool, {})).toMatchObject({ ok: false });
    expect(parseToolInput(tool, { tag: "x", more: 1 })).toMatchObject({ ok: false });
    expect(parseToolInput(tool, { tag: "x", mode: "some" })).toMatchObject({ ok: false });
    expect(toolInputJsonSchema(tool)).toMatchObject({ type: "object", required: ["tag"], properties: { tag: { type: "string", description: "Without #" }, mode: { enum: ["all", "open"] } } });
    // A script that only reads and shows is no outside effect; no tool of the app's own carries a script's name.
    expect(isEffectTool(tool)).toBe(false);
    expect(isScriptToolName(tool.name)).toBe(true);
    for (const own of TOOL_MANIFESTS) expect(isScriptToolName(own.name), own.name).toBe(false);
    expect(isScriptToolName("script_")).toBe(false);
  });
});

// A throwaway key, made for this test with the signer the releases are signed with (`tauri signer`), and the
// signature it gave the seal of the package above. Its private half was deleted when the lines were written.
const TEST_PUBLISHER = "RWSqfSlTV+Y5kCp1mPYcBKk4ZCKv4qWHNdiMktNqWFQ1fDPPrVD2Hc49";
const TEST_SIGNATURE_LINES = [
  "untrusted comment: signature from tauri secret key",
  "RUSqfSlTV+Y5kKG5RrSEOOXjWFfOXJy5PbNSIEqoldOF9c9s5nl6fOdG4zDpd1sqQ7IVZ8gNW0trQTiI21tIgOVx5wz6b1J7RQ4=",
  "trusted comment: timestamp:1791429581\tfile:test-seal.txt",
  "FGD0wu/Kf86Pi+geXgnjPtFKU9zRKehVmShOrjjdAzTBJTHKnra4y4lA/N/Xl6xTvx69g1NkC/SMM4zTEw/gDQ==",
];
const TEST_SIGNATURE = `${TEST_SIGNATURE_LINES.join("\n")}\n`;
/** The same as the signer writes it into its `.sig` file: base64 of those lines. */
const TEST_SIGNATURE_FILE =
  "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTcWZTbFRWK1k1a0tHNVJyU0VPT1hqV0ZmT1hKeTVQYk5TSUVxb2xkT0Y5YzlzNW5sNmZPZEc0ekRwZDFzcVE3SVZaOGdOVzB0clFUaUkyMXRJZ09WeDV3ejZiMUo3UlE0PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkxNDI5NTgxCWZpbGU6dGVzdC1zZWFsLnR4dApGR0Qwd3UvS2Y4NlBpK2dlWGdualB0RktVOXpSS2VoVm1TaE9yampkQXpUQkpUSEtucmE0eTRsQS9OL1hsNnhUdng2OWcxTmtDL1NNTTR6VEV3L2dEUT09Cg==";

const hashed = (files: Record<string, string>) => Object.entries(files).map(([path, text]) => ({ path, sha256: sha256Hex(utf8Encode(text)) }));
const PACKAGE = hashed({ "manifest.json": MANIFEST, "main.js": MAIN });
const testPublisher = [readPublisherKey("Test publisher", TEST_PUBLISHER)!];

describe("a script's seal", () => {
  it("lists every file with its hash in path order, in a form no file name can forge", () => {
    const seal = new TextDecoder().decode(scriptSeal(PACKAGE));
    expect(seal).toBe(
      [
        "plainva-script-seal v1",
        '["main.js","360f74b408ebd4efbaae5b92df401c238cde1d42c8a1e4500f30865e9270f345"]',
        '["manifest.json","bf519e5ce6c04cf8151b0efa7b6054940b2d4d3fdf2ed1733fe4658af4f4c816"]',
        "",
      ].join("\n"),
    );
    // The order of the listing changes nothing; a publisher's signature is not part of what it signs.
    expect(scriptSeal([...PACKAGE].reverse())).toEqual(scriptSeal(PACKAGE));
    expect(scriptSeal([...PACKAGE, { path: "signature", sha256: "0".repeat(64) }])).toEqual(scriptSeal(PACKAGE));
    // A file added, a file changed: another seal.
    expect(sealHash(scriptSeal([...PACKAGE, { path: "README.md", sha256: "0".repeat(64) }]))).not.toBe(sealHash(scriptSeal(PACKAGE)));
    // A name with a line break cannot pass for a second file.
    const odd = new TextDecoder().decode(scriptSeal([{ path: 'a"]\n["main.js","' + "1".repeat(64), sha256: "2".repeat(64) }]));
    expect(odd.split("\n")).toHaveLength(3);
  });
});

describe("a publisher's signature", () => {
  it("of a known key holds for the seal it was made for — as lines and as the signer's file", () => {
    const seal = scriptSeal(PACKAGE);
    expect(checkPublisherSignature(seal, TEST_SIGNATURE, testPublisher)).toEqual({ state: "valid", publisher: "Test publisher", keyId: "9039E65753297DAA" });
    expect(checkPublisherSignature(seal, TEST_SIGNATURE_FILE, testPublisher)).toEqual({ state: "valid", publisher: "Test publisher", keyId: "9039E65753297DAA" });
    expect(checkPublisherSignature(seal, TEST_SIGNATURE.replace(/\n/g, "\r\n"), testPublisher).state).toBe("valid");
  });

  it("does not hold once a file changed", () => {
    const changed = scriptSeal(hashed({ "manifest.json": MANIFEST, "main.js": `${MAIN}// one more line\n` }));
    expect(checkPublisherSignature(changed, TEST_SIGNATURE, testPublisher)).toEqual({ state: "invalid" });
    const added = scriptSeal([...PACKAGE, { path: "extra.js", sha256: "0".repeat(64) }]);
    expect(checkPublisherSignature(added, TEST_SIGNATURE, testPublisher)).toEqual({ state: "invalid" });
  });

  it("does not hold once the signature or its trusted comment was touched", () => {
    const seal = scriptSeal(PACKAGE);
    const lines = (change: (lines: string[]) => void) => {
      const copy = [...TEST_SIGNATURE_LINES];
      change(copy);
      return copy.join("\n");
    };
    expect(checkPublisherSignature(seal, lines((l) => (l[2] = l[2]!.replace("test-seal.txt", "other.txt"))), testPublisher)).toEqual({ state: "invalid" });
    expect(checkPublisherSignature(seal, lines((l) => (l[1] = `RUS${"A".repeat(l[1]!.length - 4)}=`)), testPublisher).state).not.toBe("valid");
    expect(checkPublisherSignature(seal, lines((l) => l.pop()), testPublisher)).toEqual({ state: "invalid" });
    expect(checkPublisherSignature(seal, lines((l) => (l[3] = "AAAA")), testPublisher)).toEqual({ state: "invalid" });
    for (const junk of ["", "signed, trust me", "untrusted comment: x", "AAAA", "{}"]) expect(checkPublisherSignature(seal, junk, testPublisher), junk).toEqual({ state: "invalid" });
  });

  it("of a key this app does not know says nothing — it is neither valid nor a forgery", () => {
    expect(checkPublisherSignature(scriptSeal(PACKAGE), TEST_SIGNATURE)).toEqual({ state: "unknown-key", keyId: "9039E65753297DAA" });
    expect(checkPublisherSignature(scriptSeal(PACKAGE), TEST_SIGNATURE, [])).toEqual({ state: "unknown-key", keyId: "9039E65753297DAA" });
  });

  it("the app knows one publisher: the key its updates are signed with", () => {
    const publishers = scriptPublishers();
    expect(publishers.map((p) => [p.label, publisherKeyId(p.keyId), p.publicKey.length])).toEqual([["Plainva", "3237C82270934676", 32]]);
    expect(readPublisherKey("x", "no key")).toBeNull();
    // A key reads the same as its one line, as its two-line file, and as base64 of that file (how the app's configuration keeps it).
    const file = `untrusted comment: minisign public key: 9039E65753297DAA\n${TEST_PUBLISHER}\n`;
    expect(readPublisherKey("Test publisher", file)).toEqual(testPublisher[0]);
    expect(readPublisherKey("Test publisher", btoa(file))).toEqual(testPublisher[0]);
  });
});

describe("this device's signature: the approval", () => {
  const seal = scriptSeal(PACKAGE);
  const key = newDeviceScriptKey();
  const publicKey = deviceScriptPublicKey(key)!;
  const signature = signScriptApproval(key, "vault-a", ".agent/scripts/tag-count", seal)!;

  it("holds for this script, in this vault, with this seal — and for nothing else", () => {
    expect(verifyScriptApproval(publicKey, "vault-a", ".agent/scripts/tag-count", seal, signature)).toBe(true);
    expect(verifyScriptApproval(publicKey, "vault-b", ".agent/scripts/tag-count", seal, signature)).toBe(false);
    expect(verifyScriptApproval(publicKey, "vault-a", ".agent/scripts/other", seal, signature)).toBe(false);
    expect(verifyScriptApproval(publicKey, "vault-a", ".agent/scripts/tag-count", scriptSeal([...PACKAGE, { path: "x", sha256: "0".repeat(64) }]), signature)).toBe(false);
  });

  it("is another device's for another key, and none for what is no key or no signature", () => {
    const other = deviceScriptPublicKey(newDeviceScriptKey())!;
    expect(other).not.toBe(publicKey);
    expect(verifyScriptApproval(other, "vault-a", ".agent/scripts/tag-count", seal, signature)).toBe(false);
    expect(verifyScriptApproval("", "vault-a", ".agent/scripts/tag-count", seal, signature)).toBe(false);
    expect(verifyScriptApproval(publicKey, "vault-a", ".agent/scripts/tag-count", seal, "")).toBe(false);
    expect(verifyScriptApproval(publicKey, "vault-a", ".agent/scripts/tag-count", seal, "not base64!")).toBe(false);
    expect(deviceScriptPublicKey({ seed: "short" })).toBeNull();
    expect(signScriptApproval({ seed: "" }, "vault-a", "x", seal)).toBeNull();
    // A vault's key and a script's id cannot be glued into each other's place.
    const glued = signScriptApproval(key, 'a","b', "c", seal)!;
    expect(verifyScriptApproval(publicKey, "a", 'b","c', seal, glued)).toBe(false);
  });
});

/** A vault as the scan reads it: paths to text. */
function memoryIO(files: Record<string, string>): InstructionIO & { files: Map<string, string> } {
  const map = new Map(Object.entries(files));
  return {
    files: map,
    async list(folder) {
      const prefix = `${folder}/`;
      const names = new Map<string, boolean>();
      for (const path of map.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        names.set(slash < 0 ? rest : rest.slice(0, slash), slash >= 0);
      }
      return [...names].map(([name, isFolder]) => ({ name, folder: isFolder }));
    },
    async read(path) {
      const text = map.get(path);
      return text === undefined ? null : utf8Encode(text);
    },
  };
}

const ROOT = ".agent/scripts/tag-count";
const scriptFiles = (more: Record<string, string> = {}): Record<string, string> => ({ [`${ROOT}/manifest.json`]: MANIFEST, [`${ROOT}/main.js`]: MAIN, ...more });
const problemsOf = async (files: Record<string, string>) => (await scanInstruction(memoryIO(files), ROOT))?.scriptProblems?.map((p) => p.code);

describe("scripts in the vault", () => {
  it("are scanned beside the skills: every file hashed, the manifest read, the code kept", async () => {
    const io = memoryIO({
      ...scriptFiles({ [`${ROOT}/tests/cases.json`]: "[]", [`${ROOT}/.DS_Store`]: "junk" }),
      ".agent/skills/offer-check/SKILL.md": "---\nname: offer-check\ndescription: Checks an offer.\n---\n\nDo it.\n",
      "AGENTS.md": "Answer briefly.",
    });
    const sources = await scanVaultInstructions(io);
    expect(sources.map((s) => [s.id, s.kind, s.files.map((f) => f.path)])).toEqual([
      [".agent/skills/offer-check", "skill", ["SKILL.md"]],
      [ROOT, "script", ["main.js", "manifest.json", "tests/cases.json"]],
      ["AGENTS.md", "agents", ["AGENTS.md"]],
    ]);
    const script = sources[1]!;
    expect(script.script).toMatchObject({ name: "tag-count", tools: ["search_vault"] });
    expect(script.scriptProblems).toEqual([]);
    expect(script.code).toBe(MAIN);
    expect(script.signature).toEqual({ state: "none" });
    // The reading copy is the manifest, then the code: what the dialog shows and an approval keeps.
    expect(script.text).toBe(`${MANIFEST.trimEnd()}\n\n${SCRIPT_READING_RULE}\n\n${MAIN}`);
    expect(nameOf(script)).toBe("tag-count");
    expect(await scanInstruction(io, ROOT)).toEqual(script);
    expect(await scanInstruction(io, ".agent/scripts/none")).toBeNull();
    expect(await scanInstruction(io, ".agent/scripts/.hidden")).toBeNull();
    expect(await scanInstruction(io, ".agent/scripts/tag-count/tests")).toBeNull();
  });

  it("whatever is unclear is a problem, and a script with a problem does not run", async () => {
    expect(await problemsOf({ [`${ROOT}/main.js`]: MAIN })).toEqual(["manifest-missing"]);
    expect(await problemsOf({ [`${ROOT}/manifest.json`]: MANIFEST })).toEqual(["main-missing"]);
    expect(await problemsOf(scriptFiles({ [`${ROOT}/manifest.json`]: "{" }))).toEqual(["manifest-json"]);
    expect(await problemsOf(scriptFiles({ [`${ROOT}/manifest.json`]: MANIFEST.replace("tag-count", "other") }))).toEqual(["name-folder"]);
    expect(await problemsOf(scriptFiles({ [`${ROOT}/manifest.json`]: `${MANIFEST}${" ".repeat(17_000)}` }))).toEqual(["file-too-large"]);
    expect(await problemsOf(scriptFiles({ [`${ROOT}/main.js`]: `// ${"x".repeat(SCRIPT_MAIN_MAX_BYTES)}` }))).toEqual(["file-too-large"]);
    for (const files of [{ [`${ROOT}/main.js`]: MAIN }, scriptFiles({ [`${ROOT}/manifest.json`]: "{" })]) {
      expect(instructionStatus((await scanInstruction(memoryIO(files), ROOT))!, EMPTY_INSTRUCTION_APPROVALS)).toBe("invalid");
    }
  });

  it("code that reads differently from how it runs cannot be reviewed: a character that draws nothing is a problem", async () => {
    const zeroWidth = String.fromCharCode(0x200b);
    const rightToLeft = String.fromCharCode(0x202e);
    expect(await problemsOf(scriptFiles({ [`${ROOT}/main.js`]: `return 1;${zeroWidth}\n` }))).toEqual(["invisible-characters"]);
    expect(await problemsOf(scriptFiles({ [`${ROOT}/main.js`]: `const a = "${rightToLeft}x"; return a;\n` }))).toEqual(["invisible-characters"]);
    expect(await problemsOf(scriptFiles({ [`${ROOT}/manifest.json`]: MANIFEST.replace("Counts", `Co${zeroWidth}unts`) }))).toEqual(["invisible-characters"]);
    // Written as an escape, the same character is visible in the code and is none.
    expect(await problemsOf(scriptFiles({ [`${ROOT}/main.js`]: 'return "\\u200b";\n' }))).toEqual([]);
  });

  it("code that is no text is no script", async () => {
    const io = memoryIO(scriptFiles());
    const bytes: InstructionIO = { list: io.list, read: async (path) => (path.endsWith("main.js") ? new Uint8Array([0xff, 0xfe, 0x00, 0x41]) : io.read(path)) };
    const source = await scanInstruction(bytes, ROOT);
    expect(source!.scriptProblems).toEqual([{ code: "main-not-text" }]);
    expect(source!.code).toBeNull();
  });

  it("is too large with more files, more bytes or deeper folders than a small program has", async () => {
    const many = scriptFiles();
    for (let i = 0; i < SCRIPT_MAX_FILES; i++) many[`${ROOT}/data/${i}.txt`] = "x";
    expect((await scanInstruction(memoryIO(many), ROOT))!.tooLarge).toBe(true);
    expect((await scanInstruction(memoryIO(scriptFiles({ [`${ROOT}/data.txt`]: "x".repeat(262_145) })), ROOT))!.tooLarge).toBe(true);
    const deep = await scanInstruction(memoryIO(scriptFiles({ [`${ROOT}/a/b/c.txt`]: "x" })), ROOT);
    expect(deep!.tooLarge).toBe(true);
    expect(instructionStatus(deep!, EMPTY_INSTRUCTION_APPROVALS)).toBe("too-large");
  });

  it("a publisher's signature in the folder is held against the files beside it", async () => {
    // The scan takes the publishers it is given; the app's own list holds only its updater key.
    const scan = (files: Record<string, string>) => scanScriptFolder(memoryIO(files), "tag-count", testPublisher);
    const signed = await scan(scriptFiles({ [`${ROOT}/signature`]: TEST_SIGNATURE }));
    expect(signed.signature).toEqual({ state: "valid", publisher: "Test publisher", keyId: "9039E65753297DAA" });
    expect(signed.scriptProblems).toEqual([]);
    // The signature is one of the files an approval binds, but not of what it signs.
    expect(signed.files.map((f) => f.path)).toEqual(["main.js", "manifest.json", "signature"]);

    // One changed line of code under a signature that was made for the old one: the script does not run.
    const tampered = await scan(scriptFiles({ [`${ROOT}/signature`]: TEST_SIGNATURE, [`${ROOT}/main.js`]: MAIN.replace("found.results.length", "found.results.length + 1") }));
    expect(tampered.signature).toEqual({ state: "invalid" });
    expect(tampered.scriptProblems).toEqual([{ code: "signature-invalid" }]);
    expect(instructionStatus(tampered, EMPTY_INSTRUCTION_APPROVALS)).toBe("invalid");

    // A key nobody here knows says nothing, and is no problem; junk in the file is one.
    const unknown = await scanInstruction(memoryIO(scriptFiles({ [`${ROOT}/signature`]: TEST_SIGNATURE })), ROOT);
    expect(unknown!.signature).toEqual({ state: "unknown-key", keyId: "9039E65753297DAA" });
    expect(unknown!.scriptProblems).toEqual([]);
    expect((await scan(scriptFiles({ [`${ROOT}/signature`]: "signed, trust me" }))).scriptProblems).toEqual([{ code: "signature-invalid" }]);
    expect((await scan(scriptFiles({ [`${ROOT}/signature`]: "x".repeat(5000) }))).scriptProblems).toEqual([{ code: "signature-invalid" }]);
  });
});

describe("a script's approval on this device", () => {
  const key = newDeviceScriptKey();
  const publicKey = deviceScriptPublicKey(key)!;
  const vaultKey = "vault-a";
  const sign = (source: InstructionSource, with_ = key, vault = vaultKey) => signScriptApproval(with_, vault, source.id, scriptSeal(source.files))!;
  const signedHere: ScriptApprovalCheck = (source, approval) => verifyScriptApproval(publicKey, vaultKey, source.id, scriptSeal(source.files), approval.signature ?? "");

  it("nothing becomes active by arriving, and nothing without this device's signature", async () => {
    const io = memoryIO(scriptFiles());
    const arrived = (await scanInstruction(io, ROOT))!;
    expect(instructionStatus(arrived, EMPTY_INSTRUCTION_APPROVALS, signedHere)).toBe("new");

    // Approving without a signature approves nothing.
    expect(approveInstruction(EMPTY_INSTRUCTION_APPROVALS, arrived, "2026-10-08T10:00:00Z", "review")).toBe(EMPTY_INSTRUCTION_APPROVALS);

    const approvals = approveInstruction(EMPTY_INSTRUCTION_APPROVALS, arrived, "2026-10-08T10:00:00Z", "review", undefined, sign(arrived));
    expect(approvalOf(approvals, ROOT)).toMatchObject({ id: ROOT, how: "review", text: arrived.text, signature: expect.any(String) });
    expect(instructionStatus(arrived, approvals, signedHere)).toBe("active");
    // Where nobody can check the signature — no keychain, no key — a script is never active.
    expect(instructionStatus(arrived, approvals)).toBe("new");
    expect(instructionStatus(arrived, switchInstruction(approvals, ROOT, false), signedHere)).toBe("off");

    // Any change lifts it: the code, the manifest, a file beside them.
    io.files.set(`${ROOT}/main.js`, `${MAIN}// more\n`);
    expect(instructionStatus((await scanInstruction(io, ROOT))!, approvals, signedHere)).toBe("changed");
    io.files.set(`${ROOT}/main.js`, MAIN);
    io.files.set(`${ROOT}/manifest.json`, MANIFEST.replace('["search_vault"]', '["search_vault", "read_note"]'));
    expect(instructionStatus((await scanInstruction(io, ROOT))!, approvals, signedHere)).toBe("changed");
    io.files.set(`${ROOT}/manifest.json`, MANIFEST);
    io.files.set(`${ROOT}/notes.txt`, "x");
    expect(instructionStatus((await scanInstruction(io, ROOT))!, approvals, signedHere)).toBe("changed");
  });

  it("an approval this device did not sign is one it never gave", async () => {
    const source = (await scanInstruction(memoryIO(scriptFiles()), ROOT))!;
    const at = "2026-10-08T10:00:00Z";
    // Copied from another device's data, written for another vault, or with the hashes right and the signature made up.
    const fromOtherDevice = approveInstruction(EMPTY_INSTRUCTION_APPROVALS, source, at, "review", undefined, sign(source, newDeviceScriptKey()));
    const fromOtherVault = approveInstruction(EMPTY_INSTRUCTION_APPROVALS, source, at, "review", undefined, sign(source, key, "vault-b"));
    const madeUp = approveInstruction(EMPTY_INSTRUCTION_APPROVALS, source, at, "review", undefined, "A".repeat(86) + "==");
    for (const approvals of [fromOtherDevice, fromOtherVault, madeUp]) {
      expect(approvalOf(approvals, ROOT)).not.toBeNull();
      expect(instructionStatus(source, approvals, signedHere)).toBe("new");
    }
    // The record of a skill, written by hand over a script's id, carries no signature at all.
    const asSkill = { approved: [{ id: ROOT, files: Object.fromEntries(source.files.map((f) => [f.path, f.sha256])), at, how: "review" as const }], off: [] };
    expect(instructionStatus(source, asSkill, signedHere)).toBe("new");
  });

  it("the signature is kept with the approval, and a damaged one is none", async () => {
    const source = (await scanInstruction(memoryIO(scriptFiles()), ROOT))!;
    const approvals = approveInstruction(EMPTY_INSTRUCTION_APPROVALS, source, "2026-10-08T10:00:00Z", "created", undefined, sign(source));
    const stored = serializeInstructionApprovals(approvals);
    expect(readInstructionApprovals(stored)).toEqual(approvals);
    expect(instructionStatus(source, readInstructionApprovals(stored), signedHere)).toBe("active");
    const damaged = JSON.parse(stored) as { approved: { signature: unknown }[] };
    damaged.approved[0]!.signature = { not: "text" };
    expect(instructionStatus(source, readInstructionApprovals(JSON.stringify(damaged)), signedHere)).toBe("new");
  });

  it("stands in the list after the skills, with its state as this device's key sees it", async () => {
    const io = memoryIO({ ...scriptFiles(), ".agent/skills/b-skill/SKILL.md": "---\nname: b-skill\ndescription: x\n---\n\nDo.\n", "AGENTS.md": "Rules." });
    const sources = await scanVaultInstructions(io);
    const script = sources.find((s) => s.kind === "script")!;
    const approvals = approveInstruction(EMPTY_INSTRUCTION_APPROVALS, script, "2026-10-08T10:00:00Z", "review", undefined, sign(script));
    expect(resolveInstructions(sources, approvals, signedHere).map((e) => [e.source.kind, e.status])).toEqual([
      ["skill", "new"],
      ["script", "active"],
      ["agents", "new"],
    ]);
    expect(resolveInstructions(sources, approvals).map((e) => e.status)).toEqual(["new", "new", "new"]);
  });
});

/** An engine played by a function: what a script would do with `tools`, written as plain code. */
function playedSandbox(play: (job: SandboxJob, host: SandboxHost, signal?: AbortSignal) => Promise<SandboxEnd>, available = true): ScriptSandbox & { jobs: SandboxJob[] } {
  const jobs: SandboxJob[] = [];
  return {
    jobs,
    available: () => available,
    run: (job, host, signal) => {
      jobs.push(job);
      return play(job, host, signal);
    },
    check: async () => ({ ok: true }),
  };
}
const usage = { ms: 3, fuel: 7 };
const done = (value: unknown): SandboxEnd => ({ kind: "done", json: JSON.stringify(value), usage });
const scriptOf = (fields: Record<string, unknown> = {}): ScriptDefinition => parseScriptManifest(manifestOf({ tools: ["search_vault", "read_note", "run_command"], ...fields }), "s").script!;
const answered = (content: string, data?: unknown): ToolOutcome => ({ content, ...(data !== undefined ? { data } : {}) });

describe("one run of a script", () => {
  it("hands the script its input and its tools, and its value back", async () => {
    const executed: { tool: string; args: unknown }[] = [];
    const sandbox = playedSandbox(async (job, host) => {
      const found = JSON.parse(await host.call("search_vault", JSON.stringify({ query: job.input.query })));
      host.log?.("log", "one line");
      return done({ hits: found.data.results.length, tools: job.tools });
    });
    const outcome = await runScript({
      script: scriptOf({ input: [{ name: "query", type: "text", required: true }] }),
      code: "…",
      input: { query: "offer" },
      sandbox,
      execute: async (tool, args) => {
        executed.push({ tool: tool.name, args });
        return answered("- [[A]] (A.md)", { results: [{ title: "A", path: "A.md" }] });
      },
    });
    expect(outcome).toMatchObject({ kind: "done", value: { hits: 1, tools: ["search_vault", "read_note", "run_command"] }, logs: [{ level: "log", text: "one line" }], usage });
    // The arguments reach the tool validated and completed, like a model's.
    expect(executed).toEqual([{ tool: "search_vault", args: { query: "offer", limit: 10 } }]);
    expect(outcome.calls).toEqual([{ tool: "search_vault", args: '{"query":"offer"}', ok: true, ms: expect.any(Number), bytes: expect.any(Number) }]);
    expect(sandbox.jobs[0]).toMatchObject({ code: "…", input: { query: "offer" }, limits: SCRIPT_LIMIT_DEFAULTS });
  });

  it("gets a tool's values where it has any, its text otherwise, and its refusal as an error", () => {
    expect(scriptCallResult({ content: "- [[A]] (A.md)", data: { results: [] } })).toEqual({ ok: true, data: { results: [] } });
    expect(scriptCallResult({ content: "Done: Open graph." })).toEqual({ ok: true, data: { text: "Done: Open graph." } });
    expect(scriptCallResult({ content: "No note is available at this path.", isError: true, data: { leaked: true } })).toEqual({ ok: false, error: "No note is available at this path." });
  });

  it("does not start with what its parameters do not describe, or where there is no engine", async () => {
    const never = playedSandbox(async () => done(null));
    const base = { script: scriptOf({ input: [{ name: "query", type: "text", required: true }] }), code: "", execute: async () => answered("") };
    expect(await runScript({ ...base, input: {}, sandbox: never })).toMatchObject({ kind: "failed", reason: "input", message: "query: is required" });
    expect(await runScript({ ...base, input: { query: "x", extra: 1 }, sandbox: never })).toMatchObject({ kind: "failed", reason: "input" });
    expect(never.jobs).toEqual([]);
    expect(await runScript({ ...base, input: { query: "x" }, sandbox: playedSandbox(async () => done(null), false) })).toMatchObject({ kind: "failed", reason: "unavailable" });
  });

  it("is stopped when it calls a tool its manifest does not name — whatever it makes of the refusal", async () => {
    const executed: string[] = [];
    for (const name of ["get_tasks", "read_mail", "fetch_url", "propose_edit", "call_tool", "no_such_tool", "script_other", "__proto__"]) {
      let aborted = false;
      const sandbox = playedSandbox(async (_job, host, signal) => {
        signal?.addEventListener("abort", () => (aborted = true));
        const refused = JSON.parse(await host.call(name, "{}"));
        // A script that swallows the refusal and goes on: more calls, and a value at the end.
        const again = JSON.parse(await host.call("search_vault", '{"query":"x"}'));
        return done({ refused: refused.ok, again: again.ok });
      });
      const outcome = await runScript({
        script: scriptOf({ tools: ["search_vault"] }),
        code: "",
        input: {},
        sandbox,
        execute: async (tool) => {
          executed.push(tool.name);
          return answered("x");
        },
      });
      expect(outcome, name).toMatchObject({ kind: "failed", reason: "tool" });
      expect(aborted, name).toBe(true);
    }
    // Neither the tool it may not call nor anything after it was carried out.
    expect(executed).toEqual([]);
  });

  it("a tool no script may call stays closed even to a manifest that names it", async () => {
    // A manifest cannot be read with such a tool; this is the run's own check, should one ever be built by hand.
    const forged: ScriptDefinition = { ...scriptOf(), tools: ["read_mail", "fetch_url", "delete_note", "draft_mail"] };
    for (const name of forged.tools) {
      const outcome = await runScript({ script: forged, code: "", input: {}, sandbox: playedSandbox(async (_job, host) => done(await host.call(name, "{}"))), execute: async () => answered("x") });
      expect(outcome, name).toMatchObject({ kind: "failed", reason: "tool" });
    }
  });

  it("is stopped at the count of calls and the size of a call its manifest sets", async () => {
    let executed = 0;
    const many = await runScript({
      script: scriptOf({ limits: { calls: 2 } }),
      code: "",
      input: {},
      sandbox: playedSandbox(async (_job, host) => {
        for (let i = 0; i < 5; i++) await host.call("search_vault", JSON.stringify({ query: `q${i}` }));
        return done("went on");
      }),
      execute: async () => {
        executed += 1;
        return answered("x");
      },
    });
    expect(many).toMatchObject({ kind: "failed", reason: "calls" });
    expect(executed).toBe(2);
    expect(many.calls).toHaveLength(2);

    const large = await runScript({
      script: scriptOf({ limits: { callBytes: 1024 } }),
      code: "",
      input: {},
      sandbox: playedSandbox(async (_job, host) => done(await host.call("search_vault", JSON.stringify({ query: "x".repeat(2000) })))),
      execute: async () => answered("x"),
    });
    expect(large).toMatchObject({ kind: "failed", reason: "size" });
    expect(large.calls).toEqual([]);
  });

  it("a result larger than the limit for one call is refused to the script, which may ask for less", async () => {
    const outcome = await runScript({
      script: scriptOf({ limits: { callBytes: 1024 } }),
      code: "",
      input: {},
      sandbox: playedSandbox(async (_job, host) => {
        const first = JSON.parse(await host.call("read_note", '{"path":"A.md"}'));
        const second = JSON.parse(await host.call("read_note", '{"path":"A.md","maxChars":200}'));
        return done({ first: first.ok, firstError: first.error, second: second.ok });
      }),
      execute: async (_tool, args) => answered("x", { text: "y".repeat((args as { maxChars: number }).maxChars) }),
    });
    expect(outcome).toMatchObject({ kind: "done", value: { first: false, second: true } });
    expect((outcome as { value: { firstError: string } }).value.firstError).toContain("larger than this script's limit");
    expect(outcome.calls.map((c) => [c.ok, c.note])).toEqual([[false, "too-large"], [true, undefined]]);
  });

  it("arguments a tool does not take are answered like a model's: the script may try again", async () => {
    const executed: unknown[] = [];
    const outcome = await runScript({
      script: scriptOf(),
      code: "",
      input: {},
      sandbox: playedSandbox(async (_job, host) => {
        const wrong = JSON.parse(await host.call("read_note", '{"note":"A"}'));
        const junk = JSON.parse(await host.call("read_note", "not json"));
        return done({ wrong: wrong.error, junk: junk.ok });
      }),
      execute: async (_tool, args) => {
        executed.push(args);
        return answered("x");
      },
    });
    expect(outcome).toMatchObject({ kind: "done", value: { junk: false } });
    expect((outcome as { value: { wrong: string } }).value.wrong).toMatch(/^Invalid arguments for read_note: path/);
    expect(executed).toEqual([]);
  });

  it("a tool that fails or throws is an error to the script, never the end of the app", async () => {
    const outcome = await runScript({
      script: scriptOf(),
      code: "",
      input: {},
      sandbox: playedSandbox(async (_job, host) => done([JSON.parse(await host.call("read_note", '{"path":"A.md"}')), JSON.parse(await host.call("search_vault", '{"query":"x"}'))])),
      execute: async (tool) => {
        if (tool.name === "read_note") return { content: "No note is available at this path.", isError: true };
        throw new Error("index closed");
      },
    });
    expect(outcome).toMatchObject({ kind: "done", value: [{ ok: false, error: "No note is available at this path." }, { ok: false, error: "The tool failed: index closed" }] });
  });

  it("a dry run calls what reads and only writes down what would show or change something", async () => {
    const executed: string[] = [];
    const outcome = await runScript({
      script: scriptOf(),
      code: "",
      input: {},
      dry: true,
      sandbox: playedSandbox(async (_job, host) => done([JSON.parse(await host.call("search_vault", '{"query":"x"}')), JSON.parse(await host.call("run_command", '{"id":"open-graph"}'))])),
      execute: async (tool) => {
        executed.push(tool.name);
        return answered("x", { results: [] });
      },
    });
    expect(executed).toEqual(["search_vault"]);
    expect(outcome).toMatchObject({ kind: "done", value: [{ ok: true, data: { results: [] } }, { ok: true, data: { dryRun: true } }] });
    expect(outcome.calls.map((c) => [c.tool, c.note])).toEqual([["search_vault", undefined], ["run_command", "not-run"]]);
  });

  it("ends as the engine ended it, and with nothing where the value is too large or no JSON", async () => {
    const run = (end: SandboxEnd, limits = {}) => runScript({ script: scriptOf({ limits }), code: "", input: {}, sandbox: playedSandbox(async () => end), execute: async () => answered("x") });
    for (const why of ["time", "fuel", "memory", "output", "stopped", "crashed"] as const) expect(await run({ kind: "killed", why, usage })).toMatchObject({ kind: "failed", reason: why, usage });
    expect(await run({ kind: "error", message: "x is not defined", usage })).toMatchObject({ kind: "failed", reason: "error", message: "x is not defined" });
    expect(await run({ kind: "done", json: JSON.stringify("x".repeat(300)), usage }, { resultBytes: 256 })).toMatchObject({ kind: "failed", reason: "output" });
    expect(await run({ kind: "done", json: "{not json", usage })).toMatchObject({ kind: "failed", reason: "error" });
    // An engine that throws instead of ending gave way.
    const thrown = await runScript({ script: scriptOf(), code: "", input: {}, sandbox: playedSandbox(async () => Promise.reject(new Error("worker lost"))), execute: async () => answered("x") });
    expect(thrown).toMatchObject({ kind: "failed", reason: "crashed" });
  });

  it("stops with the caller, and does not start once the caller has stopped", async () => {
    const controller = new AbortController();
    const outcome = await runScript({
      script: scriptOf(),
      code: "",
      input: {},
      signal: controller.signal,
      sandbox: playedSandbox(
        (_job, _host, signal) =>
          new Promise<SandboxEnd>((resolve) => {
            signal!.addEventListener("abort", () => resolve({ kind: "killed", why: "stopped", usage }));
            controller.abort();
          }),
      ),
      execute: async () => answered("x"),
    });
    expect(outcome).toMatchObject({ kind: "failed", reason: "stopped" });
    const never = playedSandbox(async () => done(null));
    expect(await runScript({ script: scriptOf(), code: "", input: {}, signal: controller.signal, sandbox: never, execute: async () => answered("x") })).toMatchObject({ kind: "failed", reason: "stopped" });
    expect(never.jobs).toEqual([]);
  });

  it("keeps a script's log short", async () => {
    const outcome = await runScript({
      script: scriptOf(),
      code: "",
      input: {},
      sandbox: playedSandbox(async (_job, host) => {
        for (let i = 0; i < 250; i++) host.log?.("log", i === 0 ? "x".repeat(2000) : `line ${i}`);
        return done(null);
      }),
      execute: async () => answered("x"),
    });
    expect(outcome.logs).toHaveLength(200);
    expect(outcome.logs[0]!.text.length).toBeLessThanOrEqual(501);
    expect(outcome.logsCut).toBe(true);
  });

  it("tells a model what happened in the app's words, never in the script's", () => {
    const limits = { ...SCRIPT_LIMIT_DEFAULTS };
    for (const reason of ["time", "fuel", "memory", "output", "stopped", "crashed", "tool", "calls", "size", "input", "unavailable", "error"] as const) {
      const text = scriptFailureText("tag-count", reason, limits);
      expect(text.length, reason).toBeGreaterThan(20);
      expect(text, reason).not.toContain("undefined");
    }
    expect(scriptFailureText("tag-count", "time", limits)).toBe("The script tag-count did not finish: it computed longer than its limit of 5 s.");
  });
});
