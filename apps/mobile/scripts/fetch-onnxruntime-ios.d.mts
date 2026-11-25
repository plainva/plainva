/** Types of `fetch-onnxruntime-ios.mjs`: ONNX Runtime for the iOS shell, from Microsoft's NuGet package. */
export interface PackagePin { bytes: number; sha256: string }
export interface IosPins { packages: Record<string, PackagePin>; xcframeworks: Record<string, PackagePin> }
export interface ZipEntry { name: string; method: number; packed: number; size: number; local: number; mode: number }
export declare const VERSION: string;
export declare const ENTRY: string;
export declare const FRAMEWORK: string;
export declare const XCFRAMEWORKS: Record<string, PackagePin>;
export declare function listZipEntries(zip: Buffer): ZipEntry[];
export declare function extractFramework(zip: Buffer, target: string): number;
export declare function fetchFrameworkArchive(options?: {
  version?: string;
  fetchImpl?: (url: string, init?: { redirect?: string }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  cacheDir?: string | null;
  log?: (line: string) => void;
  pins?: IosPins;
}): Promise<Buffer>;
