import {
  scriptedMcpHttpPort,
  scriptedMcpStdioPort,
  type EndpointConfirmText,
  type McpNativeHost,
  type McpProgramSpec,
  type McpRegisteredServer,
  type ScriptedHttpPort,
  type ScriptedMcpServer,
  type ScriptedStdioPort,
} from "@plainva/core";
import type { AiFileStore } from "@plainva/ui";

/**
 * The native side of foreign MCP servers for tests (plan KI-Harness P4.5):
 * a registry in memory, a keychain that answers only "is there one", and —
 * where the real shells make a request or start a program — the scripted
 * server of the core package. Which scripted server stands behind an address
 * or a command is the test's to say.
 */
export interface ScriptedNative {
  native: McpNativeHost;
  /** What is registered, as the native dialog confirmed it. */
  registry: McpRegisteredServer[];
  /** What the native dialog was shown, in order. */
  shown: { id: string; target: string; text: EndpointConfirmText }[];
  /** The user's answer in the native dialog. */
  confirm: boolean;
  /** The stored values: `id` for a remote server's token, `id/NAME` for a program's. */
  secrets: Map<string, string>;
  /** The ports that were opened, by server id — the newest last. */
  ports: Map<string, ScriptedHttpPort | ScriptedStdioPort>;
  /** The registry does not answer: a browser build, a broken store. */
  broken: boolean;
}

export function scriptedNative(behind: (target: string) => ScriptedMcpServer | null, options: { programs?: boolean } = {}): ScriptedNative {
  const state: ScriptedNative = {
    registry: [],
    shown: [],
    confirm: true,
    secrets: new Map(),
    ports: new Map(),
    broken: false,
    native: null as unknown as McpNativeHost,
  };
  const stored = (id: string) => [...state.secrets.keys()].filter((key) => key === id || key.startsWith(`${id}/`)).map((key) => (key === id ? "" : key.slice(id.length + 1)));
  const entry = (server: McpRegisteredServer): McpRegisteredServer => ({ ...server, stored: stored(server.id) });
  const key = (id: string, name: string | null) => (name === null ? id : `${id}/${name}`);
  const serverBehind = (id: string): ScriptedMcpServer => {
    const registered = state.registry.find((server) => server.id === id);
    const target = registered ? (registered.kind === "http" ? (registered.url ?? "") : [registered.program ?? "", ...registered.args].join(" ")) : "";
    const server = registered ? behind(target) : null;
    if (!server) throw new Error("not-registered");
    return server;
  };
  state.native = {
    async servers() {
      if (state.broken) throw new Error("no native side");
      return state.registry.map(entry);
    },
    async addHttp(id, url, text) {
      state.shown.push({ id, target: url, text });
      if (!state.confirm) return false;
      state.registry = [...state.registry.filter((server) => server.id !== id), { id, kind: "http", url, args: [], env: [], sandbox: false, stored: [] }];
      return true;
    },
    async remove(id) {
      state.registry = state.registry.filter((server) => server.id !== id);
      for (const secret of [...state.secrets.keys()]) if (secret === id || secret.startsWith(`${id}/`)) state.secrets.delete(secret);
    },
    async setSecret(id, name, value) {
      state.secrets.set(key(id, name), value);
    },
    async hasSecret(id, name) {
      return state.secrets.has(key(id, name));
    },
    async deleteSecret(id, name) {
      state.secrets.delete(key(id, name));
    },
    httpPort(id) {
      const port = scriptedMcpHttpPort(serverBehind(id));
      state.ports.set(id, port);
      return port;
    },
    programs: options.programs
      ? {
          async add(id: string, spec: McpProgramSpec, text: EndpointConfirmText) {
            state.shown.push({ id, target: [spec.program, ...spec.args].join(" "), text });
            if (!state.confirm) return false;
            state.registry = [...state.registry.filter((server) => server.id !== id), { id, kind: "program", program: spec.program, args: [...spec.args], env: [...spec.env], sandbox: spec.sandbox, stored: [] }];
            return true;
          },
          port(id: string) {
            const port = scriptedMcpStdioPort(serverBehind(id));
            state.ports.set(id, port);
            return port;
          },
          async log() {
            return "starting\nready";
          },
          async sandbox() {
            return { kind: "bwrap" as const, works: true };
          },
        }
      : null,
  };
  return state;
}

/** The app's data folder, in memory. */
export function memoryFiles(): AiFileStore & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async read(path) {
      return files.get(path) ?? null;
    },
    async write(path, text) {
      files.set(path, text);
    },
    async remove(path) {
      files.delete(path);
    },
    async removeDir(path) {
      for (const name of [...files.keys()]) if (name.startsWith(`${path}/`)) files.delete(name);
    },
  };
}

/** The native dialog's texts, as a shell would pass them. */
export const CONFIRM: EndpointConfirmText = { title: "Add an external server", message: "Only add servers you trust.", confirm: "Add", cancel: "Cancel" };
