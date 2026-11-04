/**
 * External agents (plan KI-Harness P4.6, ADR 0025): Plainva as the host of
 * an agent somebody else made — a program the user installed and signed in
 * to themselves, started in the vault's folder and spoken to in the Agent
 * Client Protocol over its input and output.
 *
 * `protocol` is what the messages are and how a stranger's ones are read;
 * `connection` the pipe in both directions; `client` one agent from its start
 * to its end; `files` which file of the vault an agent's path means; `agents`
 * the names Plainva knows agents by and what an added one is to the app.
 * `scripted` is an agent in a script, for tests in every package. The program
 * itself is started natively (apps/desktop/src-tauri/src/acp); what a session
 * does with a file, a question and a report is packages/ui/src/ai.
 */
export * from "./protocol.js";
export * from "./connection.js";
export * from "./client.js";
export * from "./files.js";
export * from "./agents.js";
export * from "./native.js";
export * from "./scripted.js";
