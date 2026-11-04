import { sha256Hex } from "../../workspace/encoding.js";
import { walkInstructionFolder, type InstructionIO } from "../skills/entries.js";
import type { InstructionSource } from "../skills/sources.js";
import { stripInvisible } from "../trust.js";
import {
  parseScriptManifest,
  SCRIPT_MAIN_FILE,
  SCRIPT_MAIN_MAX_BYTES,
  SCRIPT_MANIFEST_FILE,
  SCRIPT_MANIFEST_MAX_BYTES,
  SCRIPT_MAX_BYTES,
  SCRIPT_MAX_FILES,
  SCRIPT_SIGNATURE_FILE,
  SCRIPT_SIGNATURE_MAX_BYTES,
  SCRIPTS_FOLDER,
  type ScriptDefinition,
  type ScriptProblem,
} from "./manifest.js";
import { checkPublisherSignature, scriptSeal, type PublisherCheck, type PublisherKey } from "./seal.js";

/** A script's own folders go one level down — a `tests/` beside its two files, nothing deeper. */
const SCRIPT_MAX_DEPTH = 2;

/** What stands between the manifest and the code in a script's reading copy. */
export const SCRIPT_READING_RULE = "---------- main.js ----------";

/**
 * The reading copy of a script: its manifest, then its code — what the
 * approval dialog shows, and what an approval keeps so that a later change
 * can be shown word by word. A change of the manifest alone (one more tool, a
 * higher limit) is a change of this text.
 */
export function scriptReadingCopy(manifest: string, code: string): string {
  return `${manifest.trimEnd()}\n\n${SCRIPT_READING_RULE}\n\n${code}`;
}

function strictText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * One script folder (plan KI-Harness P5.5): every file hashed in path order,
 * the manifest parsed, the code read, a publisher's signature held against
 * the seal. Whatever is unclear is a problem, and a script with a problem
 * does not run:
 *
 * - a character that draws nothing in the manifest or the code — a zero-width
 *   or a bidirectional one — is such a problem, not a remark: code that reads
 *   differently from how it runs cannot be reviewed;
 * - so is a signature in the folder that does not hold for the files beside
 *   it. One made with a key this app does not know says nothing, and is no
 *   problem.
 */
export async function scanScriptFolder(io: InstructionIO, folder: string, publishers?: readonly PublisherKey[]): Promise<InstructionSource> {
  const root = `${SCRIPTS_FOLDER}/${folder}`;
  const empty: InstructionSource = { id: root, kind: "script", origin: "vault", root, files: [], text: null, skill: null, problems: [], tooLarge: false, script: null, scriptProblems: [], code: null, signature: { state: "none" } };
  const paths: string[] = [];
  if (!(await walkInstructionFolder(io, root, { maxDepth: SCRIPT_MAX_DEPTH, maxFiles: SCRIPT_MAX_FILES }, paths))) return { ...empty, tooLarge: true };
  paths.sort();
  const files: InstructionSource["files"] = [];
  const bytesOf = new Map<string, Uint8Array>();
  let total = 0;
  for (const rel of paths) {
    const bytes = await io.read(`${root}/${rel}`);
    if (!bytes) continue;
    total += bytes.length;
    if (total > SCRIPT_MAX_BYTES) return { ...empty, tooLarge: true };
    files.push({ path: rel, bytes: bytes.length, sha256: sha256Hex(bytes) });
    bytesOf.set(rel, bytes);
  }

  const problems: ScriptProblem[] = [];
  let script: ScriptDefinition | null = null;
  let manifestText: string | null = null;
  const manifest = bytesOf.get(SCRIPT_MANIFEST_FILE);
  if (!manifest) problems.push({ code: "manifest-missing" });
  else if (manifest.length > SCRIPT_MANIFEST_MAX_BYTES) problems.push({ code: "file-too-large", detail: SCRIPT_MANIFEST_FILE });
  else {
    manifestText = strictText(manifest);
    if (manifestText === null) problems.push({ code: "manifest-json" });
    else {
      const parsed = parseScriptManifest(manifestText, folder);
      script = parsed.script;
      problems.push(...parsed.problems);
    }
  }

  let code: string | null = null;
  const main = bytesOf.get(SCRIPT_MAIN_FILE);
  if (!main) problems.push({ code: "main-missing" });
  else if (main.length > SCRIPT_MAIN_MAX_BYTES) problems.push({ code: "file-too-large", detail: SCRIPT_MAIN_FILE });
  else {
    code = strictText(main);
    if (code === null) problems.push({ code: "main-not-text" });
  }

  const text = manifestText !== null && code !== null ? scriptReadingCopy(manifestText, code) : (manifestText ?? code);
  const invisible = text === null ? 0 : stripInvisible(text).removed;
  if (invisible) problems.push({ code: "invisible-characters", detail: String(invisible) });

  let signature: PublisherCheck | { state: "none" } = { state: "none" };
  const signed = bytesOf.get(SCRIPT_SIGNATURE_FILE);
  if (signed) {
    const signatureText = signed.length > SCRIPT_SIGNATURE_MAX_BYTES ? null : strictText(signed);
    signature = signatureText === null ? { state: "invalid" } : checkPublisherSignature(scriptSeal(files), signatureText, publishers);
    if (signature.state === "invalid") problems.push({ code: "signature-invalid" });
  }

  return { ...empty, files, text, script, scriptProblems: problems, code, signature, ...(invisible ? { invisible } : {}) };
}
