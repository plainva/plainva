import { useEffect, useState } from "react";
import { asMcpError, mcpServerStanding, type McpFailure, type McpListing, type McpSandboxInfo, type McpServerGrant } from "@plainva/core";
import type { AiSession } from "./aiSession";
import {
  externalAddProblemText,
  externalAddressHint,
  externalEnv,
  externalFolders,
  externalLines,
  externalRiskyProgram,
  externalToolRows,
  withExternalFolders,
  type ExternalFolders,
  type ExternalToolRow,
} from "./externalTools";
import type { McpInspection } from "./mcpRuntime";
import type { AiMcpServer } from "./mcpSession";
import type { McpAuditEntry } from "./mcpStores";

/**
 * The two dialogs of external tools (plan KI-Harness P4.5) as both shells
 * show them: adding a server and reviewing one. The state lives here; the
 * desktop dresses it as a modal, the phone as a sheet.
 */

type T = (key: string, vars?: Record<string, unknown>) => string;

/* ---- adding a server ------------------------------------------------------------------------ */

export type ExternalKind = "address" | "program";

export interface ExternalAddForm {
  kind: ExternalKind;
  setKind(kind: ExternalKind): void;
  name: string;
  setName(value: string): void;
  url: string;
  setUrl(value: string): void;
  token: string;
  setToken(value: string): void;
  program: string;
  setProgram(value: string): void;
  /** One argument per line. */
  args: string;
  setArgs(value: string): void;
  /** One `NAME=value` per line. */
  env: string;
  setEnv(value: string): void;
  sandbox: boolean;
  setSandbox(on: boolean): void;
  /** What this computer can lock a program into; null until it is known, and where programs are no servers. */
  sandboxInfo: McpSandboxInfo | null;
  /** What is wrong with the address as it is typed. */
  addressHint: string | null;
  /** A line of the environment values that cannot be used. */
  envProblem: string | null;
  /** The command starts a shell or fetches something first. */
  risky: boolean;
  /** Why the last attempt did not add the server. */
  problem: string | null;
  busy: boolean;
  /** Everything needed is typed and nothing typed is wrong. */
  ready: boolean;
  /** Adds the server — the native side asks once more. Resolves to its id, or null when nothing was added. */
  submit(): Promise<string | null>;
}

export function useExternalAdd(session: AiSession, t: T, programs: boolean): ExternalAddForm {
  const [kind, setKindState] = useState<ExternalKind>("address");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [program, setProgram] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [sandboxChoice, setSandbox] = useState<boolean | null>(null);
  const [sandboxInfo, setSandboxInfo] = useState<McpSandboxInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!programs) return;
    let alive = true;
    void session.mcp.sandbox().then(
      (info) => {
        if (alive) setSandboxInfo(info);
      },
      () => {
        if (alive) setSandboxInfo({ kind: "none", works: false });
      },
    );
    return () => {
      alive = false;
    };
  }, [session, programs]);

  const parsed = externalEnv(env);
  const addressHint = kind === "address" ? externalAddressHint(t, url) : null;
  const envProblem = kind === "program" && parsed.bad !== null ? t("ai.ext.add.envBad", { name: parsed.bad }) : null;
  // A sandbox that works is used unless the user says otherwise; one that does not is never claimed.
  const sandbox = Boolean(sandboxInfo?.works) && (sandboxChoice ?? true);
  const ready = name.trim() !== "" && (kind === "address" ? url.trim() !== "" && addressHint === null : program.trim() !== "" && envProblem === null);

  const submit = async (): Promise<string | null> => {
    if (!ready || busy) return null;
    setBusy(true);
    setProblem(null);
    try {
      const text = {
        title: t("ai.ext.add.confirmTitle"),
        message: t(kind === "address" ? "ai.ext.add.confirmAddress" : "ai.ext.add.confirmProgram"),
        confirm: t("ai.add.confirmAction"),
        cancel: t("common.cancel"),
      };
      const result =
        kind === "address"
          ? await session.mcp.addHttp(name, url, token, text)
          : await session.mcp.addProgram(name, { program: program.trim(), args: externalLines(args), env: parsed.names, sandbox }, parsed.values, text);
      if (result.ok) return result.id;
      setProblem(externalAddProblemText(t, result.problem));
      return null;
    } finally {
      setBusy(false);
    }
  };

  return {
    kind,
    setKind: (next) => {
      setKindState(next);
      setProblem(null);
    },
    name,
    setName,
    url,
    setUrl,
    token,
    setToken,
    program,
    setProgram,
    args,
    setArgs,
    env,
    setEnv,
    sandbox,
    setSandbox,
    sandboxInfo,
    addressHint,
    envProblem,
    risky: kind === "program" && externalRiskyProgram(program),
    problem,
    busy,
    ready,
    submit,
  };
}

/* ---- reviewing a server --------------------------------------------------------------------- */

export type ExternalLook =
  | { state: "loading" }
  | { state: "failed"; failure: McpFailure }
  | { state: "ready"; inspection: McpInspection };

