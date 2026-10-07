import {
  capMcpText,
  checkMcpAddress,
  hasMcpDrift,
  isMcpExposedToolName,
  mcpExposedToolName,
  mcpIssuesOf,
  mcpOfferedTools,
  mcpServerStanding,
  mcpToolEffect,
  mcpToolStanding,
  validMcpEnvName,
  type McpFailure,
  type McpListing,
  type McpNameIssue,
  type McpServerGrant,
  type McpServerReview,
  type McpToolEffect,
  type McpToolStanding,
} from "@plainva/core";
import type { McpAddProblem } from "./mcpRuntime";
import type { AiMcpServer } from "./mcpSession";
import type { McpAuditEntry } from "./mcpStores";

/**
 * External tools in the settings and in a conversation (plan KI-Harness
 * P4.5), as both shells show them: one model, two dresses. Everything here
 * turns what was decided elsewhere — where a server stands, why a tool is or
 * is not offered, how a look at a server failed — into the lines a person
 * reads. Nothing here decides.
 */

type T = (key: string, vars?: Record<string, unknown>) => string;

/** The state of a server in one line, as its row in the settings says it. */
export function externalStatusText(t: T, server: AiMcpServer): string {
  const standing = mcpServerStanding(server);
  if (standing !== "ready" && standing !== "off") return t(`ai.ext.status.${standing}`);
  const listed = server.snapshot?.tools.length ?? 0;
  const offered = mcpOfferedTools([{ ...server, enabled: true }]).length;
  return `${t(`ai.ext.status.${standing}`)} · ${t("ai.ext.status.tools", { offered, total: listed })}`;
}

/** Whether a server needs the user's look: never checked, registered anew, or blocked. */
export function externalNeedsReview(server: AiMcpServer): boolean {
  const standing = mcpServerStanding(server);
  return standing === "new" || standing === "blocked";
}

export interface ExternalToolRow {
  name: string;
  /** The server's title of the tool, cleaned and cut; its name where it has none. */
  title: string;
  /** What the server says the tool does: cleaned, cut — and shown as the server's words. */
  description: string;
  standing: McpToolStanding;
  /** Granted in this vault (the box is ticked) — for what the tool says it does in this listing. */
  granted: boolean;
  /** The tool can be granted at all: one whose name cannot be offered cannot. */
  grantable: boolean;
  /** What a call can do at the service, as the tool says it. */
  effect: McpToolEffect;
  /** For a tool that does not only read: the sentence that says what a call may do there. Null for one that reads. */
  warning: string | null;
  /** Why it is not offered, or what a person should notice about its name. */
  notes: string[];
}

/** The tools of a listing as the review shows them: each with its standing for this vault and what to notice. */
export function externalToolRows(t: T, server: AiMcpServer, listing: McpListing, grant: McpServerGrant, all: readonly AiMcpServer[]): ExternalToolRow[] {
  const viewed = { ...server, snapshot: listing, grant };
  // Lookalike names are told over all servers of this device, with this one as it is being looked at.
  const issues: McpNameIssue[] = mcpIssuesOf([...all.filter((other) => other.id !== server.id), viewed]);
  return listing.tools.map((tool) => {
    const standing = mcpToolStanding(viewed, tool, issues);
    const effect = mcpToolEffect(tool);
    const notes: string[] = [];
    if (standing === "name" || standing === "header-marks") notes.push(t(`ai.ext.review.standing.${standing}`));
    // Ticked for less than it says it does now: said, so that an unticked box is no riddle.
    if (standing === "not-granted" && grant.tools.includes(tool.name)) notes.push(t("ai.ext.review.effectGrew"));
    for (const issue of issues) {
      if (issue.kind === "like-builtin" && issue.server === server.id && issue.tool === tool.name) notes.push(t("ai.ext.review.likeBuiltin", { tool: issue.builtin }));
      if (issue.kind === "like-other-server" && issue.servers.includes(server.id) && issue.tool === tool.name) notes.push(t("ai.ext.review.likeOther"));
    }
    return {
      name: tool.name,
      title: capMcpText(tool.title, 80).text || tool.name,
      description: capMcpText(tool.description, 600).text,
      standing,
      // Ticked means offered: a tool that was ticked while it only read, and says more now, shows unticked again.
      granted: standing === "offered",
      grantable: standing === "offered" || standing === "not-granted",
      effect,
      warning: effect === "reads" ? null : t(`ai.ext.review.effect.${effect}`, { server: server.label }),
      notes,
    };
  });
}

