import {
  scriptedMcpHttpPort,
  scriptedMcpStdioPort,
  MCP_OAUTH_LOOPBACK_PORT,
  type EndpointConfirmText,
  type McpNativeHost,
  type McpOAuthBrowser,
  type McpProgramSpec,
  type McpRegisteredServer,
  type ScriptedHttpPort,
  type ScriptedMcpServer,
  type ScriptedOAuth,
  type ScriptedStdioPort,
} from "@plainva/core";
import type { AiFileStore } from "@plainva/ui";

/**
 * The native side of foreign MCP servers for tests (plan KI-Harness P4.5):
 * a registry in memory, a keychain that answers only "is there one", and —
 * where the real shells make a request or start a program — the scripted
 * server of the core package. Which scripted server stands behind an address
 * or a command is the test's to say; so is the sign-in a remote one has
 * (`scriptedMcpOAuth`), where it has one.
 */
export interface ScriptedNative {
  native: McpNativeHost;
  /** The browser of a sign-in: the scripted one of the server that was begun with. */
  browser: McpOAuthBrowser;
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

export interface ScriptedNativeOptions {
  programs?: boolean;
  /** The sign-in of the remote server at an address, where it has one. */
  oauth?(url: string): ScriptedOAuth | null;
}

export function scriptedNative(behind: (target: string) => ScriptedMcpServer | null, options: ScriptedNativeOptions = {}): ScriptedNative {
  const state: ScriptedNative = {
    registry: [],
    shown: [],
    confirm: true,
    secrets: new Map(),
    ports: new Map(),
    broken: false,
    native: null as unknown as McpNativeHost,
    browser: null as unknown as McpOAuthBrowser,
  };
  const signIn = (id: string): ScriptedOAuth | null => {
    const registered = state.registry.find((server) => server.id === id);
    return registered?.kind === "http" && registered.url ? (options.oauth?.(registered.url) ?? null) : null;
  };
  /** The sign-in that was begun last: what the browser shows, and what its way back ends. */
  let begun: ScriptedOAuth | null = null;
  state.browser = {
    prepare: () => Promise.resolve({ redirectPort: MCP_OAUTH_LOOPBACK_PORT }),
    open: (url) => (begun ? begun.browser.open(url) : Promise.reject(new Error("nothing was begun"))),
    wait: (signal) => (begun ? begun.browser.wait(signal) : Promise.reject(new Error("nothing was begun"))),
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
      // A sign-in goes with its server, like every other credential.
      await signIn(id)?.host.signOut(id);
      state.registry = state.registry.filter((server) => server.id !== id);
      for (const secret of [...state.secrets.keys()]) if (secret === id || secret.startsWith(`${id}/`)) state.secrets.delete(secret);
    },
    async setSecret(id, name, value) {
      // A fixed token takes the place of a sign-in: a server has one credential.
      if (name === null) await signIn(id)?.host.signOut(id);
      state.secrets.set(key(id, name), value);
    },
    async hasSecret(id, name) {
      return state.secrets.has(key(id, name));
    },
    async deleteSecret(id, name) {
      state.secrets.delete(key(id, name));
    },
    httpPort(id) {
      // What the native side puts into a request: the stored token, else the one a sign-in got. This side never sees either.
      const port = scriptedMcpHttpPort(serverBehind(id), { bearer: () => state.secrets.get(id) ?? signIn(id)?.bearer(id) });
      state.ports.set(id, port);
      return port;
    },
    oauth: {
      async document(id, url) {
        const oauth = signIn(id);
        return oauth ? oauth.host.document(id, url) : { status: 404, body: "" };
      },
      async issuer(id, issuer, url) {
        const oauth = signIn(id);
        if (!oauth) throw new Error("oauth-no-metadata");
        return oauth.host.issuer(id, issuer, url);
      },
      async begin(id, request) {
        const oauth = signIn(id);
        if (!oauth) throw new Error("oauth-no-metadata");
        const url = await oauth.host.begin(id, request);
        begun = oauth;
        return url;
      },
      async finish(redirect) {
        if (!begun) throw new Error("oauth-no-flow");
        const id = await begun.host.finish(redirect);
        // A sign-in and a fixed token exclude each other.
        state.secrets.delete(id);
        return id;
      },
      async cancel() {
        await begun?.host.cancel();
      },
      async renew(id) {
        return (await signIn(id)?.host.renew(id)) ?? false;
      },
      async status(id) {
        return (await signIn(id)?.host.status(id)) ?? null;
      },
      async signOut(id) {
        await signIn(id)?.host.signOut(id);
      },
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
