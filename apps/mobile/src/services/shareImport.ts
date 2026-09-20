import type { IVaultAdapter } from "@plainva/core";
import { SHARE_LIMITS, validateShare, type PendingShare, type SharedFile, type ShareImportPlan, type ShareTargetPort } from "./shareTarget";

const active = new Map<string, { vaultId: string; run: Promise<string> }>();
function safeName(name: string): string {
  let result = "", size = 0;
  for (const c of name.split(/[\\/]/).pop() || "Shared") {
    const char = c.charCodeAt(0) < 32 || '<>:"|?*[]#^'.includes(c) ? "_" : c;
    size += new TextEncoder().encode(char).length;
    if (size > 160) break;
    result += char;
  }
  return result.replace(/[. ]+$/, "") || "Shared";
}
const safePath = (path: string) => typeof path === "string" && !path.startsWith("/") && !path.includes("\\") && !path.split("/").some(p => !p || p === "." || p === ".." || new TextEncoder().encode(p).length > 255 || [...p].some(c => c.charCodeAt(0) < 32 || '<>:"|?*'.includes(c)));
async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function checkPlan(plan: ShareImportPlan, share: PendingShare, vaultId: string): void {
  if (plan?.version !== 1 || plan.vaultId !== vaultId) throw new Error("SHARE_OTHER_VAULT");
  if (!safePath(plan.notePath) || !plan.notePath.endsWith(".md") || typeof plan.noteText !== "string"
    || new TextEncoder().encode(plan.noteText).length > SHARE_LIMITS.textBytes + 16384
    || !Array.isArray(plan.files) || plan.files.length !== share.files.length
    || new Set(plan.files.map(f => f.path.toLowerCase())).size !== plan.files.length
    || plan.files.some(f => !safePath(f.path) || !f.path.startsWith(`Attachments/Shared/${share.id}/`) || !share.files.some(s => s.id === f.id))
    || new Set(plan.files.map(f => f.id)).size !== plan.files.length) throw new Error("SHARE_INVALID");
}
async function readFile(port: ShareTargetPort, shareId: string, file: SharedFile, guard: () => Promise<void>) {
  const bytes = new Uint8Array(file.size);
  for (let offset = 0; offset < file.size; offset += SHARE_LIMITS.chunkBytes) {
    await guard();
    const length = Math.min(SHARE_LIMITS.chunkBytes, file.size - offset);
    const { data } = await port.readFileChunk({ id: shareId, fileId: file.id, offset, length });
    if (typeof data !== "string" || data.length > Math.ceil(length / 3) * 4) throw new Error("SHARE_INVALID");
    const binary = atob(data);
    if (binary.length !== length) throw new Error("SHARE_INCOMPLETE");
    for (let i = 0; i < length; i++) bytes[offset + i] = binary.charCodeAt(i);
  }
  if (await hash(bytes) !== file.sha256) throw new Error("SHARE_INCOMPLETE");
  return bytes;
}

export interface ShareImportContext {
  vaultId: string;
  files: IVaultAdapter;
  folder: string;
  /** Recheck the active vault and workspace lock before every read/write. */
  ensureOpen(): Promise<void>;
  signal?: AbortSignal;
  onProgress?(done: number, total: number): void;
  /**
   * "As a task" (plan Aufgaben-Oberflaeche, B6): instead of a plain note in
   * `folder`, the shared content becomes an entry of the task database — title
   * from the subject or the first line, text and attachment links in the body.
   * The host says WHERE a task belongs and what it looks like; this pipeline
   * keeps owning the path and the write, so a retry still lands in one place.
   * Asked only while the plan is being made: a share whose plan already exists
   * is finished as planned.
   */
  asTask?(input: { title: string; body: string }): Promise<{ folder: string; text: string }>;
}

