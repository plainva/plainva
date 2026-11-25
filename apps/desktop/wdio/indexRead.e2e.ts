import { browser } from "@wdio/globals";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { fixtureFiles } from "../../../packages/core/scripts/perf/fixtureVault";

/**
 * How a pass of the index reads files over the bridge, in the built app.
 *
 * The full scan used to read each file the way `TauriVaultAdapter` reads one:
 * two path calls (`join`, `normalize`), the read (`checked_read_text_file`)
 * and the hash in JavaScript — one file after the other. Since it reads
 * ahead, the desktop reads a group of files in one call
 * (`read_files_for_index`), hashed in Rust. Here the page reads the same
 * folder of generated notes all three ways, in the same run — one by one in
 * turn, one by one eight at a time, and in groups — and every way must hand
 * back the same text and the same hash for every file. The times go to the
 * log and to `wdio-logs/index-read.json`; they are a measurement, not a gate.
 */

const COUNT = Number(process.env.PLAINVA_INDEX_READ_NOTES ?? 3000);

describe("reading for the index over the bridge", () => {
  let folder = "";
  const files: Array<{ path: string; text: boolean; sha256: string }> = [];

  before(() => {
    folder = mkdtempSync(join(tmpdir(), "plainva-index-read-"));
    for (const file of fixtureFiles({ count: COUNT, longTableNote: false })) {
      const target = join(folder, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.data);
      const bytes = typeof file.data === "string" ? Buffer.from(file.data, "utf8") : Buffer.from(file.data);
      files.push({ path: file.path, text: typeof file.data === "string", sha256: createHash("sha256").update(bytes).digest("hex") });
    }
  });

  after(() => {
    if (folder) rmSync(folder, { recursive: true, force: true });
  });

  it("I1 reads a generated vault one by one and in groups, with the same answers", async () => {
    // The bridge, not a vault: this spec reads a folder of its own.
    await browser.waitUntil(async () => browser.execute(() => !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__), { timeout: 60_000, interval: 500 });
    const result = await browser.executeAsync(
      (root: string, asked: Array<{ path: string; text: boolean }>, done: (result: unknown) => void) => {
        const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
        const invoke = internals.invoke.bind(internals);
        const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
        const textFiles = asked.filter((f) => f.text);
        (async () => {
          const rootId = String(await invoke("register_write_root", { path: root }));
          /** One file the way the adapter reads one: two path calls, the read, the hash here. */
          const readOne = async (path: string) => {
            const joined = await invoke("plugin:path|join", { paths: [root, path] });
            await invoke("plugin:path|normalize", { path: joined });
            const text = await invoke("checked_read_text_file", { rootId, relPath: path });
            const sha256 = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text))));
            return { path, text: String(text), sha256 };
          };
          const answers: Record<string, Map<string, { text: string; sha256: string }>> = {};
          const times: Record<string, number> = {};

          let began = performance.now();
          const inTurn = new Map<string, { text: string; sha256: string }>();
          for (const file of textFiles) {
            const one = await readOne(file.path);
            inTurn.set(one.path, one);
          }
          times.oneByOneInTurnMs = performance.now() - began;
          answers.inTurn = inTurn;

          began = performance.now();
          const eightAtATime = new Map<string, { text: string; sha256: string }>();
          let next = 0;
          await Promise.all(Array.from({ length: 8 }, async () => {
            while (next < textFiles.length) {
              const file = textFiles[next++];
              const one = await readOne(file.path);
              eightAtATime.set(one.path, one);
            }
          }));
          times.oneByOneEightAtATimeMs = performance.now() - began;
          answers.eightAtATime = eightAtATime;

          // As the scan asks: groups of eight, two groups at a time.
          began = performance.now();
          const grouped = new Map<string, { text: string; sha256: string }>();
          const groups: Array<Array<{ path: string; text: boolean }>> = [];
          for (let i = 0; i < textFiles.length; i += 8) groups.push(textFiles.slice(i, i + 8));
          let nextGroup = 0;
          let fallbacks = 0;
          await Promise.all(Array.from({ length: 2 }, async () => {
            while (nextGroup < groups.length) {
              const group = groups[nextGroup++];
              const out = (await invoke("read_files_for_index", { rootId, files: group.map((f) => ({ relPath: f.path, text: f.text })) })) as Array<{ kind: string; text?: string; sha256?: string }>;
              out.forEach((answer, i) => {
                if (answer.kind === "text") grouped.set(group[i].path, { text: answer.text!, sha256: answer.sha256! });
                else fallbacks++;
              });
            }
          }));
          times.inGroupsMs = performance.now() - began;
          answers.grouped = grouped;

          // Attachments: hashed in Rust, never carried over the bridge (their hash is checked against the file's).
          const attachments = asked.filter((f) => !f.text).slice(0, 200);
          began = performance.now();
          const attachmentHashes: Record<string, string> = {};
          for (let i = 0; i < attachments.length; i += 8) {
            const group = attachments.slice(i, i + 8);
            const out = (await invoke("read_files_for_index", { rootId, files: group.map((f) => ({ relPath: f.path, text: false })) })) as Array<{ kind: string; sha256?: string }>;
            out.forEach((answer, k) => { if (answer.kind === "bytes") attachmentHashes[group[k].path] = answer.sha256!; });
          }
          times.attachmentsInGroupsMs = performance.now() - began;

          const asRecord = (map: Map<string, { text: string; sha256: string }>) => Object.fromEntries([...map].map(([p, v]) => [p, v.sha256]));
          done({
            notes: textFiles.length,
            attachments: attachments.length,
            times,
            fallbacks,
            hashes: { inTurn: asRecord(answers.inTurn), eightAtATime: asRecord(answers.eightAtATime), grouped: asRecord(answers.grouped), attachments: attachmentHashes },
            sameText: [...answers.inTurn].every(([p, v]) => answers.grouped.get(p)?.text === v.text && answers.eightAtATime.get(p)?.text === v.text),
          });
        })().catch((error) => done({ error: String(error) }));
      },
      folder,
      files.map(({ path, text }) => ({ path, text })),
    ) as {
      error?: string; notes: number; attachments: number; times: Record<string, number>; fallbacks: number; sameText: boolean;
      hashes: { inTurn: Record<string, string>; eightAtATime: Record<string, string>; grouped: Record<string, string>; attachments: Record<string, string> };
    };
    if (result.error) throw new Error(`the page could not read the folder: ${result.error}`);
    // The adapter's way hashes the text it was handed, the group's way the bytes on disk: the same for a UTF-8 file.
    const expected = new Map(files.filter((f) => f.text).map((f) => [f.path, f.sha256]));
    const differs = (way: string, got: Record<string, string>) => {
      const wrong = [...expected].filter(([path, sha]) => got[path] !== sha);
      if (wrong.length > 0) {
        const [path, sha] = wrong[0];
        throw new Error(`${way}: ${wrong.length} of ${expected.size} hashes are not the file's, the first ${path} (${got[path] ?? "missing"} for ${sha})`);
      }
    };
    differs("in groups", result.hashes.grouped);
    differs("one by one", result.hashes.inTurn);
    differs("eight at a time", result.hashes.eightAtATime);
    for (const [path, sha] of Object.entries(result.hashes.attachments)) {
      if (files.find((f) => f.path === path)?.sha256 !== sha) throw new Error(`an attachment's hash from Rust is not its own: ${path}`);
    }
    if (!result.sameText) throw new Error("the three ways handed out different text");
    if (result.fallbacks !== 0) throw new Error(`${result.fallbacks} plain UTF-8 notes went to the fallback`);
    const report = { platform: process.platform, notes: result.notes, attachments: result.attachments, times: result.times };
    console.log(`[index-read] ${JSON.stringify(report)}`);
    mkdirSync("wdio-logs", { recursive: true });
    writeFileSync(join("wdio-logs", "index-read.json"), JSON.stringify(report, null, 2));
  });
});
