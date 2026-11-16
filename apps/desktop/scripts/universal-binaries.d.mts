/** Types for `universal-binaries.mjs` (the `beforeBundleCommand` of the desktop app). */
export declare const UNIVERSAL_TRIPLE: "universal-apple-darwin";
export declare const UNIVERSAL_PARTS: string[];
export declare function extraBinaries(fileNames: string[]): string[];
export declare function universalPlan(context: {
  triple: string | undefined;
  debug: boolean;
  targetDir: string;
  binaries: string[];
}): { name: string; output: string; inputs: string[] }[] | null;
