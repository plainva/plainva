import { Zip, ZipDeflate } from "fflate";
import { vaultExportFileName, ZIP_EXCLUDED_DIR_NAMES } from "@plainva/ui";
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { createSha256Stream, VaultFileNotFoundError } from "@plainva/core";
import { BRIDGE_PART_BYTES, nativeFileDigest } from "../platform/atomicFile";
import type { MobileVault } from "./vaultService";

/**
 * Vault export (M3E package G): the whole vault as one ZIP through the OS
 * share sheet (AirDrop, Drive, mail, …). Pure-JS zipping (fflate) — the
 * desktop keeps its native Rust zipper; the phone streams the archive into a
 * file part by part (`streamVaultZip`). Device-local noise (.plainva, .git, …) stays out,
 * matching the desktop's exclude list.
 */


/** Uint8Array → base64 without blowing the call stack on big files. */
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Where the parts of an archive go as they are made. */
export interface ZipSink {
  write(bytes: Uint8Array): Promise<void>;
}

/**
 * The vault as one ZIP, handed to `sink` part by part as it is made. Shared
 * by the on-demand export and the scheduled archive (S36) so both carry the
 * same contents — an archive that excluded different things than the export
 * would be a second, unstated definition of "the vault".
 *
 * The archive is never whole in memory (release list F51: the phone's
 * archive of a vault that had grown to 88 MB was one 118 MB message over the
 * bridge, and the app ran out of memory 40 s after every start). One file is
 * read at a time, in parts (`nativeReadBytes`); what the zipper makes of it
 * goes to the sink before the next file is read. What the page holds is the
 * largest single file and its compressed form, whatever the vault's size.
 */
/** Thrown when the archive is asked to stop (the scheduled backup was switched off while it ran). */
export class ZipStoppedError extends Error {
  constructor() {
    super("The archive was stopped");
    this.name = "ZipStoppedError";
  }
}

export async function streamVaultZip(v: MobileVault, sink: ZipSink, shouldStop: () => boolean = () => false): Promise<void> {
  if (!v.adapter.listDirForBackup) throw new Error("Complete backup listing is unavailable");
  const entries = await v.adapter.listDirForBackup(ZIP_EXCLUDED_DIR_NAMES);
  const ready: Uint8Array[] = [];
  let failure: Error | null = null;
  let finished = false;
  const zip = new Zip((error, chunk, final) => {
    if (error) { failure = error; return; }
    ready.push(chunk);
    if (final) finished = true;
  });
  const drain = async () => {
    while (ready.length > 0) await sink.write(ready.shift()!);
  };
  try {
    // Explicit entries avoid the object-key flattening of zipSync, where a
    // legitimate root filename such as __proto__ can be omitted or misread.
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      if (shouldStop()) throw new ZipStoppedError();
      let bytes: Uint8Array;
      try {
        bytes = await v.adapter.readBinaryFile(entry.path);
      } catch (error) {
        // Gone since the listing (the sync removed it): the vault no longer has it, and the archive goes on.
        if (error instanceof VaultFileNotFoundError) continue;
        throw error;
      }
      const file = new ZipDeflate(entry.path, { level: 6 });
      zip.add(file);
      file.push(bytes, true);
      if (failure) throw failure;
      await drain();
    }
    zip.end();
    if (failure) throw failure;
    if (!finished) throw new Error("Backup ZIP did not finish");
    await drain();
  } catch (error) {
    zip.terminate();
    throw error;
  }
}

/** The whole archive in memory: the browser build's download and the tests. */
export async function buildVaultZipBytes(v: MobileVault): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  await streamVaultZip(v, { write: async (chunk) => { chunks.push(chunk); } });
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

/**
 * A file the archive is written into on a phone: the parts are collected up
 * to one bridge part (`BRIDGE_PART_BYTES`) and appended, so no call carries
 * more; the SHA-256 and the size are taken on the way, for the check that
 * reads nothing back.
 */
export class PartFileSink implements ZipSink {
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private begun = false;
  private readonly hash = createSha256Stream();
  size = 0;

  /** Whether anything was written yet - before that, there is no file to remove. */
  get started(): boolean {
    return this.begun;
  }

  constructor(private readonly path: string, private readonly directory: Directory) {}

  async write(bytes: Uint8Array): Promise<void> {
    this.hash.update(bytes);
    this.size += bytes.length;
    for (let at = 0; at < bytes.length; ) {
      const take = Math.min(bytes.length - at, BRIDGE_PART_BYTES - this.pendingBytes);
      this.pending.push(bytes.subarray(at, at + take));
      this.pendingBytes += take;
      at += take;
      if (this.pendingBytes >= BRIDGE_PART_BYTES) await this.flush();
    }
  }

