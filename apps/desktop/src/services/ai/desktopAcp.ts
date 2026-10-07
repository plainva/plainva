import { Channel, invoke } from "@tauri-apps/api/core";
import { readAcpRegisteredAgents, type AcpNativeHost, type AcpPort, type EndpointConfirmText } from "@plainva/core";

/**
 * The desktop's native side of external agents (plan KI-Harness P4.6): the
 * Rust commands in `src-tauri/src/acp`. An agent is named by its id — which
 * file that is and with which arguments it starts is the native side's, and
 * so are the check that the folder it starts in is an open vault and the
 * question to the user before a start.
 */

/** A native command names what went wrong in one of a fixed set of words; it arrives as a plain string. */
const word = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

type PipeEvent = { type: "line"; text: string } | { type: "exit"; code?: number | null };

function port(agentId: string, root: string, text: EndpointConfirmText): AcpPort {
  return {
    async start(onLine, onExit) {
      const channel = new Channel<PipeEvent>();
      channel.onmessage = (event) => {
        if (event.type === "line") onLine(event.text);
        else onExit(event.code ?? null);
      };
      // The native side asks in the system's own dialog before the first start in a folder; `text` is only its wording.
      await invoke("acp_start", { agentId, root, text, onEvent: channel }).catch((error: unknown) => Promise.reject(word(error)));
    },
    async write(line) {
      await invoke("acp_write", { agentId, line });
    },
    async stop() {
      await invoke("acp_stop", { agentId });
    },
  };
}

export function createDesktopAcpHost(): AcpNativeHost {
  return {
    async agents() {
      return readAcpRegisteredAgents(await invoke<unknown>("acp_agents"));
    },
    async detect(programs) {
      const found = await invoke<unknown>("acp_detect", { programs: [...programs] });
      return programs.map((_, index) => {
        const file = Array.isArray(found) ? (found[index] as unknown) : null;
        return typeof file === "string" && file ? file : null;
      });
    },
    add(agentId, command, text) {
      return invoke<boolean>("acp_agent_add", { agentId, program: command.program, args: [...command.args], text });
    },
    async remove(agentId) {
      await invoke("acp_agent_remove", { agentId });
    },
    port,
    log(agentId) {
      return invoke<string>("acp_log", { agentId });
    },
    login(agentId, root, args, env) {
      return invoke<number>("acp_login", { agentId, root, args: [...args], env: { ...env } }).catch((error: unknown) => Promise.reject(word(error)));
    },
    async cancelLogin() {
      await invoke("acp_login_cancel");
    },
  };
}
