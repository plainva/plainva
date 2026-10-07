import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  McpError,
  mcpStartFailure,
  readMcpOAuthIssuer,
  readMcpOAuthStatus,
  readMcpRegisteredServers,
  MCP_OAUTH_LOOPBACK_PORT,
  type McpHttpChunk,
  type McpHttpPort,
  type McpNativeHost,
  type McpOAuthBrowser,
  type McpOAuthHost,
  type McpSandboxInfo,
  type McpStdioPort,
} from "@plainva/core";

/**
 * The desktop's native side of foreign MCP servers (plan KI-Harness P4.5):
 * the Rust commands in `src-tauri/src/mcp_client`. A server is named by its
 * id — its address, its command line and its credentials are the native
 * side's, and no command returns a credential.
 */

/** A native command names what went wrong in one of a fixed set of words; it arrives as a plain string. */
const word = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

const oauth: McpOAuthHost = {
  async document(serverId, url) {
    const answer = await invoke<{ status: number; body: string }>("mcp_client_oauth_document", { serverId, url }).catch((error: unknown) => Promise.reject(word(error)));
    return { status: Number(answer.status) || 0, body: typeof answer.body === "string" ? answer.body : "" };
  },
  async issuer(serverId, issuer, url) {
    const found = readMcpOAuthIssuer(await invoke<unknown>("mcp_client_oauth_issuer", { serverId, issuer, url }).catch((error: unknown) => Promise.reject(word(error))));
    if (!found) throw new Error("oauth-no-metadata");
    return found;
  },
  begin(serverId, request) {
    return invoke<string>("mcp_client_oauth_begin", { serverId, request }).catch((error: unknown) => Promise.reject(word(error)));
  },
  finish(redirect) {
    return invoke<string>("mcp_client_oauth_finish", { redirect }).catch((error: unknown) => Promise.reject(word(error)));
  },
  async cancel() {
    await invoke("mcp_client_oauth_cancel");
  },
  renew(serverId) {
    return invoke<boolean>("mcp_client_oauth_renew", { serverId });
  },
  async status(serverId) {
    return readMcpOAuthStatus(await invoke<unknown>("mcp_client_oauth_status", { serverId }));
  },
  async signOut(serverId) {
    await invoke("mcp_client_oauth_sign_out", { serverId });
  },
};

/**
 * The browser of a sign-in, and the way back from it: the system's browser
 * and a port on this computer — the listener every account sign-in of the
 * app comes back through (`oauth_loopback_*`). What arrives there is handed
 * on as it is; whether it is the answer to what was begun is the native
 * side's decision.
 */
export function createDesktopMcpBrowser(): McpOAuthBrowser {
  return {
    async prepare() {
      // The port authorization servers know from Plainva's description first; any free one where that is taken.
      const redirectPort = await invoke<number>("oauth_loopback_start", { port: MCP_OAUTH_LOOPBACK_PORT }).catch(() => invoke<number>("oauth_loopback_start"));
      return { redirectPort };
    },
    async open(url) {
      // The native side built it from an endpoint it checked; a browser is still only ever opened at a web address.
      if (!/^https?:\/\//i.test(url)) throw new Error("oauth-address");
      await openUrl(url);
    },
    async wait(signal) {
      const stop = () => void invoke("oauth_loopback_cancel").catch(() => undefined);
      if (signal?.aborted) {
        stop();
        throw new Error("cancelled");
      }
      signal?.addEventListener("abort", stop, { once: true });
      try {
        const came = await invoke<{ code?: string; state?: string | null; iss?: string | null; error?: string | null }>("oauth_loopback_wait", { timeoutSecs: 300, reportErrors: true });
        return {
          state: came.state ?? "",
          ...(came.code ? { code: came.code } : {}),
          ...(typeof came.iss === "string" ? { iss: came.iss } : {}),
          ...(typeof came.error === "string" ? { error: came.error } : {}),
        };
      } finally {
        signal?.removeEventListener("abort", stop);
      }
    },
  };
}

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
    oauth,
  };
}
