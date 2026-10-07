import {
  DEFAULT_AI_POLICY,
  ENCRYPTED_WORKSPACE_AI_POLICY,
  effectivePolicy,
  notePolicyFrom,
  readFrontmatterPath,
  scriptedAcpAgent,
  type AcpMcpServer,
  type AcpNativeHost,
  type AcpRegisteredAgent,
  type EndpointConfirmText,
  type FolderPolicyRule,
  type ScriptedAcpAgent,
  type ScriptedAcpOptions,
} from "@plainva/core";
import { AiAcp, createAcpDeviceStore, createAcpVaultStore, type AcpVaultAccess, type AcpVaultSide, type AiAcpHost, type AiAcpState, type AiFileStore } from "@plainva/ui";
import { memoryFiles } from "./mcpTestHost";

/**
 * External agents for tests (plan KI-Harness P4.6): the native side in
 * memory — a registry behind a "dialog" the test answers, programs that are
 * "installed", a terminal that ends with a number — and, where the real
 * shell starts a program, the scripted agent of the core package. Every start
 * is a new process: the test says what each one does.
 */
export interface ScriptedAcpNative {
  native: AcpNativeHost;
  /** What is registered, as the native dialog confirmed it. */
  registry: AcpRegisteredAgent[];
  /** Programs that are "installed": a bare name and the file it means. */
  installed: Record<string, string>;
  /** What the native dialog was shown, in order. */
  shown: { id: string; program: string; args: string[]; text: EndpointConfirmText }[];
  /** The user's answer in the native dialog. */
  confirm: boolean;
  /** What the native dialog before a start was shown, in order: it asks once per agent and folder. */
  startAsked: { agentId: string; root: string; text: EndpointConfirmText }[];
  /** The user's answer in that dialog. */
  confirmStart: boolean;
  /** Where the user said yes to a start: an agent's id and the folder. */
  startsAllowed: Set<string>;
  /** Every process that was started, in order. */
  processes: { agentId: string; root: string; agent: ScriptedAcpAgent }[];
  /** Every terminal that was opened for a sign-in. */
  logins: { agentId: string; root: string; args: string[]; env: Record<string, string> }[];
  /** What a terminal ends with: the program's number, or the native side's word for why there was none. */
  login: number | string;
  /** A sign-in in a terminal went through: the next process is signed in. */
  signedIn: boolean;
  /** The registry does not answer: a browser build, a broken store. */
  broken: boolean;
  cancelled: number;
  lastWords: string;
}

/** What a process does: asked at every start, with how many came before it and whether a sign-in went through. */
export type AcpScript = (start: { index: number; signedIn: boolean }) => ScriptedAcpOptions;