/** What a blocked server's listing differs in, as lines. */
export function externalDriftLines(t: T, review: McpServerReview): string[] {
  if (review.status !== "blocked" || !hasMcpDrift(review.drift)) return [];
  const { drift } = review;
  const lines: string[] = [];
  const names = (list: readonly string[]) => list.slice(0, 12).join(", ") + (list.length > 12 ? " …" : "");
  if (drift.instructions) lines.push(t("ai.ext.drift.instructions"));
  for (const [what, part] of [
    ["tools", drift.tools],
    ["prompts", drift.prompts],
  ] as const) {
    if (part.changed.length) lines.push(t(`ai.ext.drift.${what}Changed`, { names: names(part.changed) }));
    if (part.added.length) lines.push(t(`ai.ext.drift.${what}Added`, { names: names(part.added) }));
    if (part.removed.length) lines.push(t(`ai.ext.drift.${what}Removed`, { names: names(part.removed) }));
  }
  if (drift.promptBodies.length) lines.push(t("ai.ext.drift.promptBody"));
  return lines;
}

/** Why a look at a server failed, in the user's language. A server's own error text is never part of it. */
export function externalFailureText(t: T, failure: McpFailure): string {
  switch (failure.kind) {
    case "http":
      return t("ai.ext.failure.http", { status: failure.status });
    case "auth":
      return t(failure.status === 403 ? "ai.ext.failure.forbidden" : "ai.ext.failure.auth");
    case "unreachable":
      // A program that did not start names why in one of a few fixed words.
      if (failure.detail === "program-moved") return t("ai.ext.failure.programMoved");
      if (failure.detail === "sandbox-unavailable") return t("ai.ext.failure.sandboxUnavailable");
      if (failure.detail === "start-failed" || failure.detail === "already-running") return t("ai.ext.failure.startFailed");
      return t(failure.detail === "tls" ? "ai.ext.failure.tls" : "ai.ext.failure.unreachable");
    case "rpc":
      return t("ai.ext.failure.rpc", { code: failure.code });
    case "too-large":
      return t("ai.ext.failure.tooLarge");
    case "input-required":
      return t("ai.ext.failure.protocol");
    default:
      return t(`ai.ext.failure.${failure.kind}`);
  }
}

/** Why a server could not be added. Null where the user said no in the native dialog: that needs no message. */
export function externalAddProblemText(t: T, problem: McpAddProblem): string | null {
  if (problem.kind === "declined") return null;
  if (problem.kind === "name") return t("ai.ext.add.problem.name");
  if (problem.kind === "address") return t(`ai.ext.add.problem.${problem.problem}`);
  return t(problem.detail === "program-not-found" ? "ai.ext.add.problem.programNotFound" : "ai.ext.add.problem.refused");
}

/** What the address field says while it is typed: nothing while it is empty or fine. */
export function externalAddressHint(t: T, raw: string): string | null {
  if (!raw.trim()) return null;
  const address = checkMcpAddress(raw);
  return address.ok ? null : t(`ai.ext.add.problem.${address.problem}`);
}

/** Lines of a text field as a list: one argument per line, as it is, without the empty ones. */
export function externalLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim() !== "");
}

/**
 * The values a program needs, typed one per line as `NAME=value`. The names
 * go into the registry and are shown; the values go into the keychain.
 */
