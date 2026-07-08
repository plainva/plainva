import { merge } from "node-diff3";

export type MergeResult = {
  mergedText: string;
  hasConflicts: boolean;
};

/**
 * Performs a 3-way text merge using diff3.
 * 
 * @param base The original common ancestor text
 * @param yours The local text changes
 * @param theirs The remote text changes
 * @returns An object containing the merged text (with conflict markers if any) and a boolean indicating if conflicts exist.
 */
export function mergeText(base: string, yours: string, theirs: string): MergeResult {
  // Split strings into arrays of lines.
  const splitLines = (str: string) => str.split(/\r?\n/);
  
  const baseLines = splitLines(base);
  const yoursLines = splitLines(yours);
  const theirsLines = splitLines(theirs);

  const result = merge(yoursLines, baseLines, theirsLines);
  
  return {
    mergedText: result.result.join("\n"),
    hasConflicts: result.conflict
  };
}
