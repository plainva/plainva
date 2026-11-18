import { mkdir, readTextFile, remove } from "@tauri-apps/plugin-fs";
import type { NewVaultFolderPorts } from "@plainva/ui";
import { forgetVaultData } from "./vaultForget";

/**
 * The disk behind `writeNewVault` (third review of O8). Nothing here is
 * recursive: `mkdir` without `recursive` fails at a folder that is there, and
 * `remove` without it fails at a folder that is not empty — which is what
 * keeps a take-back to the attempt's own files and folders.
 */
export const newVaultFolderPorts: NewVaultFolderPorts = {
  makeDir: (path) => mkdir(path),
  readText: (path) => readTextFile(path),
  removeFile: (path) => remove(path),
  removeEmptyDir: (path) => remove(path),
  forget: async (path) => {
    await forgetVaultData(path, { deleteZipBackups: false });
  },
};
