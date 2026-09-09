import { Zip, ZipDeflate } from "fflate";
import { ZIP_EXCLUDED_DIR_NAMES } from "@plainva/ui";
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { MobileVault } from "./vaultService";

/**
 * Vault export (M3E package G): the whole vault as one ZIP through the OS
 * share sheet (AirDrop, Drive, mail, …). Pure-JS zipping (fflate) — the
 * desktop keeps its native Rust zipper; mobile vaults are small enough for
 * an in-memory pass. Device-local noise (.plainva, .git, …) stays out,
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

/**
 * The vault as one ZIP. Shared by the on-demand export and the scheduled
 * archive (S36) so both carry the same contents — an archive that excluded
 * different things than the export would be a second, unstated definition of
 * "the vault".
 */
export async function buildVaultZipBytes(v: MobileVault): Promise<Uint8Array> {
  if (!v.adapter.listDirForBackup) throw new Error("Complete backup listing is unavailable");
  const entries = await v.adapter.listDirForBackup(ZIP_EXCLUDED_DIR_NAMES);
  const chunks: Uint8Array[] = [];
  let failure: Error | null = null;
  let finished = false;
  const zip = new Zip((error, chunk, final) => {
    if (error) { failure = error; return; }
    chunks.push(chunk);
    if (final) finished = true;
  });
  try {
    // Explicit entries avoid the object-key flattening of zipSync, where a
    // legitimate root filename such as __proto__ can be omitted or misread.
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const bytes = await v.adapter.readBinaryFile(entry.path);
      const file = new ZipDeflate(entry.path, { level: 6 });
      zip.add(file);
      file.push(bytes, true);
      if (failure) throw failure;
    }
    zip.end();
    if (failure) throw failure;
    if (!finished) throw new Error("Backup ZIP did not finish");
    const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
  } catch (error) {
    zip.terminate();
    throw error;
  }
}

/** Same ZIP, base64 — what the Capacitor filesystem writes. */
export async function buildVaultZip(v: MobileVault): Promise<string> {
  return toBase64(await buildVaultZipBytes(v));
}

export async function exportVault(v: MobileVault, label: string): Promise<void> {
  const zip = await buildVaultZipBytes(v);
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${label.replace(/[^\w.-]+/g, "_") || "vault"}-${stamp}.zip`;

  if (Capacitor.getPlatform() === "web") {
    // Dev-server fallback: a plain download instead of the share sheet.
    const url = URL.createObjectURL(new Blob([zip as unknown as BlobPart], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }

  const path = `exports/${name}`;
  await Filesystem.writeFile({
    path,
    directory: Directory.Cache,
    data: toBase64(zip),
    recursive: true,
  });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  await Share.share({ title: name, url: uri });
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
