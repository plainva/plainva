import { registerPlugin } from "@capacitor/core";
import { readMcpRegisteredServers, type McpHttpChunk, type McpHttpPort, type McpNativeHost } from "@plainva/core";

/**
 * The phone's native side of foreign MCP servers (plan KI-Harness P4.5): the
 * `AiMcp` plugin (android/…/AiMcpPlugin.java, ios/App/App/AiMcpPlugin.swift).
 * A server is named by its id — its address and its token are the plugin's,
 * and no method returns a token. A phone starts no programs, so there are
 * only remote servers here.
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
  };
}
