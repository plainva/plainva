import { zipSync } from "fflate";
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { MobileVault } from "./vaultService";

/**
 * Vault export (M3E package G): the whole vault as one ZIP through the OS
 * share sheet (AirDrop, Drive, mail, …). Pure-JS zipping (fflate) — the
 * desktop keeps its native Rust zipper; mobile vaults are small enough for
 * an in-memory pass. Device-local noise (.plainva, .git, …) stays out,
 * matching the desktop's exclude list.
 */

const EXCLUDES = /^(\.plainva|\.git|\.trash|\.obsidian|node_modules)(\/|$)/;

/** Uint8Array → base64 without blowing the call stack on big files. */
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export async function exportVault(v: MobileVault, label: string): Promise<void> {
  const entries = await v.adapter.listDir("", true);
  const files: Record<string, Uint8Array> = {};
  for (const e of entries) {
    if (e.isDirectory || EXCLUDES.test(e.path)) continue;
    try {
      files[e.path] = await v.adapter.readBinaryFile(e.path);
    } catch {
      /* unreadable entries stay out; the export still carries the rest */
    }
  }
  const zip = zipSync(files, { level: 6 });
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
