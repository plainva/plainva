import { invoke } from "@tauri-apps/api/core";
import { WRITE_REFUSALS, mcpAuthorId, mcpToolKind, parseToolInput, toolByName, toolInputJsonSchema, toolsFor, withinFolders, type EgressRecipient, type ToolOutcome } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { aiVaultKey, mcpSkillPrompts, type AiSession, type AiVaultHost, type PlanQuestion, type WriteRun } from "@plainva/ui";
import { samePlan, type McpPlanQuestion, type McpPlans } from "./mcpPlans";

/**
 * The main window's side of Plainva's MCP server (plan KI-Harness §17.3,
 * ADR 0022). The native side admits a client, checks the paths it names and
 * hands each call here; this module runs it with the assistant's own tools —
 * the same hard gate, the `plainva.ai` rules as for a cloud recipient that
 * may reach the internet — narrowed to the folders that client was given, and
 * reports every path that passed, which the native side checks once more
 * before the client sees anything.
 *
 * Stage 2: a client the user allowed to propose changes also reaches six
 * tools that write. None of them changes the vault — a suggestion on a note,
 * a draft, or a plan the user confirms in this window — and each is signed
 * with the client's own id.
 */

/** The tools as the native side serves them: the core manifests of the "mcp" surface. */
export function mcpToolSpecs() {
  return toolsFor("mcp").map((tool) => {
    const inputSchema = toolInputJsonSchema(tool);
    const keys = Object.keys((inputSchema.properties ?? {}) as Record<string, unknown>);
    return {
      name: tool.name,
      description: tool.description,
      inputSchema,
      // Arguments that name a place in the vault: checked natively before the call.
      pathArgs: keys.filter((key) => key === "path" || key === "base" || key === "folder"),
      // What a call can do decides natively who is offered the tool: every client reads, only one the user allowed proposes or plans.
      kind: mcpToolKind(tool),
      // A deletion is the one plan that takes something away.
      destructive: tool.name === "delete_note",
    };
  });
}

/**
 * The native folder rule, once more in the web view: "" grants the whole
 * vault, a folder grants itself and everything below it, never a sibling that
 * only shares a prefix. Compared NFC and case-folded; the native side, which
 * knows the file system, is stricter where case matters (Linux).
 */
/** A path without separators at either end (trimmed in code: an unanchored pattern would be quadratic). */
export function trimSlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && (value[start] === "/" || value[start] === "\\")) start++;
  while (end > start && (value[end - 1] === "/" || value[end - 1] === "\\")) end--;
  return value.slice(start, end);
}

/** The one folder rule of the harness (a skill's folders read the same way, plan KI-Harness P3). */
export function insideFolders(path: string, folders: readonly string[]): boolean {
  return withinFolders(path, folders);
}

export interface McpCallRequest {
  requestId: string;
  clientId: string;
  client: string;
  tool: string;
  args: unknown;
  folders: string[];
  /** The user allows this client to propose changes in the open vault — asked natively at this call. */
  writes?: boolean;
  /** The client comes back for a plan: the handle it was given … */
  handle?: string | null;
  /** … and what its own user said to the note that input is required: "accept", "decline" or "cancel". */
  answer?: string | null;
}

export interface McpCallAnswer {
  content: string;
  isError: boolean;
  /** Every vault path that passed the gate while the call ran: the answer names no other. */
  paths: string[];
  /** A plan now waits for the user in this window: the client is told that input is required, and to come back with the handle. */
  pending?: { handle: string; message: string };
  /** The user said no — here or in the client. An answer, and the record says so; not a call that failed. */
  declined?: boolean;
}

const failed = (content: string): McpCallAnswer => ({ content, isError: true, paths: [] });

/** A tool that is not on this client's list — one that does not exist, and one it was not given: the same words as natively. */
const noTool = (name: string) => `There is no tool called ${name}.`;

/** What a client is told when it comes back for a plan that does not wait any more — the words of the native side. */
export const MCP_NOT_WAITING = "This request is not waiting in Plainva any more. Call the tool again.";

/** What a client is told when the plan would not be the one the user said yes to. */
export const MCP_PLAN_CHANGED = "What this would do has changed since the user was asked, so nothing was done. Call the tool again.";

/** How long a client that came back is kept waiting for the user's answer in Plainva before it is told again that input is required. */
export const MCP_PLAN_WAIT_MS = 20_000;

