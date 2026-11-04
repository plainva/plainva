import { useEffect, useState } from "react";
import { Check, Minus, X } from "lucide-react";
import type { ScriptInput } from "@plainva/core";
import { Checkbox } from "../components/ui/Checkbox";
import { ICON } from "../lib/iconSizes";
import type { AiSession, AiState } from "./aiSession";
import type { ScriptRunState } from "./scriptSession";
import type { ScriptCallLine } from "./scriptsWorkshop";

/**
 * The scripts of the workshop (plan KI-Harness P5.5, mockup chapter 21): what
 * both shells share beyond the models in `skillsWorkshop.ts` and
 * `scriptsWorkshop.ts` — a script's code as numbered lines, the calls of a
 * run as a list, the check of code that is about to be approved, and a run
 * with its start and its stop. The desktop puts them into a `Modal`, the
 * phone into a sheet.
 */

/** Code as it would run, line by line with its number: an error names a line, and the reader finds it. */
export function ScriptCode({ code, testId }: { code: string; testId?: string }) {
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <pre className="pv-linecompare pv-script-code" data-testid={testId}>
      {lines.map((line, index) => (
        <span key={index}>{line || " "}</span>
      ))}
    </pre>
  );
}

/**
 * The tools of the form, to tick: those that read, then those that lay down
 * a suggestion or a draft — each group under its own word, so nobody ticks a
 * writing tool for a reading one. One markup for both shells.
 */
export function ScriptToolPicker({ choices, chosen, labels, onToggle }: { choices: readonly { name: string; label: string; writes: boolean }[]; chosen: readonly string[]; labels: { read: string; write: string }; onToggle(name: string, on: boolean): void }) {
  return (
    <>
      {[false, true].map((writes) => (
        <div key={writes ? "write" : "read"} className="pv-script-toolgroup">
          <span>{writes ? labels.write : labels.read}</span>
          <div className="pv-script-tools" role="group" aria-label={writes ? labels.write : labels.read}>
            {choices
              .filter((tool) => tool.writes === writes)
              .map((tool) => (
                <Checkbox key={tool.name} checked={chosen.includes(tool.name)} onChange={(event) => onToggle(tool.name, event.target.checked)} data-testid={`ai-script-tool-${tool.name}`}>
                  {tool.label}
                </Checkbox>
              ))}
          </div>
        </div>
      ))}
    </>
  );
}

/** What a run hands back or wrote to its log, as it is: the block of the code, without numbers — it wraps, it is no program. */
export function ScriptOutput({ text, testId }: { text: string; testId?: string }) {
  return (
    <pre className="pv-linecompare pv-script-out" data-testid={testId}>
      {text}
    </pre>
  );
}

/** The tool calls of a run: a mark, the tool in the app's words, what it was asked, what came of it. */
export function ScriptCallList({ lines }: { lines: readonly ScriptCallLine[] }) {
  return (
    <>
      {lines.map((line) => (
        <span key={line.key} className="pv-skill-test-line" data-mark={line.mark} data-testid="ai-script-call">
          {line.mark === "pass" ? <Check size={ICON.meta} aria-hidden="true" /> : line.mark === "fail" ? <X size={ICON.meta} aria-hidden="true" /> : <Minus size={ICON.meta} aria-hidden="true" />}
          <span>
            {line.tool} <code>{line.args}</code> — {line.meta}
          </span>
        </span>
      ))}
    </>
  );
}

/**
 * Whether the engine reads a script's code — asked once when its dialog
 * opens, and again when the code is another. Null while it is being asked,
 * and where this device has no engine to ask.
 */
export function useScriptCheck(session: AiSession | null, code: string | null): { ok: true } | { ok: false; message: string } | null {
  const [checked, setChecked] = useState<{ code: string; result: { ok: true } | { ok: false; message: string } | null } | null>(null);
  useEffect(() => {
    if (!session || code === null) return;
    let current = true;
    void session
      .checkScript(code)
      .catch(() => null)
      .then((result) => {
        if (current) setChecked({ code, result });
      });
    return () => {
      current = false;
    };
  }, [session, code]);
  return checked && checked.code === code ? checked.result : null;
}

/**
 * A run of one script from the workshop: started, stopped, and shown from
 * the session's own state — so its calls appear as they happen. `refused`:
 * the script was not active on this device at that moment, and nothing ran.
 */
export function useScriptRun(
  session: AiSession | null,
  state: AiState | null,
  id: string,
): { run: ScriptRunState | null; busy: boolean; refused: boolean; start(input: ScriptInput, dry: boolean): void; stop(): void } {
  const [refused, setRefused] = useState(false);
  const [starting, setStarting] = useState(false);
  const shown = state?.scripts.run && state.scripts.run.id === id ? state.scripts.run : null;
  // What an earlier dialog left behind is not this one's to show.
  useEffect(() => {
    session?.clearScriptRun();
    return () => session?.clearScriptRun();
  }, [session, id]);
  const start = (input: ScriptInput, dry: boolean): void => {
    if (!session || starting || shown?.running) return;
    setStarting(true);
    setRefused(false);
    void session
      .runScript(id, input, dry)
      .then((outcome) => setRefused(outcome === null))
      .catch(() => setRefused(true))
      .finally(() => setStarting(false));
  };
  return { run: shown, busy: starting || shown?.running === true, refused, start, stop: () => session?.stopScript() };
}