export interface ExternalReviewModel {
  /** The server as it stands now; null once it is gone. */
  server: AiMcpServer | null;
  look: ExternalLook;
  /** Asks the server again. */
  retry(): void;
  /** What the review shows: what the server lists now — or, while it cannot be reached, what was approved. */
  listing: McpListing | null;
  rows: ExternalToolRow[];
  /** This vault's choices as they are being made. */
  enabled: boolean;
  grant: McpServerGrant;
  folders: ExternalFolders;
  setEnabled(on: boolean): void;
  toggleTool(name: string, on: boolean): void;
  setFolders(choice: ExternalFolders): void;
  toggleFolder(folder: string, on: boolean): void;
  /** What is shown has to be approved before anything of this server is offered. */
  needsApproval: boolean;
  /** It can be approved: the server answered, and what it lists can be kept. */
  canApprove: boolean;
  /** The vault's choices differ from what is stored. */
  dirty: boolean;
  busy: boolean;
  /** Approves what is shown (where it needs it) and stores this vault's choices. False when the approval did not take. */
  save(): Promise<boolean>;
  /** The calls of this vault's log, all servers. */
  audit: McpAuditEntry[];
  /** What a program wrote to its error stream; null until it was asked for. */
  log: string | null;
  showLog(): void;
  /** Stores a value in the keychain — an empty one deletes it — and asks the server again. */
  setSecret(name: string | null, value: string): Promise<void>;
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

export function useExternalReview(session: AiSession, servers: readonly AiMcpServer[], serverId: string, t: T): ExternalReviewModel {
  const server = servers.find((entry) => entry.id === serverId) ?? null;
  const [attempt, setAttempt] = useState(0);
  const [look, setLook] = useState<ExternalLook>({ state: "loading" });
  const [approved, setApproved] = useState(false);
  // What the user changed here and did not store yet. `choice` is kept apart from the grant: "chosen folders" with
  // none ticked yet grants what "none" grants, and is still another answer on the screen.
  const [edit, setEdit] = useState<{ enabled?: boolean; grant?: McpServerGrant; choice?: ExternalFolders; kept?: string[] }>({});
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState<McpAuditEntry[]>([]);
  const [log, setLog] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    let alive = true;
    void session.mcp.inspect(serverId, abort.signal).then(
      (inspection) => {
        if (alive) setLook({ state: "ready", inspection });
      },
      (error: unknown) => {
        if (alive) setLook({ state: "failed", failure: asMcpError(error).failure });
      },
    );
    return () => {
      alive = false;
      abort.abort();
    };
  }, [session, serverId, attempt]);

  useEffect(() => {
    let alive = true;
    void session.mcp.audit().then(
      (entries) => {
        if (alive) setAudit(entries);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [session, serverId]);

  const retry = () => {
    setLook({ state: "loading" });
    setApproved(false);
    setAttempt((count) => count + 1);
  };

  // A server nobody approved yet is proposed for this vault: it was added to be used here.
  const proposed = server ? server.enabled || mcpServerStanding(server) === "new" : false;
  const enabled = edit.enabled ?? proposed;
  const grant: McpServerGrant = edit.grant ?? server?.grant ?? { tools: [], folders: [], dataClasses: [], hosts: [] };
  const listing = look.state === "ready" ? look.inspection.listing : (server?.snapshot ?? null);
  const needsApproval = look.state === "ready" ? look.inspection.review.status !== "approved" && !approved : server !== null && mcpServerStanding(server) !== "ready" && mcpServerStanding(server) !== "off";
  const canApprove = look.state === "ready" && !look.inspection.tooLarge;
  const dirty = server !== null && (enabled !== server.enabled || !sameList(grant.tools, server.grant.tools) || !sameList(grant.folders, server.grant.folders));


  const save = async (): Promise<boolean> => {
    if (!server || busy) return false;
    setBusy(true);
    try {
      if (needsApproval) {
        if (look.state !== "ready" || !(await session.mcp.approve(server.id, look.inspection.listing))) return false;
        setApproved(true);
      }
      // A grant names tools the listing has: one that left it is not granted again when it comes back.
      const names = new Set((listing?.tools ?? []).map((tool) => tool.name));
      await session.mcp.setVault(server.id, { enabled, grant: { ...grant, tools: grant.tools.filter((name) => names.has(name)) } });
      setEdit({});
      return true;
    } finally {
      setBusy(false);
    }
  };

  return {
    server,
    look,
    retry,
    listing,
    rows: server && listing ? externalToolRows(t, server, listing, grant, servers) : [],
    enabled,
    grant,
    folders: edit.choice ?? externalFolders(grant),
    setEnabled: (on) => setEdit((before) => ({ ...before, enabled: on })),
    toggleTool: (name, on) => {
      const tools = on ? [...new Set([...grant.tools, name])] : grant.tools.filter((entry) => entry !== name);
      setEdit((before) => ({ ...before, grant: { ...grant, tools } }));
    },
    // "Chosen folders" brings back the folders that were ticked before another choice was tried.
    setFolders: (choice) => {
      const ticked = grant.folders.filter((folder) => folder !== "");
      const kept = ticked.length ? ticked : (edit.kept ?? []);
      setEdit((before) => ({ ...before, choice, kept, grant: withExternalFolders(grant, choice, kept) }));
    },
    toggleFolder: (folder, on) => {
      const ticked = grant.folders.filter((entry) => entry !== "" && entry !== folder);
      const kept = on ? [...ticked, folder] : ticked;
      setEdit((before) => ({ ...before, choice: "some", kept, grant: withExternalFolders(grant, "some", kept) }));
    },
    needsApproval,
    canApprove,
    dirty,
    busy,
    save,
    audit,
    log,
    showLog: () => {
      void session.mcp.programLog(serverId).then(setLog, () => setLog(""));
    },
    setSecret: async (name, value) => {
      await session.mcp.setSecret(serverId, name, value);
      retry();
    },
  };
}
