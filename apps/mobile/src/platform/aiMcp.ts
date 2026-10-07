import { registerPlugin } from "@capacitor/core";
import { readMcpOAuthIssuer, readMcpOAuthStatus, readMcpRegisteredServers, type McpHttpChunk, type McpHttpPort, type McpNativeHost, type McpOAuthHost } from "@plainva/core";

/**
 * The phone's native side of foreign MCP servers (plan KI-Harness P4.5): the
 * `AiMcp` plugin (android/…/AiMcpPlugin.java, ios/App/App/AiMcpPlugin.swift).
 * A server is named by its id — its address and its token are the plugin's,
 * and no method returns a token. A phone starts no programs, so there are
 * only remote servers here.
 *
 * Signing in to a server is the `AiMcpAuth` plugin (AiMcpAuthPlugin.java,
 * AiMcpAuthPlugin.swift): it makes the verifier, exchanges the code and keeps
 * the tokens; what crosses to this side is an address to open and a state to
 * show.
 */

interface AiMcpNative {
  servers(): Promise<{ servers: unknown }>;
  addServer(options: { serverId: string; url: string; title: string; message: string; confirm: string; cancel: string }): Promise<{ added: boolean }>;
  removeServer(options: { serverId: string }): Promise<void>;
  setSecret(options: { serverId: string; value: string }): Promise<void>;
  hasSecret(options: { serverId: string }): Promise<{ present: boolean }>;
  deleteSecret(options: { serverId: string }): Promise<void>;
  request(
    options: { requestId: string; serverId: string; method: "POST" | "DELETE"; headers: Record<string, string>; body: string; timeoutMs: number },
    callback: (chunk: McpHttpChunk | null, error?: unknown) => void,
  ): Promise<string>;
  cancel(options: { requestId: string }): Promise<{ cancelled: boolean }>;
}

const AiMcp = registerPlugin<AiMcpNative>("AiMcp");

interface AiMcpAuthNative {
  document(options: { serverId: string; url: string }): Promise<{ status: number; body: string }>;
  issuer(options: { serverId: string; issuer: string; url: string }): Promise<{ issuer: unknown }>;
  begin(options: { serverId: string; issuer: string; scopes: string[]; resource: string; clientKind: string; clientId: string; clientName: string }): Promise<{ url: string }>;
  finish(options: { state: string; code?: string; iss?: string; error?: string }): Promise<{ serverId: string }>;
  cancel(): Promise<void>;
  renew(options: { serverId: string }): Promise<{ renewed: boolean }>;
  status(options: { serverId: string }): Promise<{ status: unknown }>;
  signOut(options: { serverId: string }): Promise<void>;
}

const AiMcpAuth = registerPlugin<AiMcpAuthNative>("AiMcpAuth");

/** The plugin names what went wrong in one of a fixed set of words; it arrives as the message of a rejection. */
const word = (error: unknown): Error => (error instanceof Error ? error : new Error(String((error as { message?: unknown } | null)?.message ?? error)));

const oauth: McpOAuthHost = {
  async document(serverId, url) {
    const answer = await AiMcpAuth.document({ serverId, url }).catch((error: unknown) => Promise.reject(word(error)));
    return { status: Number(answer.status) || 0, body: typeof answer.body === "string" ? answer.body : "" };
  },
  async issuer(serverId, issuer, url) {
    const found = readMcpOAuthIssuer((await AiMcpAuth.issuer({ serverId, issuer, url }).catch((error: unknown) => Promise.reject(word(error)))).issuer);
    if (!found) throw new Error("oauth-no-metadata");
    return found;
  },
  async begin(serverId, request) {
    // A phone comes back through the app's own address, which the plugin knows: no port is named.
    const answer = await AiMcpAuth.begin({
      serverId,
      issuer: request.issuer,
      scopes: request.scopes,
      resource: request.resource,
      clientKind: request.client.kind,
      clientId: "id" in request.client ? request.client.id : "",
      clientName: request.clientName,
    }).catch((error: unknown) => Promise.reject(word(error)));
    return answer.url;
  },
  async finish(redirect) {
    return (await AiMcpAuth.finish(redirect).catch((error: unknown) => Promise.reject(word(error)))).serverId;
  },
  async cancel() {
    await AiMcpAuth.cancel();
  },
  async renew(serverId) {
    return (await AiMcpAuth.renew({ serverId })).renewed === true;
  },
  async status(serverId) {
    return readMcpOAuthStatus((await AiMcpAuth.status({ serverId })).status);
  },
  async signOut(serverId) {
    await AiMcpAuth.signOut({ serverId });
  },
};

const ENDED: ReadonlySet<McpHttpChunk["type"]> = new Set(["done", "cancelled", "failed"]);

function httpPort(serverId: string): McpHttpPort {
  return {
    send(requestId, request, onChunk) {
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const fail = (error: unknown) => {
          if (settled) return;
          settled = true;
          reject(error instanceof Error ? error : new Error(String(error ?? "AiMcp request failed")));
        };
        void AiMcp.request({ requestId, serverId, method: request.method, headers: request.headers, body: request.body, timeoutMs: request.timeoutMs }, (chunk, error) => {
          if (settled) return;
          if (error || !chunk) {
            fail(error);
            return;
          }
          onChunk(chunk);
          if (ENDED.has(chunk.type)) {
            settled = true;
            resolve();
          }
        }).catch(fail);
      });
    },
    async cancel(requestId) {
      await AiMcp.cancel({ requestId });
    },
  };
}

/** A remote server has one stored value, its token; a name belongs to a program, and a phone has none. */
function tokenOnly(name: string | null): void {
  if (name !== null) throw new Error("no such value for this server");
}

export function createMobileMcpHost(): McpNativeHost {
  return {
    async servers() {
      return readMcpRegisteredServers((await AiMcp.servers()).servers);
    },
    async addHttp(serverId, url, text) {
      return (await AiMcp.addServer({ serverId, url, ...text })).added;
    },
    async remove(serverId) {
      await AiMcp.removeServer({ serverId });
    },
    async setSecret(serverId, name, value) {
      tokenOnly(name);
      await AiMcp.setSecret({ serverId, value });
    },
    async hasSecret(serverId, name) {
      tokenOnly(name);
      return (await AiMcp.hasSecret({ serverId })).present;
    },
    async deleteSecret(serverId, name) {
      tokenOnly(name);
      await AiMcp.deleteSecret({ serverId });
    },
    httpPort,
    programs: null,
    oauth,
  };
}