/**
 * More waiting changes of one app than this, and it is told that the user has
 * to decide first — as a full list of drafts tells its writer. A run of the
 * assistant ends by itself; a program that calls in a loop does not.
 */
export const MCP_OPEN_PROPOSALS_MAX = 300;
export const MCP_TOO_MANY_WAITING = "Too many suggestions of this app wait for the user. They have to accept or decline some of them first.";

/** The changes of one writer that still wait on the vault's notes. */
async function waitingChanges(host: AiVaultHost, authorId: string): Promise<number> {
  const open = host.proposals ? await host.proposals().catch(() => []) : [];
  return open.filter((proposal) => proposal.authorId === authorId).reduce((sum, proposal) => sum + proposal.changes, 0);
}

/**
 * Says what an app left once per note and minute: an app that lays down many
 * things in a row is one piece of news, not twenty.
 */
export function quietLeft(left: NonNullable<McpWriting["left"]>, now: () => number = () => Date.now(), quietMs = 60_000): NonNullable<McpWriting["left"]> {
  const said = new Map<string, number>();
  return (what) => {
    const key = JSON.stringify(what.kind === "proposal" ? ["proposal", what.client, what.path] : ["draft", what.client]);
    const at = now();
    const last = said.get(key);
    if (last !== undefined && at - last < quietMs) return;
    said.set(key, at);
    left(what);
  };
}

/**
 * What the main window brings to a call that writes: the session that keeps
 * the drafts and knows the day, the plans that wait, and how the user hears
 * that a program left something. Absent, no tool that writes is served here.
 */
export interface McpWriting {
  session: Pick<AiSession, "outsideWriting">;
  plans: McpPlans;
  /** A program left a suggestion on a note, or a draft: said once, where the user works. Never the text. */
  left?(what: { kind: "proposal"; client: string; path: string } | { kind: "draft"; client: string }): void;
  waitMs?: number;
}

/**
 * The note for the client's own user while a plan waits (the app's language:
 * a person reads it, not a model). It names what the client itself named —
 * the note, the new name, the folder — and nothing the plan found in the
 * vault: which notes link here is for the user's eyes, in Plainva.
 */
function planNote(question: McpPlanQuestion, again: boolean): string {
  const note = question.path.replace(/\.md$/i, "");
  const text =
    question.plan === "rename"
      ? i18n.t("ai.mcp.planNote.rename", { note, title: question.title })
      : question.plan === "move"
        ? question.folder
          ? i18n.t("ai.mcp.planNote.move", { note, folder: question.folder })
          : i18n.t("ai.mcp.planNote.moveRoot", { note })
        : i18n.t("ai.mcp.planNote.delete", { note });
  return again ? `${i18n.t("ai.mcp.planNote.again")} ${text}` : text;
}

const stable = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => (item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : item));

/** Runs one forwarded call against the open vault. */
export async function runMcpCall(host: AiVaultHost | null, request: McpCallRequest, writing?: McpWriting): Promise<McpCallAnswer> {
  if (!host) return failed("Plainva has no vault open.");
  const tool = toolByName(request.tool);
  if (!tool || !tool.surfaces.includes("mcp")) return failed(noTool(request.tool));
  const kind = mcpToolKind(tool);
  // The native side asked the grant at this call and says so. A tool that writes without it is no tool of this client.
  if (kind !== "read" && (request.writes !== true || !writing)) return failed(noTool(request.tool));
  const parsed = parseToolInput(tool, request.args);
  if (!parsed.ok) return failed(parsed.error);
  // An outside client is a recipient like a cloud provider that may reach the internet: a note kept from the cloud, or
  // from conversations with the internet, does not exist for it. What the program does with what it reads is not Plainva's to see.
  const recipient: EgressRecipient = { kind: "cloud", provider: `mcp:${request.client}`, model: request.client };
  const paths = new Set<string>();
  const scope = { inside: (path: string) => insideFolders(path, request.folders), passed: (path: string) => void paths.add(path) };
  const execute = async (run?: WriteRun): Promise<ToolOutcome | null> => {
    const tools = host.tools(recipient, scope, undefined, true, undefined, undefined, run);
    return tools ? tools.executor.execute(tool, parsed.value, { type: "tool_call", id: request.requestId, name: tool.name, args: parsed.value }) : null;
  };
  const answered = (outcome: ToolOutcome | null): McpCallAnswer =>
    outcome ? { content: outcome.content, isError: Boolean(outcome.isError), paths: [...paths], ...(outcome.declined ? { declined: true } : {}) } : failed("This vault offers no tools.");
  try {
    if (kind === "read" || !writing) return answered(await execute());
    // Signed with the app's id and the name the user paired it under — said with what it is, so that a card
    // in a note's margin never reads like a colleague's remark.
    const author = { id: mcpAuthorId(request.clientId), displayName: i18n.t("ai.mcp.author", { client: request.client }) };
    if (kind === "propose") {
      // A draft has its own list, which says when it is full; a suggestion on a note is counted here.
      if (tool.name !== "create_note" && (await waitingChanges(host, author.id)) >= MCP_OPEN_PROPOSALS_MAX) return failed(MCP_TOO_MANY_WAITING);
      // One of a note's own AI rules is the only thing such a tool would have to ask about, and no program sets those: nobody is asked.
      const run = writing.session.outsideWriting(host, author, async () => "nobody");
      const outcome = await execute(run);
      const round = run.writes.rounds[0];
      if (round) writing.left?.({ kind: "proposal", client: request.client, path: round.path });
      else if (run.writes.drafts.length > 0) writing.left?.({ kind: "draft", client: request.client });
      return answered(outcome);
    }
    return await runMcpPlan(host, request, writing, author, stable(parsed.value), execute, answered, paths);
  } catch {
    return failed("The tool failed.");
  }
}

