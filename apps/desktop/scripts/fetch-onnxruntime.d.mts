export interface ArchivePin { version: string; name: string; bytes: number; sha256: string; library: string }
export interface PackagePin { bytes: number; sha256: string }
export interface LibraryPin { rid: string; file: string; bytes: number; sha256: string; sameOnGithub: boolean }
export interface Pins { archives: Record<string, ArchivePin>; packages: Record<string, PackagePin>; libraries: Record<string, LibraryPin> }
export const RELEASES: string;
export const NUGET: string;
export const ARCHIVES: Record<string, ArchivePin>;
export const PACKAGES: Record<string, PackagePin>;
export const LIBRARIES: Record<string, LibraryPin>;
export const NOTICES: string[];
export function sha256(bytes: Uint8Array): string;
export function readZipEntry(zip: Buffer, name: string): Buffer | undefined;
export function readTarGzEntry(tgz: Buffer, name: string): Buffer | undefined;
export function githubUnavailable(error: unknown): boolean;
export function checkLibrary(key: string, bytes: Buffer, source: string, libraries?: Record<string, LibraryPin>): void;
export function fetchLibrary(
  key: string,
  options?: {
    fetchImpl?: (url: string, init?: { redirect?: string }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
    cacheDir?: string | null;
    log?: (line: string) => void;
    pins?: Pins;
  },
): Promise<{ lib: Buffer; notices: Record<string, Buffer | undefined>; source: "github" | "nuget" }>;