  /** Writes what is left; the hex SHA-256 of everything written. */
  async close(): Promise<string> {
    await this.flush();
    if (!this.begun) await Filesystem.writeFile({ path: this.path, directory: this.directory, data: "", recursive: true });
    return this.hash.hex();
  }

  private async flush(): Promise<void> {
    if (this.pendingBytes === 0) return;
    const part = new Uint8Array(this.pendingBytes);
    let at = 0;
    for (const piece of this.pending) { part.set(piece, at); at += piece.length; }
    this.pending = [];
    this.pendingBytes = 0;
    const data = toBase64(part);
    if (!this.begun) {
      this.begun = true;
      await Filesystem.writeFile({ path: this.path, directory: this.directory, data, recursive: true });
    } else {
      await Filesystem.appendFile({ path: this.path, directory: this.directory, data });
    }
  }
}

/** The archive being made for each vault, by vault id; exports of other vaults run one after the other. */
const building = new Map<string, Promise<string | null>>();
let line: Promise<unknown> = Promise.resolve();

/**
 * The vault through the share sheet. One archive per vault at a time: a second
 * tap while it is made waits for it and shares nothing of its own (two runs
 * wrote into one file and the share sheet got a broken archive); an export of
 * another vault meanwhile runs after it. The lock is free once the file is
 * made and checked - not when the share sheet comes back, which it may never
 * do. Written into a part file of its own, checked like the scheduled archive,
 * and only then handed on.
 */
export async function exportVault(v: MobileVault, label: string): Promise<void> {
  const running = building.get(v.vaultId);
  if (running) {
    await running;
    return;
  }
  const made = line.then(() => buildExport(v, label));
  line = made.catch(() => {
    // silent: this export's caller hears of its failure; the next one starts anyway.
  });
  building.set(v.vaultId, made);
  let uri: string | null;
  try {
    uri = await made;
  } finally {
    if (building.get(v.vaultId) === made) building.delete(v.vaultId);
  }
  if (uri) await Share.share({ title: vaultExportFileName(label), url: uri });
}

/** Makes the archive and answers where it lies (the browser build downloads it and answers null). */
async function buildExport(v: MobileVault, label: string): Promise<string | null> {
  // The same name the desktop proposes for its export (`vaultExportFileName`).
  const name = vaultExportFileName(label);

  if (Capacitor.getPlatform() === "web") {
    // Dev-server fallback: a plain download instead of the share sheet.
    const zip = await buildVaultZipBytes(v);
    const url = URL.createObjectURL(new Blob([zip as unknown as BlobPart], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return null;
  }

  // Written as it is made, in parts (see `streamVaultZip`), into a part file of its own; checked; then moved into place.
  const path = `exports/${name}`;
  const partial = `${path}.${crypto.randomUUID()}.part`;
  const sink = new PartFileSink(partial, Directory.Cache);
  try {
    await streamVaultZip(v, sink);
    const written = await sink.close();
    const checked = await nativeFileDigest(partial, "CACHE");
    if (!checked || checked.size !== sink.size || checked.sha256 !== written) throw new Error("Export verification failed");
    await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {
      // silent: no earlier export of that name lies there.
    });
    await Filesystem.rename({ from: partial, to: path, directory: Directory.Cache, toDirectory: Directory.Cache });
  } catch (error) {
    if (sink.started) await Filesystem.deleteFile({ path: partial, directory: Directory.Cache }).catch(() => {
      // silent: the cache is the system's to empty; the export's own failure is thrown.
    });
    throw error;
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  return uri;
}

/**
 * The vault map as SVG through the same share sheet (S34). The desktop writes
 * it to a chosen path; a phone has no file dialog, so the picture leaves the
 * same way everything else does. SVG rather than PNG because the engine draws
 * one directly — a PNG would mean re-rasterising the canvas at a resolution
 * nobody chose, and a map is mostly text.
 */
export async function shareGraphSvg(svg: string, label: string): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${label.replace(/[^\w.-]+/g, "_") || "graph"}-${stamp}.svg`;

  if (Capacitor.getPlatform() === "web") {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }

  const path = `exports/${name}`;
  await Filesystem.writeFile({ path, directory: Directory.Cache, data: svg, encoding: Encoding.UTF8, recursive: true });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  await Share.share({ title: name, url: uri });
}