/**
 * A rename, a move or a deletion (stage 2). The first call only finds out
 * what would happen and lays it before the user; the tool itself is told that
 * nobody answered, so it does nothing. The client comes back with the handle
 * and its own user's answer; then the tool runs again, and it is told yes only
 * if the user said yes in Plainva and what it would do now is what they saw.
 */
async function runMcpPlan(
  host: AiVaultHost,
  request: McpCallRequest,
  writing: McpWriting,
  author: { id: string; displayName: string },
  args: string,
  execute: (run?: WriteRun) => Promise<ToolOutcome | null>,
  answered: (outcome: ToolOutcome | null) => McpCallAnswer,
  paths: Set<string>,
): Promise<McpCallAnswer> {
  const { plans, session } = writing;
  const declined: McpCallAnswer = { content: WRITE_REFUSALS.declined, isError: true, paths: [], declined: true };
  if (!request.handle) {
    const asked: { question: PlanQuestion | null } = { question: null };
    const outcome = await execute(
      session.outsideWriting(host, author, async (question) => {
        asked.question = question;
        return "nobody";
      }),
    );
    const question = asked.question;
    // The tool refused before it had anything to ask — no such note, no such folder, a name no note can have: its own answer.
    if (!question || question.plan === "rule") return answered(outcome);
    const handle = plans.open({ clientId: request.clientId, client: request.client, tool: request.tool, args, question, owner: host });
    return { content: "", isError: false, paths: [...paths], pending: { handle, message: planNote(question, false) } };
  }
  const plan = plans.find(request.handle, request.clientId, host);
  // Its own plan, for this very call: a handle is no pass for another one.
  if (!plan || plan.tool !== request.tool || plan.args !== args) return failed(MCP_NOT_WAITING);
  if (request.answer !== "accept") {
    plans.drop(plan.handle);
    return declined;
  }
  const decision = plan.decision ?? (await plans.wait(plan.handle, writing.waitMs ?? MCP_PLAN_WAIT_MS));
  if (decision === null) {
    // Still open in Plainva: the client is told again. A plan that is gone meanwhile does not wait any more.
    return plans.find(plan.handle, request.clientId, host) ? { content: "", isError: false, paths: [], pending: { handle: plan.handle, message: planNote(plan.question, true) } } : failed(MCP_NOT_WAITING);
  }
  plans.drop(plan.handle);
  if (decision === "no") return declined;
  const now = { changed: false };
  const outcome = await execute(
    session.outsideWriting(host, author, async (question) => {
      if (samePlan(question, plan.question)) return "yes";
      now.changed = true;
      return "no";
    }),
  );
  if (now.changed) return failed(MCP_PLAN_CHANGED);
  // Where the note is now is part of the answer: the native side checks that place like every path an answer names.
  if (outcome && !outcome.isError && plan.question.plan !== "delete") paths.add(plan.question.target);
  return answered(outcome);
}

/**
 * One event from the native side, with a stop that cannot throw — the way the
 * tray listeners in `background.ts` do it. Tauri's `unlisten` reaches into the
 * event plugin's internals and rejects where they are missing (the browser
 * the E2E suite runs in, a window that is closing); a rejection there is a
 * page error, and five E2E runs saw exactly that (CI, 2026-09-29).
 */