export function externalEnv(text: string): { names: string[]; values: Record<string, string>; bad: string | null } {
  const names: string[] = [];
  const values: Record<string, string> = {};
  for (const line of externalLines(text)) {
    const at = line.indexOf("=");
    const name = (at === -1 ? line : line.slice(0, at)).trim();
    if (!validMcpEnvName(name) || names.some((known) => known.toUpperCase() === name.toUpperCase())) return { names: [], values: {}, bad: name || line };
    names.push(name);
    if (at !== -1 && line.slice(at + 1).trim()) values[name] = line.slice(at + 1).trim();
  }
  return { names, values, bad: null };
}

const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "cmd", "powershell", "pwsh", "sudo", "doas", "curl", "wget", "env"]);

/** A command that starts a shell or fetches something first deserves a second look; the form says so. */
export function externalRiskyProgram(program: string): boolean {
  const base = program.trim().split(/[\\/]/).pop() ?? "";
  return SHELLS.has(base.toLowerCase().replace(/\.(exe|cmd|bat)$/, ""));
}

export type ExternalFolders = "none" | "some" | "all";

/** What a grant lets a server be given from the vault, as the three choices of the review. */
export function externalFolders(grant: McpServerGrant): ExternalFolders {
  if (grant.folders.includes("")) return "all";
  return grant.folders.length ? "some" : "none";
}

/** A grant with another choice of folders; "some" keeps the folders that were ticked before. */
export function withExternalFolders(grant: McpServerGrant, choice: ExternalFolders, folders: readonly string[]): McpServerGrant {
  if (choice === "all") return { ...grant, folders: [""] };
  if (choice === "none") return { ...grant, folders: [] };
  return { ...grant, folders: [...new Set(folders.filter((folder) => folder !== ""))] };
}

/** The folders of a vault a grant can name: its top level, without the hidden ones. */
export function externalTopFolders(all: readonly string[]): string[] {
  const top = new Set<string>();
  for (const folder of all) {
    const first = folder.replace(/^\/+/, "").split("/")[0];
    if (first && !first.startsWith(".")) top.add(first);
  }
  return [...top].sort((a, b) => a.localeCompare(b));
}

