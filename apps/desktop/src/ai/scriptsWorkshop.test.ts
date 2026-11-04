import { describe, expect, it } from "vitest";
import i18n from "@plainva/ui/i18n";
import {
  approveInstruction,
  deviceScriptPublicKey,
  EMPTY_INSTRUCTION_APPROVALS,
  newDeviceScriptKey,
  parseScriptManifest,
  resolveInstructions,
  scanVaultInstructions,
  SCRIPT_LIMIT_DEFAULTS,
  SCRIPT_PARAMETERS_MAX,
  SCRIPT_READ_TOOL_NAMES,
  SCRIPT_TOOL_NAMES,
  SCRIPT_WRITE_TOOL_NAMES,
  scriptSeal,
  serializeScriptManifest,
  signScriptApproval,
  utf8Encode,
  verifyScriptApproval,
  type InstructionApprovals,
  type InstructionEntry,
  type InstructionIO,
  type InstructionSource,
  type ScriptApprovalCheck,
  type ScriptCallRecord,
  type ScriptFailure,
  type ScriptOutcome,
} from "@plainva/core";
import {
  addScriptParameter,
  APP_LANGUAGES,
  approvalFacts,
  changeScriptParameter,
  machineAuthorLabel,
  newScriptForm,
  removeScriptParameter,
  scriptCallLines,
  scriptCheckLine,
  scriptDraftOf,
  scriptFieldDefaults,
  scriptFieldInput,
  scriptFormOf,
  scriptFormReady,
  scriptOutcomeText,
  scriptRowDescription,
  scriptToolChoices,
  scriptUsageLine,
  scriptValueText,
  scriptWriteError,
  skillRowDescription,
  toggleScriptTool,
  workshopSections,
  workshopTitle,
} from "@plainva/ui";

/**
 * The scripts of the workshop as both shells show them (plan KI-Harness
 * P5.5, mockup chapter 21): one model — which list a script stands in, what
 * its approval says in words, how a run reads, and the form it is written in.
 */

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);
const VAULT = "vault-1";
const CODE = 'const found = await tools.search_vault({ query: "#" + input.tag, limit: 25 });\nreturn { tag: input.tag, count: found.results.length };\n';

const manifest = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: "tag-count",
    title: "Count tags",
    description: "Counts the notes that carry a tag.",
    tools: ["search_vault", "read_note"],
    input: [
      { name: "tag", type: "text", description: "The tag, without #", required: true },
      { name: "deep", type: "boolean" },
      { name: "kind", type: "text", options: ["all", "open"] },
    ],
    ...over,
  });

function io(files: Record<string, string>): InstructionIO {
  const disk = new Map(Object.entries(files));
  return {
    async list(folder) {
      const prefix = `${folder}/`;
      const names = new Map<string, boolean>();
      for (const path of disk.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        names.set(slash < 0 ? rest : rest.slice(0, slash), slash >= 0);
      }
      return [...names].map(([name, folder]) => ({ name, folder }));
    },
    async read(path) {
      const text = disk.get(path);
      return text === undefined ? null : utf8Encode(text);
    },
  };
}

const scan = (files: Record<string, string>) => scanVaultInstructions(io(files));
const script = (files: Record<string, string> = { "manifest.json": manifest(), "main.js": CODE }) => scan(Object.fromEntries(Object.entries(files).map(([path, text]) => [`.agent/scripts/tag-count/${path}`, text])));

/** This device: a key, the check it makes, and an approval it signs. */
function device() {
  const key = newDeviceScriptKey();
  const publicKey = deviceScriptPublicKey(key)!;
  const signed: ScriptApprovalCheck = (source, approval) => verifyScriptApproval(publicKey, VAULT, source.id, scriptSeal(source.files), approval.signature ?? "");
  const approve = (approvals: InstructionApprovals, source: InstructionSource) => approveInstruction(approvals, source, "2026-10-08T09:12:00Z", "review", undefined, signScriptApproval(key, VAULT, source.id, scriptSeal(source.files)) ?? undefined);
  return { signed, approve };
}

