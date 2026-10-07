import type { EndpointConfirmText } from "../egress.js";
import type { AcpRegisteredAgent } from "./agents.js";
import type { AcpPort } from "./connection.js";

/**
 * What a shell does natively for external agents (plan KI-Harness P4.6) — the
 * contract of `apps/desktop/src-tauri/src/acp`. Only the desktop has one: a
 * phone starts no programs.
 *
 * The web view names an agent by its id and the vault by its folder. Which
 * file is started, with which arguments, is the native side's — it took them
 * from the user in a dialog of the system, it starts the file only in a
 * folder that is an open vault, and only after the user said yes to that
 * start in a dialog of the system. No credential of an agent is asked for,
 * handed over or kept on either side.
 */
export interface AcpNativeHost {
  /** The agents of this device, exactly as they were confirmed. */
  agents(): Promise<AcpRegisteredAgent[]>;
  /** Which of these programs are installed: for each bare name, the file it means on this computer, or null. Looks; starts nothing. */
  detect(programs: readonly string[]): Promise<(string | null)[]>;
  /** Remembers an agent after a native confirmation of its whole command line. False where the user said no. */
  add(agentId: string, command: { program: string; args: readonly string[] }, text: EndpointConfirmText): Promise<boolean>;
  /** Forgets an agent; one that runs ends first. */
  remove(agentId: string): Promise<void>;
  /**
   * The pipe to an agent started in the folder of an open vault. The first
   * start in a folder since the app started is confirmed natively: the system's
   * dialog shows `text` and, below it, the folder and the whole command — the
   * one step of a start the web view cannot take by itself. `start` rejects
   * with one of `ACP_START_PROBLEMS`, or with `ACP_START_DECLINED` after a no.
   */
  port(agentId: string, root: string, text: EndpointConfirmText): AcpPort;
  /** The end of what a running agent wrote to its error stream: text for a person. */
  log(agentId: string): Promise<string>;
  /**
   * Opens the agent's own program in a terminal, with the arguments and values
   * the agent named for its sign-in added, and waits for it to end. Resolves
   * with the number the program ended with (0: signed in); rejects with one of
   * `ACP_LOGIN_PROBLEMS`. What is typed in that terminal never reaches the app.
   */
  login(agentId: string, root: string, args: readonly string[], env: Readonly<Record<string, string>>): Promise<number>;
  /** Stops waiting for a sign-in. */
  cancelLogin(): Promise<void>;
}
