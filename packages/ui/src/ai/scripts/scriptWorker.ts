import { loadGuestEngine } from "./engine";
import { checkGuest, runGuest, type GuestEngine } from "./guest";
import type { FromScriptWorker, ToScriptWorker } from "./protocol";

/**
 * The script worker (ADR 0020 decision 6, plan KI-Harness P5.5): a thread of
 * its own that loads the engine, runs one script in it and says how it
 * ended. The app ends the worker afterwards — and at once when the script's
 * time is up, whatever the engine is doing then. Nothing in here touches the
 * vault, the app's data or the network: a tool call is a message to the app,
 * which decides and answers.
 */

const scope = self as unknown as { onmessage: ((event: { data: unknown }) => void) | null; postMessage(message: FromScriptWorker): void };
const post = (message: FromScriptWorker): void => scope.postMessage(message);

const answers = new Map<number, (json: string) => void>();
let nextCall = 1;
let taken = false;

scope.onmessage = (event) => {
  const message = event.data as ToScriptWorker | null;
  if (!message || typeof message !== "object") return;
  if (message.type === "result") {
    const answer = answers.get(message.id);
    answers.delete(message.id);
    answer?.(typeof message.json === "string" ? message.json : "");
    return;
  }
  if (taken || (message.type !== "run" && message.type !== "check")) return;
  taken = true;
  void (async () => {
    let engine: GuestEngine;
    try {
      engine = await loadGuestEngine();
    } catch {
      if (message.type === "check") post({ type: "checked", result: { ok: false, message: "The engine could not start." } });
      else post({ type: "end", end: { kind: "killed", why: "crashed", usage: { ms: 0, fuel: 0 } } });
      return;
    }
    if (message.type === "check") {
      post({ type: "checked", result: checkGuest(String(message.code), engine) });
      return;
    }
    post({ type: "ready" });
    const end = await runGuest(
      message.job,
      {
        call: (tool, args) =>
          new Promise<string>((resolve) => {
            const id = nextCall++;
            answers.set(id, resolve);
            post({ type: "call", id, tool, args });
          }),
        log: (level, text) => post({ type: "log", level, text }),
        working: (busy, usage) => post({ type: "working", busy, usage }),
      },
      engine,
    );
    post({ type: "end", end });
  })();
};