async function activeEntry(): Promise<InstructionEntry> {
  const { signed, approve } = device();
  const [source] = await script();
  const [entry] = resolveInstructions([source!], approve(EMPTY_INSTRUCTION_APPROVALS, source!), signed);
  return entry!;
}

describe("a script in the workshop", () => {
  it("waits with the skills until this device approved it, then stands in a group of its own", async () => {
    await i18n.changeLanguage("en");
    const { signed, approve } = device();
    const sources = await scan({
      ".agent/scripts/tag-count/manifest.json": manifest(),
      ".agent/scripts/tag-count/main.js": CODE,
      ".agent/scripts/broken/manifest.json": "{",
      ".agent/skills/offer-check/SKILL.md": "---\nname: offer-check\ndescription: Checks an offer.\n---\n\nRead the offer.\n",
    });
    const before = workshopSections(resolveInstructions(sources, EMPTY_INSTRUCTION_APPROVALS, signed));
    expect(before.waiting.map((e) => [e.source.id, e.status])).toEqual([
      [".agent/skills/offer-check", "new"],
      [".agent/scripts/broken", "invalid"],
      [".agent/scripts/tag-count", "new"],
    ]);
    expect(before.scripts).toEqual([]);
    // Among what waits, the row says that this one is a script.
    expect(scriptRowDescription(t, before.waiting[2]!)).toBe("Script · new · Counts the notes that carry a tag.");

    const source = sources.find((s) => s.id === ".agent/scripts/tag-count")!;
    const after = workshopSections(resolveInstructions(sources, approve(EMPTY_INSTRUCTION_APPROVALS, source), signed));
    expect(after.scripts.map((e) => [e.source.id, e.status])).toEqual([[".agent/scripts/tag-count", "active"]]);
    expect(after.own).toEqual([]);
    expect(workshopTitle(t, after.scripts[0]!)).toBe("Count tags");
    // Approved, the row names the tools it calls — the skills' row description hands a script to the same words.
    expect(skillRowDescription(t, after.scripts[0]!, [], null)).toBe("Counts the notes that carry a tag. · Calls: Searching the vault · Reading a note");
  });

  it("is new again on a device that did not sign its approval, and the dialog says why", async () => {
    await i18n.changeLanguage("en");
    const here = device();
    const elsewhere = device();
    const [source] = await script();
    const approvals = elsewhere.approve(EMPTY_INSTRUCTION_APPROVALS, source!);
    const [entry] = resolveInstructions([source!], approvals, here.signed);
    expect(entry!.status).toBe("new");
    const facts = approvalFacts(t, entry!, "en");
    expect(facts.canApprove).toBe(true);
    expect(facts.origin.some((line) => line.includes("this device did not sign it"))).toBe(true);
  });

  it("says in words what the manifest asks for, shows the code in full and binds exactly these files", async () => {
    await i18n.changeLanguage("en");
    const [source] = await script();
    const [entry] = resolveInstructions([source!], EMPTY_INSTRUCTION_APPROVALS, () => false);
    const facts = approvalFacts(t, entry!, "en");
    expect(facts.kind).toBe("script");
    expect(facts.title).toBe("Count tags");
    expect(facts.may).toEqual(["It calls these tools: Searching the vault · Reading a note.", "It reaches nothing else — no file, no network, no other tool.", "It changes nothing."]);
    expect(facts.limits).toBe("5 s of computing · 32 MB of memory · at most 20 tool calls of 64 KB each · a result of at most 64 KB");
    expect(facts.inputs).toEqual(["tag — text, required: The tag, without #", "deep — yes or no, optional", "kind — one of: all, open, optional"]);
    expect(facts.code).toBe(CODE);
    expect(facts.codeSize).toBe(`Lines: 2 · Characters: ${CODE.length}`);
    expect(facts.text).toBeNull();
    expect(facts.files.map((f) => f.path)).toEqual(["main.js", "manifest.json"]);
    expect(facts.origin).toEqual(["Lies in .agent/scripts/tag-count", "Never approved on this device", "No publisher's signature"]);
    expect(facts.canApprove).toBe(true);
    expect(Object.keys(facts.seen).sort()).toEqual(["main.js", "manifest.json"]);
    expect(Object.values(facts.seen).every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
  });

  it("a script that names writing tools says so before it is approved — it suggests and drafts, it changes nothing", async () => {
    await i18n.changeLanguage("en");
    const [source] = await script({ "manifest.json": manifest({ tools: ["read_note", "propose_edit", "create_task"] }), "main.js": CODE });
    const [entry] = resolveInstructions([source!], EMPTY_INSTRUCTION_APPROVALS, () => false);
    const facts = approvalFacts(t, entry!, "en");
    expect(facts.may).toEqual([
      "It calls these tools: Reading a note · Suggesting changes to a note · Drafting a task.",
      "It reaches nothing else — no file, no network, no other tool.",
      "It can suggest changes and leave drafts, signed with its name. Nothing in the vault changes before you accept or create.",
    ]);
    expect(facts.canApprove).toBe(true);
    // Its row names the writing tools like the reading ones: what it calls is what it can do.
    expect(scriptRowDescription(t, entry!)).toBe("Script · new · Counts the notes that carry a tag.");
    // A plan — a rename, a deletion — is no tool of a script, whatever its manifest says.
    const [plans] = await script({ "manifest.json": manifest({ tools: ["read_note", "delete_note"] }), "main.js": CODE });
    expect(approvalFacts(t, resolveInstructions([plans!], EMPTY_INSTRUCTION_APPROVALS, () => false)[0]!, "en").problems).toEqual(["It names a tool no script may call: delete_note."]);
  });

  it("names the script as the author of what it lays down — in every language of the app", async () => {
    for (const { code } of APP_LANGUAGES) {
      const tt = i18n.getFixedT(code);
      const label = machineAuthorLabel(tt, "script:tag-count");
      expect(label, code).toContain("tag-count");
      expect(label, code).not.toBe("tag-count");
      // The words it was laid down with — its title — are kept with the draft and shown instead.
      expect(machineAuthorLabel(tt, "script:tag-count", "Script “Count tags”"), code).toBe("Script “Count tags”");
    }
    expect(machineAuthorLabel(i18n.getFixedT("en"), "script:tag-count")).toBe("Script “tag-count”");
  });

  it("cannot be approved while its manifest is wrong, and names what is wrong", async () => {
    await i18n.changeLanguage("en");
    const [source] = await script({ "manifest.json": manifest({ tools: ["search_vault", "draft_mail", "no_such_tool"], limits: { seconds: 900 } }), "main.js": CODE });
    const [entry] = resolveInstructions([source!], EMPTY_INSTRUCTION_APPROVALS, () => false);
    expect(entry!.status).toBe("invalid");
    const facts = approvalFacts(t, entry!, "en");
    expect(facts.canApprove).toBe(false);
    expect(facts.problems).toEqual(["It names a tool no script may call: draft_mail.", "It names a tool Plainva does not have: no_such_tool.", "A limit is outside what a script may ask for: seconds."]);
  });

  it("shows what changed since the approved version, manifest and code as one text", async () => {
    await i18n.changeLanguage("en");
    const { signed, approve } = device();
    const [before] = await script();
    const approvals = approve(EMPTY_INSTRUCTION_APPROVALS, before!);
    const [after] = await script({ "manifest.json": manifest(), "main.js": CODE.replace("limit: 25", "limit: 500") });
    const [entry] = resolveInstructions([after!], approvals, signed);
    expect(entry!.status).toBe("changed");
    const facts = approvalFacts(t, entry!, "en");
    expect(facts.changes?.some((line) => line.type === "add" && line.text.includes("limit: 500"))).toBe(true);
    expect(facts.changes?.some((line) => line.type === "del" && line.text.includes("limit: 25"))).toBe(true);
    expect(facts.canApprove).toBe(true);
  });

  it("says whether the engine reads the code — and where it stopped", async () => {
    await i18n.changeLanguage("en");
    expect(scriptCheckLine(t, { ok: true }, "Lines: 2 · Characters: 143")).toEqual({ mark: "pass", text: "The engine reads this code as JavaScript. Lines: 2 · Characters: 143" });
    expect(scriptCheckLine(t, { ok: true }, undefined)).toEqual({ mark: "pass", text: "The engine reads this code as JavaScript." });
    expect(scriptCheckLine(t, { ok: false, message: "SyntaxError: unexpected token in line 3" }, "Lines: 2")).toEqual({ mark: "fail", text: "The engine does not read this code: SyntaxError: unexpected token in line 3" });
  });
});

describe("a script's run in words", () => {
  const usage = { ms: 40, fuel: 3 };
  const calls: ScriptCallRecord[] = [
    { tool: "search_vault", args: '{"query":"#kunde","limit":25}', ok: true, ms: 14.4, bytes: 1229 },
    { tool: "read_note", args: '{"path":"Kunden/Meier.md"}', ok: false, ms: 3, bytes: 0 },
    { tool: "run_command", args: '{"command":"open-graph"}', ok: true, ms: 0, bytes: 0, note: "not-run" },
    { tool: "query_base", args: '{"base":"Kunden.base"}', ok: false, ms: 9, bytes: 0, note: "too-large" },
  ];

  it("turns the fields of the dialog into the input of a run", async () => {
    const entry = await activeEntry();
    const parameters = [...entry.source.script!.parameters, { name: "limit", type: "number" as const, description: "", required: false }];
    expect(scriptFieldDefaults(parameters)).toEqual({ tag: "", deep: false, kind: "all", limit: "" });
    // A required text left empty keeps the start off; an empty number is no value.
    expect(scriptFieldInput(parameters, { tag: "", deep: false, kind: "all", limit: "" })).toEqual({ input: { deep: false, kind: "all" }, missing: ["tag"] });
    expect(scriptFieldInput(parameters, { tag: "kunde", deep: true, kind: "open", limit: " 2,5 " })).toEqual({ input: { tag: "kunde", deep: true, kind: "open", limit: 2.5 }, missing: [] });
    // A number that does not read is missing, never a guess.
    expect(scriptFieldInput(parameters, { tag: "kunde", deep: false, kind: "all", limit: "viele" }).missing).toEqual(["limit"]);
  });

  it("lists each call with the tool in the app's words and what came of it", async () => {
    await i18n.changeLanguage("en");
    expect(scriptCallLines(t, calls, "en")).toEqual([
      { key: "0", mark: "pass", tool: "Searching the vault", args: '{"query":"#kunde","limit":25}', meta: "14 ms · 1.2 KB" },
      { key: "1", mark: "fail", tool: "Reading a note", args: '{"path":"Kunden/Meier.md"}', meta: "refused" },
      { key: "2", mark: "skip", tool: "Using the app", args: '{"command":"open-graph"}', meta: "not carried out" },
      { key: "3", mark: "fail", tool: "Reading a database", args: '{"base":"Kunden.base"}', meta: "result too large" },
    ]);
  });

  it("shows a finished run's value as JSON in lines and what it used of its limits", async () => {
    await i18n.changeLanguage("en");
    const done: ScriptOutcome = { kind: "done", value: { tag: "kunde", count: 3 }, json: '{"tag":"kunde","count":3}', calls: calls.slice(0, 1), logs: [], logsCut: false, usage };
    expect(scriptValueText(done)).toBe('{\n  "tag": "kunde",\n  "count": 3\n}');
    expect(scriptUsageLine(t, done, SCRIPT_LIMIT_DEFAULTS, "en")).toBe("0.04 s computed · 3 of 50,000 steps · 1 of 20 calls");
    expect(scriptOutcomeText(t, done, SCRIPT_LIMIT_DEFAULTS, false, "en")).toEqual({ tone: "success", text: "Finished.", note: null });
    expect(scriptOutcomeText(t, done, SCRIPT_LIMIT_DEFAULTS, true, "en")).toEqual({ tone: "success", text: "Dry run finished. Nothing was shown or changed.", note: null });
    const failed: ScriptOutcome = { kind: "failed", reason: "time", calls, logs: [], logsCut: false, usage };
    expect(scriptValueText(failed)).toBeNull();
  });

  it("says why a run was ended — every reason, in every language of the app", async () => {
    const reasons: ScriptFailure[] = ["time", "fuel", "memory", "output", "stopped", "crashed", "error", "tool", "calls", "size", "input", "unavailable"];
    for (const { code } of APP_LANGUAGES) {
      const tt = i18n.getFixedT(code);
      const seen = new Set<string>();
      for (const reason of reasons) {
        const outcome: ScriptOutcome = { kind: "failed", reason, message: "ReferenceError: x is not defined", calls, logs: [], logsCut: false, usage };
        const said = scriptOutcomeText(tt, outcome, SCRIPT_LIMIT_DEFAULTS, false, code);
        // A sentence, never a key and never an empty slot (a sentence is short in a script without spaces between words).
        expect(said.text, `${code}: ${reason}`).not.toMatch(/ai\.scripts|\{\{|\}\}/);
        expect(said.text.trim().length, `${code}: ${reason}`).toBeGreaterThan(4);
        seen.add(said.text);
        // What ran before the end stays listed, and the note says so — except where nothing of the script ran at all.
        expect(said.note === null, `${code}: ${reason}`).toBe(reason === "unavailable" || reason === "input");
      }
      expect(seen.size, code).toBe(reasons.length);
    }
    await i18n.changeLanguage("en");
    const said = (reason: ScriptFailure) => scriptOutcomeText(t, { kind: "failed", reason, message: "x is not defined", calls: [], logs: [], logsCut: false, usage }, SCRIPT_LIMIT_DEFAULTS, false, "en");
    expect(said("time")).toEqual({ tone: "warning", text: "The script was ended: it computed longer than its 5 seconds.", note: null });
    expect(said("error")).toEqual({ tone: "error", text: "The script failed: x is not defined", note: null });
    expect(said("crashed").tone).toBe("error");
    expect(said("stopped")).toEqual({ tone: "warning", text: "You stopped the script.", note: null });
  });
});

describe("the form a script is written in", () => {
  it("starts as a script that is valid as soon as it has a name and a description", async () => {
    const form = newScriptForm();
    expect(scriptFormReady(form)).toBe(false);
    const filled = { ...form, name: " tag-count ", description: " Counts the notes that carry a tag. " };
    expect(scriptFormReady(filled)).toBe(true);
    const draft = scriptDraftOf(filled);
    expect(draft.name).toBe("tag-count");
    expect(draft.description).toBe("Counts the notes that carry a tag.");
    expect(draft.limits).toEqual(SCRIPT_LIMIT_DEFAULTS);
    const parsed = parseScriptManifest(serializeScriptManifest(draft), "tag-count");
    expect(parsed.problems).toEqual([]);
    expect(parsed.script?.tools).toEqual(["search_vault"]);
    expect(parsed.script?.parameters).toEqual([{ name: "query", type: "text", description: "", required: true }]);
    // An input without a description writes none into the file: the manifest holds what was said, not empty slots.
    expect(serializeScriptManifest(draft)).not.toContain('"description": ""');
  });

  it("offers exactly the tools a script may call, in the app's words, and keeps their order", async () => {
    await i18n.changeLanguage("en");
    const choices = scriptToolChoices(t);
    expect(choices.map((choice) => choice.name)).toEqual([...SCRIPT_TOOL_NAMES]);
    expect(choices.every((choice) => choice.label !== choice.name)).toBe(true);
    // Two groups in the form: what reads comes first, what suggests or drafts is marked as such.
    expect(choices.filter((choice) => choice.writes).map((choice) => choice.name)).toEqual([...SCRIPT_WRITE_TOOL_NAMES]);
    expect(choices.findIndex((choice) => choice.writes)).toBe(SCRIPT_READ_TOOL_NAMES.length);
    let form = newScriptForm();
    form = toggleScriptTool(form, "get_recent", true);
    form = toggleScriptTool(form, "read_note", true);
    expect(form.tools).toEqual(SCRIPT_TOOL_NAMES.filter((name) => ["search_vault", "read_note", "get_recent"].includes(name)));
    form = toggleScriptTool(form, "search_vault", false);
    expect(form.tools).toEqual(SCRIPT_TOOL_NAMES.filter((name) => ["read_note", "get_recent"].includes(name)));
  });

  it("adds, changes and removes inputs — twelve at most, and a list of values only for a text", async () => {
    let form = newScriptForm();
    for (let i = 0; i < 20; i += 1) form = addScriptParameter(form);
    expect(form.parameters).toHaveLength(SCRIPT_PARAMETERS_MAX);
    expect(addScriptParameter(form)).toBe(form);
    expect(new Set(form.parameters.map((p) => p.row)).size).toBe(SCRIPT_PARAMETERS_MAX);
    const second = form.parameters[1]!.row;
    form = changeScriptParameter(form, second, { name: "limit", type: "number", required: true });
    expect(form.parameters[1]).toMatchObject({ name: "limit", type: "number", required: true });
    form = removeScriptParameter(form, second);
    expect(form.parameters.some((p) => p.row === second)).toBe(false);

    const entry = await activeEntry();
    const edit = scriptFormOf(entry)!;
    expect(edit.parameters.find((p) => p.name === "kind")?.options).toEqual(["all", "open"]);
    const kind = edit.parameters.find((p) => p.name === "kind")!.row;
    expect(changeScriptParameter(edit, kind, { type: "number" }).parameters.find((p) => p.row === kind)?.options).toBeUndefined();
  });

  it("opens an existing script as it is, and hands it back unchanged", async () => {
    const entry = await activeEntry();
    const form = scriptFormOf(entry)!;
    expect(form).toMatchObject({ name: "tag-count", title: "Count tags", description: "Counts the notes that carry a tag.", tools: ["search_vault", "read_note"], code: CODE, seconds: "5", calls: "20", memoryMb: "32" });
    const draft = scriptDraftOf(form);
    const parsed = parseScriptManifest(serializeScriptManifest(draft), "tag-count");
    expect(parsed.problems).toEqual([]);
    expect(parsed.script).toEqual(entry.source.script);
    expect(draft.code).toBe(CODE);
  });

  it("hands a number that does not read to the manifest, which names the limit", async () => {
    await i18n.changeLanguage("en");
    const form = { ...newScriptForm(), name: "tag-count", description: "Counts.", seconds: "soon", calls: "7" };
    const draft = scriptDraftOf(form);
    expect(Number.isNaN(draft.limits?.seconds)).toBe(true);
    expect(draft.limits?.calls).toBe(7);
    const parsed = parseScriptManifest(serializeScriptManifest(draft), "tag-count");
    expect(parsed.problems.map((p) => p.code)).toEqual(["limit-value"]);
    expect(scriptWriteError(t, { ok: false, reason: "invalid", problems: parsed.problems })).toBe("Not yet valid: A limit is outside what a script may ask for: seconds.");
  });

  it("says in words why a script was not written", async () => {
    await i18n.changeLanguage("en");
    expect(scriptWriteError(t, { ok: true, id: ".agent/scripts/tag-count", approved: true })).toBeNull();
    expect(scriptWriteError(t, { ok: false, reason: "exists" })).toBe("A script of this name exists in this vault.");
    expect(scriptWriteError(t, { ok: false, reason: "syntax", message: "SyntaxError: unexpected token in line 2" })).toBe("The engine does not read this code: SyntaxError: unexpected token in line 2");
    expect(scriptWriteError(t, { ok: false, reason: "write-failed" })).toBe("The script could not be written into the vault.");
    expect(scriptWriteError(t, { ok: false, reason: "no-vault" })).toBe("The script could not be written into the vault.");
  });
});