/** One durable native plan owns every path; no automatic rename after a retry. */
export function importSharedContent(port: ShareTargetPort, incoming: PendingShare, ctx: ShareImportContext): Promise<string> {
  const inFlight = active.get(incoming.id);
  if (inFlight) return inFlight.vaultId === ctx.vaultId ? inFlight.run : Promise.reject(new Error("SHARE_OTHER_VAULT"));
  const run = runImport(port, incoming, ctx).finally(() => active.delete(incoming.id));
  active.set(incoming.id, { vaultId: ctx.vaultId, run });
  return run;
}
async function runImport(port: ShareTargetPort, incoming: PendingShare, ctx: ShareImportContext): Promise<string> {
  let share = validateShare(incoming);
  if (share.status !== "ready") throw new Error("SHARE_INCOMPLETE");
  const guard = async () => { ctx.signal?.throwIfAborted(); await ctx.ensureOpen(); };
  await guard();
  if (!share.plan) {
    if (ctx.folder && !safePath(ctx.folder)) throw new Error("SHARE_INVALID");
    const title = safeName(share.subject.trim() || share.text.split("\n")[0].slice(0, 60).trim() || share.files[0]?.name.replace(/\.[^.]+$/, "") || "Shared");
    const files = share.files.map((f, i) => ({ id: f.id, path: `Attachments/Shared/${share.id}/${i + 1}-${safeName(f.name)}` }));
    const links = files.map(f => `${share.files.find(s => s.id === f.id)!.mime.startsWith("image/") ? "!" : ""}[[${f.path}]]`);
    const task = ctx.asTask ? await ctx.asTask({ title, body: [share.text, ...links].filter(Boolean).join("\n\n") }) : null;
    const folder = task ? task.folder : ctx.folder;
    if (task && !safePath(folder)) throw new Error("SHARE_INVALID");
    const stem = `${folder ? folder + "/" : ""}${title} (${share.id.slice(0, 8)})`;
    let notePath = stem + ".md";
    for (let n = 2; await ctx.files.exists(notePath); n++) {
      await guard(); if (n > 100) throw new Error("SHARE_TARGET_CHANGED"); notePath = `${stem} ${n}.md`;
    }
    const noteText = task ? task.text : ["# " + title, share.text, ...links].filter(Boolean).join("\n\n") + "\n";
    share = validateShare((await port.beginImport({ id: share.id, plan: { version: 1, vaultId: ctx.vaultId, notePath, noteText, files } })).entry);
  }
  const plan = share.plan!;
  checkPlan(plan, share, ctx.vaultId);
  if (!share.noteWritten) {
    for (const [index, file] of share.files.entries()) {
      await guard();
      const path = plan.files.find(f => f.id === file.id)!.path;
      if (!share.filesDone?.includes(file.id)) {
        const bytes = await readFile(port, share.id, file, guard);
        await guard();
        if (await ctx.files.exists(path)) {
          if (await hash(await ctx.files.readBinaryFile(path)) !== file.sha256) throw new Error("SHARE_TARGET_CHANGED");
        } else {
          await ctx.files.writeBinaryFile(path, bytes);
          if (await hash(await ctx.files.readBinaryFile(path)) !== file.sha256) throw new Error("SHARE_WRITE_FAILED");
        }
        await port.markImported({ id: share.id, fileId: file.id });
      }
      ctx.onProgress?.(index + 1, share.files.length + 1);
    }
    await guard();
    if (await ctx.files.exists(plan.notePath)) {
      if (await ctx.files.readTextFile(plan.notePath) !== plan.noteText) throw new Error("SHARE_TARGET_CHANGED");
    } else {
      await ctx.files.writeTextFile(plan.notePath, plan.noteText);
      if (await ctx.files.readTextFile(plan.notePath) !== plan.noteText) throw new Error("SHARE_WRITE_FAILED");
    }
    await port.markImported({ id: share.id, note: true });
  }
  await guard();
  await port.finishShare({ id: share.id });
  ctx.onProgress?.(share.files.length + 1, share.files.length + 1);
  return plan.notePath;
}
