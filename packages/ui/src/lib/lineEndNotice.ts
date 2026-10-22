import i18n from "i18next";
import type { TextFileShape } from "@plainva/core";
import { toast } from "../services/toastStore";

/**
 * Tells the user that Plainva turned a file's line ends.
 *
 * A file keeps the line ends it has — with one exception (maintainer,
 * 2026-10-12): a carriage return of its own, every line end of a file from a
 * classic Mac, is read and not kept. The first write that changes such a file
 * leaves it with the line end its shape has (`textFileShape.ts` in the core),
 * and that is every line of the file. Nobody asked for that, so it is said.
 *
 * Both shells hand this function to the top of their adapter chain
 * (`ConflictAwareVaultAdapter`, its `onLineEndsConverted`): every write of the
 * app to a file the user sees passes there, an editor's save and the writers
 * beside it alike, and none of them has to remember the notice. On the desktop
 * the chain lives in the central window, which hands the notice on to the
 * auxiliary windows on the vault (`line-ends-converted` on the window bus).
 *
 * Once per file comes by itself — afterwards the file has nothing left to
 * turn. What is gathered here is a burst: a gesture that writes many files (a
 * rename that follows its links through a folder of old notes) says it in one
 * notice, not in one per file. Each further file waits a moment longer for the
 * next, at most a few seconds in all, so a long gesture still says it while
 * it runs.
 */
const BURST_MS = 600;
const BURST_MAX_MS = 3000;

let burst: { names: string[]; eol: TextFileShape["eol"]; started: number; timer: number } | null = null;

/** The sentence in the user's language, or the English one where no translation answers. */
function said(key: string, fallback: string, values: Record<string, string | number>): string {
  const translated = i18n.t(key, { ...values, defaultValue: fallback });
  return typeof translated === "string" && translated.trim() ? translated : fallback;
}

const lineEndName = (eol: TextFileShape["eol"]): string => (eol === "\r\n" ? "CRLF" : "LF");

/** The file's name as it stands in its folder, extension included: it need not be a note. */
const fileName = (path: string): string => path.split("/").pop() || path;

function sayBurst(): void {
  const gathered = burst;
  burst = null;
  if (!gathered) return;
  if (gathered.names.length === 1) {
    const name = gathered.names[0];
    const lineEnd = lineEndName(gathered.eol);
    toast.info(said(
      "editor.lineEndsConverted",
      `“${name}” had bare CR line endings, as old Mac files do. Plainva saved it with ${lineEnd}.`,
      { name, eol: lineEnd },
    ));
    return;
  }
  const files = gathered.names.length;
  toast.info(said(
    "editor.lineEndsConvertedSeveral",
    `Several files (${files}) had bare CR line endings, as old Mac files do. Plainva saved them with LF or CRLF.`,
    { files },
  ));
}

export function sayLineEndsConverted(path: string, eol: TextFileShape["eol"]): void {
  const name = fileName(path);
  if (burst) {
    burst.names.push(name);
    if (Date.now() - burst.started < BURST_MAX_MS) {
      window.clearTimeout(burst.timer);
      burst.timer = window.setTimeout(sayBurst, BURST_MS);
    }
    return;
  }
  // Scheduled before it is kept: a burst is never left behind without its timer.
  const timer = window.setTimeout(sayBurst, BURST_MS);
  burst = { names: [name], eol, started: Date.now(), timer };
}