export function listenQuietly<T>(event: string, handler: (payload: T) => void): () => void {
  let stop: (() => void) | null = null;
  let stopped = false;
  const quiet = (unlisten: () => void) => {
    try {
      void Promise.resolve(unlisten() as unknown).catch(() => undefined);
    } catch {
      // A listener that is already gone is not a problem.
    }
  };
  void import("@tauri-apps/api/event")
    .then(({ listen }) => listen<T>(event, (e) => handler(e.payload)))
    .then((unlisten) => {
      if (stopped) quiet(unlisten);
      else stop = () => quiet(unlisten);
    })
    .catch(() => undefined);
  return () => {
    stopped = true;
    stop?.();
  };
}

/** Answers forwarded calls in the main window; returns the stop function. */
export function listenForMcpCalls(host: () => AiVaultHost | null, writing?: McpWriting): () => void {
  const quiet = writing?.left ? { ...writing, left: quietLeft(writing.left) } : writing;
  return listenQuietly<McpCallRequest>("mcp-call", (payload) => {
    void runMcpCall(host(), payload, quiet).then((answer) => invoke("mcp_call_answer", { requestId: payload.requestId, answer }));
  });
}

/** The vault's name: the last part of its folder path. */
export function vaultName(path: string): string {
  const trimmed = trimSlashes(path);
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
}

/** Tells the native side what to serve: on or off, the open vault, the tools. */
export function configureMcp(enabled: boolean, vault: { path: string; name: string } | null): Promise<void> {
  return invoke("mcp_configure", {
    enabled,
    vault: vault ? { key: aiVaultKey(vault.path), name: vault.name, root: vault.path } : null,
    tools: mcpToolSpecs(),
    // The core skills as prompts (plan P1.5), in the app's language.
    prompts: mcpSkillPrompts((key, vars) => i18n.t(key, vars)),
  });
}

export interface McpPairRequest {
  requestId: string;
  client: string;
  version: string;
  program: string;
  /** Paired before: this asks only for folders of the vault open now. */
  known: boolean;
}

export interface McpClientView {
  id: string;
  name: string;
  program: string;
  createdAt: string;
  lastSeen: string;
  folders: string[];
  /** The user allows this client to propose changes in the vault open now. */
  writes: boolean;
}

export interface McpAuditEntry {
  at: string;
  clientId: string;
  client: string;
  tool: string;
  ok: boolean;
  notes: number;
  /** What became of a call that was not carried out at once: "asked" (a plan waits for the user) or "declined". */
  note?: string;
}

export interface McpStatus {
  running: boolean;
  helperPath: string | null;
  identifier: string;
  clients: McpClientView[];
  audit: McpAuditEntry[];
}

export const mcpStatus = () => invoke<McpStatus>("mcp_status");
export const mcpAnswerPairing = (requestId: string, allow: boolean, folders: string[], writes = false) => invoke("mcp_pair_answer", { requestId, allow, folders, writes });
export const mcpSetFolders = (clientId: string, folders: string[]) => invoke("mcp_set_folders", { clientId, folders });
/** Whether this client may propose changes in the vault open now (stage 2): off until the user switches it on. */
export const mcpSetWrites = (clientId: string, allowed: boolean) => invoke("mcp_set_writes", { clientId, allowed });
export const mcpRevoke = (clientId: string) => invoke("mcp_revoke", { clientId });
export const mcpWritePackage = (target: string) => invoke("mcp_write_package", { target });

/** The folders a pairing can grant: the vault's top-level folders, sorted. */
export function topLevelFolders(all: readonly string[]): string[] {
  const top = new Set<string>();
  for (const folder of all) {
    const first = folder.replace(/^\/+/, "").split("/")[0];
    if (first && !first.startsWith(".")) top.add(first);
  }
  return [...top].sort((a, b) => a.localeCompare(b));
}

/** The command a user pastes into a terminal to add Plainva to Claude Code. */
export function claudeCodeCommand(helperPath: string, identifier: string): string {
  return `claude mcp add plainva -- "${helperPath}" --app ${identifier}`;
}

/** The JSON most MCP clients take in their configuration file. */
export function mcpClientConfig(helperPath: string, identifier: string): string {
  return JSON.stringify({ mcpServers: { plainva: { command: helperPath, args: ["--app", identifier] } } }, null, 2);
}
