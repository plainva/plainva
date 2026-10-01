import { invoke } from "@tauri-apps/api/core";
import { parseToolInput, toolByName, toolInputJsonSchema, toolsFor, withinFolders, type EgressRecipient } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { aiVaultKey, mcpSkillPrompts, type AiVaultHost } from "@plainva/ui";

/**
 * The main window's side of Plainva's MCP server (plan KI-Harness §17.3,
 * ADR 0022). The native side admits a client, checks the paths it names and
 * hands each call here; this module runs it with the assistant's own tools —
 * the same hard gate, the `plainva.ai` rules as for any cloud recipient —
 * narrowed to the folders that client was given, and reports every path that
 * passed, which the native side checks once more before the client sees
 * anything. Read-only: the MCP surface holds no tool that writes.
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
}

export interface McpCallAnswer {
  content: string;
  isError: boolean;
  /** Every vault path that passed the gate while the call ran: the answer names no other. */
  paths: string[];
}

const failed = (content: string): McpCallAnswer => ({ content, isError: true, paths: [] });

/** Runs one forwarded call against the open vault. */
export async function runMcpCall(host: AiVaultHost | null, request: McpCallRequest): Promise<McpCallAnswer> {
  if (!host) return failed("Plainva has no vault open.");
  const tool = toolByName(request.tool);
  if (!tool || !tool.surfaces.includes("mcp")) return failed(`There is no tool called ${request.tool}.`);
  const parsed = parseToolInput(tool, request.args);
  if (!parsed.ok) return failed(parsed.error);
  // An outside client is a recipient like a cloud provider: a note kept from the cloud stays hidden from it too.
  const recipient: EgressRecipient = { kind: "cloud", provider: `mcp:${request.client}`, model: request.client };
  const paths = new Set<string>();
  const tools = host.tools(recipient, { inside: (path) => insideFolders(path, request.folders), passed: (path) => paths.add(path) });
  if (!tools) return failed("This vault offers no tools.");
  try {
    const outcome = await tools.executor.execute(tool, parsed.value, { type: "tool_call", id: request.requestId, name: tool.name, args: parsed.value });
    return { content: outcome.content, isError: Boolean(outcome.isError), paths: [...paths] };
  } catch {
    return failed("The tool failed.");
  }
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
export function listenForMcpCalls(host: () => AiVaultHost | null): () => void {
  return listenQuietly<McpCallRequest>("mcp-call", (payload) => {
    void runMcpCall(host(), payload).then((answer) => invoke("mcp_call_answer", { requestId: payload.requestId, answer }));
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
}

export interface McpAuditEntry {
  at: string;
  clientId: string;
  client: string;
  tool: string;
  ok: boolean;
  notes: number;
}

export interface McpStatus {
  running: boolean;
  helperPath: string | null;
  identifier: string;
  clients: McpClientView[];
  audit: McpAuditEntry[];
}

export const mcpStatus = () => invoke<McpStatus>("mcp_status");
export const mcpAnswerPairing = (requestId: string, allow: boolean, folders: string[]) => invoke("mcp_pair_answer", { requestId, allow, folders });
export const mcpSetFolders = (clientId: string, folders: string[]) => invoke("mcp_set_folders", { clientId, folders });
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