export function scriptedAcpNative(script: AcpScript = () => ({})): ScriptedAcpNative {
  const state: ScriptedAcpNative = {
    native: null as unknown as AcpNativeHost,
    registry: [],
    installed: {},
    shown: [],
    confirm: true,
    startAsked: [],
    confirmStart: true,
    startsAllowed: new Set(),
    processes: [],
    logins: [],
    login: 0,
    signedIn: false,
    broken: false,
    cancelled: 0,
    lastWords: "",
  };
  state.native = {
    async agents() {
      if (state.broken) throw new Error("no native side");
      // The native registry lists its entries by id, whatever order they were added in.
      return state.registry.map((agent) => ({ ...agent, args: [...agent.args] })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
    async detect(programs) {
      return programs.map((name) => state.installed[name] ?? null);
    },
    async add(agentId, command, text) {
      // The native side resolves a bare name to the file it means before it shows it.
      const program = state.installed[command.program] ?? command.program;
      state.shown.push({ id: agentId, program, args: [...command.args], text });
      if (!command.program.trim()) throw new Error("not a program");
      if (!state.confirm) return false;
      state.registry = [...state.registry.filter((agent) => agent.id !== agentId), { id: agentId, program, args: [...command.args] }];
      return true;
    },
    async remove(agentId) {
      state.registry = state.registry.filter((agent) => agent.id !== agentId);
      // A yes to a start was for the command that stood there.
      for (const key of [...state.startsAllowed]) if (key.startsWith(`${agentId}\n`)) state.startsAllowed.delete(key);
    },
    port(agentId, root, text) {
      let agent: ScriptedAcpAgent | null = null;
      return {
        async start(onLine, onExit) {
          if (!state.registry.some((entry) => entry.id === agentId)) throw new Error("not-registered");
          // The native side asks before the first start in a folder since the app started, and remembers a yes.
          const key = `${agentId}\n${root}`;
          if (!state.startsAllowed.has(key)) {
            state.startAsked.push({ agentId, root, text });
            if (!state.confirmStart) throw new Error("declined");
            state.startsAllowed.add(key);
          }
          agent = scriptedAcpAgent(script({ index: state.processes.length, signedIn: state.signedIn }));
          state.processes.push({ agentId, root, agent });
          await agent.port.start(onLine, onExit);
        },
        write: (line) => (agent ? agent.port.write(line) : Promise.reject(new Error("the agent is not running"))),
        stop: () => (agent ? agent.port.stop() : Promise.resolve()),
      };
    },
    async log() {
      return state.lastWords;
    },
    async login(agentId, root, args, env) {
      // As the native side: no terminal for an agent whose start in this folder nobody confirmed.
      if (!state.startsAllowed.has(`${agentId}\n${root}`)) throw new Error("start-failed");
      state.logins.push({ agentId, root, args: [...args], env: { ...env } });
      if (typeof state.login === "string") throw new Error(state.login);
      if (state.login === 0) state.signedIn = true;
      return state.login;
    },
    async cancelLogin() {
      state.cancelled++;
    },
  };
  return state;
}

export const ROOT = "/home/mara/Vault";

/** The last entry of a list — the desktop's compiler target has no `Array.prototype.at`. */
export const lastOf = <T,>(list: readonly T[]): T | undefined => list[list.length - 1];

/** The vault's notes: two a cloud may read, one that is kept from it by its own rule, one in a folder kept from it. */
export const AGENT_NOTES: Record<string, string> = {
  "Projects/Plan.md": "# Plan\n\nShip the first draft in May.\n\nThen gather feedback.\n",
  "Projects/Notes.md": "---\ntags: [project]\n---\n# Notes\n\nSee https://example.com/spec for the outline.\n",
  "Health/Results.md": "---\nplainva:\n  ai:\n    cloud: deny\n---\n# Results\n\nPrivate.\n",
  "Journal/2026-10-07.md": "# Wednesday\n\n- 09:00 Standup\n",
  "Data/table.base": "views: []\n",
};

export interface MemoryAcpVault {
  side: AcpVaultSide;
  files: Map<string, string>;
  /** Every suggestion round that was written, in order. */
  proposed: Parameters<AcpVaultAccess["propose"]>[0][];
  /** Every note that was created, in order. */
  created: string[];
  /** What was asked of the vault: the paths that were read. */
  reads: string[];
  /** The note open in the shell. */
  active: string | null;
  encrypted: boolean;
  /** Proposing fails: the note's margin is busy, or the vault has none. */
  marginFails: boolean;
  appFiles: AiFileStore & { files: Map<string, string> };
}

/** A vault in memory, with the real rules: a note's own in its frontmatter, a folder's in `rules`. */
export function memoryAcpVault(notes: Record<string, string> = AGENT_NOTES, rules: FolderPolicyRule[] = [{ folder: "Journal/", cloud: "deny" }], root = ROOT): MemoryAcpVault {
  const appFiles = memoryFiles();
  const vault: MemoryAcpVault = { side: null as unknown as AcpVaultSide, files: new Map(Object.entries(notes)), proposed: [], created: [], reads: [], active: null, encrypted: false, marginFails: false, appFiles };
  const access: AcpVaultAccess = {
    root,
    async read(path) {
      vault.reads.push(path);
      return vault.files.get(path) ?? null;
    },
    async list(folder) {
      const prefix = folder ? `${folder}/` : "";
      const names = new Set<string>();
      for (const path of vault.files.keys()) {
        if (path.startsWith(prefix)) names.add(path.slice(prefix.length).split("/")[0]!);
      }
      return names.size ? [...names] : folder ? null : [];
    },
    async policyOf(path, text) {
      const content = text ?? vault.files.get(path) ?? "";
      const plainva = readFrontmatterPath(content, ["plainva"]);
      return effectivePolicy(path, notePolicyFrom(plainva === undefined ? {} : { plainva }), rules, vault.encrypted ? ENCRYPTED_WORKSPACE_AI_POLICY : DEFAULT_AI_POLICY);
    },
    async propose(round) {
      if (vault.marginFails) throw new Error("comment-operation-running");
      vault.proposed.push(round);
    },
    async create(path, content) {
      if (vault.files.has(path)) throw new Error("a file is there already");
      vault.files.set(path, content);
      vault.created.push(path);
    },
    encrypted: () => vault.encrypted,
  };
  vault.side = { access, store: createAcpVaultStore(appFiles, "vault-one"), activeNote: () => vault.active };
  return vault;
}

export interface AcpHarness {
  agents: AiAcp;
  native: ScriptedAcpNative;
  vault: MemoryAcpVault;
  /** Every state that was published, in order. */
  states: AiAcpState[];
  state(): AiAcpState;
  /** The process that runs, or ran last. */
  agent(): ScriptedAcpAgent;
  /** What Plainva's own tools are for the agent; null while they are switched off. */
  toolbox: AcpMcpServer | null;
  deviceFiles: AiFileStore & { files: Map<string, string> };
  /** Tells a listener about every state that is published — what a surface subscribes to. */
  subscribe(listener: () => void): () => void;
  /** Lets everything that is queued run. */
  settle(): Promise<void>;
}

const NOW = new Date("2026-10-07T10:00:00Z");

/** The texts the session writes itself, as keys with their values: a test reads what was meant. */
export const acpLabel = (key: string, vars?: Record<string, string>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key);

/** The controller over a scripted native side and a vault in memory, with one agent added ("gemini") unless the test adds its own. */
export async function acpHarness(
  script: AcpScript = () => ({}),
  options: { vault?: MemoryAcpVault | null; add?: boolean; toolbox?: AcpMcpServer | null; label?: (key: string, vars?: Record<string, string>) => string } = {},
): Promise<AcpHarness> {
  const native = scriptedAcpNative(script);
  native.installed = { gemini: "/usr/bin/gemini", "codex-acp": "/usr/local/bin/codex-acp" };
  const deviceFiles = memoryFiles();
  const states: AiAcpState[] = [];
  const harness = { toolbox: options.toolbox === undefined ? null : options.toolbox } as AcpHarness;
  const host: AiAcpHost = {
    native: native.native,
    store: createAcpDeviceStore(deviceFiles),
    version: async () => "0.9.0",
    toolbox: async () => harness.toolbox,
  };
  const listeners = new Set<() => void>();
  const agents = new AiAcp(host, { now: () => NOW, later: (run) => run() }, options.label ?? acpLabel, (state) => {
    states.push(state);
    for (const listener of [...listeners]) listener();
  });
  const vault = options.vault === undefined ? memoryAcpVault() : options.vault;
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  Object.assign(harness, {
    agents,
    native,
    vault: vault as MemoryAcpVault,
    states,
    state: () => agents.state,
    agent: () => native.processes[native.processes.length - 1]!.agent,
    deviceFiles,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    settle,
  });
  agents.attach(vault ? vault.side : null);
  await settle();
  if (options.add !== false) {
    await agents.add("Gemini CLI", { program: "gemini", args: ["--acp"] }, { title: "Add", message: "Trust it?", confirm: "Add", cancel: "Cancel" });
    await settle();
  }
  return harness;
}
