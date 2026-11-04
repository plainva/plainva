import { runScript, scriptFailureText, type RunScripts, type ScriptCallRecord, type ScriptDefinition, type ScriptOutcome, type ScriptSandbox, type ToolCallPart, type ToolExecutor, type ToolManifest, type ToolOutcome } from "@plainva/core";

/**
 * A script as a tool of a conversation (ADR 0020 decision 6, plan KI-Harness
 * P5.5): one implementation for both shells. Running one is decided here, in
 * the order of trust:
 *
 * 1. the script as it stands NOW on this device — its files the approved
 *    ones, the approval signed by this device —, not as it stood when the
 *    conversation began;
 * 2. what the model hands it, held against the script's parameters (the run
 *    does that once more than the orchestrator already did);
 * 3. every tool call the script makes, held against its manifest — and
 *    carried out by the conversation's own executor, so it meets the same
 *    privacy gate, the same folders and the same record of what was read as
 *    a call the model made itself.
 *
 * What comes back is a program's output: data, fenced.
 */

export interface ActiveScript {
  definition: ScriptDefinition;
  /** The code as approved. */
  code: string;
}

export interface ScriptToolsHost {
  /** The script behind an id as it stands now: active on this device, or null. */
  script(id: string): Promise<ActiveScript | null>;
  sandbox: ScriptSandbox;
}

/** What a run did with scripts, gathered while it runs: names, outcomes and counts — never content. */
export const newRunScripts = (): RunScripts => ({ runs: [] });

/** A script's value as a model reads it, at most this long. */
export const SCRIPT_RESULT_CHARS_MAX = 16_000;

const NOT_AVAILABLE = "This script is not available on this device right now. Answer without it.";

/** The call a script makes, as the tool it calls sees it: under the id of the model's call that started the script. */
const innerCall = (call: ToolCallPart, tool: ToolManifest, args: unknown, n: number): ToolCallPart => ({ type: "tool_call", id: `${call.id}/${n}`, name: tool.name, args });

/** A finished run as the answer to the model's call. */
export function scriptToolOutcome(script: ScriptDefinition, outcome: ScriptOutcome): ToolOutcome {
  if (outcome.kind === "failed") return { content: scriptFailureText(script.name, outcome.reason, script.limits), isError: true };
  const cut = outcome.json.length > SCRIPT_RESULT_CHARS_MAX;
  return {
    content: cut ? `${outcome.json.slice(0, SCRIPT_RESULT_CHARS_MAX)}\n\n[The result was longer; this is its beginning.]` : outcome.json,
    origin: { kind: "script", script: script.name },
  };
}

/**
 * `tools`: what a script's own calls go to — the conversation's executor
 * below the tool search and the skills, behind the gate.
 */
export function createScriptExecutor(inner: ToolExecutor, tools: ToolExecutor, host: ScriptToolsHost, log: RunScripts): ToolExecutor {
  return {
    async execute(tool, args, call, signal) {
      if (!tool.script) return inner.execute(tool, args, call, signal);
      const active = await host.script(tool.script.id).catch(() => null);
      if (!active) return { content: NOT_AVAILABLE, isError: true };
      let made = 0;
      const outcome = await runScript({
        script: active.definition,
        code: active.code,
        input: args,
        sandbox: host.sandbox,
        execute: (inside, insideArgs, stop) => tools.execute(inside, insideArgs, innerCall(call, inside, insideArgs, ++made), stop),
        ...(signal ? { signal } : {}),
      });
      log.runs.push({ script: active.definition.name, outcome: outcome.kind === "done" ? "done" : outcome.reason, calls: outcome.calls.length });
      return scriptToolOutcome(active.definition, outcome);
    },
  };
}

/** One call of a run as the workshop lists it. */
export type ScriptCallView = ScriptCallRecord;
