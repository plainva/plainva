import { Channel, invoke } from "@tauri-apps/api/core";
import {
  McpError,
  mcpStartFailure,
  readMcpRegisteredServers,
  type McpHttpChunk,
  type McpHttpPort,
  type McpNativeHost,
  type McpSandboxInfo,
  type McpStdioPort,
} from "@plainva/core";

/**
 * The desktop's native side of foreign MCP servers (plan KI-Harness P4.5):
 * the Rust commands in `src-tauri/src/mcp_client`. A server is named by its
 * id — its address, its command line and its credentials are the native
 * side's, and no command returns a credential.
 */

type PipeEvent = { type: "line"; text: string } | { type: "exit"; code?: number | null };

const ENDED: ReadonlySet<McpHttpChunk["type"]> = new Set(["done", "cancelled", "failed"]);

function httpPort(serverId: string): McpHttpPort {
  return {
    send(requestId, request, onChunk) {
      return new Promise<void>((resolve, reject) => {
        const channel = new Channel<McpHttpChunk>();
        let settled = false;
        channel.onmessage = (chunk) => {
          if (settled) return;
          onChunk(chunk);
          if (ENDED.has(chunk.type)) {
            settled = true;
            resolve();
          }
        };
        invoke("mcp_client_http", {
          request: { requestId, serverId, method: request.method, headers: request.headers, body: request.body, timeoutMs: request.timeoutMs },
          onEvent: channel,
        }).catch((error: unknown) => {
          if (settled) return;
          settled = true;
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    },
    async cancel(requestId) {
      await invoke("mcp_client_cancel", { requestId });
    },
  };
}

function stdioPort(serverId: string): McpStdioPort {
  return {
    async start(onLine, onExit) {
      const channel = new Channel<PipeEvent>();
      channel.onmessage = (event) => {
        if (event.type === "line") onLine(event.text);
        else onExit(event.code ?? null);
      };
      try {
        await invoke("mcp_client_start", { serverId, onEvent: channel });
      } catch (error) {
        // The native side names why in one of a fixed set of words; the settings say it in the user's language.
        throw new McpError(mcpStartFailure(error));
      }
    },
    async write(line) {
      await invoke("mcp_client_write", { serverId, line });
    },
    async stop() {
      await invoke("mcp_client_stop", { serverId });
    },
  };
}

export function createDesktopMcpHost(): McpNativeHost {
  return {
    async servers() {
      return readMcpRegisteredServers(await invoke<unknown>("mcp_client_servers"));
    },
    addHttp(serverId, url, text) {
      return invoke<boolean>("mcp_client_add_http", { serverId, url, text });
    },
    async remove(serverId) {
      await invoke("mcp_client_remove", { serverId });
    },
    async setSecret(serverId, name, value) {
      await invoke("mcp_client_secret_set", { serverId, name, value });
    },
    hasSecret(serverId, name) {
      return invoke<boolean>("mcp_client_secret_present", { serverId, name });
    },
    async deleteSecret(serverId, name) {
      await invoke("mcp_client_secret_delete", { serverId, name });
    },
    httpPort,
    programs: {
      add(serverId, spec, text) {
        return invoke<boolean>("mcp_client_add_program", { serverId, program: spec.program, args: spec.args, env: spec.env, sandbox: spec.sandbox, text });
      },
      port: stdioPort,
      log(serverId) {
        return invoke<string>("mcp_client_log", { serverId });
      },
      sandbox() {
        return invoke<McpSandboxInfo>("mcp_client_sandbox");
      },
    },
  };
}