/** One argument as a person reads it in a command line: quoted where it would otherwise read as two. */
const shownArg = (arg: string) => (arg === "" || /[\s"]/.test(arg) ? JSON.stringify(arg) : arg);

/** A value a server has stored on this device: a remote server's token (no name), or one of a program's environment. */
export interface ExternalSecret {
  /** Null for the token of a remote server. */
  name: string | null;
  stored: boolean;
}

/** The values a server can have in the keychain. Whether one is stored is all anybody learns of it. */
export function externalSecrets(server: AiMcpServer): ExternalSecret[] {
  const stored = new Set(server.registered.stored);
  if (server.registered.kind === "http") return [{ name: null, stored: stored.has("") }];
  return server.registered.env.map((name) => ({ name, stored: stored.has(name) }));
}

export interface ExternalFact {
  label: string;
  lines: string[];
  /** The value is the server's address or command: shown as it is, in a fixed-width face. */
  code?: boolean;
}

/**
 * What a review says of a server before its texts: where requests go or what
 * is started — exactly what was confirmed natively —, how it is started, and
 * what the server calls itself (its own words, cleaned and cut).
 */
export function externalFacts(t: T, server: AiMcpServer, seen: { name: string; version: string } | null): ExternalFact[] {
  const { registered } = server;
  const facts: ExternalFact[] = [];
  if (registered.kind === "http") facts.push({ label: t("ai.ext.add.address"), lines: [registered.url ?? ""], code: true });
  else {
    facts.push({ label: t("ai.ext.review.command"), lines: [[registered.program ?? "", ...registered.args.map(shownArg)].join(" ")], code: true });
    facts.push({ label: t("ai.ext.review.start"), lines: [t(registered.sandbox ? "ai.ext.review.sandboxOn" : "ai.ext.review.sandboxOff")] });
  }
  const name = seen ? capMcpText(seen.name, 80).text : "";
  if (seen) facts.push({ label: t("ai.ext.review.self"), lines: [`${name || server.id} · MCP ${capMcpText(seen.version, 32).text || "?"}`] });
  return facts;
}

/** A prompt a server offers, as the conversation lists it. */
export interface ExternalPrompt {
  serverId: string;
  server: string;
  name: string;
  title: string;
  description: string;
  args: { name: string; description: string; required: boolean }[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The prompts of the servers that are ready in this vault. Their texts are the servers' own: cleaned and cut. */
export function externalPrompts(servers: readonly AiMcpServer[]): ExternalPrompt[] {
  const out: ExternalPrompt[] = [];
  for (const server of servers) {
    if (mcpServerStanding(server) !== "ready" || !server.snapshot) continue;
    for (const prompt of server.snapshot.prompts.slice(0, 24)) {
      const args = (Array.isArray(prompt.arguments) ? prompt.arguments : [])
        .filter((arg): arg is Record<string, unknown> => isRecord(arg) && typeof arg.name === "string" && arg.name.length > 0 && arg.name.length <= 64 && capMcpText(arg.name, 64).text === arg.name)
        .slice(0, 8)
        .map((arg) => ({ name: arg.name as string, description: capMcpText(arg.description, 200).text, required: arg.required === true }));
      out.push({ serverId: server.id, server: server.label, name: prompt.name, title: capMcpText(prompt.title, 60).text || prompt.name, description: capMcpText(prompt.description, 200).text, args });
    }
  }
  return out;
}

/**
 * The foreign tools this device knows, by the names a model calls them: from
 * the listings that were approved, wherever their servers stand now. A step
 * of last week keeps its name when its server was switched off or blocked
 * since; only a server that is gone leaves a tool without one.
 */
function knownForeignTools(servers: readonly AiMcpServer[]): Map<string, { server: string; title: string }> {
  const known = new Map<string, { server: string; title: string }>();
  for (const server of servers) {
    for (const tool of server.snapshot?.tools ?? []) known.set(mcpExposedToolName(server.id, tool.name), { server: server.label, title: capMcpText(tool.title, 80).text || tool.name });
  }
  return known;
}

/** The label of a foreign tool in a conversation: the user's name for the server and the server's name for the tool. */
export function externalToolLabel(t: T, exposed: string, servers: readonly AiMcpServer[]): string | null {
  if (!isMcpExposedToolName(exposed)) return null;
  const tool = knownForeignTools(servers).get(exposed);
  return tool ? `${tool.server} · ${tool.title}` : t("ai.ext.toolUnknown");
}

/** The further tools of a conversation that are foreign ones, counted per server — for the send overview. */
export function externalOverviewLines(t: T, more: readonly string[], servers: readonly AiMcpServer[]): string[] {
  const counts = new Map<string, number>();
  let unknown = 0;
  const known = knownForeignTools(servers);
  for (const name of more) {
    if (!isMcpExposedToolName(name)) continue;
    const tool = known.get(name);
    if (tool) counts.set(tool.server, (counts.get(tool.server) ?? 0) + 1);
    else unknown++;
  }
  const lines = [...counts].map(([server, count]) => t("ai.ext.overviewTools", { n: count, server }));
  if (unknown) lines.push(t("ai.ext.overviewOther", { n: unknown }));
  return lines;
}

/** The log of calls of a vault, newest first, as lines. */
export function externalAuditLines(t: T, entries: readonly McpAuditEntry[], serverId: string, locale: string): { key: string; text: string }[] {
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  return entries
    .filter((entry) => entry.server === serverId)
    .slice(-30)
    .reverse()
    .map((entry, index) => {
      const at = new Date(entry.at);
      return { key: `${entry.at}-${index}`, text: `${Number.isNaN(at.getTime()) ? entry.at : time.format(at)} · ${entry.tool} · ${t(`ai.ext.outcome.${entry.outcome}`)}` };
    });
}
